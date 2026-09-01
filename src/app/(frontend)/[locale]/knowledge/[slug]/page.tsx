import { IconArrowLeft, IconSend } from '@tabler/icons-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import React from 'react'

import { JsonLd } from '@/components/website/JsonLd'
import { PageHero } from '@/components/website/PageHero'
import { RichText } from '@/components/website/RichText'
import { getPostCategoryLabel, isPublicLocale, localePath } from '@/lib/i18n'
import { buildArticleJsonLd, buildPageMetadata, getMediaURL } from '@/lib/seo'
import { getPostBySlug, getSiteSettings } from '@/lib/website-data'
import { getWebsiteV17Copy } from '@/lib/website-i18n'

const loadKnowledgePost = async (locale: 'ar' | 'en', slug: string) => {
  const [post, settings] = await Promise.all([
    getPostBySlug(locale, slug, { contentType: 'knowledge' }),
    getSiteSettings(locale),
  ])
  return { post, settings }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>
}): Promise<Metadata> {
  const { locale, slug } = await params
  if (!isPublicLocale(locale)) return {}
  const { post, settings } = await loadKnowledgePost(locale, slug)
  if (!post) notFound()

  return buildPageMetadata({
    description: post.excerpt,
    locale,
    media: post.featuredImage,
    path: `/knowledge/${slug}`,
    seo: post.seo,
    siteName: settings.siteName,
    title: post.title,
  })
}

export default async function KnowledgeDetailPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>
}) {
  const { locale, slug } = await params
  if (!isPublicLocale(locale)) notFound()
  const { post } = await loadKnowledgePost(locale, slug)
  if (!post) notFound()
  const copy = getWebsiteV17Copy(locale)

  const jsonLd = buildArticleJsonLd({
    datePublished: post.publishedAt,
    description: post.excerpt,
    image: getMediaURL(post.featuredImage, 'large'),
    locale,
    path: `/knowledge/${slug}`,
    title: post.title,
  })

  return (
    <>
      <JsonLd data={jsonLd} />
      <PageHero image={post.featuredImage} subtitle={post.excerpt} title={post.title} />

      <article className="section">
        <div className="container knowledge-detail-wrap">
          <div className="knowledge-detail-header">
            <Link className="text-link mb-4 inline-flex" href={localePath(locale, '/knowledge')}>
              <IconArrowLeft aria-hidden size={17} />
              {copy.knowledge.backToKnowledge}
            </Link>
            <div className="knowledge-meta mt-2">
              <span className="knowledge-badge">{getPostCategoryLabel(locale, post.category)}</span>
              {post.publishedAt ? (
                <span className="ltr-text" dir="ltr">
                  {new Intl.DateTimeFormat(locale).format(new Date(post.publishedAt))}
                </span>
              ) : null}
            </div>
          </div>

          <div className="article-content">
            <RichText data={post.content} />
          </div>

          <div className="knowledge-consult-box">
            <h3>{copy.knowledge.consultTitle}</h3>
            <p className="muted">{copy.knowledge.consultSubtitle}</p>
            <Link className="button mt-4" href={localePath(locale, '/contact')}>
              <IconSend aria-hidden size={18} />
              {copy.knowledge.consultButton}
            </Link>
          </div>
        </div>
      </article>
    </>
  )
}
