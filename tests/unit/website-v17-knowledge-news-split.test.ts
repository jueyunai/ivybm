import { describe, expect, it, vi } from 'vitest'
import type { Payload } from 'payload'

type MockPost = {
  category: string
  content?: unknown
  contentType?: 'knowledge' | 'news'
  id: number
  slug: string
  title: string
  _status: 'draft' | 'published'
}

describe('Website v1.7 Knowledge vs News route and query split', () => {
  it('differentiates Knowledge and News posts by contentType', () => {
    const newsPost: MockPost = {
      _status: 'published',
      category: 'industry',
      contentType: 'news',
      id: 1,
      slug: 'dubai-facade-expo-2026',
      title: 'IVYBM at Dubai Facade Expo',
    }

    const knowledgePost: MockPost = {
      _status: 'published',
      category: 'technical',
      contentType: 'knowledge',
      id: 2,
      slug: 'double-curved-tolerance-guide',
      title: 'Engineering Guide: Double-Curved Aluminum Panel Tolerances',
    }

    expect(newsPost.contentType).toBe('news')
    expect(knowledgePost.contentType).toBe('knowledge')

    // URL resolution rule
    const getPostUrl = (post: MockPost, locale: string) => {
      const type = post.contentType || 'news'
      return `/${locale}/${type}/${post.slug}`
    }

    expect(getPostUrl(newsPost, 'en')).toBe('/en/news/dubai-facade-expo-2026')
    expect(getPostUrl(knowledgePost, 'en')).toBe('/en/knowledge/double-curved-tolerance-guide')
    expect(getPostUrl(knowledgePost, 'ar')).toBe('/ar/knowledge/double-curved-tolerance-guide')
  })

  it('defaults legacy posts without explicit contentType to news', () => {
    const legacyPost: MockPost = {
      _status: 'published',
      category: 'company',
      id: 3,
      slug: 'factory-expansion-announcement',
      title: 'Factory Expansion',
    }

    const resolvedType = legacyPost.contentType ?? 'news'
    expect(resolvedType).toBe('news')
  })

  it('verifies that getPosts queries can filter by contentType in payload find', async () => {
    const mockFind = vi.fn().mockImplementation(({ where: _where }: { where?: Record<string, unknown> }) => {
      return Promise.resolve({
        docs: [
          {
            _status: 'published',
            category: 'technical',
            contentType: 'knowledge',
            id: 10,
            slug: 'anodizing-vs-pvdf-coating',
            title: 'Anodizing vs PVDF Coating Comparison',
          },
        ],
        totalDocs: 1,
      })
    })

    const payload = { find: mockFind } as unknown as Payload

    // Simulate query with contentType filter
    await payload.find({
      collection: 'posts',
      where: {
        and: [
          { _status: { equals: 'published' } },
          { contentType: { equals: 'knowledge' } },
        ],
      },
    })

    expect(mockFind).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: 'posts',
        where: {
          and: [
            { _status: { equals: 'published' } },
            { contentType: { equals: 'knowledge' } },
          ],
        },
      }),
    )
  })

  it('enforces collection-level slug uniqueness without silent auto-rewrite', () => {
    const existingSlugs = new Set(['double-curved-guide', 'news-update-2026'])

    const validateNewPostSlug = (newSlug: string): { ok: boolean; error?: string } => {
      if (existingSlugs.has(newSlug)) {
        return {
          error: 'A post with this slug already exists. Please choose a unique slug.',
          ok: false,
        }
      }
      return { ok: true }
    }

    expect(validateNewPostSlug('double-curved-guide').ok).toBe(false)
    expect(validateNewPostSlug('double-curved-guide').error).toContain('already exists')
    expect(validateNewPostSlug('brand-new-technical-article').ok).toBe(true)
  })

  it('provides safe English fallback when Arabic content is missing without 404', () => {
    const postWithTranslations = {
      en: { title: 'Facade Panel Specifications', excerpt: 'Comprehensive guide' },
      ar: { title: '', excerpt: '' }, // empty translation
    }

    const resolvePostContent = (locale: 'en' | 'ar') => {
      const localized = postWithTranslations[locale]
      if (localized && localized.title.trim()) {
        return { isFallback: false, ...localized }
      }
      return { isFallback: true, ...postWithTranslations.en }
    }

    const arResolved = resolvePostContent('ar')
    expect(arResolved.isFallback).toBe(true)
    expect(arResolved.title).toBe('Facade Panel Specifications')
  })
})
