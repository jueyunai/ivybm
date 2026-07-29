import { formatAdminURL } from 'payload/shared'

type AdminLogoutRequest = {
  apiRoute: string
  fetcher?: typeof fetch
  userSlug: string
}

export class AdminLogoutError extends Error {
  status: number

  constructor(status: number) {
    super(`Admin logout failed with status ${status}`)
    this.name = 'AdminLogoutError'
    this.status = status
  }
}

export const requestAdminLogout = async ({
  apiRoute,
  fetcher = globalThis.fetch,
  userSlug,
}: AdminLogoutRequest): Promise<void> => {
  const response = await fetcher(
    formatAdminURL({
      apiRoute,
      path: `/${userSlug}/logout`,
    }),
    {
      credentials: 'include',
      method: 'POST',
    },
  )

  if (!response.ok) {
    throw new AdminLogoutError(response.status)
  }
}
