import { describe, expect, it } from 'vitest'

import {
  hasPortalPermission,
  normalizePortalPermissions,
  PERMISSION_MODULE_IDS,
  PORTAL_PERMISSION_PRESETS,
  resolveRoleAccess,
  type AccessAction,
  type AccessResource,
  type RoleUser,
} from '@/access/roles'

const admin: RoleUser = { id: 1, role: 'admin' }
const operator: RoleUser = { id: 2, role: 'operator' }
const sales: RoleUser = { id: 3, role: 'sales' }

const expectAllowed = (user: RoleUser, resource: AccessResource, actions: AccessAction[]): void => {
  for (const action of actions) {
    expect(resolveRoleAccess({ action, resource, user })).toBe(true)
  }
}

const expectDenied = (
  user: RoleUser | null,
  resource: AccessResource,
  actions: AccessAction[],
): void => {
  for (const action of actions) {
    expect(resolveRoleAccess({ action, resource, user })).toBe(false)
  }
}

describe('role access matrix', () => {
  const allActions: AccessAction[] = ['create', 'read', 'update', 'delete']

  it('denies unauthenticated access to every protected resource', () => {
    const resources: AccessResource[] = [
      'users',
      'content',
      'knowledge',
      'platformAccounts',
      'conversations',
      'leads',
    ]

    for (const resource of resources) {
      expectDenied(null, resource, allActions)
    }
  })

  it('allows administrators to manage every resource', () => {
    const resources: AccessResource[] = [
      'users',
      'content',
      'knowledge',
      'platformAccounts',
      'conversations',
      'leads',
    ]

    for (const resource of resources) {
      expectAllowed(admin, resource, allActions)
    }
  })

  it('allows operators to manage content and knowledge and work active conversations and leads', () => {
    expectAllowed(operator, 'content', allActions)
    expectAllowed(operator, 'knowledge', allActions)
    expectAllowed(operator, 'conversations', ['read', 'update'])
    expectAllowed(operator, 'leads', ['read', 'update'])

    expectDenied(operator, 'users', allActions)
    expectDenied(operator, 'platformAccounts', allActions)
    expectDenied(operator, 'conversations', ['create', 'delete'])
    expectDenied(operator, 'leads', ['create', 'delete'])
  })

  it('scopes sales access to assigned conversations and leads', () => {
    const assignedToSelf = {
      assignedTo: {
        equals: sales.id,
      },
    }

    expect(resolveRoleAccess({ action: 'read', resource: 'conversations', user: sales })).toEqual(
      assignedToSelf,
    )
    expect(resolveRoleAccess({ action: 'update', resource: 'conversations', user: sales })).toEqual(
      assignedToSelf,
    )
    expect(resolveRoleAccess({ action: 'read', resource: 'leads', user: sales })).toEqual(
      assignedToSelf,
    )
    expect(resolveRoleAccess({ action: 'update', resource: 'leads', user: sales })).toEqual(
      assignedToSelf,
    )

    expectDenied(sales, 'users', allActions)
    expectDenied(sales, 'content', allActions)
    expectDenied(sales, 'knowledge', allActions)
    expectDenied(sales, 'platformAccounts', allActions)
    expectDenied(sales, 'conversations', ['create', 'delete'])
    expectDenied(sales, 'leads', ['create', 'delete'])
  })

  it('uses role presets with edit implying view for every module', () => {
    const expectedPresets = {
      admin: Object.fromEntries(
        PERMISSION_MODULE_IDS.map((moduleId) => [moduleId, { edit: true, view: true }]),
      ),
      operator: Object.fromEntries(
        PERMISSION_MODULE_IDS.map((moduleId) => [
          moduleId,
          {
            edit: [
              'conversations',
              'leads',
              'content',
              'media',
              'contentStudio',
              'knowledge',
              'settings',
            ].includes(moduleId),
            view: true,
          },
        ]),
      ),
      sales: Object.fromEntries(
        PERMISSION_MODULE_IDS.map((moduleId) => [
          moduleId,
          {
            edit: ['conversations', 'leads', 'settings'].includes(moduleId),
            view: ['conversations', 'leads', 'settings'].includes(moduleId),
          },
        ]),
      ),
    }

    expect(PORTAL_PERMISSION_PRESETS.admin).toEqual(expectedPresets.admin)
    expect(PORTAL_PERMISSION_PRESETS.operator).toEqual(expectedPresets.operator)
    expect(PORTAL_PERMISSION_PRESETS.sales).toEqual(expectedPresets.sales)
  })

  it('normalizes granular permissions and rejects edit without view', () => {
    expect(
      normalizePortalPermissions(
        {
          conversations: { edit: true, view: true },
          leads: { edit: true, view: false },
          content: 'not-a-module-permission',
        },
        'sales',
      ),
    ).toEqual({
      conversations: { edit: true, view: true },
      content: { edit: false, view: false },
      contentStudio: { edit: false, view: false },
      knowledge: { edit: false, view: false },
      leads: { edit: false, view: false },
      media: { edit: false, view: false },
      operations: { edit: false, view: false },
      platforms: { edit: false, view: false },
      settings: { edit: true, view: true },
    })

    expect(normalizePortalPermissions(undefined, 'operator').conversations).toEqual({
      edit: true,
      view: true,
    })
  })

  it('checks portal permissions from a stored role user', () => {
    const user: RoleUser = {
      id: 4,
      role: 'sales',
      permissions: {
        conversations: { edit: false, view: true },
        leads: { edit: true, view: true },
      },
    }

    expect(hasPortalPermission(user, 'conversations', 'view')).toBe(true)
    expect(hasPortalPermission(user, 'conversations', 'edit')).toBe(false)
    expect(hasPortalPermission(user, 'leads', 'edit')).toBe(true)
    expect(hasPortalPermission(user, 'media', 'view')).toBe(false)
    expect(hasPortalPermission(null, 'leads', 'view')).toBe(false)
  })
})
