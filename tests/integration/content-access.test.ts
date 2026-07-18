import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getPayload, type Payload } from 'payload'

import type { User } from '@/payload-types'
import config from '@/payload.config'

let payload: Payload
let admin: User
let operator: User
let sales: User

const createdDocuments: Array<{
  collection: 'pages' | 'product-categories'
  id: number | string
}> = []
const createdUserIDs: Array<number | string> = []

describe.sequential('CMS content access integration', () => {
  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL is required for content access integration tests')
    }

    payload = await getPayload({
      config,
      disableOnInit: true,
      key: 'content-access-integration-tests',
    })

    const suffix = randomUUID()
    admin = await payload.create({
      collection: 'users',
      context: { skipAudit: true },
      data: {
        email: `task5-admin-${suffix}@example.invalid`,
        password: 'task5-admin-integration-password',
        role: 'admin',
      },
      overrideAccess: true,
    })
    operator = await payload.create({
      collection: 'users',
      context: { skipAudit: true },
      data: {
        email: `task5-operator-${suffix}@example.invalid`,
        password: 'task5-operator-integration-password',
        role: 'operator',
      },
      overrideAccess: true,
    })
    sales = await payload.create({
      collection: 'users',
      context: { skipAudit: true },
      data: {
        email: `task5-sales-${suffix}@example.invalid`,
        password: 'task5-sales-integration-password',
        role: 'sales',
      },
      overrideAccess: true,
    })
    createdUserIDs.push(admin.id, operator.id, sales.id)
  })

  afterAll(async () => {
    if (!payload) return

    for (const document of [...createdDocuments].reverse()) {
      await payload
        .delete({
          collection: document.collection,
          context: { disableRevalidate: true },
          id: document.id,
          overrideAccess: true,
        })
        .catch(() => undefined)
    }

    if (createdUserIDs.length > 0) {
      await payload.delete({
        collection: 'audit-logs',
        overrideAccess: true,
        where: {
          actor: {
            in: createdUserIDs,
          },
        },
      })
      await payload.delete({
        collection: 'users',
        context: { skipAudit: true },
        overrideAccess: true,
        where: {
          id: {
            in: createdUserIDs,
          },
        },
      })
    }

    await payload.destroy()
  })

  it('never exposes drafts or internal notes through ordinary public access', async () => {
    const suffix = randomUUID()
    const draft = await payload.create({
      collection: 'pages',
      context: { disableRevalidate: true },
      data: {
        _status: 'draft',
        internalNotes: 'Confidential draft note',
        slug: `task5-draft-${suffix}`,
        title: 'Private Draft',
      },
      draft: true,
      overrideAccess: true,
    })
    const published = await payload.create({
      collection: 'pages',
      context: { disableRevalidate: true },
      data: {
        _status: 'published',
        internalNotes: 'Confidential published note',
        slug: `task5-published-${suffix}`,
        title: 'Public Page',
      },
      draft: false,
      overrideAccess: true,
    })
    createdDocuments.push(
      { collection: 'pages', id: draft.id },
      { collection: 'pages', id: published.id },
    )

    const result = await payload.find({
      collection: 'pages',
      draft: true,
      overrideAccess: false,
      where: {
        slug: {
          in: [draft.slug, published.slug],
        },
      },
    })

    expect(result.docs).toHaveLength(1)
    expect(result.docs[0].id).toBe(published.id)
    expect(result.docs[0]).not.toHaveProperty('internalNotes')
  })

  it('allows operators to manage content while sales users remain read-only', async () => {
    const category = await payload.create({
      collection: 'product-categories',
      context: { disableRevalidate: true },
      data: {
        slug: `task5-category-${randomUUID()}`,
        title: 'Operator Managed Category',
      },
      overrideAccess: false,
      user: operator,
    })
    createdDocuments.push({ collection: 'product-categories', id: category.id })

    const publicResult = await payload.findByID({
      collection: 'product-categories',
      id: category.id,
      overrideAccess: false,
      user: sales,
    })

    expect(publicResult.id).toBe(category.id)
    await expect(
      payload.delete({
        collection: 'product-categories',
        context: { disableRevalidate: true },
        id: category.id,
        overrideAccess: false,
        user: sales,
      }),
    ).rejects.toMatchObject({ status: 403 })
  })

  it('allows ordinary public reads of site settings', async () => {
    const settings = await payload.findGlobal({
      overrideAccess: false,
      slug: 'site-settings',
    })

    expect(settings).toBeDefined()
    expect(settings.navigation).toBeInstanceOf(Array)
  })
})
