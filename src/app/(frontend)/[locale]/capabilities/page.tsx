import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import React from 'react'

import { CapabilitiesView } from '@/components/website/CapabilitiesView'
import { isPublicLocale, type Locale } from '@/lib/i18n'
import { buildPageMetadata } from '@/lib/seo'
import { getPageBySlug, getSiteSettings } from '@/lib/website-data'
import { getWebsiteV17Copy } from '@/lib/website-i18n'

const loadCapabilities = async (locale: Locale) => {
  const [page, home, settings] = await Promise.all([
    getPageBySlug(locale, 'capabilities'),
    getPageBySlug(locale, 'home'),
    getSiteSettings(locale),
  ])
  return { home, page, settings }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale: value } = await params
  if (!isPublicLocale(value)) return {}
  const { home, page, settings } = await loadCapabilities(value)
  const copy = getWebsiteV17Copy(value)

  return buildPageMetadata({
    description: page?.summary || copy.pages.capabilitiesSubtitle,
    locale: value,
    media: page?.heroImage || home?.heroImage,
    path: '/capabilities',
    seo: page?.seo || settings.defaultSeo,
    siteName: settings.siteName,
    title: page?.title || copy.navigation.capabilities,
  })
}

export default async function CapabilitiesPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale: value } = await params
  if (!isPublicLocale(value)) notFound()
  const { home, page } = await loadCapabilities(value)

  return (
    <CapabilitiesView
      fallbackImage={home?.heroImage}
      locale={value}
      page={page}
    />
  )
}
