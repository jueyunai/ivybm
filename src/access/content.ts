import type { Access, AccessResult, PayloadRequest } from 'payload'

import { getRoleUser, resolveRoleAccess } from './roles'

const canManageContent = (user: unknown): boolean =>
  resolveRoleAccess({
    action: 'read',
    resource: 'content',
    user: getRoleUser(user),
  }) === true

export const publicRead: Access = (): AccessResult => true

export const contentAdmin = ({ req }: { req: PayloadRequest }): boolean =>
  canManageContent(req.user)

export const publishedContentRead: Access = ({ req }): AccessResult => {
  if (canManageContent(req.user)) {
    return true
  }

  return {
    _status: {
      equals: 'published',
    },
  }
}

export const activeDownloadsRead: Access = ({ req }): AccessResult => {
  if (canManageContent(req.user)) {
    return true
  }

  return {
    isActive: {
      equals: true,
    },
  }
}

export const publicMediaRead: Access = ({ req }): AccessResult => {
  if (canManageContent(req.user)) {
    return true
  }

  return {
    isPublic: {
      equals: true,
    },
  }
}

export const contentCreate: Access = ({ req }): AccessResult =>
  resolveRoleAccess({
    action: 'create',
    resource: 'content',
    user: getRoleUser(req.user),
  })

export const contentUpdate: Access = ({ req }): AccessResult =>
  resolveRoleAccess({
    action: 'update',
    resource: 'content',
    user: getRoleUser(req.user),
  })

export const contentDelete: Access = ({ req }): AccessResult =>
  resolveRoleAccess({
    action: 'delete',
    resource: 'content',
    user: getRoleUser(req.user),
  })
