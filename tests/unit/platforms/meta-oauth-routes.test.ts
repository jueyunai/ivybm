import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  META_OAUTH_CALLBACK_PATH,
  META_OAUTH_TRANSACTION_COOKIE,
  requiredMetaPermissions,
} from '@/modules/platforms/meta/oauth'

const mocks = vi.hoisted(() => ({ getPayload: vi.fn() }))

vi.mock('payload', () => ({ getPayload: mocks.getPayload }))
vi.mock('@/payload.config', () => ({ default: {} }))

import { GET as metaOAuthCallback } from '@/app/api/platforms/meta/oauth/callback/route'
import { POST as metaOAuthDisconnect } from '@/app/api/platforms/meta/oauth/disconnect/route'
import { GET as metaOAuthStart } from '@/app/api/platforms/meta/oauth/start/route'

const environmentKeys = [
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
} = {}) => ({
  auth: vi.fn().mockResolvedValue({ user: authenticatedUser }),
  findByID: vi.fn().mockResolvedValue(foundAccount),
  logger: { error: vi.fn() },
  update: vi.fn().mockResolvedValue(foundAccount),
})

const startRequest = (): NextRequest =>
  new NextRequest('http://localhost:3000/api/platforms/meta/oauth/start?accountId=42')

const cookieHeader = (response: Response): string => {
  const setCookie = response.headers.get('set-cookie')
  if (!setCookie) throw new Error('Expected an OAuth transaction cookie')
  return setCookie.split(';', 1)[0]
}

describe('Meta OAuth routes', () => {
  beforeEach(() => {
    mocks.getPayload.mockReset()
    process.env.META_APP_ID = '1111111111111111'
    process.env.META_LOGIN_CONFIG_ID = '2222222222222222'
    process.env.META_OAUTH_REDIRECT_URI = `http://localhost:3000${META_OAUTH_CALLBACK_PATH}`
    process.env.META_WEBHOOK_APP_SECRET = 'test-meta-app-secret'
    process.env.NEXT_PUBLIC_SERVER_URL = 'https://ivybm.com'
    process.env.PLATFORM_CREDENTIAL_ENCRYPTION_KEY = 'b'.repeat(64)
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
        new Response(JSON.stringify({ access_token: 'short-user-token', expires_in: 3_600 }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ access_token: 'long-user-token', expires_in: 5_184_000 }),
          { status: 200 },
        ),
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
      'http://localhost:3000/admin/collections/platform-accounts/42?metaOAuth=connected',
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
          expiresAt: expect.any(String),
          scopes: requiredMetaPermissions('facebook-page').map((scope) => ({ scope })),
          state: 'connected',
        },
      },
      id: 42,
      overrideAccess: false,
      user: admin,
    })
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
      'http://localhost:3000/admin/collections/platform-accounts?metaOAuth=state_mismatch',
    )
    expect(fetcher).not.toHaveBeenCalled()
    expect(payload.update).not.toHaveBeenCalled()
  })

  it('disconnects credentials only for a same-origin authenticated admin request', async () => {
    const payload = createPayload()
    mocks.getPayload.mockResolvedValue(payload)

    const forbidden = await metaOAuthDisconnect(
      new NextRequest('http://localhost:3000/api/platforms/meta/oauth/disconnect', {
        body: JSON.stringify({ accountId: 42 }),
        headers: { 'content-type': 'application/json', origin: 'https://evil.example' },
        method: 'POST',
      }),
    )
    expect(forbidden.status).toBe(403)
    expect(payload.update).not.toHaveBeenCalled()

    const response = await metaOAuthDisconnect(
      new NextRequest('http://localhost:3000/api/platforms/meta/oauth/disconnect', {
        body: JSON.stringify({ accountId: 42 }),
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
      user: admin,
    })
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
        body: JSON.stringify({ accountId: 42 }),
        headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
        method: 'POST',
      }),
    )

    await expect(response.json()).resolves.toEqual({ error: { code: 'meta_account_required' } })
    expect(response.status).toBe(409)
    expect(payload.update).not.toHaveBeenCalled()
  })
})
