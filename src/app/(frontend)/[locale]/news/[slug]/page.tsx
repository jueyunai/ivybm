import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import React from 'react'

import { ComparisonTable } from '@/components/website/Cards'
import { JsonLd } from '@/components/website/JsonLd'
import { PageHero } from '@/components/website/PageHero'
import { RichText } from '@/components/website/RichText'
import { WebsiteImage } from '@/components/website/WebsiteImage'
import { getPostCategoryLabel, isPublicLocale } from '@/lib/i18n'
import { getLegacyArticleReference } from '@/lib/legacy-article-reference'
import { buildArticleJsonLd, buildPageMetadata, getMediaURL } from '@/lib/seo'
import { getPostBySlug, getSiteSettings } from '@/lib/website-data'

const loadPost = async (locale: 'ar' | 'en', slug: string) => {
  const [post, settings] = await Promise.all([getPostBySlug(locale, slug), getSiteSettings(locale)])
  return { post, settings }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>
}): Promise<Metadata> {
  const { locale, slug } = await params
  if (!isPublicLocale(locale)) return {}
  const { post, settings } = await loadPost(locale, slug)
  if (!post) notFound()
  return buildPageMetadata({ description: post.excerpt, locale, media: post.featuredImage, path: `/news/${slug}`, seo: post.seo, siteName: settings.siteName, title: post.title })
}

export default async function PostDetailPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>
}) {
  const { locale, slug } = await params
  if (!isPublicLocale(locale)) notFound()
  const { post } = await loadPost(locale, slug)
  if (!post) notFound()
  const legacyReference = getLegacyArticleReference(locale, slug)
  const jsonLd = buildArticleJsonLd({
    datePublished: post.publishedAt,
    description: post.excerpt,
    image: getMediaURL(post.featuredImage, 'large'),
    locale,
    path: `/news/${slug}`,
    title: post.title,
  })

  return (
    <>
      <JsonLd data={jsonLd} />
      <PageHero image={post.featuredImage} subtitle={post.excerpt} title={post.title} />
      <article className="section">
        <div className="container article-content">
          <p className="section-kicker">
            {getPostCategoryLabel(locale, post.category)}
            {post.publishedAt
              ? ` · ${new Intl.DateTimeFormat(locale).format(new Date(post.publishedAt))}`
              : ''}
          </p>
          {legacyReference ? (
            <section aria-labelledby="legacy-article-reference" className="article-reference-block">
              <figure className="article-inline-figure">
                <WebsiteImage
                  alt={legacyReference.imageAlt}
                  className="article-inline-image"
                  media={post.featuredImage}
                  sizes="(max-width: 860px) 100vw, 820px"
                  type="original"
                />
                <figcaption>{legacyReference.imageCaption}</figcaption>
              </figure>
              <h2 id="legacy-article-reference">{legacyReference.title}</h2>
              <p className="article-source-note">{legacyReference.note}</p>
              <ComparisonTable
                caption={legacyReference.caption}
                headers={legacyReference.headers}
                rows={legacyReference.rows.map((row) => [row.nominal, row.actual])}
              />
            </section>
          ) : null}
          <RichText data={post.content} />
        </div>
      </article>
    </>
  )
}
