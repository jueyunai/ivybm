import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import React from 'react'

import { KnowledgeView } from '@/components/website/KnowledgeView'
import { isPublicLocale, type Locale } from '@/lib/i18n'
import { buildPageMetadata } from '@/lib/seo'
import { getPosts, getSiteSettings } from '@/lib/website-data'
import { getWebsiteV17Copy } from '@/lib/website-i18n'

const loadKnowledgePosts = async (locale: Locale) => {
  const [posts, settings] = await Promise.all([
    getPosts(locale, { contentType: 'knowledge' }),
    getSiteSettings(locale),
  ])
  return { posts, settings }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale: value } = await params
  if (!isPublicLocale(value)) return {}
  const { posts, settings } = await loadKnowledgePosts(value)
  const copy = getWebsiteV17Copy(value)

  return buildPageMetadata({
    description: copy.pages.knowledgeSubtitle,
    locale: value,
    media: posts[0]?.featuredImage,
    path: '/knowledge',
    seo: settings.defaultSeo,
    siteName: settings.siteName,
    title: copy.navigation.knowledge,
  })
}

export default async function KnowledgePage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale: value } = await params
  if (!isPublicLocale(value)) notFound()
  const { posts } = await loadKnowledgePosts(value)

  return <KnowledgeView locale={value} posts={posts} />
}
