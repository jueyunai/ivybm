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
  FEISHU_OAUTH_SCOPES,
  hashOAuthState,
  refreshFeishuOAuthToken,
} from '@/modules/feishu/oauth'
import { provisionFeishuCRM } from '@/modules/feishu/provision'

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

  it('creates a free-tier-compatible Base and customer table without advanced permissions', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        response({
          code: 0,
          data: {
            app: {
              app_token: 'base_fixture',
              url: 'https://tenant.example.invalid/base/base_fixture',
            },
          },
        }),
      )
      .mockResolvedValueOnce(response({ code: 0, data: { table_id: 'tbl_fixture' } }))

    await expect(provisionFeishuCRM({ accessToken: 'user-access', fetch })).resolves.toEqual({
      appToken: 'base_fixture',
      baseURL: 'https://tenant.example.invalid/base/base_fixture',
      tableId: 'tbl_fixture',
    })
    expect(fetch.mock.calls.map(([url]) => String(url))).toEqual([
      'https://open.feishu.cn/open-apis/bitable/v1/apps',
      'https://open.feishu.cn/open-apis/bitable/v1/apps/base_fixture/tables',
    ])
    const tableBody = JSON.parse(String(fetch.mock.calls[1]?.[1]?.body))
    expect(tableBody.table.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field_name: '系统 Lead ID', type: 1 }),
        expect.objectContaining({ field_name: '下次跟进时间', type: 5 }),
      ]),
    )
    expect(JSON.stringify(tableBody)).not.toContain('advanced')
  })
})
