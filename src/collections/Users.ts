import { ValidationError, type CollectionBeforeValidateHook, type CollectionConfig } from 'payload'

import {
  admins,
  adminsOrSelf,
  authenticated,
  normalizePortalPermissions,
  USER_ROLES,
} from '../access/roles'
import {
  writeAuditLogAfterChange,
  writeAuditLogAfterDelete,
  writeLoginAuditLog,
} from '../hooks/writeAuditLog'

const enforceUserPolicy: CollectionBeforeValidateHook = async ({
  data,
  operation,
  originalDoc,
  req,
}) => {
  if (!data) {
    return data
  }

  if (typeof data.password === 'string' && data.password.length < 12) {
    throw new ValidationError({
      collection: 'users',
      errors: [
        {
          message: 'Password must be at least 12 characters',
          path: 'password',
        },
      ],
    })
  }

  if (operation === 'create' && !data.role) {
    if (!req.user) {
      const existingUsers = await req.payload.count({
        collection: 'users',
        overrideAccess: true,
        req,
      })

      data.role = existingUsers.totalDocs === 0 ? 'admin' : 'sales'
    } else {
      data.role = 'sales'
    }
  }

  const permissions =
    data.permissions ?? (operation === 'update' ? originalDoc?.permissions : undefined)
  const role = data.role ?? originalDoc?.role
  data.permissions = normalizePortalPermissions(permissions, role)

  return data
}

export const Users: CollectionConfig = {
  slug: 'users',
  access: {
    admin: authenticated,
    create: admins,
    delete: admins,
    read: adminsOrSelf,
    update: adminsOrSelf,
  },
  admin: {
    useAsTitle: 'username',
  },
  auth: {
    cookies: {
      sameSite: 'Lax',
      secure: process.env.NODE_ENV === 'production',
    },
    lockTime: 10 * 60 * 1000,
    maxLoginAttempts: 5,
    tokenExpiration: 2 * 60 * 60,
    useSessions: true,
    loginWithUsername: {
      allowEmailLogin: false,
      requireEmail: false,
      requireUsername: true,
    },
  },
  fields: [
    {
      name: 'role',
      type: 'select',
      access: {
        create: admins,
        update: admins,
      },
      options: [...USER_ROLES],
      required: true,
      saveToJWT: true,
    },
    {
      name: 'permissions',
      type: 'json',
      required: true,
    },
  ],
  hooks: {
    afterChange: [writeAuditLogAfterChange],
    afterDelete: [writeAuditLogAfterDelete],
    afterLogin: [writeLoginAuditLog],
    beforeValidate: [enforceUserPolicy],
  },
}
