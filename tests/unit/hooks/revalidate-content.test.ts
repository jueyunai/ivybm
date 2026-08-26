import { beforeEach, describe, expect, it, vi } from 'vitest'

const { purgeCloudflareEverythingMock, purgeCloudflareUrlsMock, revalidatePathMock } = vi.hoisted(
  () => ({
    purgeCloudflareEverythingMock: vi.fn().mockResolvedValue({ status: 'succeeded' }),
    purgeCloudflareUrlsMock: vi.fn().mockResolvedValue({ status: 'succeeded' }),
    revalidatePathMock: vi.fn(),
  }),
)

vi.mock('@/lib/cloudflare', () => ({
  purgeCloudflareEverything: purgeCloudflareEverythingMock,
  purgeCloudflareUrls: purgeCloudflareUrlsMock,
}))

vi.mock('next/cache', () => ({
  revalidatePath: revalidatePathMock,
}))

import {
  revalidateContentAfterChange,
  revalidateContentAfterDelete,
  revalidateMediaAfterChange,
  revalidateSiteSettingsAfterChange,
} from '@/hooks/revalidateContent'

const req = {
  payload: {
    logger: {
      warn: vi.fn(),
    },
  },
}

describe('content cache revalidation', () => {
  beforeEach(() => {
    revalidatePathMock.mockReset()
    purgeCloudflareEverythingMock.mockClear()
    purgeCloudflareUrlsMock.mockClear()
    req.payload.logger.warn.mockReset()
  })

  it('revalidates product indexes and localized details after publication', async () => {
    await revalidateContentAfterChange({
      collection: { slug: 'products' },
      context: {},
      doc: { _status: 'published', slug: 'perforated-panel' },
      operation: 'update',
      previousDoc: { _status: 'draft', slug: 'perforated-panel' },
      req,
    } as never)

    expect(revalidatePathMock.mock.calls).toEqual([
      ['/en/products'],
      ['/en/products/perforated-panel'],
      ['/ar/products'],
      ['/ar/products/perforated-panel'],
    ])
    expect(purgeCloudflareUrlsMock).toHaveBeenCalledWith(
      [
        '/en/products',
        '/en/products/perforated-panel',
        '/ar/products',
        '/ar/products/perforated-panel',
      ],
      { logger: req.payload.logger },
    )
  })

  it.each([
    {
      doc: { _status: 'published', slug: 'airport-facade' },
      label: 'publication',
      previousDoc: { _status: 'draft', slug: 'airport-facade' },
    },
    {
      doc: { _status: 'published', slug: 'airport-facade' },
      label: 'same-slug edit',
      previousDoc: { _status: 'published', slug: 'airport-facade' },
    },
    {
      doc: { _status: 'draft', slug: 'airport-facade' },
      label: 'unpublish',
      previousDoc: { _status: 'published', slug: 'airport-facade' },
    },
  ])('revalidates project indexes and details after $label', async ({ doc, previousDoc }) => {
    await revalidateContentAfterChange({
      collection: { slug: 'projects' },
      context: {},
      doc,
      operation: 'update',
      previousDoc,
      req,
    } as never)

    expect(revalidatePathMock.mock.calls).toEqual([
      ['/en/projects'],
      ['/en/projects/airport-facade'],
      ['/ar/projects'],
      ['/ar/projects/airport-facade'],
    ])
    expect(purgeCloudflareUrlsMock).toHaveBeenCalledWith(
      [
        '/en/projects',
        '/en/projects/airport-facade',
        '/ar/projects',
        '/ar/projects/airport-facade',
      ],
      { logger: req.payload.logger },
    )
  })

  it('revalidates the previous public path when content is unpublished or renamed', async () => {
    await revalidateContentAfterChange({
      collection: { slug: 'posts' },
      context: {},
      doc: { _status: 'draft', slug: 'new-guide' },
      operation: 'update',
      previousDoc: { _status: 'published', slug: 'old-guide' },
      req,
    } as never)

    expect(revalidatePathMock.mock.calls).toEqual([
      ['/en/news'],
      ['/en/news/old-guide'],
      ['/ar/news'],
      ['/ar/news/old-guide'],
    ])
    expect(purgeCloudflareUrlsMock).toHaveBeenCalledWith(
      ['/en/news', '/en/news/old-guide', '/ar/news', '/ar/news/old-guide'],
      { logger: req.payload.logger },
    )
  })

  it('does not invalidate public pages for a draft-only change', async () => {
    await revalidateContentAfterChange({
      collection: { slug: 'pages' },
      context: {},
      doc: { _status: 'draft', slug: 'about' },
      operation: 'create',
      previousDoc: undefined,
      req,
    } as never)

    expect(revalidatePathMock).not.toHaveBeenCalled()
    expect(purgeCloudflareUrlsMock).not.toHaveBeenCalled()
  })

  it('revalidates public paths after deletion', async () => {
    await revalidateContentAfterDelete({
      collection: { slug: 'projects' },
      context: {},
      doc: { _status: 'published', slug: 'airport-facade' },
      req,
    } as never)

    expect(revalidatePathMock.mock.calls).toEqual([
      ['/en/projects'],
      ['/en/projects/airport-facade'],
      ['/ar/projects'],
      ['/ar/projects/airport-facade'],
    ])
    expect(purgeCloudflareUrlsMock).toHaveBeenCalledWith(
      [
        '/en/projects',
        '/en/projects/airport-facade',
        '/ar/projects',
        '/ar/projects/airport-facade',
      ],
      { logger: req.payload.logger },
    )
  })

  it('ignores inactive downloads that were never public', async () => {
    await revalidateContentAfterChange({
      collection: { slug: 'downloads' },
      context: {},
      doc: { isActive: false, slug: 'private-download' },
      operation: 'create',
      previousDoc: undefined,
      req,
    } as never)

    expect(revalidatePathMock).not.toHaveBeenCalled()
    expect(purgeCloudflareUrlsMock).not.toHaveBeenCalled()
    expect(purgeCloudflareEverythingMock).not.toHaveBeenCalled()
  })

  it('can disable revalidation for seed and maintenance operations', async () => {
    await revalidateContentAfterChange({
      collection: { slug: 'products' },
      context: { disableRevalidate: true },
      doc: { _status: 'published', slug: 'perforated-panel' },
      operation: 'create',
      previousDoc: undefined,
      req,
    } as never)

    expect(revalidatePathMock).not.toHaveBeenCalled()
    expect(purgeCloudflareUrlsMock).not.toHaveBeenCalled()
    expect(purgeCloudflareEverythingMock).not.toHaveBeenCalled()
  })

  it('invalidates both locale layouts when site settings change', async () => {
    await revalidateSiteSettingsAfterChange({ context: {}, doc: {}, req } as never)

    expect(revalidatePathMock.mock.calls).toEqual([
      ['/en', 'layout'],
      ['/ar', 'layout'],
    ])
    expect(purgeCloudflareEverythingMock).toHaveBeenCalledWith({ logger: req.payload.logger })
    expect(purgeCloudflareUrlsMock).not.toHaveBeenCalled()
  })

  it('invalidates product detail patterns when a category changes', async () => {
    await revalidateContentAfterChange({
      collection: { slug: 'product-categories' },
      context: {},
      doc: { slug: 'facade-panels' },
      operation: 'update',
      previousDoc: { slug: 'facade-panels' },
      req,
    } as never)

    expect(revalidatePathMock.mock.calls).toEqual([
      ['/en/products'],
      ['/ar/products'],
      ['/en/products/[slug]', 'page'],
      ['/ar/products/[slug]', 'page'],
    ])
    expect(purgeCloudflareUrlsMock).toHaveBeenCalledWith(['/en/products', '/ar/products'], {
      logger: req.payload.logger,
    })
  })

  it('invalidates locale layouts only when a public media asset changes', async () => {
    await revalidateMediaAfterChange({
      context: {},
      doc: { isPublic: false },
      previousDoc: { isPublic: false },
      req,
    } as never)
    expect(revalidatePathMock).not.toHaveBeenCalled()

    await revalidateMediaAfterChange({
      context: {},
      doc: { isPublic: true },
      previousDoc: { isPublic: false },
      req,
    } as never)
    expect(revalidatePathMock.mock.calls).toEqual([
      ['/en', 'layout'],
      ['/ar', 'layout'],
    ])
    expect(purgeCloudflareEverythingMock).not.toHaveBeenCalled()
    expect(purgeCloudflareUrlsMock).not.toHaveBeenCalled()
  })
})
