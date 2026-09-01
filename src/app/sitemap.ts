import type { MetadataRoute } from 'next'

import { localePath, type Locale, PUBLIC_LOCALES } from '@/lib/i18n'
import { LEGAL_PATHS } from '@/lib/legal'
import { absoluteURL, getSiteOrigin } from '@/lib/seo'
import {
  getPageBySlug,
  getPosts,
  getProducts,
  getProjects,
  getSiteSettings,
} from '@/lib/website-data'

export const dynamic = 'force-dynamic'

const addPath = (paths: Map<string, Set<Locale>>, path: string, locale: Locale) => {
  const locales = paths.get(path) || new Set<Locale>()
  locales.add(locale)
  paths.set(path, locales)
}

export const hasArabicContentCompleteness = (
  item: { title?: string | null } | null | undefined,
): boolean => {
  if (!item || typeof item !== 'object') return false
  const title = typeof item.title === 'string' ? item.title.trim() : ''
  return Boolean(title)
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const origin = getSiteOrigin()
  const paths = new Map<string, Set<Locale>>()

  await Promise.all(
    PUBLIC_LOCALES.map(async (locale) => {
      const isArabic = locale === 'ar'
      const queryOptions = isArabic ? { fallbackLocale: false as const } : {}

      const [
        home,
        about,
        contact,
        capabilities,
        forProfessionals,
        products,
        projects,
        posts,
        settings,
      ] = await Promise.all([
        getPageBySlug(locale, 'home', queryOptions),
        getPageBySlug(locale, 'about', queryOptions),
        getPageBySlug(locale, 'contact', queryOptions),
        getPageBySlug(locale, 'capabilities', queryOptions),
        getPageBySlug(locale, 'for-professionals', queryOptions),
        getProducts(locale, queryOptions),
        getProjects(locale, queryOptions),
        getPosts(locale, queryOptions),
        getSiteSettings(locale, queryOptions),
      ])

      for (const [path, page] of [
        ['/', home],
        ['/about', about],
        ['/contact', contact],
        ['/capabilities', capabilities],
        ['/for-professionals', forProfessionals],
      ] as const) {
        if (page?.title?.trim() && !page.seo?.noIndex) {
          if (!isArabic || hasArabicContentCompleteness(page)) {
            addPath(paths, path, locale)
          }
        }
      }

      if (!settings?.defaultSeo?.noIndex) {
        for (const path of [
          '/products',
          '/projects',
          '/capabilities',
          '/for-professionals',
          '/knowledge',
          '/news',
        ]) {
          addPath(paths, path, locale)
        }
        for (const path of LEGAL_PATHS) {
          addPath(paths, path, locale)
        }
      }

      for (const item of products) {
        if (item.title?.trim() && !item.seo?.noIndex) {
          if (!isArabic || hasArabicContentCompleteness(item)) {
            addPath(paths, `/products/${item.slug}`, locale)
          }
        }
      }

      for (const item of projects) {
        if (item.title?.trim() && !item.seo?.noIndex) {
          if (!isArabic || hasArabicContentCompleteness(item)) {
            addPath(paths, `/projects/${item.slug}`, locale)
          }
        }
      }

      for (const item of posts) {
        if (item.title?.trim() && !item.seo?.noIndex) {
          if (!isArabic || hasArabicContentCompleteness(item)) {
            const section = item.contentType === 'knowledge' ? 'knowledge' : 'news'
            addPath(paths, `/${section}/${item.slug}`, locale)
          }
        }
      }
    }),
  )

  return [...paths.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .flatMap(([path, locales]) => {
      const languages = Object.fromEntries(
        PUBLIC_LOCALES.filter((locale) => locales.has(locale)).map((locale) => [
          locale,
          absoluteURL(localePath(locale, path), origin),
        ]),
      )
      if (locales.has('en')) languages['x-default'] = absoluteURL(localePath('en', path), origin)

      return PUBLIC_LOCALES.filter((locale) => locales.has(locale)).map((locale) => ({
        alternates: { languages },
        changeFrequency: path === '/' ? ('weekly' as const) : ('monthly' as const),
        priority: path === '/' ? 1 : path.split('/').length === 2 ? 0.8 : 0.7,
        url: absoluteURL(localePath(locale, path), origin),
      }))
    })
}
