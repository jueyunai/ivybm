import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createLocalReq, getPayload, type Payload } from 'payload'

import {
  getContentSummary,
  loadWebsiteContentPageData,
} from '@/admin-portal/modules/website-content/getContentSummary'
import type { User } from '@/payload-types'
import config from '@/payload.config'

let payload: Payload
let admin: User
let operator: User
let sales: User
const createdPageIDs: Array<number | string> = []
const createdUserIDs: Array<number | string> = []
let queryToken = ''

const requestFor = (user: User) => createLocalReq({ user }, payload)

describe.sequential('Portal website content access', () => {
  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL is required for Portal content integration tests')
    }

    payload = await getPayload({
      config,
      disableOnInit: true,
      key: 'admin-portal-content-access-integration-tests',
    })

    const suffix = randomUUID()
    queryToken = `P06-${suffix}`
    for (const role of ['admin', 'operator', 'sales'] as const) {
      const user = await payload.create({
        collection: 'users',
        context: { skipAudit: true },
        data: {
          email: `portal-content-${role}-${suffix}@example.invalid`,
          password: 'portal-content-integration-password',
          role,
        },
        overrideAccess: true,
      })
      createdUserIDs.push(user.id)
      if (role === 'admin') admin = user
      if (role === 'operator') operator = user
      if (role === 'sales') sales = user
    }

    const published = await payload.create({
      collection: 'pages',
      context: { disableRevalidate: true },
      data: {
        _status: 'published',
        seo: { description: 'Published SEO description', title: 'Published SEO title' },
        slug: `portal-p06-published-${suffix}`,
        title: `${queryToken} Published`,
      },
      draft: false,
      fallbackLocale: false,
      locale: 'en',
      overrideAccess: true,
    })
    createdPageIDs.push(published.id)
    await payload.update({
      collection: 'pages',
      context: { disableRevalidate: true },
      data: {
        seo: { description: 'وصف تحسين البحث', title: 'عنوان تحسين البحث' },
        title: 'صفحة منشورة',
      },
      fallbackLocale: false,
      id: published.id,
      locale: 'ar',
      overrideAccess: true,
    })

    const draft = await payload.create({
      collection: 'pages',
      context: { disableRevalidate: true },
      data: {
        _status: 'draft',
        slug: `portal-p06-draft-${suffix}`,
        title: `${queryToken} Draft`,
      },
      draft: true,
      fallbackLocale: false,
      locale: 'en',
      overrideAccess: true,
    })
    createdPageIDs.push(draft.id)
  })

  afterAll(async () => {
    if (!payload) return

    if (createdPageIDs.length > 0) {
      await payload.delete({
        collection: 'pages',
        context: { disableRevalidate: true },
        overrideAccess: true,
        where: { id: { in: createdPageIDs } },
      })
    }
    if (createdUserIDs.length > 0) {
      await payload.delete({
        collection: 'audit-logs',
        overrideAccess: true,
        where: { actor: { in: createdUserIDs } },
      })
      await payload.delete({
        collection: 'users',
        context: { skipAudit: true },
        overrideAccess: true,
        where: { id: { in: createdUserIDs } },
      })
    }
    await payload.destroy()
  })

  it('lets administrators and operators read draft and published metadata safely', async () => {
    for (const user of [admin, operator]) {
      const summary = await getContentSummary({
        payload,
        query: { page: 1, q: queryToken, status: 'all', type: 'pages' },
        req: await requestFor(user),
      })

      expect(summary.items).toHaveLength(2)
      expect(summary.items.map((item) => item.status).sort()).toEqual(['draft', 'published'])
      expect(summary.items.find((item) => item.status === 'published')?.localeCompleteness).toEqual(
        {
          ar: 100,
          en: 100,
        },
      )
      expect(JSON.stringify(summary)).not.toMatch(/body|internalNotes|keywords|\/admin/i)
    }
  })

  it('returns a forbidden page result for sales without exposing CMS content', async () => {
    const result = await loadWebsiteContentPageData({
      env: {
        ADMIN_PORTAL_ENABLED: 'true',
        ADMIN_PORTAL_WEBSITE_CONTENT_ENABLED: 'true',
      },
      payload,
      query: { page: 1, q: queryToken, status: 'all', type: 'pages' },
      req: await requestFor(sales),
      role: 'sales',
    })

    expect(result).toEqual({ state: 'forbidden', summary: null })
  })
})
