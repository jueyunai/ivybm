import { describe, expect, it, vi } from 'vitest'

import type { PayloadRequest } from 'payload'

import {
  ContentCommandError,
  type ContentCommandPayload,
  createPortalContent,
  deletePortalContent,
  getPortalContentEditor,
  getPortalContentOptions,
  parseContentMutation,
  updatePortalContent,
} from '@/admin-portal/modules/website-content/contentCommands'

const req = {
  user: { collection: 'users', email: 'operator@example.invalid', id: 2, role: 'operator' },
} as unknown as PayloadRequest

describe('Portal website content commands', () => {
  it('normalizes a localized page form into a bounded mutation', () => {
    expect(
      parseContentMutation('pages', {
        action: 'save-draft',
        bodyText: '  First paragraph\n\nSecond paragraph  ',
        locale: 'ar',
        seoDescription: ' وصف ',
        seoTitle: ' عنوان ',
        slug: 'about-us',
        summary: ' ملخص ',
        title: ' من نحن ',
        updatedAt: '2026-07-30T10:00:00.000Z',
      }),
    ).toMatchObject({
      action: 'save-draft',
      data: {
        body: {
          root: expect.objectContaining({ direction: 'rtl', type: 'root', version: 1 }),
        },
        seo: { description: 'وصف', title: 'عنوان' },
        slug: 'about-us',
        summary: 'ملخص',
        title: 'من نحن',
      },
      locale: 'ar',
      updatedAt: '2026-07-30T10:00:00.000Z',
    })

    expect(() => parseContentMutation('pages', { locale: 'fr', slug: 'x', title: 'X' })).toThrow(
      ContentCommandError,
    )
    expect(() =>
      parseContentMutation('pages', { locale: 'en', slug: 'Invalid Slug', title: 'X' }),
    ).toThrow(ContentCommandError)
    expect(() =>
      parseContentMutation('pages', {
        heroImageId: '91invalid',
        locale: 'en',
        slug: 'valid-page',
        title: 'Valid page',
      }),
    ).toThrow(ContentCommandError)
  })

  it('creates drafts through the current access-controlled Payload request', async () => {
    const create = vi.fn().mockResolvedValue({
      _status: 'draft',
      id: 44,
      slug: 'new-page',
      title: 'New page',
      updatedAt: '2026-07-30T10:00:00.000Z',
    })
    const find = vi.fn().mockResolvedValue({ docs: [] })

    await expect(
      createPortalContent({
        input: {
          action: 'save-draft',
          locale: 'en',
          slug: 'new-page',
          title: 'New page',
        },
        payload: { create, find } as ContentCommandPayload,
        req,
        type: 'pages',
      }),
    ).resolves.toMatchObject({ id: 44, status: 'draft' })

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: 'pages',
        draft: true,
        fallbackLocale: false,
        locale: 'en',
        overrideAccess: false,
        req,
      }),
    )
  })

  it('selects the requested editor locale without falling back to another translation', async () => {
    const find = vi.fn().mockResolvedValue({
      docs: [
        {
          _status: 'published',
          category: 7,
          coverImage: 91,
          description: { ar: null, en: { root: { children: [{ text: 'English body' }] } } },
          id: 44,
          seo: {
            description: { ar: null, en: 'English search description' },
            title: { ar: null, en: 'English search title' },
          },
          shortDescription: { ar: null, en: 'English summary' },
          slug: 'localized-product',
          specifications: [
            {
              id: 'row-1',
              label: { ar: null, en: 'Thickness' },
              value: { ar: null, en: '3 mm' },
            },
          ],
          title: { ar: null, en: 'English product' },
          updatedAt: '2026-07-30T10:00:00.000Z',
        },
      ],
    })

    await expect(
      getPortalContentEditor({
        id: 44,
        locale: 'ar',
        payload: { find },
        req,
        type: 'products',
      }),
    ).resolves.toMatchObject({
      data: {
        bodyText: '',
        categoryId: 7,
        coverImageId: 91,
        seoDescription: '',
        seoTitle: '',
        shortDescription: '',
        slug: 'localized-product',
        specifications: [{ id: 'row-1', label: null, value: null }],
        title: '',
      },
      locale: 'ar',
    })
    expect(find).toHaveBeenCalledWith(
      expect.objectContaining({
        draft: true,
        fallbackLocale: false,
        locale: 'all',
        where: { id: { equals: 44 } },
      }),
    )
  })

  it('isolates the editor locale from concurrent option queries that mutate their request', async () => {
    const sharedReq = {
      locale: 'en',
      query: {},
      user: req.user,
    } as unknown as PayloadRequest
    const find = vi.fn(async (rawArgs: Record<string, unknown>) => {
      const args = rawArgs as {
        collection: string
        locale?: 'all' | 'ar' | 'en'
        req: PayloadRequest
      }
      const localReq = args.req
      localReq.locale = args.locale ?? localReq.locale
      if (args.collection === 'products') {
        await new Promise((resolve) => setTimeout(resolve, 0))
        return {
          docs: [
            {
              _status: 'published',
              category: 7,
              coverImage: 91,
              id: 44,
              seo: {
                description:
                  localReq.locale === 'all'
                    ? { en: 'English search description' }
                    : 'English search description',
                title:
                  localReq.locale === 'all'
                    ? { en: 'English search title' }
                    : 'English search title',
              },
              shortDescription:
                localReq.locale === 'all' ? { en: 'English summary' } : 'English summary',
              slug: 'concurrent-product',
              title: localReq.locale === 'all' ? { en: 'English product' } : 'English product',
              updatedAt: '2026-07-30T10:00:00.000Z',
            },
          ],
        }
      }
      return { docs: [] }
    }) as NonNullable<ContentCommandPayload['find']>

    const [editor] = await Promise.all([
      getPortalContentEditor({
        id: 44,
        locale: 'ar',
        payload: { find },
        req: sharedReq,
        type: 'products',
      }),
      getPortalContentOptions({ payload: { find }, req: sharedReq }),
    ])

    expect(editor.data).toMatchObject({
      seoDescription: '',
      seoTitle: '',
      shortDescription: '',
      title: '',
    })
    expect(sharedReq.locale).toBe('en')
  })

  it('rejects a non-image asset when an image relation is submitted', async () => {
    const create = vi.fn()
    const find = vi.fn(async (args: Record<string, unknown>) =>
      args.collection === 'media'
        ? { docs: [{ id: 91, mimeType: 'application/pdf' }] }
        : { docs: [] },
    ) as NonNullable<ContentCommandPayload['find']>

    await expect(
      createPortalContent({
        input: {
          action: 'save-draft',
          heroImageId: '91',
          locale: 'en',
          slug: 'pdf-hero-page',
          title: 'PDF hero page',
        },
        payload: { create, find },
        req,
        type: 'pages',
      }),
    ).rejects.toMatchObject({ code: 'content-media-image-required', status: 400 })

    expect(create).not.toHaveBeenCalled()
  })

  it('returns safe image preview URLs with media editor options', async () => {
    const find = vi.fn(async ({ collection }: { collection: string }) =>
      collection === 'media'
        ? {
            docs: [
              {
                filename: 'facade.jpg',
                id: 91,
                mimeType: 'image/jpeg',
                sizes: { card: { url: '/media/facade-card.jpg' } },
              },
              {
                filename: 'unsafe.jpg',
                id: 92,
                mimeType: 'image/jpeg',
                url: 'javascript:alert(1)',
              },
              {
                filename: 'catalog.pdf',
                id: 93,
                mimeType: 'application/pdf',
                url: '/media/catalog.pdf',
              },
            ],
          }
        : { docs: [] },
    )

    await expect(
      getPortalContentOptions({
        payload: {
          find: find as unknown as NonNullable<ContentCommandPayload['find']>,
        },
        req,
      }),
    ).resolves.toEqual({
      categories: [],
      media: [
        {
          id: 91,
          label: 'facade.jpg',
          meta: 'image/jpeg',
          previewUrl: '/media/facade-card.jpg',
        },
        {
          id: 92,
          label: 'unsafe.jpg',
          meta: 'image/jpeg',
          previewUrl: undefined,
        },
        {
          id: 93,
          label: 'catalog.pdf',
          meta: 'application/pdf',
          previewUrl: undefined,
        },
      ],
    })
  })

  it('rejects stale updates and publishes posts with a publication timestamp', async () => {
    const create = vi.fn().mockResolvedValue({ id: 1 })
    const update = vi.fn().mockResolvedValue({
      _status: 'published',
      id: 9,
      slug: 'industry-update',
      title: 'Industry update',
      updatedAt: '2026-07-30T11:00:00.000Z',
    })
    const findByID = vi.fn().mockResolvedValue({
      id: 9,
      updatedAt: '2026-07-30T10:00:00.000Z',
    })

    await expect(
      updatePortalContent({
        id: 9,
        input: {
          action: 'publish',
          bodyText: 'A reviewed article.',
          category: 'industry',
          excerpt: 'Summary',
          locale: 'en',
          seoDescription: 'Search description',
          seoTitle: 'Search title',
          slug: 'industry-update',
          title: 'Industry update',
          updatedAt: '2026-07-30T09:59:59.000Z',
        },
        now: () => new Date('2026-07-30T10:30:00.000Z'),
        payload: { create, findByID, update },
        req,
        type: 'posts',
      }),
    ).rejects.toMatchObject({ code: 'content-stale', status: 409 })

    await expect(
      updatePortalContent({
        id: 9,
        input: {
          action: 'publish',
          bodyText: 'A reviewed article.',
          category: 'industry',
          excerpt: 'Summary',
          locale: 'en',
          seoDescription: 'Search description',
          seoTitle: 'Search title',
          slug: 'industry-update',
          title: 'Industry update',
          updatedAt: '2026-07-30T10:00:00.000Z',
        },
        now: () => new Date('2026-07-30T10:30:00.000Z'),
        payload: { create, findByID, update },
        req,
        type: 'posts',
      }),
    ).resolves.toMatchObject({ id: 9, status: 'published' })

    expect(update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        collection: 'posts',
        data: expect.objectContaining({ publishedAt: '2026-07-30T10:30:00.000Z' }),
        draft: false,
        overrideAccess: false,
        req,
      }),
    )
  })

  it('unpublishes the root document instead of only creating a draft version', async () => {
    const create = vi.fn().mockResolvedValue({ id: 1 })
    const findByID = vi.fn().mockResolvedValue({
      _status: 'published',
      hasBeenPublished: true,
      id: 9,
      updatedAt: '2026-07-30T10:00:00.000Z',
    })
    const update = vi.fn().mockResolvedValue({
      _status: 'draft',
      hasBeenPublished: true,
      id: 9,
      slug: 'case-study',
      title: 'Case study',
      updatedAt: '2026-07-30T11:00:00.000Z',
    })

    await expect(
      updatePortalContent({
        id: 9,
        input: {
          action: 'unpublish',
          coverImageId: '91',
          locale: 'en',
          slug: 'case-study',
          title: 'Case study',
          updatedAt: '2026-07-30T10:00:00.000Z',
        },
        payload: {
          create,
          find: vi.fn().mockResolvedValue({ docs: [{ id: 91, mimeType: 'image/jpeg' }] }),
          findByID,
          update,
        },
        req,
        type: 'projects',
      }),
    ).resolves.toMatchObject({ id: 9, status: 'unpublished' })

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: 'projects',
        data: expect.objectContaining({ _status: 'draft' }),
        draft: false,
        overrideAccess: false,
        req,
      }),
    )
  })

  it('never allows previously published content to return to the initial draft state', async () => {
    const findByID = vi.fn().mockResolvedValue({
      _status: 'draft',
      hasBeenPublished: true,
      id: 9,
      updatedAt: '2026-07-30T10:00:00.000Z',
    })

    await expect(
      updatePortalContent({
        id: 9,
        input: {
          action: 'save-draft',
          coverImageId: '91',
          locale: 'en',
          slug: 'case-study',
          title: 'Case study',
          updatedAt: '2026-07-30T10:00:00.000Z',
        },
        payload: { findByID },
        req,
        type: 'projects',
      }),
    ).rejects.toMatchObject({ code: 'content-invalid-action', status: 409 })
  })

  it('blocks deletion of a product category that is still referenced', async () => {
    const count = vi.fn().mockResolvedValue({ totalDocs: 2 })
    const create = vi.fn().mockResolvedValue({ id: 1 })
    const deleteDocument = vi.fn()
    const findByID = vi.fn().mockResolvedValue({ id: 7, updatedAt: '2026-07-30T10:00:00.000Z' })

    await expect(
      deletePortalContent({
        id: 7,
        locale: 'en',
        payload: { count, create, delete: deleteDocument, findByID },
        req,
        type: 'product-categories',
        updatedAt: '2026-07-30T10:00:00.000Z',
      }),
    ).rejects.toMatchObject({ code: 'content-in-use', status: 409 })
    expect(deleteDocument).not.toHaveBeenCalled()
  })

  it('blocks deletion of a page still used by site navigation', async () => {
    const create = vi.fn().mockResolvedValue({ id: 1 })
    const deleteDocument = vi.fn()
    const findByID = vi.fn().mockResolvedValue({ id: 8, updatedAt: '2026-07-30T10:00:00.000Z' })
    const findGlobal = vi.fn().mockResolvedValue({ navigation: [{ label: 'About', page: 8 }] })

    await expect(
      deletePortalContent({
        id: 8,
        locale: 'en',
        payload: { create, delete: deleteDocument, findByID, findGlobal },
        req,
        type: 'pages',
        updatedAt: '2026-07-30T10:00:00.000Z',
      }),
    ).rejects.toMatchObject({ code: 'content-in-use', status: 409 })
    expect(findGlobal).toHaveBeenCalledWith(
      expect.objectContaining({
        overrideAccess: false,
        req,
        slug: 'site-settings',
      }),
    )
    expect(deleteDocument).not.toHaveBeenCalled()
  })
})
