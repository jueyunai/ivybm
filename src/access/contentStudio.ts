import type { Access, AccessResult, PayloadRequest } from 'payload'

import { getRoleUser, resolveRoleAccess } from './roles'

const commandContextKey = 'portalContentStudioCommand'

const canManageContentStudio = (user: unknown): boolean =>
  resolveRoleAccess({
    action: 'read',
    resource: 'content',
    user: getRoleUser(user),
  }) === true

export const contentStudioRead: Access = ({ req }): AccessResult =>
  canManageContentStudio(req.user)

export const contentStudioAdmin = ({ req }: { req: PayloadRequest }): boolean =>
  canManageContentStudio(req.user)

// Writes are intentionally accepted only from a server-side Portal command. This
// prevents a browser from treating Payload's generic REST routes as the workflow.
export const contentStudioCommandWrite: Access = ({ req }: { req: PayloadRequest }): boolean =>
  canManageContentStudio(req.user) && req.context[commandContextKey] === true

export const contentStudioInternalWriteContext = {
  [commandContextKey]: true,
} as const
