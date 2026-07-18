import type { Metadata } from 'next'

import type { Media } from '@/payload-types'

import { DEFAULT_LOCALE, localePath, type Locale, PUBLIC_LOCALES } from './i18n'
import { isImageMedia } from './media'

type MediaSize = 'card' | 'large' | 'original' | 'thumbnail'

type SEOData = {
  canonical?: null | string
  description?: null | string
  keywords?: null | string
  noIndex?: boolean | null
  ogImage?: Media | number | null
  title?: null | string
}

const DEFAULT_ORIGIN = 'http://localhost:3000'

export const getSiteOrigin = (value = process.env.NEXT_PUBLIC_SERVER_URL): URL => {
  if (!value?.trim()) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('NEXT_PUBLIC_SERVER_URL is required in production')
    }

    return new URL(DEFAULT_ORIGIN)
  }

  try {
    const origin = new URL(value)
    if (!['http:', 'https:'].includes(origin.protocol)) throw new Error('Unsupported URL protocol')
    return origin
  } catch (error) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('NEXT_PUBLIC_SERVER_URL must be an absolute HTTP(S) URL', { cause: error })
    }

    return new URL(DEFAULT_ORIGIN)
  }
}

export const absoluteURL = (value: string, origin?: string | URL): string => {
  try {
    return new URL(value).toString()
  } catch {
    return new URL(value.startsWith('/') ? value : `/${value}`, origin || getSiteOrigin()).toString()
  }
}

export const getMediaURL = (
  media: Media | number | null | undefined,
  size: MediaSize = 'original',
  origin?: string | URL,
): string | undefined => {
  if (!isImageMedia(media)) return undefined

  const sized = size === 'original' ? undefined : media.sizes?.[size]
  const value = sized?.url || media.url

  return value ? absoluteURL(value, origin) : undefined
}

const parseKeywords = (keywords?: null | string): string[] | undefined => {
  const values = keywords
    ?.split(',')
    .map((keyword) => keyword.trim())
    .filter(Boolean)

  return values?.length ? values : undefined
}

const alternateLanguages = (path: string, origin: string | URL) => {
  const languages = Object.fromEntries(
    PUBLIC_LOCALES.map((locale) => [locale, absoluteURL(localePath(locale, path), origin)]),
  ) as Record<Locale, string> & { 'x-default'?: string }

  languages['x-default'] = absoluteURL(localePath(DEFAULT_LOCALE, path), origin)

  return languages
}

export const buildPageMetadata = ({
  description,
  locale,
  media,
  origin = getSiteOrigin(),
  path,
  seo,
  siteName,
  title,
}: {
  description?: null | string
  locale: Locale
  media?: Media | number | null
  origin?: string | URL
  path: string
  seo?: SEOData | null
  siteName: string
  title: string
}): Metadata => {
  const resolvedTitle = seo?.title?.trim() || title
  const resolvedDescription = seo?.description?.trim() || description || undefined
  const localizedCanonical = localePath(locale, path)
  const canonical = seo?.canonical?.trim()
    ? absoluteURL(seo.canonical, origin)
    : absoluteURL(localizedCanonical, origin)
  const selectedMedia = seo?.ogImage || media
  const image = getMediaURL(selectedMedia, 'large', origin)
  const imageMedia = selectedMedia && typeof selectedMedia === 'object' ? selectedMedia : undefined

  return {
    alternates: {
      canonical,
      languages: alternateLanguages(path, origin),
    },
    description: resolvedDescription,
    keywords: parseKeywords(seo?.keywords),
    openGraph: {
      description: resolvedDescription,
      images: image
        ? [
            {
              alt: imageMedia?.alt || resolvedTitle,
              height: imageMedia?.sizes?.large?.height || imageMedia?.height || undefined,
              url: image,
              width: imageMedia?.sizes?.large?.width || imageMedia?.width || undefined,
            },
          ]
        : undefined,
      locale,
      siteName,
      title: resolvedTitle,
      type: 'website',
      url: canonical,
    },
    robots: seo?.noIndex ? { follow: false, index: false } : { follow: true, index: true },
    title: resolvedTitle === siteName ? resolvedTitle : `${resolvedTitle} | ${siteName}`,
  }
}

export const buildOrganizationJsonLd = ({
  description,
  email,
  locale,
  name,
  origin = getSiteOrigin(),
  phone,
  socialLinks = [],
}: {
  description?: null | string
  email?: null | string
  locale: Locale
  name: string
  origin?: string | URL
  phone?: null | string
  socialLinks?: string[]
}) => ({
  '@context': 'https://schema.org',
  '@type': 'Organization',
  ...(description ? { description } : {}),
  ...(email ? { email } : {}),
  name,
  ...(phone ? { telephone: phone } : {}),
  ...(socialLinks.length ? { sameAs: socialLinks } : {}),
  url: absoluteURL(localePath(locale), origin),
})

export const buildProductJsonLd = ({
  description,
  image,
  locale,
  name,
  origin = getSiteOrigin(),
  path,
}: {
  description?: null | string
  image?: string
  locale: Locale
  name: string
  origin?: string | URL
  path: string
}) => ({
  '@context': 'https://schema.org',
  '@type': 'Product',
  ...(description ? { description } : {}),
  ...(image ? { image } : {}),
  name,
  url: absoluteURL(localePath(locale, path), origin),
})

export const buildArticleJsonLd = ({
  datePublished,
  description,
  image,
  locale,
  origin = getSiteOrigin(),
  path,
  title,
}: {
  datePublished?: null | string
  description?: null | string
  image?: string
  locale: Locale
  origin?: string | URL
  path: string
  title: string
}) => ({
  '@context': 'https://schema.org',
  '@type': 'Article',
  ...(datePublished ? { datePublished } : {}),
  ...(description ? { description } : {}),
  headline: title,
  ...(image ? { image } : {}),
  mainEntityOfPage: absoluteURL(localePath(locale, path), origin),
})
