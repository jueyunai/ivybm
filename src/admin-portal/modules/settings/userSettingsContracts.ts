import { USER_ROLES, type UserRole } from '@/access/roles'
import type { User } from '@/payload-types'

export type PortalTeamMemberRole = UserRole

export type PortalTeamMemberStatus = 'normal' | 'security_locked' | 'manually_locked'

export interface PortalTeamMemberDTO {
  createdAt: string
  email: string
  id: number | string
  lockedUntil: string | null
  role: PortalTeamMemberRole
  status: PortalTeamMemberStatus
  updatedAt: string
}

export interface CreateTeamMemberInput {
  confirmPassword: string
  email: string
  password: string
  role: PortalTeamMemberRole
}

export interface UpdateTeamMemberInput {
  email?: string
  role?: PortalTeamMemberRole
  updatedAt: string
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
  confirmEmail: string
  updatedAt: string
}

export const MANUAL_LOCK_UNTIL = '2099-12-31T23:59:59.999Z'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

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

export const validateEmail = (value: unknown): string => {
  if (typeof value !== 'string') {
    throw new UserSettingsCommandError('invalid-input', 'A valid email address is required.', 400)
  }
  const normalized = value.trim().toLowerCase()
  if (!normalized || normalized.length > 320 || !EMAIL_PATTERN.test(normalized)) {
    throw new UserSettingsCommandError('invalid-input', 'A valid email address is required.', 400)
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

export const selectPortalTeamMemberDTO = (
  user: Pick<User, 'createdAt' | 'email' | 'id' | 'role' | 'updatedAt'> & {
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
    email: user.email,
    id: user.id,
    lockedUntil,
    role: user.role,
    status,
    updatedAt: typeof user.updatedAt === 'string' ? user.updatedAt : new Date().toISOString(),
  }
}
