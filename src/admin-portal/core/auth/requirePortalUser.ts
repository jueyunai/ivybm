import { redirect } from 'next/navigation'

import { getPortalSession } from './getPortalSession'
import { safePortalReturnTo } from './safeReturnTo'
import type { PortalUser } from './types'

type RequirePortalUserOptions = {
  getSession?: () => Promise<PortalUser | null>
  onRedirect?: (path: string) => never
  returnTo?: string
}

export const requirePortalUser = async ({
  getSession = getPortalSession,
  onRedirect = redirect,
  returnTo,
}: RequirePortalUserOptions = {}): Promise<PortalUser> => {
  const user = await getSession()
  if (user) return user

  const safeReturnTo = safePortalReturnTo(returnTo)
  return onRedirect(`/dashboard/login?returnTo=${encodeURIComponent(safeReturnTo)}`)
}
