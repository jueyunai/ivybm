import type { PortalLoginCredentials, PortalLoginErrorCode } from './types'

export class PortalLoginError extends Error {
  code: PortalLoginErrorCode
  status: number

  constructor(code: PortalLoginErrorCode, status: number) {
    super(`Portal login failed: ${code}`)
    this.code = code
    this.name = 'PortalLoginError'
    this.status = status
  }
}

const codeForStatus = (status: number): PortalLoginErrorCode => {
  if (status === 401 || status === 400) return 'invalid-credentials'
  if (status === 423 || status === 429) return 'account-locked'
  return 'service-unavailable'
}

export const requestPortalLogin = async ({
  email,
  fetcher = globalThis.fetch,
  password,
}: PortalLoginCredentials & { fetcher?: typeof fetch }): Promise<void> => {
  let response: Response

  try {
    response = await fetcher('/api/users/login', {
      body: JSON.stringify({ email, password }),
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    })
  } catch {
    throw new PortalLoginError('network-failure', 0)
  }

  if (!response.ok) throw new PortalLoginError(codeForStatus(response.status), response.status)
}
