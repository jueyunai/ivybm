import { headers } from 'next/headers'
import { getPayload } from 'payload'

import { getRoleUser } from '@/access/roles'
import config from '@/payload.config'

import type { PortalUser } from './types'

type PortalAuthUser = {
  collection?: string
  email?: unknown
  id?: unknown
  role?: unknown
}

type PortalAuthPayload = {
  auth: (args: { headers: Headers }) => Promise<{ user: PortalAuthUser | null }>
}

type GetPortalSessionOptions = {
  getPayloadInstance?: () => Promise<PortalAuthPayload>
  requestHeaders?: Headers
}

export const getPortalSession = async ({
  getPayloadInstance = async () => (await getPayload({ config })) as PortalAuthPayload,
  requestHeaders,
}: GetPortalSessionOptions = {}): Promise<PortalUser | null> => {
  const payload = await getPayloadInstance()
  const authenticated = await payload.auth({ headers: requestHeaders ?? (await headers()) })
  const candidate = authenticated.user

  if (candidate?.collection !== 'users' || typeof candidate.email !== 'string') return null

  const roleUser = getRoleUser(candidate)
  if (!roleUser) return null

  return {
    email: candidate.email,
    id: roleUser.id,
    role: roleUser.role,
  }
}
