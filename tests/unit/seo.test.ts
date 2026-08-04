import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  DEFAULT_LOCALE,
  getLocaleDirection,
  getPostCategoryLabel,
  isPublicLocale,
  localePath,
  replacePathLocale,
} from '@/lib/i18n'
import {
  buildOrganizationJsonLd,
  buildPageMetadata,
  getMediaURL,
  getSiteOrigin,
} from '@/lib/seo'
import robots from '@/app/robots'

describe('website localization', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('supports English LTR and Arabic RTL with English as the default', () => {
    expect(DEFAULT_LOCALE).toBe('en')
    expect(isPublicLocale('en')).toBe(true)
    expect(isPublicLocale('ar')).toBe(true)
    expect(isPublicLocale('zh')).toBe(false)
    expect(getLocaleDirection('en')).toBe('ltr')
    expect(getLocaleDirection('ar')).toBe('rtl')
  })

  it('builds stable locale-prefixed paths and switches locale without changing the route', () => {
    expect(localePath('en', '/products/solid-aluminum-panel')).toBe(
      '/en/products/solid-aluminum-panel',
    )
    expect(localePath('ar', '/')).toBe('/ar')
    expect(replacePathLocale('/en/projects/commercial-complex-facade', 'ar')).toBe(
      '/ar/projects/commercial-complex-facade',
    )
    expect(replacePathLocale('/products', 'ar')).toBe('/ar/products')
  })

  it('localizes content categories without leaking English labels into Arabic pages', () => {
    expect(getPostCategoryLabel('en', 'products')).toBe('Products')
    expect(getPostCategoryLabel('ar', 'products')).toBe('المنتجات')
    expect(getPostCategoryLabel('ar', 'company')).toBe('أخبار الشركة')
  })
})

describe('website SEO', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('normalizes the configured public origin', () => {
    expect(getSiteOrigin('https://www.ivybm.com/').toString()).toBe('https://www.ivybm.com/')
  })

  it('keeps private application routes out of robots indexing', () => {
    vi.stubEnv('NEXT_PUBLIC_SERVER_URL', 'https://www.ivybm.com')

    expect(robots().rules).toMatchObject({
      allow: '/',
      disallow: ['/admin', '/admin/', '/api', '/api/', '/dashboard', '/dashboard/'],
      userAgent: '*',
    })
  })

  it('fails fast when the production public origin is missing or invalid', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('NEXT_PUBLIC_SERVER_URL', '')
    expect(() => getSiteOrigin()).toThrow('NEXT_PUBLIC_SERVER_URL is required in production')
    expect(() => getSiteOrigin('not-a-url')).toThrow(
      'NEXT_PUBLIC_SERVER_URL must be an absolute HTTP(S) URL',
    )
  })

  it('builds canonical, hreflang, robots and Open Graph metadata', () => {
    const metadata = buildPageMetadata({
      description: 'Curved aluminum facade solutions for overseas construction projects.',
      locale: 'ar',
      media: {
        alt: 'Curved aluminum facade',
        createdAt: '2026-07-18T00:00:00.000Z',
        id: 1,
        source: 'IVYBM-owned test fixture',
        sizes: {
          large: {
            height: 1067,
            url: '/api/media/file/curved-panel-1600x1067.jpg',
            width: 1600,
          },
        },
        updatedAt: '2026-07-18T00:00:00.000Z',
      },
      origin: 'https://www.ivybm.com',
      path: '/products/solid-aluminum-panel',
      seo: {
        canonical: '/ar/products/solid-aluminum-panel',
        description: 'حلول ألواح الألمنيوم المنحنية للمشاريع العالمية.',
        keywords: 'ألواح ألمنيوم, واجهات منحنية',
        noIndex: true,
        title: 'ألواح ألمنيوم منحنية',
      },
      siteName: 'IVYBM',
      title: 'Solid Aluminum Panel',
    })

    expect(metadata.title).toBe('ألواح ألمنيوم منحنية | IVYBM')
    expect(metadata.description).toBe('حلول ألواح الألمنيوم المنحنية للمشاريع العالمية.')
    expect(metadata.keywords).toEqual(['ألواح ألمنيوم', 'واجهات منحنية'])
    expect(metadata.alternates).toEqual({
      canonical: 'https://www.ivybm.com/ar/products/solid-aluminum-panel',
      languages: {
        ar: 'https://www.ivybm.com/ar/products/solid-aluminum-panel',
        en: 'https://www.ivybm.com/en/products/solid-aluminum-panel',
        'x-default': 'https://www.ivybm.com/en/products/solid-aluminum-panel',
      },
    })
    expect(metadata.robots).toEqual({ follow: false, index: false })
    expect(metadata.openGraph).toMatchObject({
      locale: 'ar',
      siteName: 'IVYBM',
      title: 'ألواح ألمنيوم منحنية',
      type: 'website',
      url: 'https://www.ivybm.com/ar/products/solid-aluminum-panel',
    })
    expect(metadata.openGraph?.images).toEqual([
      {
        alt: 'Curved aluminum facade',
        height: 1067,
        url: 'https://www.ivybm.com/api/media/file/curved-panel-1600x1067.jpg',
        width: 1600,
      },
    ])
  })

  it('ignores inaccessible media relation IDs', () => {
    expect(getMediaURL(42, 'card', 'https://www.ivybm.com')).toBeUndefined()
  })

  it('never exposes PDF uploads as website or Open Graph images', () => {
    expect(
      getMediaURL(
        {
          alt: 'Technical PDF',
          createdAt: '2026-07-18T00:00:00.000Z',
          filename: 'technical-data.pdf',
          id: 2,
          mimeType: 'application/pdf',
          source: 'IVYBM-owned fixture',
          updatedAt: '2026-07-18T00:00:00.000Z',
          url: '/api/media/file/technical-data.pdf',
        },
        'original',
        'https://www.ivybm.com',
      ),
    ).toBeUndefined()
  })

  it('builds organization JSON-LD without empty contact fields', () => {
    expect(
      buildOrganizationJsonLd({
        description: 'Architectural aluminum panel manufacturer.',
        email: 'sales@example.com',
        locale: 'en',
        name: 'IVYBM',
        origin: 'https://www.ivybm.com',
        phone: undefined,
        socialLinks: ['https://www.linkedin.com/company/ivybm'],
      }),
    ).toEqual({
      '@context': 'https://schema.org',
      '@type': 'Organization',
      description: 'Architectural aluminum panel manufacturer.',
      email: 'sales@example.com',
      name: 'IVYBM',
      sameAs: ['https://www.linkedin.com/company/ivybm'],
      url: 'https://www.ivybm.com/en',
    })
  })
})
