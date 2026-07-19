import type { Access, AccessResult, PayloadRequest } from 'payload'

import { accessFor, authenticated, getRoleUser } from './roles'

export const conversationsAdmin = authenticated
export const conversationsCreate = accessFor('conversations', 'create')
export const conversationsDelete = accessFor('conversations', 'delete')
export const conversationsRead = accessFor('conversations', 'read')
export const conversationsUpdate = accessFor('conversations', 'update')

export const conversationMessagesRead: Access = ({ req }): AccessResult => {
  const user = getRoleUser(req.user)
  if (!user) return false
  if (user.role === 'admin' || user.role === 'operator') return true
  return { 'conversation.assignedTo': { equals: user.id } }
}

export const conversationInternalWrite: Access = () => false
export const visitorSessionsAdmin = ({ req }: { req: PayloadRequest }): boolean => {
  const role = getRoleUser(req.user)?.role
  return role === 'admin' || role === 'operator'
}
