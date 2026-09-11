import type { PortalUserPermissions, UserRole } from '@/access/roles'

export interface PortalUser {
  permissions: PortalUserPermissions
  username: string
  id: number | string
  role: UserRole
}

export type PortalLoginErrorCode =
  'account-locked' | 'invalid-credentials' | 'network-failure' | 'service-unavailable'

export interface PortalLoginCredentials {
  username: string
  password: string
}
