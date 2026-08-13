import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  META_OAUTH_CALLBACK_PATH,
  META_OAUTH_TRANSACTION_COOKIE,
  requiredMetaPermissions,
} from '@/modules/platforms/meta/oauth'

const mocks = vi.hoisted(() => ({
  commitTransaction: vi.fn(),
  createLocalReq: vi.fn(),
  getPayload: vi.fn(),
  initTransaction: vi.fn(),
  killTransaction: vi.fn(),
}))

vi.mock('payload', () => ({
  commitTransaction: mocks.commitTransaction,
  createLocalReq: mocks.createLocalReq,
  getPayload: mocks.getPayload,
  initTransaction: mocks.initTransaction,
  killTransaction: mocks.killTransaction,
}))
vi.mock('@/payload.config', () => ({ default: {} }))

import { GET as metaOAuthCallback } from '@/app/api/platforms/meta/oauth/callback/route'
import { POST as metaOAuthDisconnect } from '@/app/api/platforms/meta/oauth/disconnect/route'
import { GET as metaOAuthStart } from '@/app/api/platforms/meta/oauth/start/route'

const environmentKeys = [
  'ADMIN_PORTAL_ENABLED',
  'ADMIN_PORTAL_PLATFORMS_ENABLED',
  'META_APP_ID',
  'META_LOGIN_CONFIG_ID',
  'META_OAUTH_REDIRECT_URI',
  'META_WEBHOOK_APP_SECRET',
  'NEXT_PUBLIC_SERVER_URL',
  'PLATFORM_CREDENTIAL_ENCRYPTION_KEY',
] as const
const originalEnvironment = Object.fromEntries(
  environmentKeys.map((key) => [key, process.env[key]]),
)

const admin = { collection: 'users' as const, id: 7, role: 'admin' as const }
const account = {
  accountKind: 'facebook-page' as const,
  authorization: {
    accessTokenConfigured: false,
    refreshTokenConfigured: false,
    scopes: [],
    state: 'pending' as const,
  },
  authorizationRevision: 7,
  capabilities: { messagingInbound: 'pending' as const, publishing: 'pending' as const },
  connectionKey: 'facebook-page:123456789012345',
  createdAt: '2026-07-31T00:00:00.000Z',
  externalAccountId: '123456789012345',
  id: 42,
  name: 'Foshan Ivy Facebook Page',
  platformFamily: 'meta' as const,
  updatedAt: '2026-07-31T00:00:00.000Z',
}

type TestAccount = Omit<typeof account, 'accountKind' | 'externalAccountId'> & {
  accountKind: 'facebook-page' | 'instagram-professional'
  externalAccountId: null | string
}

const createPayload = ({
  authenticatedUser = admin,
  foundAccount = account,
}: {
  authenticatedUser?: null | typeof admin
  foundAccount?: TestAccount
} = {}) => {
  const oauthRow: {
    account_kind: string
    authorization_revision: number
    authorization_state: string
    external_account_id: null | string
    updated_at: string
  } = {
    account_kind: foundAccount.accountKind,
    authorization_revision: foundAccount.authorizationRevision,
    authorization_state: foundAccount.authorization.state,
    external_account_id: foundAccount.externalAccountId,
    updated_at: foundAccount.updatedAt,
  }
  return {
    auth: vi.fn().mockResolvedValue({ user: authenticatedUser }),
    findByID: vi.fn().mockResolvedValue(foundAccount),
    logger: { error: vi.fn() },
    db: {
      drizzle: {
        execute: vi.fn().mockResolvedValue({
          rows: [oauthRow],
        }),
      },
      sessions: {},
    },
    __oauthRow: oauthRow,
    update: vi.fn().mockResolvedValue(foundAccount),
  }
}

const startRequest = (): NextRequest =>
  new NextRequest('http://localhost:3000/api/platforms/meta/oauth/start?accountId=42')

const cookieHeader = (response: Response): string => {
  const setCookie = response.headers.get('set-cookie')
  if (!setCookie) throw new Error('Expected an OAuth transaction cookie')
  return setCookie.split(';', 1)[0]
}

describe('Meta OAuth routes', () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset()
    mocks.createLocalReq.mockResolvedValue({ transactionID: undefined })
    mocks.commitTransaction.mockResolvedValue(undefined)
    mocks.initTransaction.mockResolvedValue(undefined)
    mocks.killTransaction.mockResolvedValue(undefined)
    process.env.ADMIN_PORTAL_ENABLED = 'true'
    process.env.ADMIN_PORTAL_PLATFORMS_ENABLED = 'true'
    process.env.META_APP_ID = '1111111111111111'
    process.env.META_LOGIN_CONFIG_ID = '2222222222222222'
    process.env.META_OAUTH_REDIRECT_URI = `http://localhost:3000${META_OAUTH_CALLBACK_PATH}`
    process.env.META_WEBHOOK_APP_SECRET = 'test-meta-app-secret'
    process.env.NEXT_PUBLIC_SERVER_URL = 'https://ivybm.com'
    process.env.PLATFORM_CREDENTIAL_ENCRYPTION_KEY = 'b'.repeat(64)
  })

  it('stops OAuth callbacks while the platform module is disabled', async () => {
    process.env.ADMIN_PORTAL_PLATFORMS_ENABLED = 'false'

    const response = await metaOAuthCallback(
      new NextRequest(
        `http://localhost:3000${META_OAUTH_CALLBACK_PATH}?code=ignored&state=ignored`,
      ),
    )

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({
      error: { code: 'platform_module_disabled' },
    })
    expect(mocks.getPayload).not.toHaveBeenCalled()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    for (const [key, value] of Object.entries(originalEnvironment)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })

  it('requires an administrator before loading a platform account', async () => {
    const payload = createPayload({ authenticatedUser: null })
    mocks.getPayload.mockResolvedValue(payload)

    const response = await metaOAuthStart(startRequest())

    await expect(response.json()).resolves.toEqual({ error: { code: 'authentication_required' } })
    expect(response.status).toBe(401)
    expect(payload.findByID).not.toHaveBeenCalled()
  })

  it('redirects to Facebook Login for Business with an encrypted account transaction', async () => {
    const payload = createPayload()
    mocks.getPayload.mockResolvedValue(payload)

    const response = await metaOAuthStart(startRequest())
    const location = response.headers.get('location')
    const setCookie = response.headers.get('set-cookie')

    expect(response.status).toBe(302)
    const authorizationURL = new URL(String(location))
    expect(authorizationURL.hostname).toBe('www.facebook.com')
    expect(authorizationURL.searchParams.get('client_id')).toBe('1111111111111111')
    expect(authorizationURL.searchParams.get('config_id')).toBe('2222222222222222')
    expect(authorizationURL.searchParams.get('redirect_uri')).toBe(
      `http://localhost:3000${META_OAUTH_CALLBACK_PATH}`,
    )
    expect(setCookie).toContain(`${META_OAUTH_TRANSACTION_COOKIE}=v1%3A`)
    expect(setCookie).toContain('HttpOnly')
    expect(setCookie).toContain('SameSite=lax')
    expect(setCookie).toContain(`Path=${META_OAUTH_CALLBACK_PATH}`)
    expect(setCookie).not.toContain(account.externalAccountId)
    expect(setCookie).not.toContain('test-meta-app-secret')
  })

  it('rejects Instagram accounts because they require a separate OAuth configuration', async () => {
    const payload = createPayload({
      foundAccount: {
        ...account,
        accountKind: 'instagram-professional',
        externalAccountId: '987654321098765',
      },
    })
    mocks.getPayload.mockResolvedValue(payload)

    const response = await metaOAuthStart(startRequest())

    await expect(response.json()).resolves.toEqual({
      error: { code: 'instagram_oauth_separate_configuration_required' },
    })
    expect(response.status).toBe(409)
  })

  it('binds and stores the exact managed Facebook Page token after callback', async () => {
    const payload = createPayload()
    mocks.getPayload.mockResolvedValue(payload)
    const startResponse = await metaOAuthStart(startRequest())
    const state = new URL(String(startResponse.headers.get('location'))).searchParams.get('state')
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: 'short-user-token', token_type: 'bearer' }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: 'long-user-token', token_type: 'bearer' }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: requiredMetaPermissions('facebook-page').map((permission) => ({
              permission,
              status: 'granted',
            })),
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              {
                access_token: 'page-access-token',
                id: account.externalAccountId,
                name: account.name,
              },
            ],
          }),
          { status: 200 },
        ),
      )
    vi.stubGlobal('fetch', fetcher)

    const response = await metaOAuthCallback(
      new NextRequest(
        `https://untrusted-host.example${META_OAUTH_CALLBACK_PATH}?code=authorization-code&state=${state}`,
        { headers: { cookie: cookieHeader(startResponse) } },
      ),
    )

    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe(
      'http://localhost:3000/dashboard/platforms?metaOAuth=connected',
    )
    expect(response.headers.get('set-cookie')).toContain(`${META_OAUTH_TRANSACTION_COOKIE}=;`)
    expect(payload.update).toHaveBeenCalledWith({
      collection: 'platform-accounts',
      data: {
        authorization: {
          accessToken: 'page-access-token',
          appId: '1111111111111111',
          clearAccessToken: false,
          clearRefreshToken: true,
          expiresAt: null,
          scopes: requiredMetaPermissions('facebook-page').map((scope) => ({ scope })),
          state: 'connected',
        },
      },
      id: 42,
      overrideAccess: false,
      req: expect.any(Object),
      user: admin,
    })
  })

  it('logs safe diagnostics when Meta rejects the exact Page lookup fallback', async () => {
    const payload = createPayload()
    mocks.getPayload.mockResolvedValue(payload)
    const startResponse = await metaOAuthStart(startRequest())
    const state = new URL(String(startResponse.headers.get('location'))).searchParams.get('state')
    const providerMessage =
      'provider failure containing authorization-code, long-user-token and test-meta-app-secret'
    const oversizedProviderKey = `x${'y'.repeat(199_999)}`
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: 'short-user-token', expires_in: 3_600 }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: 'long-user-token', expires_in: 5_184_000 }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: requiredMetaPermissions('facebook-page').map((permission) => ({
              permission,
              status: 'granted',
            })),
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [] }), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            [oversizedProviderKey]: 'provider-controlled value',
            error: {
              code: 200,
              error_subcode: 2018065,
              message: providerMessage,
              type: 'long-user-token',
            },
          }),
          { status: 403 },
        ),
      )
    vi.stubGlobal('fetch', fetcher)

    const response = await metaOAuthCallback(
      new NextRequest(
        `http://localhost:3000${META_OAUTH_CALLBACK_PATH}?code=authorization-code&state=${state}`,
        { headers: { cookie: cookieHeader(startResponse) } },
      ),
    )

    expect(response.headers.get('location')).toBe(
      'http://localhost:3000/dashboard/platforms?metaOAuth=identity_verification_failed',
    )
    expect(payload.update).not.toHaveBeenCalled()
    expect(payload.logger.error).toHaveBeenCalledWith({
      code: 'identity_verification_failed',
      message: 'Meta OAuth callback failed',
      oauthCode: 'identity_verification_failed',
      providerErrorCode: 200,
      providerErrorSubcode: 2018065,
      providerResponseKeys: ['error'],
      providerStatus: 403,
      returnedPageIds: [],
      stage: 'page_direct',
      targetPageId: account.externalAccountId,
    })
    const serializedLog = JSON.stringify(payload.logger.error.mock.calls)
    expect(serializedLog).not.toContain('authorization-code')
    expect(serializedLog).not.toContain(String(state))
    expect(serializedLog).not.toContain('short-user-token')
    expect(serializedLog).not.toContain('long-user-token')
    expect(serializedLog).not.toContain('test-meta-app-secret')
    expect(serializedLog).not.toContain(providerMessage)
    expect(serializedLog).not.toContain(oversizedProviderKey)
  })

  it('does not persist a late callback after the account is disconnected', async () => {
    const payload = createPayload()
    mocks.getPayload.mockResolvedValue(payload)
    const startResponse = await metaOAuthStart(startRequest())
    const state = new URL(String(startResponse.headers.get('location'))).searchParams.get('state')
    let resolvePermissions!: (response: Response) => void
    let markPermissionsStarted!: () => void
    const permissionsStarted = new Promise<void>((resolve) => {
      markPermissionsStarted = resolve
    })
    const permissionsResponse = new Promise<Response>((resolve) => {
      resolvePermissions = resolve
    })
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: 'short-user-token', expires_in: 3_600 }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: 'long-user-token', expires_in: 5_184_000 }), {
          status: 200,
        }),
      )
      .mockImplementationOnce(async () => {
        markPermissionsStarted()
        return permissionsResponse
      })
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              { id: account.externalAccountId, name: account.name, access_token: 'page-token' },
            ],
          }),
          { status: 200 },
        ),
      )
    vi.stubGlobal('fetch', fetcher)

    const callbackPromise = metaOAuthCallback(
      new NextRequest(
        `http://localhost:3000${META_OAUTH_CALLBACK_PATH}?code=authorization-code&state=${state}`,
        { headers: { cookie: cookieHeader(startResponse) } },
      ),
    )
    await permissionsStarted

    const disconnect = await metaOAuthDisconnect(
      new NextRequest('http://localhost:3000/api/platforms/meta/oauth/disconnect', {
        body: JSON.stringify({ accountId: 42, authorizationRevision: 7 }),
        headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
        method: 'POST',
      }),
    )
    expect(disconnect.status).toBe(200)
    payload.__oauthRow.authorization_state = 'not_started'
    payload.__oauthRow.authorization_revision += 1
    payload.__oauthRow.updated_at = account.updatedAt
    resolvePermissions(
      new Response(
        JSON.stringify({
          data: requiredMetaPermissions('facebook-page').map((permission) => ({
            permission,
            status: 'granted',
          })),
        }),
        { status: 200 },
      ),
    )

    const response = await callbackPromise

    expect(response.headers.get('location')).toBe(
      'http://localhost:3000/dashboard/platforms?metaOAuth=account_changed',
    )
    expect(payload.update).toHaveBeenCalledTimes(1)
  })

  it('does not persist a callback after the provider identity changes', async () => {
    const payload = createPayload()
    mocks.getPayload.mockResolvedValue(payload)
    const startResponse = await metaOAuthStart(startRequest())
    const state = new URL(String(startResponse.headers.get('location'))).searchParams.get('state')
    let resolvePermissions!: (response: Response) => void
    let markPermissionsStarted!: () => void
    const permissionsStarted = new Promise<void>((resolve) => {
      markPermissionsStarted = resolve
    })
    const permissionsResponse = new Promise<Response>((resolve) => {
      resolvePermissions = resolve
    })
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: 'short-user-token', expires_in: 3_600 }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: 'long-user-token', expires_in: 5_184_000 }), {
          status: 200,
        }),
      )
      .mockImplementationOnce(async () => {
        markPermissionsStarted()
        return permissionsResponse
      })
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              { id: account.externalAccountId, name: account.name, access_token: 'page-token' },
            ],
          }),
          { status: 200 },
        ),
      )
    vi.stubGlobal('fetch', fetcher)

    const callbackPromise = metaOAuthCallback(
      new NextRequest(
        `http://localhost:3000${META_OAUTH_CALLBACK_PATH}?code=authorization-code&state=${state}`,
        { headers: { cookie: cookieHeader(startResponse) } },
      ),
    )
    await permissionsStarted
    payload.__oauthRow.external_account_id = '999999999999999'
    payload.__oauthRow.authorization_revision += 1
    payload.__oauthRow.updated_at = account.updatedAt
    resolvePermissions(
      new Response(
        JSON.stringify({
          data: requiredMetaPermissions('facebook-page').map((permission) => ({
            permission,
            status: 'granted',
          })),
        }),
        { status: 200 },
      ),
    )

    const response = await callbackPromise

    expect(response.headers.get('location')).toBe(
      'http://localhost:3000/dashboard/platforms?metaOAuth=account_changed',
    )
    expect(payload.update).not.toHaveBeenCalled()
  })

  it('does not overwrite replacement credentials when the timestamp is unchanged', async () => {
    const payload = createPayload()
    mocks.getPayload.mockResolvedValue(payload)
    const startResponse = await metaOAuthStart(startRequest())
    const state = new URL(String(startResponse.headers.get('location'))).searchParams.get('state')
    let resolvePermissions!: (response: Response) => void
    let markPermissionsStarted!: () => void
    const permissionsStarted = new Promise<void>((resolve) => {
      markPermissionsStarted = resolve
    })
    const permissionsResponse = new Promise<Response>((resolve) => {
      resolvePermissions = resolve
    })
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: 'short-user-token', expires_in: 3_600 }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: 'long-user-token', expires_in: 5_184_000 }), {
          status: 200,
        }),
      )
      .mockImplementationOnce(async () => {
        markPermissionsStarted()
        return permissionsResponse
      })
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              {
                id: account.externalAccountId,
                name: account.name,
                access_token: 'stale-page-token',
              },
            ],
          }),
          { status: 200 },
        ),
      )
    vi.stubGlobal('fetch', fetcher)

    const callbackPromise = metaOAuthCallback(
      new NextRequest(
        `http://localhost:3000${META_OAUTH_CALLBACK_PATH}?code=authorization-code&state=${state}`,
        { headers: { cookie: cookieHeader(startResponse) } },
      ),
    )
    await permissionsStarted

    // Simulate the PlatformAccounts hook committing a credential replacement in
    // the same timestamp(3) tick. Only the monotonic revision changes.
    payload.__oauthRow.authorization_revision += 1
    payload.__oauthRow.updated_at = account.updatedAt
    resolvePermissions(
      new Response(
        JSON.stringify({
          data: requiredMetaPermissions('facebook-page').map((permission) => ({
            permission,
            status: 'granted',
          })),
        }),
        { status: 200 },
      ),
    )

    const response = await callbackPromise

    expect(response.headers.get('location')).toBe(
      'http://localhost:3000/dashboard/platforms?metaOAuth=account_changed',
    )
    expect(payload.update).not.toHaveBeenCalled()
  })

  it('does not call Meta or store credentials when state validation fails', async () => {
    const payload = createPayload()
    mocks.getPayload.mockResolvedValue(payload)
    const startResponse = await metaOAuthStart(startRequest())
    const fetcher = vi.fn<typeof fetch>()
    vi.stubGlobal('fetch', fetcher)

    const response = await metaOAuthCallback(
      new NextRequest(
        `http://localhost:3000${META_OAUTH_CALLBACK_PATH}?code=authorization-code&state=${'x'.repeat(43)}`,
        { headers: { cookie: cookieHeader(startResponse) } },
      ),
    )

    expect(response.headers.get('location')).toBe(
      'http://localhost:3000/dashboard/platforms?metaOAuth=state_mismatch',
    )
    expect(fetcher).not.toHaveBeenCalled()
    expect(payload.update).not.toHaveBeenCalled()
  })

  it('disconnects credentials only for a same-origin authenticated admin request', async () => {
    const payload = createPayload()
    mocks.getPayload.mockResolvedValue(payload)

    const forbidden = await metaOAuthDisconnect(
      new NextRequest('http://localhost:3000/api/platforms/meta/oauth/disconnect', {
        body: JSON.stringify({ accountId: 42, authorizationRevision: 7 }),
        headers: { 'content-type': 'application/json', origin: 'https://evil.example' },
        method: 'POST',
      }),
    )
    expect(forbidden.status).toBe(403)
    expect(payload.update).not.toHaveBeenCalled()

    const response = await metaOAuthDisconnect(
      new NextRequest('http://localhost:3000/api/platforms/meta/oauth/disconnect', {
        body: JSON.stringify({ accountId: 42, authorizationRevision: 7 }),
        headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
        method: 'POST',
      }),
    )
    await expect(response.json()).resolves.toEqual({ data: { accountId: 42, disconnected: true } })
    expect(response.status).toBe(200)
    expect(payload.update).toHaveBeenCalledWith({
      collection: 'platform-accounts',
      data: {
        authorization: {
          clearAccessToken: true,
          clearRefreshToken: true,
          expiresAt: null,
          scopes: [],
          state: 'not_started',
        },
      },
      id: 42,
      overrideAccess: false,
      req: expect.any(Object),
      user: admin,
    })
  })

  it('does not disconnect credentials from a stale page revision', async () => {
    const payload = createPayload()
    payload.__oauthRow.authorization_revision = 8
    mocks.getPayload.mockResolvedValue(payload)

    const response = await metaOAuthDisconnect(
      new NextRequest('http://localhost:3000/api/platforms/meta/oauth/disconnect', {
        body: JSON.stringify({ accountId: 42, authorizationRevision: 7 }),
        headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
        method: 'POST',
      }),
    )

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({ error: { code: 'stale_revision' } })
    expect(payload.update).not.toHaveBeenCalled()
  })

  it('does not use the Facebook disconnect endpoint for Instagram accounts', async () => {
    const payload = createPayload({
      foundAccount: {
        ...account,
        accountKind: 'instagram-professional',
        externalAccountId: '987654321098765',
      },
    })
    mocks.getPayload.mockResolvedValue(payload)

    const response = await metaOAuthDisconnect(
      new NextRequest('http://localhost:3000/api/platforms/meta/oauth/disconnect', {
        body: JSON.stringify({ accountId: 42, authorizationRevision: 7 }),
        headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
        method: 'POST',
      }),
    )

    await expect(response.json()).resolves.toEqual({ error: { code: 'meta_account_required' } })
    expect(response.status).toBe(409)
    expect(payload.update).not.toHaveBeenCalled()
  })
})
