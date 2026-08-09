import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import instagramOAuthFixture from '../../fixtures/platforms/instagram-oauth-success.json'

import {
  INSTAGRAM_OAUTH_CALLBACK_PATH,
  INSTAGRAM_OAUTH_TRANSACTION_COOKIE,
  requiredInstagramPermissions,
} from '@/modules/platforms/instagram/oauth'

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

import { GET as instagramOAuthCallback } from '@/app/api/platforms/instagram/oauth/callback/route'
import { POST as instagramOAuthDisconnect } from '@/app/api/platforms/instagram/oauth/disconnect/route'
import { GET as instagramOAuthStart } from '@/app/api/platforms/instagram/oauth/start/route'

const environmentKeys = [
  'INSTAGRAM_APP_ID',
  'INSTAGRAM_APP_SECRET',
  'INSTAGRAM_OAUTH_REDIRECT_URI',
  'NEXT_PUBLIC_SERVER_URL',
  'PLATFORM_CREDENTIAL_ENCRYPTION_KEY',
] as const
const originalEnvironment = Object.fromEntries(
  environmentKeys.map((key) => [key, process.env[key]]),
)

const admin = { collection: 'users' as const, id: 7, role: 'admin' as const }
const account = {
  accountKind: 'instagram-professional' as const,
  authorization: {
    accessTokenConfigured: false,
    refreshTokenConfigured: false,
    scopes: [],
    state: 'pending' as const,
  },
  authorizationRevision: 7,
  capabilities: { messagingInbound: 'pending' as const, publishing: 'pending' as const },
  connectionKey: 'instagram-professional:987654321098765',
  createdAt: '2026-07-31T00:00:00.000Z',
  externalAccountId: '987654321098765',
  id: 42,
  name: 'Foshan Ivy Instagram',
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
  findByIDError = false,
}: {
  authenticatedUser?: null | typeof admin
  findByIDError?: boolean
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
    findByID: findByIDError
      ? vi.fn().mockRejectedValue(new Error('not found'))
      : vi.fn().mockResolvedValue(foundAccount),
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
  new NextRequest('http://localhost:3000/api/platforms/instagram/oauth/start?accountId=42')

const cookieHeader = (response: Response): string => {
  const setCookie = response.headers.get('set-cookie')
  if (!setCookie) throw new Error('Expected an OAuth transaction cookie')
  return setCookie.split(';', 1)[0]
}

describe('Instagram OAuth routes', () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset()
    mocks.createLocalReq.mockResolvedValue({ transactionID: undefined })
    mocks.commitTransaction.mockResolvedValue(undefined)
    mocks.initTransaction.mockResolvedValue(undefined)
    mocks.killTransaction.mockResolvedValue(undefined)
    process.env.INSTAGRAM_APP_ID = '1221206873460693'
    process.env.INSTAGRAM_APP_SECRET = 'test-instagram-app-secret'
    process.env.INSTAGRAM_OAUTH_REDIRECT_URI = `http://localhost:3000${INSTAGRAM_OAUTH_CALLBACK_PATH}`
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

    const response = await instagramOAuthStart(startRequest())

    await expect(response.json()).resolves.toEqual({ error: { code: 'authentication_required' } })
    expect(response.status).toBe(401)
    expect(payload.findByID).not.toHaveBeenCalled()
  })

  it('redirects to Instagram OAuth with an encrypted account transaction', async () => {
    const payload = createPayload()
    mocks.getPayload.mockResolvedValue(payload)

    const response = await instagramOAuthStart(startRequest())
    const location = response.headers.get('location')
    const setCookie = response.headers.get('set-cookie')

    expect(response.status).toBe(302)
    const authorizationURL = new URL(String(location))
    expect(authorizationURL.hostname).toBe('www.instagram.com')
    expect(authorizationURL.pathname).toBe('/oauth/authorize')
    expect(authorizationURL.searchParams.get('client_id')).toBe('1221206873460693')
    expect(authorizationURL.searchParams.get('redirect_uri')).toBe(
      `http://localhost:3000${INSTAGRAM_OAUTH_CALLBACK_PATH}`,
    )
    expect(setCookie).toContain(`${INSTAGRAM_OAUTH_TRANSACTION_COOKIE}=v1%3A`)
    expect(setCookie).toContain('HttpOnly')
    expect(setCookie).toContain('SameSite=lax')
    expect(setCookie).toContain(`Path=${INSTAGRAM_OAUTH_CALLBACK_PATH}`)
    expect(setCookie).not.toContain(account.externalAccountId)
    expect(setCookie).not.toContain('test-instagram-app-secret')
  })

  it('binds and stores the Instagram professional account token after callback', async () => {
    const payload = createPayload()
    mocks.getPayload.mockResolvedValue(payload)
    const startResponse = await instagramOAuthStart(startRequest())
    const state = new URL(String(startResponse.headers.get('location'))).searchParams.get('state')
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify(instagramOAuthFixture.responses.shortToken), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(instagramOAuthFixture.responses.longToken), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(instagramOAuthFixture.responses.profile), { status: 200 }),
      )
    vi.stubGlobal('fetch', fetcher)

    const response = await instagramOAuthCallback(
      new NextRequest(
        `https://untrusted-host.example${INSTAGRAM_OAUTH_CALLBACK_PATH}?code=authorization-code&state=${state}`,
        { headers: { cookie: cookieHeader(startResponse) } },
      ),
    )

    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe(
      'http://localhost:3000/admin/collections/platform-accounts/42?instagramOAuth=connected',
    )
    expect(response.headers.get('set-cookie')).toContain(`${INSTAGRAM_OAUTH_TRANSACTION_COOKIE}=;`)
    expect(payload.update).toHaveBeenCalledWith({
      collection: 'platform-accounts',
      data: {
        authorization: {
          accessToken: instagramOAuthFixture.responses.longToken.access_token,
          appId: '1221206873460693',
          clearAccessToken: false,
          clearRefreshToken: true,
          expiresAt: expect.any(String),
          scopes: requiredInstagramPermissions('instagram-professional').map((scope) => ({
            scope,
          })),
          state: 'connected',
        },
      },
      id: 42,
      overrideAccess: false,
      req: expect.any(Object),
      user: admin,
    })

    const actualRequests = fetcher.mock.calls.map(([input, init]) => {
      const url = new URL(String(input))
      const fields = url.searchParams.get('fields')
      return {
        ...(fields ? { fields } : {}),
        method: init?.method ?? 'GET',
        origin: url.origin,
        pathname: url.pathname,
      }
    })
    expect(actualRequests).toEqual(instagramOAuthFixture.requests)
    expect(actualRequests.every(({ pathname }) => !pathname.includes('permissions'))).toBe(true)
  })

  it('logs only safe structured diagnostics when the provider rejects token exchange', async () => {
    const payload = createPayload()
    mocks.getPayload.mockResolvedValue(payload)
    const startResponse = await instagramOAuthStart(startRequest())
    const state = new URL(String(startResponse.headers.get('location'))).searchParams.get('state')
    const providerMessage =
      'invalid authorization-code test-instagram-app-secret leaked-provider-token'
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          JSON.stringify({
            access_token: 'leaked-provider-token',
            code: 400,
            error_message: providerMessage,
            error_type: 'OAuthException',
          }),
          { status: 401 },
        ),
      ),
    )

    const response = await instagramOAuthCallback(
      new NextRequest(
        `http://localhost:3000${INSTAGRAM_OAUTH_CALLBACK_PATH}?code=authorization-code&state=${state}`,
        { headers: { cookie: cookieHeader(startResponse) } },
      ),
    )

    expect(response.headers.get('location')).toBe(
      'http://localhost:3000/admin/collections/platform-accounts/42?instagramOAuth=token_exchange_failed',
    )
    expect(payload.logger.error).toHaveBeenCalledWith({
      code: 'token_exchange_failed',
      message: 'Instagram OAuth callback failed',
      oauthCode: 'token_exchange_failed',
      providerErrorCode: 400,
      providerErrorType: 'OAuthException',
      providerResponseKeys: ['access_token', 'code', 'error_message', 'error_type'],
      providerStatus: 401,
      stage: 'short_token_exchange',
    })
    const serializedLog = JSON.stringify(payload.logger.error.mock.calls)
    expect(serializedLog).not.toContain('authorization-code')
    expect(serializedLog).not.toContain(String(state))
    expect(serializedLog).not.toContain('test-instagram-app-secret')
    expect(serializedLog).not.toContain('leaked-provider-token')
    expect(serializedLog).not.toContain(providerMessage)
  })

  it('does not persist a late Instagram callback after the account is disconnected', async () => {
    const payload = createPayload()
    mocks.getPayload.mockResolvedValue(payload)
    const startResponse = await instagramOAuthStart(startRequest())
    const state = new URL(String(startResponse.headers.get('location'))).searchParams.get('state')
    let resolveProfile!: (response: Response) => void
    let markProfileStarted!: () => void
    const profileStarted = new Promise<void>((resolve) => {
      markProfileStarted = resolve
    })
    const profileResponse = new Promise<Response>((resolve) => {
      resolveProfile = resolve
    })
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify(instagramOAuthFixture.responses.shortToken), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: 'long-user-token', expires_in: 5_184_000 }), {
          status: 200,
        }),
      )
      .mockImplementationOnce(async () => {
        markProfileStarted()
        return profileResponse
      })
    vi.stubGlobal('fetch', fetcher)

    const callbackPromise = instagramOAuthCallback(
      new NextRequest(
        `http://localhost:3000${INSTAGRAM_OAUTH_CALLBACK_PATH}?code=authorization-code&state=${state}`,
        { headers: { cookie: cookieHeader(startResponse) } },
      ),
    )
    await profileStarted

    const disconnect = await instagramOAuthDisconnect(
      new NextRequest('http://localhost:3000/api/platforms/instagram/oauth/disconnect', {
        body: JSON.stringify({ accountId: 42 }),
        headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
        method: 'POST',
      }),
    )
    expect(disconnect.status).toBe(200)
    payload.__oauthRow.authorization_state = 'not_started'
    payload.__oauthRow.authorization_revision += 1
    // Deliberately retain the same timestamp to prove timestamp(3) collisions
    // cannot let the stale callback pass the monotonic generation check.
    payload.__oauthRow.updated_at = account.updatedAt
    resolveProfile(
      new Response(JSON.stringify(instagramOAuthFixture.responses.profile), { status: 200 }),
    )

    const response = await callbackPromise

    expect(response.headers.get('location')).toBe(
      'http://localhost:3000/admin/collections/platform-accounts/42?instagramOAuth=account_changed',
    )
    expect(payload.update).toHaveBeenCalledTimes(1)
  })

  it('rejects a code grant missing a required permission before persistence', async () => {
    const payload = createPayload()
    mocks.getPayload.mockResolvedValue(payload)
    const startResponse = await instagramOAuthStart(startRequest())
    const state = new URL(String(startResponse.headers.get('location'))).searchParams.get('state')
    const shortToken = {
      ...instagramOAuthFixture.responses.shortToken,
      permissions: 'instagram_business_basic',
    }
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify(shortToken), { status: 200 }))
    vi.stubGlobal('fetch', fetcher)

    const response = await instagramOAuthCallback(
      new NextRequest(
        `http://localhost:3000${INSTAGRAM_OAUTH_CALLBACK_PATH}?code=authorization-code&state=${state}`,
        { headers: { cookie: cookieHeader(startResponse) } },
      ),
    )

    expect(response.headers.get('location')).toBe(
      'http://localhost:3000/admin/collections/platform-accounts/42?instagramOAuth=required_permission_missing',
    )
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(payload.update).not.toHaveBeenCalled()
  })

  it('does not call Instagram or store credentials when state validation fails', async () => {
    const payload = createPayload()
    mocks.getPayload.mockResolvedValue(payload)
    const startResponse = await instagramOAuthStart(startRequest())
    const fetcher = vi.fn<typeof fetch>()
    vi.stubGlobal('fetch', fetcher)

    const response = await instagramOAuthCallback(
      new NextRequest(
        `http://localhost:3000${INSTAGRAM_OAUTH_CALLBACK_PATH}?code=authorization-code&state=${'x'.repeat(43)}`,
        { headers: { cookie: cookieHeader(startResponse) } },
      ),
    )

    expect(response.headers.get('location')).toBe(
      'http://localhost:3000/admin/collections/platform-accounts?instagramOAuth=state_mismatch',
    )
    expect(fetcher).not.toHaveBeenCalled()
    expect(payload.update).not.toHaveBeenCalled()
  })

  it('disconnects credentials only for a same-origin authenticated admin request', async () => {
    const payload = createPayload()
    mocks.getPayload.mockResolvedValue(payload)

    const forbidden = await instagramOAuthDisconnect(
      new NextRequest('http://localhost:3000/api/platforms/instagram/oauth/disconnect', {
        body: JSON.stringify({ accountId: 42 }),
        headers: { 'content-type': 'application/json', origin: 'https://evil.example' },
        method: 'POST',
      }),
    )
    expect(forbidden.status).toBe(403)
    expect(payload.update).not.toHaveBeenCalled()

    const response = await instagramOAuthDisconnect(
      new NextRequest('http://localhost:3000/api/platforms/instagram/oauth/disconnect', {
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

  it('does not disconnect a non-Instagram platform account', async () => {
    const payload = createPayload({
      foundAccount: {
        ...account,
        accountKind: 'facebook-page',
        externalAccountId: '123456789012345',
      },
    })
    mocks.getPayload.mockResolvedValue(payload)

    const response = await instagramOAuthDisconnect(
      new NextRequest('http://localhost:3000/api/platforms/instagram/oauth/disconnect', {
        body: JSON.stringify({ accountId: 42 }),
        headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
        method: 'POST',
      }),
    )

    await expect(response.json()).resolves.toEqual({
      error: { code: 'instagram_account_required' },
    })
    expect(response.status).toBe(409)
    expect(payload.update).not.toHaveBeenCalled()
  })

  it('returns not found without attempting an update for a missing account', async () => {
    const payload = createPayload({ findByIDError: true })
    mocks.getPayload.mockResolvedValue(payload)

    const response = await instagramOAuthDisconnect(
      new NextRequest('http://localhost:3000/api/platforms/instagram/oauth/disconnect', {
        body: JSON.stringify({ accountId: 42 }),
        headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
        method: 'POST',
      }),
    )

    await expect(response.json()).resolves.toEqual({
      error: { code: 'platform_account_not_found' },
    })
    expect(response.status).toBe(404)
    expect(payload.update).not.toHaveBeenCalled()
  })

  it('rejects non-JSON disconnect requests before loading Payload', async () => {
    const payload = createPayload()
    mocks.getPayload.mockResolvedValue(payload)

    const response = await instagramOAuthDisconnect(
      new NextRequest('http://localhost:3000/api/platforms/instagram/oauth/disconnect', {
        body: JSON.stringify({ accountId: 42 }),
        headers: { origin: 'http://localhost:3000' },
        method: 'POST',
      }),
    )

    await expect(response.json()).resolves.toEqual({
      error: { code: 'unsupported_media_type' },
    })
    expect(response.status).toBe(415)
    expect(mocks.getPayload).not.toHaveBeenCalled()
  })
})
