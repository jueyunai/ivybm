import { describe, expect, it, vi } from 'vitest'

import sitemap, { hasArabicContentCompleteness } from '@/app/sitemap'
import * as websiteData from '@/lib/website-data'

describe('sitemap generation with Knowledge/News separation and Arabic completeness gate', () => {
  it('correctly assesses Arabic content completeness', () => {
    expect(hasArabicContentCompleteness({ title: 'لوحة الألومنيوم' })).toBe(true)
    expect(hasArabicContentCompleteness({ title: '  ' })).toBe(false)
    expect(hasArabicContentCompleteness({ title: null })).toBe(false)
    expect(hasArabicContentCompleteness({ title: undefined })).toBe(false)
    expect(hasArabicContentCompleteness(null)).toBe(false)
  })

  it('generates sitemap separating Knowledge and News posts and enforcing Arabic completeness gate', async () => {
    vi.spyOn(websiteData, 'getPageBySlug').mockImplementation((locale, slug) => {
      if (slug === 'home') return Promise.resolve({ id: 1, title: locale === 'en' ? 'Home' : 'الرئيسية' } as unknown as never)
      return Promise.resolve(null)
    })
    vi.spyOn(websiteData, 'getSiteSettings').mockResolvedValue({ defaultSeo: { noIndex: false } } as unknown as never)
    vi.spyOn(websiteData, 'getProducts').mockResolvedValue([])
    vi.spyOn(websiteData, 'getProjects').mockResolvedValue([])

    vi.spyOn(websiteData, 'getPosts').mockImplementation((locale) => {
      if (locale === 'en') {
        return Promise.resolve([
          { contentType: 'news', id: 10, slug: 'expansion-update', title: 'Expansion Update' } as unknown as never,
          { contentType: 'knowledge', id: 20, slug: 'facade-tolerance-guide', title: 'Facade Tolerance Guide' } as unknown as never,
          { contentType: 'knowledge', id: 30, slug: 'untranslated-guide', title: 'Untranslated Guide' } as unknown as never,
        ])
      }
      if (locale === 'ar') {
        return Promise.resolve([
          { contentType: 'news', id: 10, slug: 'expansion-update', title: 'تحديث التوسع' } as unknown as never,
          { contentType: 'knowledge', id: 20, slug: 'facade-tolerance-guide', title: 'دليل تفاوتات واجهات المباني' } as unknown as never,
          // untranslated-guide has empty/null title in Arabic
          { contentType: 'knowledge', id: 30, slug: 'untranslated-guide', title: '' } as unknown as never,
        ])
      }
      return Promise.resolve([])
    })

    const entries = await sitemap()

    // 1. Knowledge post URL is separated to /knowledge/<slug>
    const knowledgeEn = entries.find((e) => e.url.includes('/en/knowledge/facade-tolerance-guide'))
    expect(knowledgeEn).toBeDefined()
    expect(knowledgeEn?.alternates?.languages).toHaveProperty('en')
    expect(knowledgeEn?.alternates?.languages).toHaveProperty('ar')

    // 2. News post URL is separated to /news/<slug>
    const newsEn = entries.find((e) => e.url.includes('/en/news/expansion-update'))
    expect(newsEn).toBeDefined()
    expect(newsEn?.alternates?.languages).toHaveProperty('en')
    expect(newsEn?.alternates?.languages).toHaveProperty('ar')

    // 3. Untranslated guide without Arabic title is omitted from Arabic sitemap and hreflang
    const untranslatedEn = entries.find((e) => e.url.includes('/en/knowledge/untranslated-guide'))
    expect(untranslatedEn).toBeDefined()
    expect(untranslatedEn?.alternates?.languages).toHaveProperty('en')
    expect(untranslatedEn?.alternates?.languages).not.toHaveProperty('ar')

    const untranslatedAr = entries.find((e) => e.url.includes('/ar/knowledge/untranslated-guide'))
    expect(untranslatedAr).toBeUndefined()
  })
})
