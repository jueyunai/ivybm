import type { Access, AccessResult, FieldAccess } from 'payload'

import { accessFor, admins, authenticated, getRoleUser } from './roles'

export const leadsAdmin = authenticated
export const leadsCreate = accessFor('leads', 'create')
export const leadsRead = accessFor('leads', 'read')
export const leadsUpdate = accessFor('leads', 'update')
export const leadsDelete = accessFor('leads', 'delete')

export const leadSourcesAdmin = authenticated
export const leadSourcesCreate = admins
export const leadSourcesDelete = admins
export const leadSourcesRead: Access = ({ req }): AccessResult => Boolean(getRoleUser(req.user))
export const leadSourcesUpdate = admins

export const adminFieldAccess: FieldAccess = ({ req }): boolean =>
  getRoleUser(req.user)?.role === 'admin'

export const leadManagerFieldAccess: FieldAccess = ({ req }): boolean => {
  const role = getRoleUser(req.user)?.role
  return role === 'admin' || role === 'operator'
}
