import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  createLocalReq: vi.fn(),
  getPayload: vi.fn(),
}))

vi.mock('payload', () => ({ createLocalReq: mocks.createLocalReq, getPayload: mocks.getPayload }))
vi.mock('@/payload.config', () => ({ default: {} }))

import { GET } from '@/app/api/platforms/readiness/route'

const request = (): NextRequest => new NextRequest('http://localhost/api/platforms/readiness')

describe('platform readiness route', () => {
  beforeEach(() => {
    mocks.createLocalReq.mockReset()
    mocks.createLocalReq.mockResolvedValue({ id: 'portal-platform-readiness-request' })
    mocks.getPayload.mockReset()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('requires an authenticated user before loading platform accounts', async () => {
    const find = vi.fn()
    mocks.getPayload.mockResolvedValue({
      auth: vi.fn().mockResolvedValue({ user: null }),
      find,
      logger: { error: vi.fn() },
    })

    const response = await GET(request())

    await expect(response.json()).resolves.toEqual({ error: { code: 'authentication_required' } })
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.status).toBe(401)
    expect(find).not.toHaveBeenCalled()
  })

  it('returns a stable unavailable response without logging a credential-bearing failure', async () => {
    vi.stubEnv('ADMIN_PORTAL_ENABLED', 'true')
    vi.stubEnv('ADMIN_PORTAL_PLATFORMS_ENABLED', 'true')
    const logger = { error: vi.fn() }
    const secretBearingError = new Error('access token must not be exposed')
    mocks.getPayload.mockResolvedValue({
      auth: vi.fn().mockResolvedValue({ user: { collection: 'users', role: 'admin' } }),
      find: vi.fn().mockRejectedValue(secretBearingError),
      logger,
    })

    const response = await GET(request())
    const body = await response.text()

    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.status).toBe(503)
    expect(body).toBe(JSON.stringify({ error: { code: 'platform_readiness_unavailable' } }))
    expect(body).not.toContain(secretBearingError.message)
    expect(logger.error).toHaveBeenCalledWith(
      'Platform readiness endpoint unavailable during assessing',
    )
  })

  it('does not load readiness data when the Portal platform module is disabled', async () => {
    vi.stubEnv('ADMIN_PORTAL_ENABLED', 'true')
    vi.stubEnv('ADMIN_PORTAL_PLATFORMS_ENABLED', 'false')
    const find = vi.fn()
    mocks.getPayload.mockResolvedValue({
      auth: vi.fn().mockResolvedValue({ user: { collection: 'users', role: 'admin' } }),
      find,
      logger: { error: vi.fn() },
    })

    const response = await GET(request())

    await expect(response.json()).resolves.toEqual({ error: { code: 'platform_module_disabled' } })
    expect(response.status).toBe(503)
    expect(find).not.toHaveBeenCalled()
  })

  it('reads platform accounts through the current access-controlled request', async () => {
    vi.stubEnv('ADMIN_PORTAL_ENABLED', 'true')
    vi.stubEnv('ADMIN_PORTAL_PLATFORMS_ENABLED', 'true')
    const find = vi.fn().mockResolvedValue({ docs: [] })
    mocks.getPayload.mockResolvedValue({
      auth: vi.fn().mockResolvedValue({ user: { collection: 'users', id: 1, role: 'admin' } }),
      find,
      logger: { error: vi.fn() },
    })

    const response = await GET(request())

    await expect(response.json()).resolves.toEqual({ accounts: [] })
    expect(find).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: 'platform-accounts',
        context: { portalPlatformReadinessCredentialRead: true },
        overrideAccess: false,
        req: expect.anything(),
      }),
    )
  })
})
