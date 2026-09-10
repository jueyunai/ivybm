import type { Access, AccessResult, PayloadRequest, Where } from 'payload'

export const USER_ROLES = ['admin', 'operator', 'sales'] as const

export type UserRole = (typeof USER_ROLES)[number]

export type RoleUser = {
  id: number | string
  permissions?: unknown
  role: UserRole
}

export type AccessAction = 'create' | 'read' | 'update' | 'delete'

export type AccessResource =
  | 'users'
  | 'content'
  | 'contentStudio'
  | 'media'
  | 'knowledge'
  | 'platformAccounts'
  | 'conversations'
  | 'leads'

export const PERMISSION_MODULE_IDS = [
  'conversations',
  'leads',
  'content',
  'media',
  'contentStudio',
  'knowledge',
  'platforms',
  'operations',
  'settings',
] as const

export type PermissionModuleId = (typeof PERMISSION_MODULE_IDS)[number]

export interface ModulePermission {
  edit: boolean
  view: boolean
}

export type PortalUserPermissions = Record<PermissionModuleId, ModulePermission>

export type PermissionMatrixInput = Partial<Record<PermissionModuleId, unknown>>

const rolePermissions = (
  role: UserRole,
  editableModules: PermissionModuleId[],
): PortalUserPermissions =>
  Object.fromEntries(
    PERMISSION_MODULE_IDS.map((moduleId) => [
      moduleId,
      {
        edit: editableModules.includes(moduleId),
        view: role === 'sales' ? editableModules.includes(moduleId) : true,
      },
    ]),
  ) as PortalUserPermissions

export const PORTAL_PERMISSION_PRESETS = {
  admin: rolePermissions('admin', [...PERMISSION_MODULE_IDS]),
  operator: rolePermissions('operator', [
    'conversations',
    'leads',
    'content',
    'media',
    'contentStudio',
    'knowledge',
    'settings',
  ]),
  sales: rolePermissions('sales', ['conversations', 'leads', 'settings']),
} as const satisfies Record<UserRole, PortalUserPermissions>

const normalizeModulePermission = (value: unknown): ModulePermission => {
  if (!value || typeof value !== 'object') return { edit: false, view: false }
  const candidate = value as { edit?: unknown; view?: unknown }
  const edit = candidate.edit === true
  const view = candidate.view === true || edit
  return { edit, view }
}

export const normalizePortalPermissions = (
  value: unknown,
  role: UserRole = 'sales',
): PortalUserPermissions => {
  const template = PORTAL_PERMISSION_PRESETS[role]
  const source = value && typeof value === 'object' ? (value as PermissionMatrixInput) : {}

  return Object.fromEntries(
    PERMISSION_MODULE_IDS.map((moduleId) => [
      moduleId,
      source[moduleId] === undefined
        ? template[moduleId]
        : normalizeModulePermission(source[moduleId]),
    ]),
  ) as PortalUserPermissions
}

export const hasPortalPermission = (
  user: Pick<RoleUser, 'permissions' | 'role'> | null | undefined,
  moduleId: PermissionModuleId,
  action: 'view' | 'edit',
): boolean => {
  if (!user) return false
  const matrix = normalizePortalPermissions(user.permissions, user.role)
  return matrix[moduleId][action]
}

type ResolveRoleAccessArgs = {
  action: AccessAction
  resource: AccessResource
  user: RoleUser | null
}

const isRoleUser = (user: unknown): user is RoleUser => {
  if (!user || typeof user !== 'object') {
    return false
  }

  const candidate = user as Partial<RoleUser>

  return (
    (typeof candidate.id === 'number' || typeof candidate.id === 'string') &&
    USER_ROLES.some((role) => role === candidate.role)
  )
}

export const getRoleUser = (user: unknown): RoleUser | null => (isRoleUser(user) ? user : null)

const assignedToUser = (user: RoleUser): Where => ({
  assignedTo: {
    equals: user.id,
  },
})

const permissionModuleFor = (resource: AccessResource): PermissionModuleId => {
  switch (resource) {
    case 'contentStudio':
      return 'contentStudio'
    case 'platformAccounts':
      return 'platforms'
    case 'users':
      return 'settings'
    default:
      return resource
  }
}

export const resolveRoleAccess = ({
  action,
  resource,
  user,
}: ResolveRoleAccessArgs): AccessResult => {
  if (!user) {
    return false
  }

  if (
    !hasPortalPermission(user, permissionModuleFor(resource), action === 'read' ? 'view' : 'edit')
  ) {
    return false
  }

  if (user.role === 'admin') {
    return true
  }

  if (user.role === 'operator') {
    if (resource === 'content' || resource === 'knowledge') {
      return true
    }

    if (
      (resource === 'conversations' || resource === 'leads') &&
      (action === 'read' || action === 'update')
    ) {
      return true
    }

    return false
  }

  if (
    user.role === 'sales' &&
    (resource === 'conversations' || resource === 'leads') &&
    (action === 'read' || action === 'update')
  ) {
    return assignedToUser(user)
  }

  return false
}

export const accessFor =
  (resource: AccessResource, action: AccessAction): Access =>
  ({ req }): AccessResult =>
    resolveRoleAccess({
      action,
      resource,
      user: getRoleUser(req.user),
    })

export const portalPermissionAccess =
  (moduleId: PermissionModuleId, action: 'view' | 'edit'): Access =>
  ({ req }): boolean =>
    hasPortalPermission(getRoleUser(req.user), moduleId, action)

export const portalPermissionAdminAccess =
  (moduleId: PermissionModuleId, action: 'view' | 'edit') =>
  ({ req }: { req: PayloadRequest }): boolean =>
    hasPortalPermission(getRoleUser(req.user), moduleId, action)

type AdminAccess = ({ req }: { req: PayloadRequest }) => boolean | Promise<boolean>

export const authenticated: AdminAccess = ({ req }): boolean => Boolean(getRoleUser(req.user))

export const admins: AdminAccess = ({ req }): boolean => getRoleUser(req.user)?.role === 'admin'

export const adminsOrSelf: Access = ({ req }): AccessResult => {
  const user = getRoleUser(req.user)

  if (!user) {
    return false
  }

  if (user.role === 'admin') {
    return true
  }

  return {
    id: {
      equals: user.id,
    },
  }
}
