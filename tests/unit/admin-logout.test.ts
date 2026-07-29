import { describe, expect, it, vi } from 'vitest'

import { AdminLogoutError, requestAdminLogout } from '@/admin/auth/logout'

describe('requestAdminLogout', () => {
  it('uses the Payload REST logout contract with the current session cookie', async () => {
    const fetcher = vi.fn<typeof fetch>()
    fetcher.mockResolvedValue(new Response(null, { status: 204 }))

    await expect(
      requestAdminLogout({ apiRoute: '/api', fetcher, userSlug: 'users' }),
    ).resolves.toBeUndefined()

    expect(fetcher).toHaveBeenCalledWith('/api/users/logout', {
      credentials: 'include',
      method: 'POST',
    })
  })

  it('rejects a real non-2xx response so the UI can retry without clearing auth state', async () => {
    const fetcher = vi.fn<typeof fetch>()
    fetcher.mockResolvedValue(new Response(null, { status: 503 }))

    await expect(
      requestAdminLogout({ apiRoute: '/api', fetcher, userSlug: 'users' }),
    ).rejects.toEqual(expect.objectContaining<Partial<AdminLogoutError>>({ status: 503 }))
  })
})
