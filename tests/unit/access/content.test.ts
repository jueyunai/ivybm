import { describe, expect, it } from 'vitest'

import {
  activeDownloadsRead,
  contentAdmin,
  contentCreate,
  contentDelete,
  contentUpdate,
  publicRead,
  publicMediaRead,
  publishedContentRead,
} from '@/access/content'
import type { RoleUser } from '@/access/roles'

const admin: RoleUser = { id: 1, role: 'admin' }
const operator: RoleUser = { id: 2, role: 'operator' }
const sales: RoleUser = { id: 3, role: 'sales' }

const callAccess = async (access: typeof publishedContentRead, user: RoleUser | null) =>
  access({ req: { user } } as never)

describe('CMS content access', () => {
  it('shows every draft state only to administrators and operators', async () => {
    await expect(callAccess(publishedContentRead, admin)).resolves.toBe(true)
    await expect(callAccess(publishedContentRead, operator)).resolves.toBe(true)
  })

  it('limits anonymous and sales reads to published documents', async () => {
    const publishedOnly = { _status: { equals: 'published' } }

    await expect(callAccess(publishedContentRead, null)).resolves.toEqual(publishedOnly)
    await expect(callAccess(publishedContentRead, sales)).resolves.toEqual(publishedOnly)
  })

  it('limits public download reads to active records', async () => {
    const activeOnly = { isActive: { equals: true } }

    await expect(callAccess(activeDownloadsRead, null)).resolves.toEqual(activeOnly)
    await expect(callAccess(activeDownloadsRead, sales)).resolves.toEqual(activeOnly)
    await expect(callAccess(activeDownloadsRead, operator)).resolves.toBe(true)
  })

  it('keeps public collections and settings readable for every visitor', async () => {
    await expect(callAccess(publicRead, null)).resolves.toBe(true)
    await expect(callAccess(publicRead, sales)).resolves.toBe(true)
  })

  it('limits ordinary media reads to explicitly public assets', async () => {
    const publicOnly = { isPublic: { equals: true } }

    await expect(callAccess(publicMediaRead, null)).resolves.toEqual(publicOnly)
    await expect(callAccess(publicMediaRead, sales)).resolves.toEqual(publicOnly)
    await expect(callAccess(publicMediaRead, operator)).resolves.toBe(true)
  })

  it('allows only administrators and operators to mutate content', async () => {
    for (const access of [contentCreate, contentUpdate, contentDelete]) {
      await expect(callAccess(access, admin)).resolves.toBe(true)
      await expect(callAccess(access, operator)).resolves.toBe(true)
      await expect(callAccess(access, sales)).resolves.toBe(false)
      await expect(callAccess(access, null)).resolves.toBe(false)
    }
  })

  it('shows CMS admin navigation only to content managers', () => {
    expect(contentAdmin({ req: { user: admin } } as never)).toBe(true)
    expect(contentAdmin({ req: { user: operator } } as never)).toBe(true)
    expect(contentAdmin({ req: { user: sales } } as never)).toBe(false)
    expect(contentAdmin({ req: { user: { id: 4, role: 'viewer' } } } as never)).toBe(false)
  })
})
