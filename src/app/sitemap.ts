import type { MetadataRoute } from 'next'

import { localePath, type Locale, PUBLIC_LOCALES } from '@/lib/i18n'
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

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const origin = getSiteOrigin()
  const paths = new Map<string, Set<Locale>>()

  await Promise.all(
    PUBLIC_LOCALES.map(async (locale) => {
      const [home, about, contact, products, projects, posts, settings] = await Promise.all([
        getPageBySlug(locale, 'home'),
        getPageBySlug(locale, 'about'),
        getPageBySlug(locale, 'contact'),
        getProducts(locale),
        getProjects(locale),
        getPosts(locale),
        getSiteSettings(locale),
      ])

      for (const [path, page] of [
        ['/', home],
        ['/about', about],
        ['/contact', contact],
      ] as const) {
        if (page?.title?.trim() && !page.seo?.noIndex) addPath(paths, path, locale)
      }

      if (!settings.defaultSeo?.noIndex) {
        for (const path of ['/products', '/projects', '/news']) addPath(paths, path, locale)
      }

      for (const item of products) {
        if (item.title?.trim() && !item.seo?.noIndex) addPath(paths, `/products/${item.slug}`, locale)
      }
      for (const item of projects) {
        if (item.title?.trim() && !item.seo?.noIndex) addPath(paths, `/projects/${item.slug}`, locale)
      }
      for (const item of posts) {
        if (item.title?.trim() && !item.seo?.noIndex) addPath(paths, `/news/${item.slug}`, locale)
      }
    }),
  )

  return [...paths.entries()].sort(([left], [right]) => left.localeCompare(right)).flatMap(([path, locales]) => {
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
