import { describe, expect, it, vi } from 'vitest'

const mockFind = vi.fn()

vi.mock('payload', async (importOriginal) => {
  const actual = await importOriginal<typeof import('payload')>()
  return {
    ...actual,
    getPayload: vi.fn().mockImplementation(() =>
      Promise.resolve({
        find: mockFind,
        findGlobal: vi.fn(),
      }),
    ),
  }
})

import { getPostBySlug, getPosts } from '@/lib/website-data'

describe('website-data Posts queries with contentType filtering', () => {
  it('filters posts by contentType and applies english fallback by default', async () => {
    mockFind.mockResolvedValueOnce({
      docs: [
        {
          category: 'technical-guide',
          contentType: 'knowledge',
          id: 1,
          slug: 'curtain-wall-tolerances',
          title: 'Curtain Wall Tolerances',
        },
      ],
    })

    const result = await getPosts('en', { contentType: 'knowledge' })
    expect(result).toHaveLength(1)
    expect(result[0].contentType).toBe('knowledge')
    expect(mockFind).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: 'posts',
        fallbackLocale: 'en',
        where: { contentType: { equals: 'knowledge' } },
      }),
    )
  })

  it('queries post by slug with specific contentType restriction', async () => {
    mockFind.mockResolvedValueOnce({
      docs: [
        {
          category: 'material-comparison',
          contentType: 'knowledge',
          id: 2,
          slug: 'curtain-wall-tolerances',
          title: 'Curtain Wall Tolerances',
        },
      ],
    })

    const post = await getPostBySlug('en', 'curtain-wall-tolerances', {
      contentType: 'knowledge',
    })

    expect(post?.id).toBe(2)
    expect(mockFind).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: 'posts',
        fallbackLocale: 'en',
        where: {
          and: [
            { slug: { equals: 'curtain-wall-tolerances' } },
            { contentType: { equals: 'knowledge' } },
          ],
        },
      }),
    )
  })
})
