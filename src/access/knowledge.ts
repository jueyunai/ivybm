import type { Access, AccessResult, PayloadRequest } from 'payload'

import { getRoleUser, resolveRoleAccess } from './roles'

const canManageKnowledge = (user: unknown): boolean =>
  resolveRoleAccess({
    action: 'read',
    resource: 'knowledge',
    user: getRoleUser(user),
  }) === true

export const knowledgeAdmin = ({ req }: { req: PayloadRequest }): boolean =>
  canManageKnowledge(req.user)

const knowledgeAccess =
  (action: 'create' | 'read' | 'update' | 'delete'): Access =>
  ({ req }): AccessResult =>
    resolveRoleAccess({
      action,
      resource: 'knowledge',
      user: getRoleUser(req.user),
    })

export const knowledgeCreate = knowledgeAccess('create')
export const knowledgeRead = knowledgeAccess('read')
export const knowledgeUpdate = knowledgeAccess('update')
export const knowledgeDelete = knowledgeAccess('delete')
