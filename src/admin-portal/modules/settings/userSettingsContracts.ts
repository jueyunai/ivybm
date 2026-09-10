import {
  normalizePortalPermissions,
  USER_ROLES,
  type PortalUserPermissions,
  type UserRole,
} from '@/access/roles'
import type { User } from '@/payload-types'

export type PortalTeamMemberRole = UserRole
export type { PortalUserPermissions }

export type PortalTeamMemberStatus = 'normal' | 'security_locked' | 'manually_locked'

export interface PortalTeamMemberDTO {
  createdAt: string
  id: number | string
  lockedUntil: string | null
  permissions: PortalUserPermissions
  role: PortalTeamMemberRole
  status: PortalTeamMemberStatus
  updatedAt: string
  username: string
}

export interface CreateTeamMemberInput {
  permissions: PortalUserPermissions
  password: string
  role: PortalTeamMemberRole
  username: string
}

export interface UpdateTeamMemberInput {
  permissions?: PortalUserPermissions
  role?: PortalTeamMemberRole
  updatedAt: string
  username?: string
}

export interface ResetMemberPasswordInput {
  confirmPassword: string
  password: string
  updatedAt: string
}

export interface ChangePersonalPasswordInput {
  confirmNewPassword: string
  currentPassword: string
  newPassword: string
}

export interface LockTeamMemberInput {
  updatedAt: string
}

export interface UnlockTeamMemberInput {
  updatedAt: string
}

export interface DeleteTeamMemberInput {
  confirmUsername: string
  updatedAt: string
}

export const MANUAL_LOCK_UNTIL = '2099-12-31T23:59:59.999Z'

const USERNAME_PATTERN = /^[a-z0-9](?:[a-z0-9._-]{1,62})[a-z0-9]$/

export class UserSettingsCommandError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly details?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'UserSettingsCommandError'
  }
}

export const validateUsername = (value: unknown): string => {
  if (typeof value !== 'string') {
    throw new UserSettingsCommandError('invalid-input', 'A valid username is required.', 400)
  }
  const normalized = value.trim().toLowerCase()
  if (!USERNAME_PATTERN.test(normalized)) {
    throw new UserSettingsCommandError('invalid-input', 'A valid username is required.', 400)
  }
  return normalized
}

export const validatePassword = (value: unknown, fieldName = 'Password'): string => {
  if (typeof value !== 'string') {
    throw new UserSettingsCommandError(
      'invalid-input',
      `${fieldName} must be between 12 and 128 characters.`,
      400,
    )
  }
  if (value.length < 12 || value.length > 128) {
    throw new UserSettingsCommandError(
      'invalid-input',
      `${fieldName} must be between 12 and 128 characters.`,
      400,
    )
  }
  return value
}

export const validateRole = (value: unknown): PortalTeamMemberRole => {
  if (typeof value !== 'string' || !USER_ROLES.includes(value as PortalTeamMemberRole)) {
    throw new UserSettingsCommandError(
      'invalid-input',
      'A valid role (admin, operator, sales) is required.',
      400,
    )
  }
  return value as PortalTeamMemberRole
}

export const validateUpdatedAt = (value: unknown): string => {
  if (typeof value !== 'string' || !value.trim()) {
    throw new UserSettingsCommandError(
      'invalid-input',
      'A valid configuration version (updatedAt) is required.',
      400,
    )
  }
  return value.trim()
}

export const validatePermissions = (
  value: unknown,
  role: PortalTeamMemberRole,
): PortalUserPermissions => normalizePortalPermissions(value, role)

export const selectPortalTeamMemberDTO = (
  user: Pick<User, 'createdAt' | 'id' | 'permissions' | 'role' | 'updatedAt' | 'username'> & {
    lockUntil?: string | null
    loginAttempts?: number | null
  },
): PortalTeamMemberDTO => {
  const now = new Date()
  let status: PortalTeamMemberStatus = 'normal'
  let lockedUntil: string | null = null

  if (user.lockUntil) {
    const lockDate = new Date(user.lockUntil)
    if (lockDate.getTime() > now.getTime()) {
      if (lockDate.getFullYear() >= 2090) {
        status = 'manually_locked'
        lockedUntil = null
      } else {
        status = 'security_locked'
        lockedUntil = user.lockUntil
      }
    }
  }

  return {
    createdAt: typeof user.createdAt === 'string' ? user.createdAt : new Date().toISOString(),
    id: user.id,
    lockedUntil,
    permissions: normalizePortalPermissions(user.permissions, user.role),
    role: user.role,
    status,
    updatedAt: typeof user.updatedAt === 'string' ? user.updatedAt : new Date().toISOString(),
    username: user.username,
  }
}
