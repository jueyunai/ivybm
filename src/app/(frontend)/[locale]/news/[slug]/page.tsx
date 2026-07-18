import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import React from 'react'

import { JsonLd } from '@/components/website/JsonLd'
import { PageHero } from '@/components/website/PageHero'
import { RichText } from '@/components/website/RichText'
import { getPostCategoryLabel, isPublicLocale } from '@/lib/i18n'
import { buildArticleJsonLd, buildPageMetadata, getMediaURL } from '@/lib/seo'
import { getPostBySlug, getSiteSettings } from '@/lib/website-data'

const loadPost = async (locale: 'ar' | 'en', slug: string) => {
  const [post, settings] = await Promise.all([getPostBySlug(locale, slug), getSiteSettings(locale)])
  return { post, settings }
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string; slug: string }> }): Promise<Metadata> {
  const { locale, slug } = await params
  if (!isPublicLocale(locale)) return {}
  const { post, settings } = await loadPost(locale, slug)
  if (!post) notFound()
  return buildPageMetadata({ description: post.excerpt, locale, media: post.featuredImage, path: `/news/${slug}`, seo: post.seo, siteName: settings.siteName, title: post.title })
}

export default async function PostDetailPage({ params }: { params: Promise<{ locale: string; slug: string }> }) {
  const { locale, slug } = await params
  if (!isPublicLocale(locale)) notFound()
  const { post } = await loadPost(locale, slug)
  if (!post) notFound()
  const jsonLd = buildArticleJsonLd({ datePublished: post.publishedAt, description: post.excerpt, image: getMediaURL(post.featuredImage, 'large'), locale, path: `/news/${slug}`, title: post.title })
  return <><JsonLd data={jsonLd} /><PageHero image={post.featuredImage} subtitle={post.excerpt} title={post.title} /><article className="section"><div className="container article-content"><p className="section-kicker">{getPostCategoryLabel(locale, post.category)}{post.publishedAt ? ` · ${new Intl.DateTimeFormat(locale).format(new Date(post.publishedAt))}` : ''}</p><RichText data={post.content} /></div></article></>
}
