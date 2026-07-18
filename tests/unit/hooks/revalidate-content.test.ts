import { beforeEach, describe, expect, it, vi } from 'vitest'

const { revalidatePathMock } = vi.hoisted(() => ({
  revalidatePathMock: vi.fn(),
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
  })

  it('invalidates both locale layouts when site settings change', async () => {
    await revalidateSiteSettingsAfterChange({ context: {}, doc: {}, req } as never)

    expect(revalidatePathMock.mock.calls).toEqual([
      ['/en', 'layout'],
      ['/ar', 'layout'],
    ])
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
  })
})
