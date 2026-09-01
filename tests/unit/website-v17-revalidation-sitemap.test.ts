import { describe, expect, it } from 'vitest'

describe('Website v1.7 ISR Revalidation and Sitemap split specification', () => {
  type PostDoc = {
    _status: 'draft' | 'published'
    contentType?: 'knowledge' | 'news'
    slug: string
    title?: string
    title_ar?: string
    content_ar?: string
  }

  const PUBLIC_LOCALES = ['en', 'ar'] as const

  const localizedPostPaths = (doc: PostDoc): string[] => {
    const type = doc.contentType === 'knowledge' ? 'knowledge' : 'news'
    const paths: string[] = []
    for (const locale of PUBLIC_LOCALES) {
      paths.push(`/${locale}/${type}`)
      if (doc.slug) {
        paths.push(`/${locale}/${type}/${doc.slug}`)
      }
    }
    return paths
  }

  it('generates /knowledge paths for knowledge posts in revalidation', () => {
    const knowledgeDoc: PostDoc = {
      _status: 'published',
      contentType: 'knowledge',
      slug: 'double-curved-manufacturing-process',
    }

    const paths = localizedPostPaths(knowledgeDoc)
    expect(paths).toEqual([
      '/en/knowledge',
      '/en/knowledge/double-curved-manufacturing-process',
      '/ar/knowledge',
      '/ar/knowledge/double-curved-manufacturing-process',
    ])
  })

  it('maintains /news paths for standard news posts in revalidation', () => {
    const newsDoc: PostDoc = {
      _status: 'published',
      contentType: 'news',
      slug: 'canton-fair-2026',
    }

    const paths = localizedPostPaths(newsDoc)
    expect(paths).toEqual([
      '/en/news',
      '/en/news/canton-fair-2026',
      '/ar/news',
      '/ar/news/canton-fair-2026',
    ])
  })

  it('defaults legacy posts without contentType to /news paths', () => {
    const legacyDoc: PostDoc = {
      _status: 'published',
      slug: 'legacy-article',
    }

    const paths = localizedPostPaths(legacyDoc)
    expect(paths).toEqual([
      '/en/news',
      '/en/news/legacy-article',
      '/ar/news',
      '/ar/news/legacy-article',
    ])
  })

  it('evaluates Arabic minimal indexation completeness threshold', () => {
    const meetsArabicIndexThreshold = (item: {
      hasExplicitArabicContent?: boolean
      isArabicFallbackToEnglish?: boolean
      title_ar?: string
    }): boolean => {
      if (item.isArabicFallbackToEnglish) return false
      if (!item.title_ar || !item.title_ar.trim()) return false
      return Boolean(item.hasExplicitArabicContent)
    }

    // Fully translated Arabic post -> passes threshold
    expect(
      meetsArabicIndexThreshold({
        hasExplicitArabicContent: true,
        isArabicFallbackToEnglish: false,
        title_ar: 'دليل تصنيع ألواح الألمنيوم',
      }),
    ).toBe(true)

    // Missing Arabic translation (falls back to English) -> fails threshold
    expect(
      meetsArabicIndexThreshold({
        hasExplicitArabicContent: false,
        isArabicFallbackToEnglish: true,
        title_ar: '',
      }),
    ).toBe(false)

    // Blank title -> fails threshold
    expect(
      meetsArabicIndexThreshold({
        hasExplicitArabicContent: true,
        isArabicFallbackToEnglish: false,
        title_ar: '   ',
      }),
    ).toBe(false)
  })

  it('filters sitemap entries according to Arabic index threshold', () => {
    const posts = [
      {
        contentType: 'knowledge' as const,
        hasArabicTranslation: true,
        slug: 'curtain-wall-guide',
      },
      {
        contentType: 'knowledge' as const,
        hasArabicTranslation: false, // fallback to English
        slug: 'engineering-tolerances',
      },
      {
        contentType: 'news' as const,
        hasArabicTranslation: true,
        slug: 'expo-2026',
      },
    ]

    const buildSitemapEntries = (items: typeof posts) => {
      const entries: { locale: string; path: string }[] = []
      for (const item of items) {
        const type = item.contentType
        // English is always indexed
        entries.push({ locale: 'en', path: `/${type}/${item.slug}` })
        // Arabic is only indexed if it meets completeness threshold
        if (item.hasArabicTranslation) {
          entries.push({ locale: 'ar', path: `/${type}/${item.slug}` })
        }
      }
      return entries
    }

    const sitemap = buildSitemapEntries(posts)

    // Verify Knowledge and News paths are segregated
    expect(sitemap).toContainEqual({ locale: 'en', path: '/knowledge/curtain-wall-guide' })
    expect(sitemap).toContainEqual({ locale: 'ar', path: '/knowledge/curtain-wall-guide' })
    expect(sitemap).toContainEqual({ locale: 'en', path: '/news/expo-2026' })
    expect(sitemap).toContainEqual({ locale: 'ar', path: '/news/expo-2026' })

    // Uncompleted Arabic post has English URL in sitemap but NO Arabic URL
    expect(sitemap).toContainEqual({ locale: 'en', path: '/knowledge/engineering-tolerances' })
    expect(sitemap).not.toContainEqual({ locale: 'ar', path: '/knowledge/engineering-tolerances' })
  })
})
