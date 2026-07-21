import { describe, expect, it } from 'vitest'

import {
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
})
