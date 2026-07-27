import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  getPayload: vi.fn(),
}))

vi.mock('payload', () => ({ getPayload: mocks.getPayload }))
vi.mock('@/payload.config', () => ({ default: {} }))

import { GET } from '@/app/api/platforms/readiness/route'

const request = (): NextRequest => new NextRequest('http://localhost/api/platforms/readiness')

describe('platform readiness route', () => {
  beforeEach(() => {
    mocks.getPayload.mockReset()
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
      'Platform readiness endpoint unavailable during loading_accounts',
    )
  })
})
