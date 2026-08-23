import { describe, expect, it, vi } from 'vitest'

import { getPortalSession } from '@/admin-portal/core/auth/getPortalSession'
import { getPortalRequestPath } from '@/admin-portal/core/auth/portalRequestPath'
import { requirePortalUser } from '@/admin-portal/core/auth/requirePortalUser'
import { requestPortalLogout } from '@/modules/auth/payloadLogout'

describe('Portal authentication adapters', () => {
  it.each(['admin', 'operator', 'sales'] as const)(
    'returns a minimal Portal user for the Payload users collection with the %s role',
    async (role) => {
      const auth = vi.fn().mockResolvedValue({
        user: { collection: 'users', email: `${role}@example.com`, id: 42, role },
      })

      await expect(
        getPortalSession({
          getPayloadInstance: async () => ({ auth }),
          requestHeaders: new Headers({ cookie: 'payload-token=opaque' }),
        }),
      ).resolves.toEqual({
        email: `${role}@example.com`,
        id: 42,
        role,
      })
      expect(auth).toHaveBeenCalledWith({
        headers: expect.any(Headers),
      })
    },
  )

  it('fails closed for missing users, another collection, or an invalid role', async () => {
    for (const user of [
      null,
      { collection: 'api-keys', email: 'admin@example.com', id: 1, role: 'admin' },
      { collection: 'users', email: 'admin@example.com', id: 1, role: 'owner' },
    ]) {
      await expect(
        getPortalSession({
          getPayloadInstance: async () => ({ auth: vi.fn().mockResolvedValue({ user }) }),
          requestHeaders: new Headers(),
        }),
      ).resolves.toBeNull()
    }
  })

  it('propagates Payload authentication infrastructure failures', async () => {
    const failure = new Error('database unavailable')

    await expect(
      getPortalSession({
        getPayloadInstance: async () => {
          throw failure
        },
        requestHeaders: new Headers(),
      }),
    ).rejects.toBe(failure)
  })

  it('redirects an unauthenticated request to the safe Portal login target', async () => {
    const redirectTo = vi.fn((path: string): never => {
      throw new Error(path)
    })

    await expect(
      requirePortalUser({
        getSession: async () => null,
        onRedirect: redirectTo,
        returnTo: 'https://evil.example/dashboard',
      }),
    ).rejects.toThrow('/dashboard/login?returnTo=%2Fdashboard')
    expect(redirectTo).toHaveBeenCalledWith('/dashboard/login?returnTo=%2Fdashboard')
  })

  it('returns the existing Payload Portal user without redirecting', async () => {
    const user = { email: 'sales@example.com', id: 8, role: 'sales' } as const
    const redirectTo = vi.fn((_path: string): never => {
      throw new Error('should not redirect')
    })

    await expect(
      requirePortalUser({ getSession: async () => user, onRedirect: redirectTo }),
    ).resolves.toBe(user)
    expect(redirectTo).not.toHaveBeenCalled()
  })

  it('uses the proxy-provided current Portal path and still sanitizes it', () => {
    expect(
      getPortalRequestPath(
        new Headers({ 'x-ivybm-portal-path': '/dashboard/media?type=pdf#preview' }),
      ),
    ).toBe('/dashboard/media?type=pdf#preview')
    expect(
      getPortalRequestPath(
        new Headers({ 'x-ivybm-portal-path': 'https://evil.example/dashboard' }),
      ),
    ).toBe('/dashboard')
  })

  it('only completes logout after Payload returns a 2xx response', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 200 }))

    await expect(requestPortalLogout({ fetcher })).resolves.toBeUndefined()
    expect(fetcher).toHaveBeenCalledWith('/api/users/logout', {
      credentials: 'include',
      method: 'POST',
    })

    fetcher.mockResolvedValueOnce(new Response(null, { status: 503 }))
    await expect(requestPortalLogout({ fetcher })).rejects.toMatchObject({
      code: 'service-unavailable',
      status: 503,
    })

    fetcher.mockRejectedValueOnce(new Error('socket detail'))
    await expect(requestPortalLogout({ fetcher })).rejects.toMatchObject({
      code: 'network-failure',
      status: 0,
    })
  })
})
