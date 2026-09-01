import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import React from 'react'

import { PostCard } from '@/components/website/Cards'
import { PageHero } from '@/components/website/PageHero'
import { getWebsiteCopy, isPublicLocale, type Locale } from '@/lib/i18n'
import { buildPageMetadata } from '@/lib/seo'
import { getPosts, getSiteSettings } from '@/lib/website-data'

const loadPosts = async (locale: Locale) => {
  const [posts, settings] = await Promise.all([
    getPosts(locale, { contentType: 'news' }),
    getSiteSettings(locale),
  ])
  return { posts, settings }
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale: value } = await params
  if (!isPublicLocale(value)) return {}
  const { posts, settings } = await loadPosts(value)
  const copy = getWebsiteCopy(value)
  return buildPageMetadata({ description: copy.pages.newsSubtitle, locale: value, media: posts[0]?.featuredImage, path: '/news', seo: settings.defaultSeo, siteName: settings.siteName, title: copy.navigation.news })
}

export default async function NewsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: value } = await params
  if (!isPublicLocale(value)) notFound()
  const { posts } = await loadPosts(value)
  const copy = getWebsiteCopy(value)
  return <><PageHero image={posts[0]?.featuredImage} subtitle={copy.pages.newsSubtitle} title={copy.navigation.news} /><section className="section"><div className="container"><div className="tabs"><span className="tab static-active">{copy.tabs.all}</span><span className="tab">{copy.tabs.industry}</span><span className="tab">{copy.tabs.company}</span><span className="tab">{copy.tabs.technical}</span></div><div className="grid cols-3">{posts.map((post) => <PostCard key={post.id} locale={value} post={post} />)}</div></div></section></>
}
