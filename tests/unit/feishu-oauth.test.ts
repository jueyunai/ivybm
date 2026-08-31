import { describe, expect, it, vi } from 'vitest'

import {
  decryptFeishuCredential,
  encryptFeishuCredential,
  readFeishuCredentialEncryptionKey,
} from '@/modules/feishu/credentials'
import {
  buildFeishuAuthorizeURL,
  createOAuthAttempt,
  exchangeFeishuOAuthCode,
  FEISHU_OAUTH_REQUEST_TIMEOUT_MS,
  FEISHU_OAUTH_SCOPES,
  getFeishuOAuthUser,
  hashOAuthState,
  refreshFeishuOAuthToken,
} from '@/modules/feishu/oauth'
import { cleanupFeishuDefaultTables, provisionFeishuCRM } from '@/modules/feishu/provision'

const response = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
    status,
  })

describe('Feishu OAuth connection', () => {
  it('creates a short-lived state and S256 PKCE authorization URL', () => {
    const attempt = createOAuthAttempt(() => new Date('2026-07-30T00:00:00.000Z'))
    const url = new URL(
      buildFeishuAuthorizeURL({
        appId: 'cli_fixture',
        challenge: attempt.challenge,
        redirectURI: 'https://ivybm.example.invalid/api/integrations/feishu/callback',
        state: attempt.state,
      }),
    )

    expect(attempt.stateHash).toBe(hashOAuthState(attempt.state))
    expect(attempt.expiresAt).toBe('2026-07-30T00:10:00.000Z')
    expect(attempt.verifier.length).toBeGreaterThanOrEqual(43)
    expect(url.origin).toBe('https://accounts.feishu.cn')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('scope')).toBe(FEISHU_OAUTH_SCOPES.join(' '))
    expect(url.searchParams.get('state')).toBe(attempt.state)
  })

  it('supports confidential server apps without PKCE parameters', () => {
    const url = new URL(
      buildFeishuAuthorizeURL({
        appId: 'cli_confidential_fixture',
        redirectURI: 'https://ivybm.example.invalid/api/integrations/feishu/callback',
        state: 'state-fixture',
      }),
    )

    expect(url.searchParams.has('code_challenge')).toBe(false)
    expect(url.searchParams.has('code_challenge_method')).toBe(false)
  })

  it('encrypts OAuth credentials with the independent Feishu key', () => {
    const key = readFeishuCredentialEncryptionKey({
      FEISHU_CREDENTIAL_ENCRYPTION_KEY: 'a'.repeat(64),
    })
    const encrypted = encryptFeishuCredential('refresh-token-fixture', key)
    expect(encrypted).not.toContain('refresh-token-fixture')
    expect(decryptFeishuCredential(encrypted, key)).toBe('refresh-token-fixture')
    expect(() =>
      readFeishuCredentialEncryptionKey({ FEISHU_CREDENTIAL_ENCRYPTION_KEY: 'short' }),
    ).toThrow('64-character hexadecimal key')
  })

  it('uses the v3 token endpoint for code exchange and one-time refresh rotation', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        response({
          access_token: 'access-1',
          code: 0,
          expires_in: 7200,
          refresh_token: 'refresh-1',
          refresh_token_expires_in: 604800,
          scope: 'bitable:app offline_access',
        }),
      )
      .mockResolvedValueOnce(
        response({
          access_token: 'access-2',
          code: 0,
          expires_in: 7200,
          refresh_token: 'refresh-2',
          refresh_token_expires_in: 604800,
          scope: 'bitable:app offline_access',
        }),
      )

    const exchanged = await exchangeFeishuOAuthCode({
      appId: 'cli_fixture',
      appSecret: 'secret-fixture',
      clock: () => new Date('2026-07-30T00:00:00.000Z'),
      code: 'single-use-code',
      codeVerifier: 'v'.repeat(64),
      fetch,
      redirectURI: 'https://ivybm.example.invalid/api/integrations/feishu/callback',
    })
    const refreshed = await refreshFeishuOAuthToken({
      appId: 'cli_fixture',
      appSecret: 'secret-fixture',
      clock: () => new Date('2026-07-30T01:00:00.000Z'),
      fetch,
      refreshToken: exchanged.refreshToken,
    })

    expect(fetch.mock.calls[0]?.[0]).toBe('https://accounts.feishu.cn/oauth/v3/token')
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toMatchObject({
      code_verifier: 'v'.repeat(64),
      grant_type: 'authorization_code',
    })
    expect(JSON.parse(String(fetch.mock.calls[1]?.[1]?.body))).toEqual(
      expect.objectContaining({ grant_type: 'refresh_token', refresh_token: 'refresh-1' }),
    )
    expect(refreshed.refreshToken).toBe('refresh-2')
  })

  it('bounds OAuth provider requests and forwards an abort signal', async () => {
    vi.useFakeTimers()
    try {
      const fetch = vi.fn<typeof globalThis.fetch>(async (_input, init) => {
        const signal = init?.signal
        if (!signal) throw new Error('expected OAuth request signal')
        await new Promise<never>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true })
        })
        throw new Error('unreachable')
      })
      const result = exchangeFeishuOAuthCode({
        appId: 'cli_fixture',
        appSecret: 'secret-fixture',
        code: 'single-use-code',
        fetch,
        redirectURI: 'https://ivybm.example.invalid/api/integrations/feishu/callback',
        timeoutMs: 50,
      })

      const timedOut = expect(result).rejects.toMatchObject({ code: 'timeout', retryable: true })
      await vi.advanceTimersByTimeAsync(50)
      await timedOut
      expect(fetch.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal)
      expect(FEISHU_OAUTH_REQUEST_TIMEOUT_MS).toBeLessThan(120_000)
    } finally {
      vi.useRealTimers()
    }
  })

  it('applies the same bounded request contract to OAuth user lookup', async () => {
    vi.useFakeTimers()
    try {
      const fetch = vi.fn<typeof globalThis.fetch>(async (_input, init) => {
        const signal = init?.signal
        if (!signal) throw new Error('expected OAuth user request signal')
        await new Promise<never>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true })
        })
        throw new Error('unreachable')
      })
      const result = getFeishuOAuthUser({ accessToken: 'access-fixture', fetch, timeoutMs: 50 })
      const timedOut = expect(result).rejects.toMatchObject({ code: 'timeout', retryable: true })
      await vi.advanceTimersByTimeAsync(50)
      await timedOut
      expect(fetch.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal)
    } finally {
      vi.useRealTimers()
    }
  })

  it('creates a free-tier-compatible Base and customer table without advanced permissions', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        response({
          code: 0,
          data: {
            app: {
              app_token: 'base_fixture',
              default_table_id: 'tbl_default',
              url: 'https://tenant.example.invalid/base/base_fixture',
            },
          },
        }),
      )
      .mockResolvedValueOnce(response({ code: 0, data: { table_id: 'tbl_fixture' } }))
      .mockResolvedValueOnce(
        response({
          code: 0,
          data: {
            has_more: false,
            items: [
              { name: '客户档案', table_id: 'tbl_fixture' },
              { name: '默认数据表', table_id: 'tbl_default' },
            ],
          },
        }),
      )
      .mockResolvedValueOnce(response({ code: 0, data: { items: [], total: 0 } }))
      .mockResolvedValueOnce(response({ code: 0, data: {} }))

    await expect(provisionFeishuCRM({ accessToken: 'user-access', fetch })).resolves.toEqual({
      appToken: 'base_fixture',
      baseURL: 'https://tenant.example.invalid/base/base_fixture',
      defaultTableId: 'tbl_default',
      tableId: 'tbl_fixture',
    })
    expect(fetch.mock.calls.map(([url]) => String(url))).toEqual([
      'https://open.feishu.cn/open-apis/bitable/v1/apps',
      'https://open.feishu.cn/open-apis/bitable/v1/apps/base_fixture/tables',
      'https://open.feishu.cn/open-apis/bitable/v1/apps/base_fixture/tables?page_size=100',
      'https://open.feishu.cn/open-apis/bitable/v1/apps/base_fixture/tables/tbl_default/records?page_size=1',
      'https://open.feishu.cn/open-apis/bitable/v1/apps/base_fixture/tables/tbl_default',
    ])
    expect(fetch.mock.calls[3]?.[1]?.method).toBe('GET')
    expect(fetch.mock.calls[4]?.[1]?.method).toBe('DELETE')
    const tableBody = JSON.parse(String(fetch.mock.calls[1]?.[1]?.body))
    expect(tableBody.table.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field_name: '系统 Lead ID', type: 1 }),
        expect.objectContaining({ field_name: '图纸与附件', type: 1 }),
        expect.objectContaining({ field_name: '下次跟进时间', type: 5 }),
      ]),
    )
    expect(JSON.stringify(tableBody)).not.toContain('advanced')
  })
})

describe('cleanupFeishuDefaultTables', () => {
  const tablesPage = (items: unknown[], pageToken?: string) =>
    response({
      code: 0,
      data: {
        has_more: pageToken !== undefined,
        items,
        ...(pageToken ? { page_token: pageToken } : {}),
      },
    })

  it('deletes only the explicit empty default table ID', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      const url = String(input)
      if (url.endsWith('/tables?page_size=100')) {
        return tablesPage([
          { name: '客户档案', table_id: 'tbl_crm' },
          { name: '默认数据表', table_id: 'tbl_default' },
          { name: '默认数据表 2', table_id: 'tbl_extra' },
        ])
      }
      if (url.includes('/records?page_size=1')) {
        return response({ code: 0, data: { items: [], total: 0 } })
      }
      expect(init?.method).toBe('DELETE')
      return response({ code: 0, data: {} })
    })
    await expect(
      cleanupFeishuDefaultTables({
        accessToken: 'user-access',
        appToken: 'base_fixture',
        defaultTableId: 'tbl_default',
        fetch,
        keepTableId: 'tbl_crm',
      }),
    ).resolves.toEqual({ deletedTableIds: ['tbl_default'] })
    const deleted = fetch.mock.calls
      .filter(([, init]) => init?.method === 'DELETE')
      .map(([url]) => String(url))
    expect(deleted).toEqual([
      'https://open.feishu.cn/open-apis/bitable/v1/apps/base_fixture/tables/tbl_default',
    ])
  })

  it('never deletes a table that already contains records', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      const url = String(input)
      if (url.endsWith('/tables?page_size=100')) {
        return tablesPage([
          { name: '客户档案', table_id: 'tbl_crm' },
          { name: '默认数据表', table_id: 'tbl_default' },
        ])
      }
      if (url.includes('/records?page_size=1')) {
        return response({ code: 0, data: { items: [{ record_id: 'rec_1' }], total: 1 } })
      }
      throw new Error(`unexpected request ${init?.method} ${url}`)
    })
    await expect(
      cleanupFeishuDefaultTables({
        accessToken: 'user-access',
        appToken: 'base_fixture',
        defaultTableId: 'tbl_default',
        fetch,
        keepTableId: 'tbl_crm',
      }),
    ).resolves.toEqual({ deletedTableIds: [] })
  })

  it('continues when a single table check or delete fails', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
      const url = String(input)
      if (url.endsWith('/tables?page_size=100')) {
        return tablesPage([
          { name: '客户档案', table_id: 'tbl_crm' },
          { name: '已删除表', table_id: 'tbl_gone' },
          { name: '默认数据表', table_id: 'tbl_default' },
        ])
      }
      if (url.includes('/tbl_gone/records')) {
        return response({ code: 1254043, msg: 'table not found' }, 404)
      }
      if (url.includes('/records?page_size=1')) {
        return response({ code: 0, data: { items: [], total: 0 } })
      }
      return response({ code: 0, data: {} })
    })
    await expect(
      cleanupFeishuDefaultTables({
        accessToken: 'user-access',
        appToken: 'base_fixture',
        defaultTableId: 'tbl_gone',
        fetch,
        keepTableId: 'tbl_crm',
      }),
    ).resolves.toEqual({ deletedTableIds: [] })
  })

  it('paginates the table listing', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
      const url = String(input)
      if (url.endsWith('/tables?page_size=100')) {
        return tablesPage(
          [
            { name: '客户档案', table_id: 'tbl_crm' },
            { name: '默认数据表', table_id: 'tbl_page1' },
          ],
          'page-2',
        )
      }
      if (url.endsWith('/tables?page_size=100&page_token=page-2')) {
        return tablesPage([{ name: '默认数据表 2', table_id: 'tbl_page2' }])
      }
      if (url.includes('/records?page_size=1')) {
        return response({ code: 0, data: { items: [] } })
      }
      return response({ code: 0, data: {} })
    })
    await expect(
      cleanupFeishuDefaultTables({
        accessToken: 'user-access',
        appToken: 'base_fixture',
        defaultTableId: 'tbl_page2',
        fetch,
        keepTableId: 'tbl_crm',
      }),
    ).resolves.toEqual({ deletedTableIds: ['tbl_page2'] })
  })

  it('never infers a deletion candidate from a user-editable table name', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      const url = String(input)
      if (url.endsWith('/tables?page_size=100')) {
        return tablesPage([
          { name: '客户档案', table_id: 'tbl_crm' },
          { name: 'Table', table_id: 'tbl_custom_table' },
          { name: 'Table 1', table_id: 'tbl_custom_table_1' },
          { name: '数据表', table_id: 'tbl_custom_cn' },
        ])
      }
      if (url.includes('/records?page_size=1')) {
        return response({ code: 0, data: { items: [], total: 0 } })
      }
      expect(init?.method).toBe('DELETE')
      return response({ code: 0, data: {} })
    })
    await expect(
      cleanupFeishuDefaultTables({
        accessToken: 'user-access',
        appToken: 'base_fixture',
        fetch,
        keepTableId: 'tbl_crm',
      }),
    ).resolves.toEqual({ deletedTableIds: [] })
    const deleted = fetch.mock.calls
      .filter(([, init]) => init?.method === 'DELETE')
      .map(([url]) => String(url))
    expect(deleted).toEqual([])
    expect(fetch).not.toHaveBeenCalled()
  })

  it('deletes candidate matching explicit defaultTableId even with non-standard name', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      const url = String(input)
      if (url.endsWith('/tables?page_size=100')) {
        return tablesPage([
          { name: '客户档案', table_id: 'tbl_crm' },
          { name: '自定义初始表', table_id: 'tbl_auto_generated' },
        ])
      }
      if (url.includes('/records?page_size=1')) {
        return response({ code: 0, data: { items: [], total: 0 } })
      }
      expect(init?.method).toBe('DELETE')
      return response({ code: 0, data: {} })
    })
    await expect(
      cleanupFeishuDefaultTables({
        accessToken: 'user-access',
        appToken: 'base_fixture',
        defaultTableId: 'tbl_auto_generated',
        fetch,
        keepTableId: 'tbl_crm',
      }),
    ).resolves.toEqual({ deletedTableIds: ['tbl_auto_generated'] })
  })

  it('gracefully handles list tables network or API failure without throwing', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      response({ code: 99999, msg: 'internal server error' }, 500),
    )
    await expect(
      cleanupFeishuDefaultTables({
        accessToken: 'user-access',
        appToken: 'base_fixture',
        defaultTableId: 'tbl_default',
        fetch,
        keepTableId: 'tbl_crm',
      }),
    ).resolves.toEqual({ deletedTableIds: [] })
  })

})
