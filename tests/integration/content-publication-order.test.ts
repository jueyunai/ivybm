import { randomUUID } from 'node:crypto'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createLocalReq, getPayload, type Payload } from 'payload'
import type { PostgresAdapter } from '@payloadcms/db-postgres'
import { PORTAL_PERMISSION_PRESETS } from '@/access/roles'

import {
  buildPlainRichText,
  createPortalContent,
} from '@/admin-portal/modules/website-content/contentCommands'
import { getContentSummary } from '@/admin-portal/modules/website-content/getContentSummary'
import { getPosts, getProducts, getProjects } from '@/lib/website-data'
import config from '@/payload.config'
import type { User } from '@/payload-types'

type ContentType = 'products' | 'projects' | 'posts' | 'knowledge'
type Collection = 'products' | 'projects' | 'posts'
const context = { disableRevalidate: true, skipAudit: true }
const token = randomUUID().slice(0, 8)
const documents: Array<{ collection: Collection; id: number }> = []
let payload: Payload
let admin: User
let categoryId: number
let mediaId: number

const createContent = async (type: ContentType, slug: string, publishedAt?: string) => {
  const collection = type === 'knowledge' ? 'posts' : type
  const data = {
    _status: publishedAt ? 'published' : 'draft',
    title: slug,
    slug,
    publishedAt,
    ...(type === 'products'
      ? {
          category: categoryId,
          coverImage: mediaId,
          shortDescription: 'Engineering product',
          description: buildPlainRichText('Product details.', 'en'),
        }
      : type === 'projects'
        ? {
            coverImage: mediaId,
            summary: 'Project summary',
            description: buildPlainRichText('Project details.', 'en'),
          }
        : {
            category: type === 'knowledge' ? 'technical-guide' : 'industry',
            contentType: type === 'knowledge' ? 'knowledge' : 'news',
            excerpt: 'Article summary',
            content: buildPlainRichText('Article details.', 'en'),
          }),
  }
  const document = await payload.create({
    collection,
    context: { ...context, importPublicationDate: Boolean(publishedAt) },
    data: data as never,
    draft: !publishedAt,
    locale: 'en',
    overrideAccess: true,
  })
  documents.push({ collection, id: document.id })
  return document
}

const publicContent = (type: ContentType, locale: 'en' | 'ar') =>
  type === 'products'
    ? getProducts(locale)
    : type === 'projects'
      ? getProjects(locale)
      : getPosts(locale, { contentType: type === 'knowledge' ? 'knowledge' : 'news' })

describe.sequential('content publication lifecycle and ordering', () => {
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL ?? '')
    if (
      !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
      !url.pathname.endsWith('_test')
    ) {
      throw new Error('A local isolated _test database is required')
    }
    payload = await getPayload({ config, disableOnInit: true })
    admin = await payload.create({
      collection: 'users',
      context,
      data: {
        username: `publication-${token}`,
        password: 'Local-publication-fixture-123!',
        permissions: PORTAL_PERMISSION_PRESETS.admin,
        role: 'admin',
      },
      overrideAccess: true,
    })
    const category = await payload.create({
      collection: 'product-categories',
      context,
      data: { title: 'Publication fixture category', slug: `publication-${token}` },
      overrideAccess: true,
    })
    categoryId = category.id
    const image = await sharp({
      create: { background: '#777777', channels: 3, height: 80, width: 80 },
    })
      .png()
      .toBuffer()
    const media = await payload.create({
      collection: 'media',
      context,
      data: {
        alt: 'Publication ordering test image',
        isPublic: true,
        source: 'IVYBM generated integration test fixture',
      },
      file: {
        data: image,
        mimetype: 'image/png',
        name: `publication-${token}.png`,
        size: image.length,
      },
      overrideAccess: true,
    })
    mediaId = media.id
  })

  afterAll(async () => {
    if (!payload) return
    try {
      for (const document of [...documents].reverse()) {
        await payload.delete({ ...document, context, overrideAccess: true })
      }
      if (mediaId)
        await payload.delete({ collection: 'media', id: mediaId, context, overrideAccess: true })
      if (categoryId)
        await payload.delete({
          collection: 'product-categories',
          id: categoryId,
          context,
          overrideAccess: true,
        })
      if (admin) {
        const database = payload.db as unknown as PostgresAdapter
        await database.pool.query('DELETE FROM audit_logs WHERE actor_id=$1', [admin.id])
        await payload.delete({ collection: 'users', id: admin.id, context, overrideAccess: true })
      }
    } finally {
      await payload.destroy()
    }
  })

  it.each(['products', 'projects', 'posts', 'knowledge'] as const)(
    'preserves the first date through the full %s lifecycle',
    async (type) => {
      const collection: Collection = type === 'knowledge' ? 'posts' : type
      const draft = await createContent(type, `lifecycle-${type}-${token}`)
      expect(draft.publishedAt).toBeNull()
      const started = Date.now()
      const published = await payload.update({
        collection,
        id: draft.id,
        context,
        data: { _status: 'published' },
        draft: false,
        overrideAccess: true,
      })
      const firstDate = published.publishedAt!
      expect(Date.parse(firstDate)).toBeGreaterThanOrEqual(started)
      expect(Date.parse(firstDate)).toBeLessThanOrEqual(Date.now())

      const edited = await payload.update({
        collection,
        id: draft.id,
        context,
        data: { seo: { title: 'Updated SEO' }, publishedAt: '2099-01-01T00:00:00.000Z' },
        draft: false,
        overrideAccess: true,
      })
      expect(edited.createdAt).toBe(draft.createdAt)
      expect(edited.publishedAt).toBe(firstDate)
      const translated = await payload.update({
        collection,
        id: draft.id,
        context,
        data: { title: 'محتوى الاختبار', publishedAt: null },
        draft: false,
        locale: 'ar',
        overrideAccess: true,
      })
      expect(translated.publishedAt).toBe(firstDate)
      const unpublished = await payload.update({
        collection,
        id: draft.id,
        context,
        data: { _status: 'draft' },
        draft: false,
        overrideAccess: true,
      })
      expect(unpublished.publishedAt).toBe(firstDate)
      const hidden = await payload.find({
        collection,
        draft: false,
        overrideAccess: false,
        where: { id: { equals: draft.id } },
      })
      expect(hidden.docs).toEqual([])
      const republished = await payload.update({
        collection,
        id: draft.id,
        context,
        data: { _status: 'published' },
        draft: false,
        overrideAccess: true,
      })
      expect(republished.publishedAt).toBe(firstDate)
      expect(republished.createdAt).toBe(draft.createdAt)
      expect(Date.parse(republished.updatedAt)).toBeGreaterThan(Date.parse(draft.updatedAt))
    },
  )

  it.each(['products', 'projects', 'posts', 'knowledge'] as const)(
    'keeps %s creation order stable after edits and matches website order across locales',
    async (type) => {
      const group = `sort-${type}-${token}`
      const early = await createContent(type, `${group}-early`, '2026-09-03T00:00:00.000Z')
      const late = await createContent(type, `${group}-late`, '2026-09-02T00:00:00.000Z')
      const draft = await createContent(type, `${group}-draft`)
      const collection: Collection = type === 'knowledge' ? 'posts' : type
      await payload.update({
        collection,
        id: late.id,
        context,
        data: { seo: { title: 'Batch SEO revision' } },
        draft: false,
        overrideAccess: true,
      })
      const req = await createLocalReq({ user: { ...admin, collection: 'users' } }, payload)
      const base = { page: 1, q: group, status: 'all' as const, type }
      const created = await getContentSummary({ payload, query: base, req })
      expect(created.items.map((item) => item.id)).toEqual([draft.id, late.id, early.id])
      const updated = await getContentSummary({ payload, query: { ...base, sort: 'updated' }, req })
      expect(updated.items[0].id).toBe(late.id)
      const website = await getContentSummary({ payload, query: { ...base, sort: 'website' }, req })
      expect(website.items.map((item) => item.id)).toEqual([early.id, late.id])
      expect(website.items.map((item) => item.publishedAt)).toEqual([
        '2026-09-03T00:00:00.000Z',
        '2026-09-02T00:00:00.000Z',
      ])
      const ids = new Set([early.id, late.id, draft.id])
      for (const locale of ['en', 'ar'] as const) {
        const docs = await publicContent(type, locale)
        expect(
          docs.filter((document) => ids.has(document.id)).map((document) => document.id),
        ).toEqual([early.id, late.id])
      }
    },
  )

  it('records a real first publication date when publishing a new article directly from the Portal', async () => {
    const req = await createLocalReq({ context, user: { ...admin, collection: 'users' } }, payload)
    const result = await createPortalContent({
      payload,
      req,
      type: 'posts',
      input: {
        action: 'publish',
        locale: 'en',
        category: 'industry',
        title: 'Direct publication fixture',
        slug: `direct-publication-${token}`,
        excerpt: 'Reviewed article summary',
        bodyText: 'Reviewed article body.',
        seoTitle: 'Reviewed article',
        seoDescription: 'Reviewed article search description',
        publishedAt: '2099-01-01T00:00:00.000Z',
      },
    })
    documents.push({ collection: 'posts', id: Number(result.id) })
    expect(result.status).toBe('published')
    expect(result.createdAt).toBeTruthy()
    expect(result.publishedAt).not.toBeNull()
    expect(Date.parse(result.publishedAt!)).toBeLessThanOrEqual(Date.now())
    const saved = await payload.findByID({
      collection: 'posts',
      id: result.id,
      overrideAccess: true,
    })
    expect(saved.publishedAt).toBe(result.publishedAt)
  })
})
