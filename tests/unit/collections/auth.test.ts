import { describe, expect, it } from 'vitest'

import { admins, adminsOrSelf, authenticated, USER_ROLES } from '@/access/roles'
import { AuditLogs } from '@/collections/AuditLogs'
import { Users } from '@/collections/Users'

describe('authentication collections', () => {
  it('configures secure local authentication and role-based user management', () => {
    expect(Users.auth).toMatchObject({
      cookies: {
        sameSite: 'Lax',
      },
      lockTime: 10 * 60 * 1000,
      maxLoginAttempts: 5,
      tokenExpiration: 2 * 60 * 60,
      useSessions: true,
    })

    expect(Users.access).toEqual({
      admin: authenticated,
      create: admins,
      delete: admins,
      read: adminsOrSelf,
      update: adminsOrSelf,
    })

    expect(Users.fields).toContainEqual(
      expect.objectContaining({
        name: 'role',
        options: USER_ROLES,
        required: true,
        saveToJWT: true,
        type: 'select',
      }),
    )

    expect(Users.hooks?.beforeValidate).toHaveLength(1)
    expect(Users.hooks?.afterChange).toHaveLength(1)
    expect(Users.hooks?.afterDelete).toHaveLength(1)
    expect(Users.hooks?.afterLogin).toHaveLength(1)
  })

  it('makes audit records admin-readable and immutable through public APIs', () => {
    expect(AuditLogs.access).toEqual({
      admin: admins,
      create: expect.any(Function),
      delete: expect.any(Function),
      read: admins,
      update: expect.any(Function),
    })

    expect(AuditLogs.access?.create?.({} as never)).toBe(false)
    expect(AuditLogs.access?.update?.({} as never)).toBe(false)
    expect(AuditLogs.access?.delete?.({} as never)).toBe(false)
  })
})
