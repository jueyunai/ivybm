import { USER_ROLES, type UserRole } from '@/access/roles'
import type { User } from '@/payload-types'

export type PortalTeamMemberRole = UserRole

export type PortalTeamMemberStatus = 'normal' | 'security_locked' | 'manually_locked'

export type PermissionModuleId =
  | 'conversations'
  | 'leads'
  | 'content'
  | 'media'
  | 'contentStudio'
  | 'knowledge'
  | 'platforms'
  | 'operations'
  | 'settings'

export interface ModulePermission {
  edit: boolean
  view: boolean
}

export type PortalUserPermissions = Record<PermissionModuleId, ModulePermission>

export const PERMISSION_MODULES: Array<{
  description: string
  id: PermissionModuleId
  label: string
}> = [
  { id: 'conversations', label: '统一会话', description: '客户消息与渠道接待' },
  { id: 'leads', label: '线索管理', description: '线索跟进与资质确认' },
  { id: 'content', label: '官网内容', description: '多语言产品与文章维护' },
  { id: 'media', label: '素材库', description: '工程图片与资产管理' },
  { id: 'contentStudio', label: 'AI 内容工作台', description: '社媒图文草稿与发布' },
  { id: 'knowledge', label: '知识库与 AI 调试', description: '业务知识文档与索引' },
  { id: 'platforms', label: '平台状态', description: '海外平台账号连接与授权' },
  { id: 'operations', label: '后台任务', description: '异步发布与同步作业' },
  { id: 'settings', label: '基础设置', description: '团队成员管理与模型配置' },
]

export const DEFAULT_PERMISSIONS_FOR_ROLE: Record<PortalTeamMemberRole, PortalUserPermissions> = {
  admin: {
    conversations: { edit: true, view: true },
    leads: { edit: true, view: true },
    content: { edit: true, view: true },
    media: { edit: true, view: true },
    contentStudio: { edit: true, view: true },
    knowledge: { edit: true, view: true },
    platforms: { edit: true, view: true },
    operations: { edit: true, view: true },
    settings: { edit: true, view: true },
  },
  operator: {
    conversations: { edit: false, view: true },
    leads: { edit: false, view: true },
    content: { edit: true, view: true },
    media: { edit: true, view: true },
    contentStudio: { edit: true, view: true },
    knowledge: { edit: true, view: true },
    platforms: { edit: false, view: true },
    operations: { edit: false, view: true },
    settings: { edit: false, view: false },
  },
  sales: {
    conversations: { edit: true, view: true },
    leads: { edit: true, view: true },
    content: { edit: false, view: false },
    media: { edit: false, view: false },
    contentStudio: { edit: false, view: false },
    knowledge: { edit: false, view: false },
    platforms: { edit: false, view: false },
    operations: { edit: false, view: false },
    settings: { edit: false, view: false },
  },
}


export interface PortalTeamMemberDTO {
  createdAt: string
  email: string
  id: number | string
  lockedUntil: string | null
  permissions?: PortalUserPermissions
  role: PortalTeamMemberRole
  status: PortalTeamMemberStatus
  updatedAt: string
}

export interface CreateTeamMemberInput {
  confirmPassword: string
  email: string
  password: string
  permissions?: PortalUserPermissions
  role: PortalTeamMemberRole
}

export interface UpdateTeamMemberInput {
  email?: string
  permissions?: PortalUserPermissions
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
    permissions?: unknown
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

  const permissions =
    user.permissions && typeof user.permissions === 'object'
      ? (user.permissions as PortalUserPermissions)
      : undefined

  return {
    createdAt: typeof user.createdAt === 'string' ? user.createdAt : new Date().toISOString(),
    email: user.email,
    id: user.id,
    lockedUntil,
    ...(permissions ? { permissions } : {}),
    role: user.role,
    status,
    updatedAt: typeof user.updatedAt === 'string' ? user.updatedAt : new Date().toISOString(),
  }
}
