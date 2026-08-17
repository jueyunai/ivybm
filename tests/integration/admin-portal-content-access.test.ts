import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createLocalReq, getPayload, type Payload, type PayloadRequest } from 'payload'

import { executePortalRouteCommand } from '@/admin-portal/core/commands/portalCommandReceipts'
import {
  getContentSummary,
  loadWebsiteContentPageData,
  type ContentTypeId,
} from '@/admin-portal/modules/website-content/getContentSummary'
import {
  createPortalContent,
  deletePortalContent,
  getPortalContentEditor,
  type ContentCommandResult,
  updatePortalContent,
} from '@/admin-portal/modules/website-content/contentCommands'
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
        collection: 'portal-command-receipts',
        overrideAccess: true,
        where: { actor: { in: createdUserIDs } },
      })
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
          ar: 50,
          en: 50,
        },
      )
      expect(summary.items.find((item) => item.status === 'published')?.localeMissing).toEqual({
        ar: ['summary', 'body', 'heroImage'],
        en: ['summary', 'body', 'heroImage'],
      })
      const publishedItem = summary.items.find((item) => item.status === 'published')
      expect(publishedItem?.previewHrefs).toEqual({
        ar: `/ar/${publishedItem?.slug}`,
        en: `/en/${publishedItem?.slug}`,
      })
      expect(JSON.stringify(summary)).not.toMatch(
        /"(body|content|description|internalNotes|keywords)"\s*:|\/admin/i,
      )
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

  it('persists localized create, publish, edit, audit, and delete through Portal commands', async () => {
    const media = await payload.find({
      collection: 'media',
      limit: 1,
      overrideAccess: true,
      pagination: false,
      where: { mimeType: { contains: 'image/' } },
    })
    expect(media.docs[0]).toBeTruthy()
    const heroImageId = media.docs[0].id
    const slug = `portal-command-${randomUUID()}`
    const operatorReq = await requestFor(operator)

    const directSlug = `portal-command-direct-${randomUUID()}`
    const directPublished = await createPortalContent({
      input: {
        action: 'publish',
        bodyText: 'Direct English body',
        heroImageId,
        locale: 'en',
        seoDescription: 'Direct English search description',
        seoTitle: 'Direct English search title',
        slug: directSlug,
        summary: 'Direct English summary',
        title: 'Direct Portal command page',
      },
      payload,
      req: operatorReq,
      type: 'pages',
    })
    createdPageIDs.push(directPublished.id)
    await expect(
      getPortalContentEditor({
        id: directPublished.id,
        locale: 'ar',
        payload,
        req: operatorReq,
        type: 'pages',
      }),
    ).resolves.toMatchObject({
      data: {
        bodyText: '',
        seoDescription: '',
        seoTitle: '',
        slug: directSlug,
        summary: '',
        title: '',
      },
    })

    const created = await createPortalContent({
      input: {
        action: 'save-draft',
        bodyText: 'English body',
        heroImageId,
        locale: 'en',
        seoDescription: 'English search description',
        seoTitle: 'English search title',
        slug,
        summary: 'English summary',
        title: 'Portal command page',
      },
      payload,
      req: operatorReq,
      type: 'pages',
    })
    createdPageIDs.push(created.id)
    expect(created.status).toBe('draft')

    const published = await updatePortalContent({
      id: created.id,
      input: {
        action: 'publish',
        bodyText: 'English body',
        heroImageId,
        locale: 'en',
        seoDescription: 'English search description',
        seoTitle: 'English search title',
        slug,
        summary: 'English summary',
        title: 'Portal command page',
        updatedAt: created.updatedAt,
      },
      payload,
      req: operatorReq,
      type: 'pages',
    })
    expect(published.status).toBe('published')

    const missingArabic = await getPortalContentEditor({
      id: created.id,
      locale: 'ar',
      payload,
      req: operatorReq,
      type: 'pages',
    })
    expect(missingArabic.data).toMatchObject({
      bodyText: '',
      seoDescription: '',
      seoTitle: '',
      slug,
      summary: '',
      title: '',
    })

    const localized = await updatePortalContent({
      id: created.id,
      input: {
        action: 'publish',
        bodyText: 'النص العربي',
        heroImageId,
        locale: 'ar',
        seoDescription: 'وصف البحث',
        seoTitle: 'عنوان البحث',
        slug,
        summary: 'الملخص العربي',
        title: 'صفحة أوامر البوابة',
        updatedAt: published.updatedAt,
      },
      payload,
      req: operatorReq,
      type: 'pages',
    })
    const arabic = await getPortalContentEditor({
      id: created.id,
      locale: 'ar',
      payload,
      req: operatorReq,
      type: 'pages',
    })
    expect(arabic.data).toMatchObject({
      bodyText: 'النص العربي',
      slug,
      summary: 'الملخص العربي',
      title: 'صفحة أوامر البوابة',
    })
    expect(localized.status).toBe('published')

    const audit = await payload.find({
      collection: 'audit-logs',
      overrideAccess: true,
      pagination: false,
      where: {
        and: [
          { actor: { equals: operator.id } },
          { documentId: { equals: String(created.id) } },
          { resource: { equals: 'pages' } },
        ],
      },
    })
    expect(audit.docs.map((entry) => entry.action)).toEqual(
      expect.arrayContaining(['create', 'update']),
    )

    await expect(
      createPortalContent({
        input: { action: 'save-draft', locale: 'en', slug: `${slug}-sales`, title: 'Denied' },
        payload,
        req: await requestFor(sales),
        type: 'pages',
      }),
    ).rejects.toBeTruthy()

    await expect(
      deletePortalContent({
        id: created.id,
        locale: 'ar',
        payload,
        req: operatorReq,
        type: 'pages',
        updatedAt: localized.updatedAt,
      }),
    ).resolves.toMatchObject({ id: created.id })
    createdPageIDs.splice(createdPageIDs.indexOf(created.id), 1)
  })

  it('keeps an untranslated Arabic product empty after direct publication', async () => {
    const assets = await payload.find({
      collection: 'media',
      limit: 20,
      overrideAccess: true,
      pagination: false,
    })
    const image = assets.docs.find((asset) => asset.mimeType?.startsWith('image/'))
    expect(image).toBeTruthy()

    const operatorReq = await requestFor(operator)
    const suffix = randomUUID()
    let categoryID: number | string | null = null
    let productID: number | string | null = null

    const executeCreate = <T>(
      scope: string,
      operation: (transactionReq: PayloadRequest) => Promise<T>,
    ) =>
      executePortalRouteCommand({
        fingerprintInput: { scope },
        operation,
        payload,
        req: operatorReq,
        request: new Request('http://localhost/api/portal/content', {
          headers: { 'Idempotency-Key': `portal-content-test:${randomUUID()}` },
        }),
        scope,
      })

    try {
      const category = await executeCreate(
        'portal.website-content:product-categories:create',
        (transactionReq) =>
          createPortalContent({
            input: {
              action: 'save',
              locale: 'en',
              slug: `portal-direct-product-category-${suffix}`,
              title: 'Direct product category',
            },
            payload,
            req: transactionReq,
            type: 'product-categories',
          }),
      )
      categoryID = category.id

      const product = await executeCreate(
        'portal.website-content:products:create',
        (transactionReq) =>
          createPortalContent({
            input: {
              action: 'publish',
              bodyText: 'Direct English product body',
              categoryId: category.id,
              coverImageId: image!.id,
              locale: 'en',
              seoDescription: 'Direct English product search description',
              seoTitle: 'Direct English product search title',
              shortDescription: 'Direct English product summary',
              slug: `portal-direct-product-${suffix}`,
              title: 'Direct Portal product',
            },
            payload,
            req: transactionReq,
            type: 'products',
          }),
      )
      productID = product.id

      await expect(
        getPortalContentEditor({
          id: product.id,
          locale: 'ar',
          payload,
          req: operatorReq,
          type: 'products',
        }),
      ).resolves.toMatchObject({
        data: {
          bodyText: '',
          categoryId: category.id,
          coverImageId: image!.id,
          seoDescription: '',
          seoTitle: '',
          shortDescription: '',
          slug: `portal-direct-product-${suffix}`,
          title: '',
        },
        locale: 'ar',
        status: 'published',
      })
    } finally {
      if (productID !== null) {
        await payload.delete({ collection: 'products', id: productID, overrideAccess: true })
      }
      if (categoryID !== null) {
        await payload.delete({
          collection: 'product-categories',
          id: categoryID,
          overrideAccess: true,
        })
      }
    }
  })

  it('persists bilingual create, update, state, and delete flows for all six content types', async () => {
    const assets = await payload.find({
      collection: 'media',
      limit: 20,
      overrideAccess: true,
      pagination: false,
    })
    const image = assets.docs.find((asset) => asset.mimeType?.startsWith('image/'))
    const file = assets.docs.find((asset) => asset.mimeType === 'application/pdf') ?? assets.docs[0]
    expect(image).toBeTruthy()
    expect(file).toBeTruthy()

    const imageID = image!.id
    const fileID = file!.id
    const suffix = randomUUID()
    const operatorReq = await requestFor(operator)
    const records = new Map<ContentTypeId, ContentCommandResult>()
    const collections: Record<
      ContentTypeId,
      'downloads' | 'pages' | 'posts' | 'product-categories' | 'products' | 'projects'
    > = {
      downloads: 'downloads',
      pages: 'pages',
      posts: 'posts',
      'product-categories': 'product-categories',
      products: 'products',
      projects: 'projects',
    }

    const common = (type: ContentTypeId, locale: 'ar' | 'en') => ({
      locale,
      seoDescription: locale === 'ar' ? `وصف ${type}` : `${type} SEO description`,
      seoTitle: locale === 'ar' ? `عنوان ${type}` : `${type} SEO title`,
      slug: `portal-matrix-${type}-${suffix}`,
      title: locale === 'ar' ? `عنوان ${type}` : `Portal matrix ${type}`,
    })
    const inputFor = (
      type: ContentTypeId,
      locale: 'ar' | 'en',
      categoryID?: number | string,
    ): Record<string, unknown> => {
      const base = common(type, locale)
      const body = locale === 'ar' ? `محتوى ${type}` : `${type} body content`
      switch (type) {
        case 'pages':
          return {
            ...base,
            action: 'save-draft',
            bodyText: body,
            heroImageId: imageID,
            summary: body,
          }
        case 'product-categories':
          return { ...base, action: 'save', description: body, sortOrder: 10 }
        case 'products':
          return {
            ...base,
            action: 'save-draft',
            bodyText: body,
            categoryId: categoryID,
            coverImageId: imageID,
            galleryIds: [imageID],
            shortDescription: body,
            specifications: [{ label: locale === 'ar' ? 'السماكة' : 'Thickness', value: '3 mm' }],
          }
        case 'projects':
          return {
            ...base,
            action: 'save-draft',
            application: body,
            bodyText: body,
            coverImageId: imageID,
            galleryIds: [imageID],
            location: locale === 'ar' ? 'دبي' : 'Dubai',
            summary: body,
          }
        case 'posts':
          return {
            ...base,
            action: 'save-draft',
            bodyText: body,
            category: 'industry',
            excerpt: body,
            featuredImageId: imageID,
          }
        case 'downloads':
          return {
            ...base,
            action: 'save',
            coverImageId: imageID,
            description: body,
            downloadType: 'catalog',
            fileId: fileID,
            isActive: true,
          }
      }
    }

    const updateRecord = (type: ContentTypeId, result: ContentCommandResult) => {
      records.set(type, result)
      return result
    }

    try {
      const category = updateRecord(
        'product-categories',
        await createPortalContent({
          input: inputFor('product-categories', 'en'),
          payload,
          req: operatorReq,
          type: 'product-categories',
        }),
      )

      for (const type of ['pages', 'products', 'projects', 'posts', 'downloads'] as const) {
        updateRecord(
          type,
          await createPortalContent({
            input: inputFor(type, 'en', category.id),
            payload,
            req: operatorReq,
            type,
          }),
        )
      }

      for (const type of [
        'product-categories',
        'pages',
        'products',
        'projects',
        'posts',
        'downloads',
      ] as const) {
        const current = records.get(type)!
        const localized = updateRecord(
          type,
          await updatePortalContent({
            id: current.id,
            input: {
              ...inputFor(type, 'ar', category.id),
              updatedAt: current.updatedAt,
            },
            payload,
            req: operatorReq,
            type,
          }),
        )
        const editor = await getPortalContentEditor({
          id: localized.id,
          locale: 'ar',
          payload,
          req: operatorReq,
          type,
        })
        expect(editor.data.title).toBe(`عنوان ${type}`)
      }

      for (const type of ['pages', 'products', 'projects', 'posts'] as const) {
        const current = records.get(type)!
        const published = updateRecord(
          type,
          await updatePortalContent({
            id: current.id,
            input: {
              ...inputFor(type, 'en', category.id),
              action: 'publish',
              updatedAt: current.updatedAt,
            },
            payload,
            req: operatorReq,
            type,
          }),
        )
        expect(published.status).toBe('published')
      }

      const project = records.get('projects')!
      const beforeUnpublish = await getContentSummary({
        payload,
        query: { page: 1, q: '', status: 'all', type: 'projects' },
        req: operatorReq,
      })
      if (!beforeUnpublish.statusBreakdown || !('draft' in beforeUnpublish.statusBreakdown)) {
        throw new Error('Expected versioned project status breakdown')
      }
      const publicBeforeUnpublish = await payload.find({
        collection: 'projects',
        draft: false,
        fallbackLocale: false,
        limit: 1,
        locale: 'en',
        overrideAccess: false,
        where: { slug: { equals: project.slug } },
      })
      expect(publicBeforeUnpublish.docs).toHaveLength(1)

      const unpublished = updateRecord(
        'projects',
        await updatePortalContent({
          id: project.id,
          input: {
            ...inputFor('projects', 'en', category.id),
            action: 'unpublish',
            updatedAt: project.updatedAt,
          },
          payload,
          req: operatorReq,
          type: 'projects',
        }),
      )
      expect(unpublished.status).toBe('unpublished')

      const rootDocument = await payload.findByID({
        collection: 'projects',
        draft: false,
        id: project.id,
        overrideAccess: true,
      })
      expect(rootDocument._status).toBe('draft')
      const publicAfterUnpublish = await payload.find({
        collection: 'projects',
        draft: false,
        fallbackLocale: false,
        limit: 1,
        locale: 'en',
        overrideAccess: false,
        where: { slug: { equals: project.slug } },
      })
      expect(publicAfterUnpublish.docs).toHaveLength(0)

      const afterUnpublish = await getContentSummary({
        payload,
        query: { page: 1, q: '', status: 'all', type: 'projects' },
        req: operatorReq,
      })
      if (!afterUnpublish.statusBreakdown || !('draft' in afterUnpublish.statusBreakdown)) {
        throw new Error('Expected versioned project status breakdown after unpublish')
      }
      expect(afterUnpublish.statusBreakdown).toEqual({
        draft: beforeUnpublish.statusBreakdown.draft,
        published: beforeUnpublish.statusBreakdown.published - 1,
        unpublished: beforeUnpublish.statusBreakdown.unpublished + 1,
      })

      const download = records.get('downloads')!
      const deactivated = updateRecord(
        'downloads',
        await updatePortalContent({
          id: download.id,
          input: {
            ...inputFor('downloads', 'en', category.id),
            action: 'deactivate',
            updatedAt: download.updatedAt,
          },
          payload,
          req: operatorReq,
          type: 'downloads',
        }),
      )
      expect(deactivated.status).toBe('inactive')
      expect(records.get('product-categories')?.status).toBe('always-visible')

      for (const type of [
        'products',
        'product-categories',
        'pages',
        'projects',
        'posts',
        'downloads',
      ] as const) {
        const record = records.get(type)!
        const deleted = await deletePortalContent({
          id: record.id,
          locale: 'en',
          payload,
          req: operatorReq,
          type,
          updatedAt: record.updatedAt,
        })
        expect(deleted.id).toBe(record.id)
        records.delete(type)
      }
    } finally {
      for (const type of [
        'products',
        'product-categories',
        'pages',
        'projects',
        'posts',
        'downloads',
      ] as const) {
        const record = records.get(type)
        if (!record) continue
        try {
          await deletePortalContent({
            id: record.id,
            locale: 'en',
            payload,
            req: operatorReq,
            type,
            updatedAt: record.updatedAt,
          })
        } catch {
          await payload.delete({
            collection: collections[type],
            id: record.id,
            overrideAccess: true,
          })
        }
      }
    }
  })
})
