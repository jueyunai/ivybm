import type { Access, AccessResult, PayloadRequest, Where } from 'payload'

export const USER_ROLES = ['admin', 'operator', 'sales'] as const

export type UserRole = (typeof USER_ROLES)[number]

export type RoleUser = {
  id: number | string
  role: UserRole
}

export type AccessAction = 'create' | 'read' | 'update' | 'delete'

export type AccessResource =
  'users' | 'content' | 'knowledge' | 'platformAccounts' | 'conversations' | 'leads'

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

export const resolveRoleAccess = ({
  action,
  resource,
  user,
}: ResolveRoleAccessArgs): AccessResult => {
  if (!user) {
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
