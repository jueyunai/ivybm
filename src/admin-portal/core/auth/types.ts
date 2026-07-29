import type { UserRole } from '@/access/roles'

export interface PortalUser {
  email: string
  id: number | string
  role: UserRole
}

export type PortalLoginErrorCode =
  | 'account-locked'
  | 'invalid-credentials'
  | 'network-failure'
  | 'service-unavailable'

export interface PortalLoginCredentials {
  email: string
  password: string
}
