import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Payload } from 'payload'

import {
  buildFeishuRegisterAppOptions,
  configureRegisteredFeishuApp,
  FEISHU_APP_CONFIG_PROPAGATION_DELAY_MS,
  FEISHU_QR_TENANT_SCOPES,
  FEISHU_QR_USER_SCOPES,
  isFeishuQRRegistrationEnabled,
} from '@/modules/feishu/appRegistration'
import { PayloadFeishuTokenProvider } from '@/modules/feishu/connectionClient'
import {
  encryptFeishuCredential,
  readFeishuCredentialEncryptionKey,
} from '@/modules/feishu/credentials'

const response = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
    status,
  })

describe('Feishu QR app registration', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })
  it('requests only the reviewed app capabilities and user OAuth scopes', () => {
    const onQRCodeReady = vi.fn()
    const signal = new AbortController().signal

    expect(buildFeishuRegisterAppOptions({ onQRCodeReady, signal })).toEqual({
      addons: {
        preset: false,
        scopes: {
          tenant: [...FEISHU_QR_TENANT_SCOPES],
          user: [...FEISHU_QR_USER_SCOPES],
        },
      },
      appPreset: {
        desc: 'IVYBM 客户线索、飞书多维表格与销售提醒',
        name: 'IVYBM CRM - {user}',
      },
      createOnly: true,
      onQRCodeReady,
      onStatusChange: expect.any(Function),
      signal,
      source: 'ivybm-crm',
    })
    expect(FEISHU_QR_TENANT_SCOPES).toEqual([
      'application:application:patch',
      'im:message:send_as_bot',
    ])
    expect(FEISHU_QR_USER_SCOPES).toEqual(['auth:user.id:read', 'bitable:app', 'offline_access'])
  })

  it('configures the registered app with a tenant token and refreshable redirect URL', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        response({ code: 0, expire: 7200, tenant_access_token: 'tenant-token-fixture' }),
      )
      .mockResolvedValueOnce(response({ code: 0, msg: 'success' }))
    const settle = vi.fn(async () => undefined)

    await configureRegisteredFeishuApp({
      appId: 'cli_registered_fixture',
      appSecret: 'registered-secret-fixture',
      fetch,
      redirectURI: 'https://ivybm.example.invalid/api/integrations/feishu/callback',
      settle,
    })

    expect(fetch.mock.calls[0]?.[0]).toBe(
      'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal',
    )
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toEqual({
      app_id: 'cli_registered_fixture',
      app_secret: 'registered-secret-fixture',
    })
    expect(fetch.mock.calls[1]?.[0]).toBe(
      'https://open.feishu.cn/open-apis/application/v7/applications/cli_registered_fixture/config',
    )
    expect(fetch.mock.calls[1]?.[1]).toMatchObject({
      headers: {
        authorization: 'Bearer tenant-token-fixture',
        'content-type': 'application/json; charset=utf-8',
      },
      method: 'PATCH',
    })
    expect(JSON.parse(String(fetch.mock.calls[1]?.[1]?.body))).toEqual({
      security: {
        add: {
          redirect_urls: ['https://ivybm.example.invalid/api/integrations/feishu/callback'],
        },
        allow_refresh_token: true,
      },
    })
    expect(settle).toHaveBeenCalledWith(FEISHU_APP_CONFIG_PROPAGATION_DELAY_MS)
  })

  it('fails closed on provider errors without including credentials in the error', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(
        response({ code: 99991663, msg: 'secret registered-secret-fixture was rejected' }, 403),
      )

    const result = configureRegisteredFeishuApp({
      appId: 'cli_registered_fixture',
      appSecret: 'registered-secret-fixture',
      fetch,
      redirectURI: 'https://ivybm.example.invalid/api/integrations/feishu/callback',
      settle: vi.fn(async () => undefined),
    })

    await expect(result).rejects.toMatchObject({ code: 99991663, status: 403 })
    await expect(result).rejects.not.toThrow(/registered-secret-fixture/u)
  })

  it('enables registration only for the exact true feature flag', () => {
    expect(isFeishuQRRegistrationEnabled({ FEISHU_QR_REGISTRATION_ENABLED: 'true' })).toBe(true)
    expect(isFeishuQRRegistrationEnabled({ FEISHU_QR_REGISTRATION_ENABLED: 'TRUE' })).toBe(false)
    expect(isFeishuQRRegistrationEnabled({ FEISHU_QR_REGISTRATION_ENABLED: 'false' })).toBe(false)
    expect(isFeishuQRRegistrationEnabled({})).toBe(false)
  })

  it('uses the registered tenant credentials directly for bot tokens', async () => {
    vi.stubEnv('FEISHU_CREDENTIAL_ENCRYPTION_KEY', 'a'.repeat(64))
    vi.stubEnv('FEISHU_APP_ID', 'cli_store_app_must_not_be_used')
    vi.stubEnv('FEISHU_APP_SECRET', 'store-secret-must-not-be-used')
    const key = readFeishuCredentialEncryptionKey()
    const payload = {
      findByID: vi.fn(async () => ({
        appId: 'cli_registered_fixture',
        appSecretEncrypted: encryptFeishuCredential('registered-secret-fixture', key),
        authMode: 'qr_registered',
        id: 42,
        status: 'connected',
        tenantKey: 'tenant-fixture',
      })),
      logger: { error: vi.fn() },
    } as unknown as Payload
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(
        response({ code: 0, expire: 7200, tenant_access_token: 'registered-tenant-token' }),
      )

    const provider = new PayloadFeishuTokenProvider({ connectionId: 42, fetch, payload })
    await expect(provider.getToken('im')).resolves.toBe('registered-tenant-token')
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch.mock.calls[0]?.[0]).toBe(
      'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal',
    )
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toEqual({
      app_id: 'cli_registered_fixture',
      app_secret: 'registered-secret-fixture',
    })
  })
})
