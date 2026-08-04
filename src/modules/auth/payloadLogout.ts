export class PortalLogoutError extends Error {
  code: 'network-failure' | 'service-unavailable'
  status: number

  constructor(code: 'network-failure' | 'service-unavailable', status: number) {
    super(`Portal logout failed: ${code}`)
    this.code = code
    this.name = 'PortalLogoutError'
    this.status = status
  }
}

export const requestPortalLogout = async ({
  fetcher = globalThis.fetch,
}: {
  fetcher?: typeof fetch
} = {}): Promise<void> => {
  let response: Response

  try {
    response = await fetcher('/api/users/logout', {
      credentials: 'include',
      method: 'POST',
    })
  } catch {
    throw new PortalLogoutError('network-failure', 0)
  }

  if (!response.ok) throw new PortalLogoutError('service-unavailable', response.status)
}
