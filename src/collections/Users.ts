import { ValidationError, type CollectionBeforeValidateHook, type CollectionConfig } from 'payload'

import { admins, adminsOrSelf, authenticated, USER_ROLES } from '../access/roles'
import {
  writeAuditLogAfterChange,
  writeAuditLogAfterDelete,
  writeLoginAuditLog,
} from '../hooks/writeAuditLog'

const enforceUserPolicy: CollectionBeforeValidateHook = async ({ data, operation, req }) => {
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
    useAsTitle: 'email',
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
  },
  fields: [
    {
      name: 'email',
      type: 'email',
      validate: (value: unknown) => {
        if (!value || typeof value !== 'string') return '请输入有效的账号'
        const trimmed = value.trim()
        if (trimmed.length < 2 || trimmed.length > 320 || /\s/.test(trimmed)) {
          return '账号需为 2 至 320 个字符且不包含空格'
        }
        return true
      },
    },
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
      access: {
        create: admins,
        update: admins,
      },
    },
  ],
  hooks: {
    afterChange: [writeAuditLogAfterChange],
    afterDelete: [writeAuditLogAfterDelete],
    afterLogin: [writeLoginAuditLog],
    beforeValidate: [enforceUserPolicy],
  },
}
