import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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

import { DELETE, PATCH } from '@/app/api/platforms/accounts/[id]/route'
import { GET, POST } from '@/app/api/platforms/accounts/route'

const environmentKeys = [
  'ADMIN_PORTAL_ENABLED',
  'ADMIN_PORTAL_PLATFORMS_ENABLED',
  'NEXT_PUBLIC_SERVER_URL',
  'NODE_ENV',
] as const
const originalEnvironment = Object.fromEntries(
  environmentKeys.map((key) => [key, process.env[key]]),
)

const admin = { collection: 'users' as const, id: 7, role: 'admin' as const }
const operator = { collection: 'users' as const, id: 8, role: 'operator' as const }

const account = {
  accountKind: 'facebook-page' as const,
  authorization: {
    accessTokenConfigured: false,
    appId: null,
    expiresAt: null,
    refreshTokenConfigured: false,
    scopes: [],
    state: 'not_started' as const,
  },
  authorizationRevision: 3,
  capabilities: { messagingInbound: 'not_started', publishing: 'not_started' },
  externalAccountId: '123456789012345',
  id: 42,
  name: 'Test Page',
  notes: null,
  platformFamily: 'meta' as const,
}

const createPayload = ({
  authenticatedUser = admin,
  docs = [account],
  findByIDResult = account,
}: {
  authenticatedUser?: null | typeof admin | typeof operator
  docs?: unknown[]
  findByIDResult?: unknown
} = {}) => {
  const rowAccount = findByIDResult as typeof account
  return {
    auth: vi.fn().mockResolvedValue({ user: authenticatedUser }),
    create: vi.fn().mockResolvedValue(findByIDResult),
    db: {
      drizzle: {
        execute: vi.fn().mockResolvedValue({
          rows: [
            {
              account_kind: rowAccount.accountKind,
              authorization_revision: rowAccount.authorizationRevision,
              authorization_state: rowAccount.authorization.state,
              external_account_id: rowAccount.externalAccountId,
            },
          ],
        }),
      },
      sessions: {},
    },
    delete: vi.fn().mockResolvedValue({}),
    find: vi.fn().mockResolvedValue({ docs }),
    findByID: vi.fn().mockResolvedValue(findByIDResult),
    update: vi.fn().mockResolvedValue(findByIDResult),
  }
}

const jsonRequest = ({
  body,
  method,
  origin = 'http://localhost:3000',
  path = '/api/platforms/accounts',
}: {
  body?: unknown
  method: string
  origin?: string
  path?: string
}): NextRequest =>
  new NextRequest(`http://localhost:3000${path}`, {
    body: body ? JSON.stringify(body) : undefined,
    headers: {
      'content-type': 'application/json',
      origin,
    },
    method,
  })

describe('platform account portal routes', () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset()
    mocks.createLocalReq.mockResolvedValue({ transactionID: undefined })
    mocks.commitTransaction.mockResolvedValue(undefined)
    mocks.initTransaction.mockResolvedValue(undefined)
    mocks.killTransaction.mockResolvedValue(undefined)
    process.env.ADMIN_PORTAL_ENABLED = 'true'
    process.env.ADMIN_PORTAL_PLATFORMS_ENABLED = 'true'
    process.env.NEXT_PUBLIC_SERVER_URL = 'http://localhost:3000'
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    for (const [key, value] of Object.entries(originalEnvironment)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })

  it('lists redacted accounts for an administrator', async () => {
    const payload = createPayload()
    mocks.getPayload.mockResolvedValue(payload)

    const response = await GET(jsonRequest({ method: 'GET', path: '/api/platforms/accounts' }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(body.accounts).toHaveLength(1)
    expect(body.accounts[0]).toEqual({
      accountKind: 'facebook-page',
      authorization: {
        accessTokenConfigured: false,
        appId: null,
        expiresAt: null,
        refreshTokenConfigured: false,
        scopes: [],
        state: 'not_started',
      },
      authorizationRevision: 3,
      capabilities: { messagingInbound: 'not_started', publishing: 'not_started' },
      externalAccountId: '123456789012345',
      id: 42,
      name: 'Test Page',
      notes: null,
      platformFamily: 'meta',
    })
    expect(body.accounts[0].authorization).not.toHaveProperty('accessToken')
    expect(body.accounts[0].authorization).not.toHaveProperty('refreshToken')
    expect(payload.find).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: 'platform-accounts',
        overrideAccess: false,
        pagination: false,
        req: expect.any(Object),
        sort: 'name',
        user: admin,
      }),
    )
  })

  it('rejects list requests from non-administrators', async () => {
    const payload = createPayload({ authenticatedUser: operator })
    mocks.getPayload.mockResolvedValue(payload)

    const response = await GET(jsonRequest({ method: 'GET', path: '/api/platforms/accounts' }))

    await expect(response.json()).resolves.toEqual({ error: { code: 'forbidden' } })
    expect(response.status).toBe(403)
  })

  it('rejects list requests when the portal platform module is disabled', async () => {
    process.env.ADMIN_PORTAL_PLATFORMS_ENABLED = 'false'
    const payload = createPayload()
    mocks.getPayload.mockResolvedValue(payload)

    const response = await GET(jsonRequest({ method: 'GET', path: '/api/platforms/accounts' }))

    await expect(response.json()).resolves.toEqual({ error: { code: 'platform_module_disabled' } })
    expect(response.status).toBe(503)
  })

  it('creates a supported platform account', async () => {
    const payload = createPayload()
    mocks.getPayload.mockResolvedValue(payload)

    const response = await POST(
      jsonRequest({
        body: {
          accountKind: 'linkedin-member',
          externalAccountId: 'member-123',
          name: 'New LinkedIn',
          notes: 'staging',
        },
        method: 'POST',
        path: '/api/platforms/accounts',
      }),
    )

    expect(response.status).toBe(201)
    expect(payload.create).toHaveBeenCalledWith({
      collection: 'platform-accounts',
      data: expect.objectContaining({
        accountKind: 'linkedin-member',
        authorization: expect.objectContaining({ state: 'not_started' }),
        externalAccountId: 'member-123',
        name: 'New LinkedIn',
        notes: 'staging',
      }),
      overrideAccess: false,
      user: admin,
    })
  })

  it('accepts the public browser origin behind an internal reverse-proxy URL', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    process.env.NEXT_PUBLIC_SERVER_URL = 'https://ivybm.com'
    const payload = createPayload()
    mocks.getPayload.mockResolvedValue(payload)

    const response = await POST(
      new NextRequest('http://app:3000/api/platforms/accounts', {
        body: JSON.stringify({ accountKind: 'facebook-page', name: 'Production Page' }),
        headers: { 'content-type': 'application/json', origin: 'https://ivybm.com' },
        method: 'POST',
      }),
    )

    expect(response.status).toBe(201)
    expect(payload.create).toHaveBeenCalledOnce()
  })

  it('rejects unsupported account kinds including TikTok', async () => {
    const payload = createPayload()
    mocks.getPayload.mockResolvedValue(payload)

    const response = await POST(
      jsonRequest({
        body: { accountKind: 'tiktok-business', name: 'TikTok' },
        method: 'POST',
        path: '/api/platforms/accounts',
      }),
    )

    await expect(response.json()).resolves.toEqual({ error: { code: 'unsupported_account_kind' } })
    expect(response.status).toBe(400)
  })

  it('rejects create requests with a mismatched origin', async () => {
    const payload = createPayload()
    mocks.getPayload.mockResolvedValue(payload)

    const response = await POST(
      jsonRequest({
        body: { accountKind: 'facebook-page', name: 'Test' },
        method: 'POST',
        origin: 'https://evil.example',
        path: '/api/platforms/accounts',
      }),
    )

    await expect(response.json()).resolves.toEqual({ error: { code: 'forbidden' } })
    expect(response.status).toBe(403)
    expect(payload.create).not.toHaveBeenCalled()
  })

  it('rejects create requests with a non-JSON content type', async () => {
    const response = await POST(
      new NextRequest('http://localhost:3000/api/platforms/accounts', {
        body: JSON.stringify({ name: 'Test' }),
        headers: { origin: 'http://localhost:3000' },
        method: 'POST',
      }),
    )

    await expect(response.json()).resolves.toEqual({ error: { code: 'unsupported_media_type' } })
    expect(response.status).toBe(415)
  })

  it('updates account metadata with stale-write protection', async () => {
    const payload = createPayload()
    mocks.getPayload.mockResolvedValue(payload)

    const response = await PATCH(
      jsonRequest({
        body: { authorizationRevision: 3, externalAccountId: 'new-id', name: 'Updated Page' },
        method: 'PATCH',
        path: '/api/platforms/accounts/42',
      }),
    )

    expect(response.status).toBe(200)
    expect(payload.update).toHaveBeenCalledWith({
      collection: 'platform-accounts',
      data: { externalAccountId: 'new-id', name: 'Updated Page' },
      id: 42,
      overrideAccess: false,
      req: expect.any(Object),
      user: admin,
    })
  })

  it('rejects updates when the authorization revision is stale', async () => {
    const payload = createPayload({
      findByIDResult: { ...account, authorizationRevision: 3 },
    })
    mocks.getPayload.mockResolvedValue(payload)

    const response = await PATCH(
      jsonRequest({
        body: { authorizationRevision: 1, name: 'Updated Page' },
        method: 'PATCH',
        path: '/api/platforms/accounts/42',
      }),
    )

    await expect(response.json()).resolves.toEqual({ error: { code: 'stale_revision' } })
    expect(response.status).toBe(409)
  })

  it('deletes a safely disconnected account', async () => {
    const payload = createPayload({
      findByIDResult: {
        ...account,
        authorization: { ...account.authorization, state: 'not_started' },
      },
    })
    mocks.getPayload.mockResolvedValue(payload)

    const response = await DELETE(
      jsonRequest({
        body: { authorizationRevision: 3 },
        method: 'DELETE',
        path: '/api/platforms/accounts/42',
      }),
    )

    expect(response.status).toBe(200)
    expect(payload.delete).toHaveBeenCalledWith({
      collection: 'platform-accounts',
      id: 42,
      overrideAccess: false,
      req: expect.any(Object),
      user: admin,
    })
  })

  it('refuses to delete a connected account', async () => {
    const payload = createPayload({
      findByIDResult: {
        ...account,
        authorization: { ...account.authorization, state: 'connected' },
      },
    })
    mocks.getPayload.mockResolvedValue(payload)

    const response = await DELETE(
      jsonRequest({
        body: { authorizationRevision: 3 },
        method: 'DELETE',
        path: '/api/platforms/accounts/42',
      }),
    )

    await expect(response.json()).resolves.toEqual({ error: { code: 'account_not_disconnected' } })
    expect(response.status).toBe(409)
    expect(payload.delete).not.toHaveBeenCalled()
  })
})
