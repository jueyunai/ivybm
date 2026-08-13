import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  LINKEDIN_OAUTH_CALLBACK_PATH,
  LINKEDIN_OAUTH_TRANSACTION_COOKIE,
  requiredLinkedInPermissions,
} from '@/modules/platforms/linkedin/oauth'

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

import { GET as linkedinOAuthCallback } from '@/app/api/platforms/linkedin/oauth/callback/route'
import { POST as linkedinOAuthDisconnect } from '@/app/api/platforms/linkedin/oauth/disconnect/route'
import { GET as linkedinOAuthStart } from '@/app/api/platforms/linkedin/oauth/start/route'

const environmentKeys = [
  'ADMIN_PORTAL_ENABLED',
  'ADMIN_PORTAL_PLATFORMS_ENABLED',
  'LINKEDIN_API_VERSION',
  'LINKEDIN_APP_ID',
  'LINKEDIN_APP_SECRET',
  'LINKEDIN_OAUTH_REDIRECT_URI',
  'NEXT_PUBLIC_SERVER_URL',
  'PLATFORM_CREDENTIAL_ENCRYPTION_KEY',
] as const
const originalEnvironment = Object.fromEntries(
  environmentKeys.map((key) => [key, process.env[key]]),
)

const admin = { collection: 'users' as const, id: 7, role: 'admin' as const }
const memberAccount = {
  accountKind: 'linkedin-member' as const,
  authorization: {
    accessTokenConfigured: false,
    refreshTokenConfigured: false,
    scopes: [],
    state: 'pending' as const,
  },
  authorizationRevision: 7,
  capabilities: { messagingInbound: 'not_started' as const, publishing: 'pending' as const },
  connectionKey: 'linkedin-member:abc123',
  createdAt: '2026-07-31T00:00:00.000Z',
  externalAccountId: 'abc123',
  id: 42,
  name: 'Foshan Ivy LinkedIn',
  platformFamily: 'linkedin' as const,
  updatedAt: '2026-07-31T00:00:00.000Z',
}

const organizationAccount = {
  ...memberAccount,
  accountKind: 'linkedin-organization' as const,
  connectionKey: 'linkedin-organization:12345',
  externalAccountId: '12345',
}

type FacebookAccount = Omit<typeof memberAccount, 'accountKind' | 'platformFamily'> & {
  accountKind: 'facebook-page'
  platformFamily: 'meta'
}

type TestAccount = typeof memberAccount | typeof organizationAccount | FacebookAccount

const createPayload = ({
  authenticatedUser = admin,
  foundAccount = memberAccount,
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
    logger: { error: vi.fn(), info: vi.fn() },
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

const startRequest = (accountId = 42): NextRequest =>
  new NextRequest(`http://localhost:3000/api/platforms/linkedin/oauth/start?accountId=${accountId}`)

const cookieHeader = (response: Response): string => {
  const setCookie = response.headers.get('set-cookie')
  if (!setCookie) throw new Error('Expected an OAuth transaction cookie')
  return setCookie.split(';', 1)[0]
}

describe('LinkedIn OAuth routes', () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset()
    mocks.createLocalReq.mockResolvedValue({ transactionID: undefined })
    mocks.commitTransaction.mockResolvedValue(undefined)
    mocks.initTransaction.mockResolvedValue(undefined)
    mocks.killTransaction.mockResolvedValue(undefined)
    process.env.LINKEDIN_API_VERSION = '202506'
    process.env.ADMIN_PORTAL_ENABLED = 'true'
    process.env.ADMIN_PORTAL_PLATFORMS_ENABLED = 'true'
    process.env.LINKEDIN_APP_ID = 'linkedin-app-id'
    process.env.LINKEDIN_APP_SECRET = 'test-linkedin-app-secret'
    process.env.LINKEDIN_OAUTH_REDIRECT_URI = `http://localhost:3000${LINKEDIN_OAUTH_CALLBACK_PATH}`
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

  it('stops OAuth callbacks while the platform module is disabled', async () => {
    process.env.ADMIN_PORTAL_PLATFORMS_ENABLED = 'false'

    const response = await linkedinOAuthCallback(
      new NextRequest(
        `http://localhost:3000${LINKEDIN_OAUTH_CALLBACK_PATH}?code=ignored&state=ignored`,
      ),
    )

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({
      error: { code: 'platform_module_disabled' },
    })
    expect(mocks.getPayload).not.toHaveBeenCalled()
  })

  it('requires an administrator before loading a platform account', async () => {
    const payload = createPayload({ authenticatedUser: null })
    mocks.getPayload.mockResolvedValue(payload)

    const response = await linkedinOAuthStart(startRequest())

    await expect(response.json()).resolves.toEqual({ error: { code: 'authentication_required' } })
    expect(response.status).toBe(401)
    expect(payload.findByID).not.toHaveBeenCalled()
  })

  it('redirects to LinkedIn OAuth with an encrypted account transaction', async () => {
    const payload = createPayload()
    mocks.getPayload.mockResolvedValue(payload)

    const response = await linkedinOAuthStart(startRequest())
    const location = response.headers.get('location')
    const setCookie = response.headers.get('set-cookie')

    expect(response.status).toBe(302)
    const authorizationURL = new URL(String(location))
    expect(authorizationURL.hostname).toBe('www.linkedin.com')
    expect(authorizationURL.pathname).toBe('/oauth/v2/authorization')
    expect(authorizationURL.searchParams.get('client_id')).toBe('linkedin-app-id')
    expect(authorizationURL.searchParams.get('redirect_uri')).toBe(
      `http://localhost:3000${LINKEDIN_OAUTH_CALLBACK_PATH}`,
    )
    expect(authorizationURL.searchParams.get('scope')).toBe(
      requiredLinkedInPermissions('linkedin-member').join(' '),
    )
    expect(setCookie).toContain(`${LINKEDIN_OAUTH_TRANSACTION_COOKIE}=v1%3A`)
    expect(setCookie).toContain('HttpOnly')
    expect(setCookie).toContain('SameSite=lax')
    expect(setCookie).toContain(`Path=${LINKEDIN_OAUTH_CALLBACK_PATH}`)
    expect(setCookie).not.toContain(memberAccount.externalAccountId)
    expect(setCookie).not.toContain('test-linkedin-app-secret')
  })

  it('binds and stores the LinkedIn member token after callback', async () => {
    const payload = createPayload()
    mocks.getPayload.mockResolvedValue(payload)
    const startResponse = await linkedinOAuthStart(startRequest())
    const state = new URL(String(startResponse.headers.get('location'))).searchParams.get('state')
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: 'linkedin-member-token',
            expires_in: 5_184_000,
            scope: requiredLinkedInPermissions('linkedin-member').join(' '),
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ sub: memberAccount.externalAccountId }), { status: 200 }),
      )
    vi.stubGlobal('fetch', fetcher)

    const response = await linkedinOAuthCallback(
      new NextRequest(
        `https://untrusted-host.example${LINKEDIN_OAUTH_CALLBACK_PATH}?code=authorization-code&state=${state}`,
        { headers: { cookie: cookieHeader(startResponse) } },
      ),
    )

    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe(
      'http://localhost:3000/dashboard/platforms?linkedinOAuth=connected',
    )
    expect(response.headers.get('set-cookie')).toContain(`${LINKEDIN_OAUTH_TRANSACTION_COOKIE}=;`)
    expect(payload.update).toHaveBeenCalledWith({
      collection: 'platform-accounts',
      data: {
        authorization: {
          accessToken: 'linkedin-member-token',
          appId: 'linkedin-app-id',
          clearAccessToken: false,
          clearRefreshToken: true,
          expiresAt: expect.any(String),
          scopes: requiredLinkedInPermissions('linkedin-member').map((scope) => ({ scope })),
          state: 'connected',
        },
      },
      id: 42,
      overrideAccess: false,
      req: expect.any(Object),
      user: admin,
    })
  })

  it('binds and stores the LinkedIn organization token after callback', async () => {
    const payload = createPayload({ foundAccount: organizationAccount })
    mocks.getPayload.mockResolvedValue(payload)
    const startResponse = await linkedinOAuthStart(startRequest())
    const state = new URL(String(startResponse.headers.get('location'))).searchParams.get('state')
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: 'linkedin-organization-token',
            expires_in: 5_184_000,
            scope: requiredLinkedInPermissions('linkedin-organization').join(' '),
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            elements: [
              {
                organization: `urn:li:organization:${organizationAccount.externalAccountId}`,
                role: 'CONTENT_ADMINISTRATOR',
                state: 'APPROVED',
              },
            ],
          }),
          { status: 200 },
        ),
      )
    vi.stubGlobal('fetch', fetcher)

    const response = await linkedinOAuthCallback(
      new NextRequest(
        `http://localhost:3000${LINKEDIN_OAUTH_CALLBACK_PATH}?code=authorization-code&state=${state}`,
        { headers: { cookie: cookieHeader(startResponse) } },
      ),
    )

    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe(
      'http://localhost:3000/dashboard/platforms?linkedinOAuth=connected',
    )
    expect(payload.update).toHaveBeenCalledWith({
      collection: 'platform-accounts',
      data: {
        authorization: {
          accessToken: 'linkedin-organization-token',
          appId: 'linkedin-app-id',
          clearAccessToken: false,
          clearRefreshToken: true,
          expiresAt: expect.any(String),
          scopes: requiredLinkedInPermissions('linkedin-organization').map((scope) => ({ scope })),
          state: 'connected',
        },
      },
      id: 42,
      overrideAccess: false,
      req: expect.any(Object),
      user: admin,
    })
  })

  it('logs only safe structured diagnostics when the provider rejects token exchange', async () => {
    const payload = createPayload()
    mocks.getPayload.mockResolvedValue(payload)
    const startResponse = await linkedinOAuthStart(startRequest())
    const state = new URL(String(startResponse.headers.get('location'))).searchParams.get('state')
    const providerMessage = 'invalid request test-linkedin-app-secret leaked-provider-token'
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: 'invalid_request',
            error_description: providerMessage,
          }),
          { status: 400 },
        ),
      ),
    )

    const response = await linkedinOAuthCallback(
      new NextRequest(
        `http://localhost:3000${LINKEDIN_OAUTH_CALLBACK_PATH}?code=authorization-code&state=${state}`,
        { headers: { cookie: cookieHeader(startResponse) } },
      ),
    )

    expect(response.headers.get('location')).toBe(
      'http://localhost:3000/dashboard/platforms?linkedinOAuth=token_exchange_failed',
    )
    expect(payload.logger.error).toHaveBeenCalledWith({
      code: 'token_exchange_failed',
      message: 'LinkedIn OAuth callback failed',
      oauthCode: 'token_exchange_failed',
      providerErrorCode: 'invalid_request',
      providerResponseKeys: ['error', 'error_description'],
      providerStatus: 400,
      stage: 'token_exchange',
    })
    const serializedLog = JSON.stringify(payload.logger.error.mock.calls)
    expect(serializedLog).not.toContain('authorization-code')
    expect(serializedLog).not.toContain(String(state))
    expect(serializedLog).not.toContain('test-linkedin-app-secret')
    expect(serializedLog).not.toContain('leaked-provider-token')
  })

  it('does not persist a late LinkedIn callback after the account is disconnected', async () => {
    const payload = createPayload()
    mocks.getPayload.mockResolvedValue(payload)
    const startResponse = await linkedinOAuthStart(startRequest())
    const state = new URL(String(startResponse.headers.get('location'))).searchParams.get('state')
    let resolveUserinfo!: (response: Response) => void
    let markUserinfoStarted!: () => void
    const userinfoStarted = new Promise<void>((resolve) => {
      markUserinfoStarted = resolve
    })
    const userinfoResponse = new Promise<Response>((resolve) => {
      resolveUserinfo = resolve
    })
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: 'linkedin-member-token',
            expires_in: 5_184_000,
            scope: requiredLinkedInPermissions('linkedin-member').join(' '),
          }),
          { status: 200 },
        ),
      )
      .mockImplementationOnce(async () => {
        markUserinfoStarted()
        return userinfoResponse
      })
    vi.stubGlobal('fetch', fetcher)

    const callbackPromise = linkedinOAuthCallback(
      new NextRequest(
        `http://localhost:3000${LINKEDIN_OAUTH_CALLBACK_PATH}?code=authorization-code&state=${state}`,
        { headers: { cookie: cookieHeader(startResponse) } },
      ),
    )
    await userinfoStarted

    const disconnect = await linkedinOAuthDisconnect(
      new NextRequest('http://localhost:3000/api/platforms/linkedin/oauth/disconnect', {
        body: JSON.stringify({ accountId: 42, authorizationRevision: 7 }),
        headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
        method: 'POST',
      }),
    )
    expect(disconnect.status).toBe(200)
    payload.__oauthRow.authorization_state = 'not_started'
    payload.__oauthRow.authorization_revision += 1
    payload.__oauthRow.updated_at = memberAccount.updatedAt
    resolveUserinfo(
      new Response(JSON.stringify({ sub: memberAccount.externalAccountId }), { status: 200 }),
    )

    const response = await callbackPromise

    expect(response.headers.get('location')).toBe(
      'http://localhost:3000/dashboard/platforms?linkedinOAuth=account_changed',
    )
    expect(payload.update).toHaveBeenCalledTimes(1)
  })

  it('rejects a code grant missing a required permission before persistence', async () => {
    const payload = createPayload()
    mocks.getPayload.mockResolvedValue(payload)
    const startResponse = await linkedinOAuthStart(startRequest())
    const state = new URL(String(startResponse.headers.get('location'))).searchParams.get('state')
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          JSON.stringify({
            access_token: 'linkedin-member-token',
            expires_in: 5_184_000,
            scope: 'openid profile',
          }),
          { status: 200 },
        ),
      ),
    )

    const response = await linkedinOAuthCallback(
      new NextRequest(
        `http://localhost:3000${LINKEDIN_OAUTH_CALLBACK_PATH}?code=authorization-code&state=${state}`,
        { headers: { cookie: cookieHeader(startResponse) } },
      ),
    )

    expect(response.headers.get('location')).toBe(
      'http://localhost:3000/dashboard/platforms?linkedinOAuth=required_permission_missing',
    )
    expect(payload.update).not.toHaveBeenCalled()
  })

  it('does not call LinkedIn or store credentials when state validation fails', async () => {
    const payload = createPayload()
    mocks.getPayload.mockResolvedValue(payload)
    const startResponse = await linkedinOAuthStart(startRequest())
    const fetcher = vi.fn<typeof fetch>()
    vi.stubGlobal('fetch', fetcher)

    const response = await linkedinOAuthCallback(
      new NextRequest(
        `http://localhost:3000${LINKEDIN_OAUTH_CALLBACK_PATH}?code=authorization-code&state=${'x'.repeat(43)}`,
        { headers: { cookie: cookieHeader(startResponse) } },
      ),
    )

    expect(response.headers.get('location')).toBe(
      'http://localhost:3000/dashboard/platforms?linkedinOAuth=state_mismatch',
    )
    expect(fetcher).not.toHaveBeenCalled()
    expect(payload.update).not.toHaveBeenCalled()
  })

  it('disconnects credentials only for a same-origin authenticated admin request', async () => {
    const payload = createPayload()
    mocks.getPayload.mockResolvedValue(payload)

    const forbidden = await linkedinOAuthDisconnect(
      new NextRequest('http://localhost:3000/api/platforms/linkedin/oauth/disconnect', {
        body: JSON.stringify({ accountId: 42, authorizationRevision: 7 }),
        headers: { 'content-type': 'application/json', origin: 'https://evil.example' },
        method: 'POST',
      }),
    )
    expect(forbidden.status).toBe(403)
    expect(payload.update).not.toHaveBeenCalled()

    const response = await linkedinOAuthDisconnect(
      new NextRequest('http://localhost:3000/api/platforms/linkedin/oauth/disconnect', {
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

    const response = await linkedinOAuthDisconnect(
      new NextRequest('http://localhost:3000/api/platforms/linkedin/oauth/disconnect', {
        body: JSON.stringify({ accountId: 42, authorizationRevision: 7 }),
        headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
        method: 'POST',
      }),
    )

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({ error: { code: 'stale_revision' } })
    expect(payload.update).not.toHaveBeenCalled()
  })

  it('does not disconnect a non-LinkedIn platform account', async () => {
    const payload = createPayload({
      foundAccount: {
        ...memberAccount,
        accountKind: 'facebook-page',
        platformFamily: 'meta',
      },
    })
    mocks.getPayload.mockResolvedValue(payload)

    const response = await linkedinOAuthDisconnect(
      new NextRequest('http://localhost:3000/api/platforms/linkedin/oauth/disconnect', {
        body: JSON.stringify({ accountId: 42, authorizationRevision: 7 }),
        headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
        method: 'POST',
      }),
    )

    await expect(response.json()).resolves.toEqual({
      error: { code: 'linkedin_account_required' },
    })
    expect(response.status).toBe(409)
    expect(payload.update).not.toHaveBeenCalled()
  })
})
