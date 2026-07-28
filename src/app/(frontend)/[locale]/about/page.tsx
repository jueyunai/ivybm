import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import React from 'react'

import { PageHero } from '@/components/website/PageHero'
import { RichText } from '@/components/website/RichText'
import { SectionHeader } from '@/components/website/SectionHeader'
import { WebsiteImage } from '@/components/website/WebsiteImage'
import { getWebsiteCopy, isPublicLocale, localePath, type Locale } from '@/lib/i18n'
import { isImageMedia } from '@/lib/media'
import { buildPageMetadata } from '@/lib/seo'
import { getPageBySlug, getProducts, getProjects, getSiteSettings } from '@/lib/website-data'
import type { Media } from '@/payload-types'

const loadAbout = async (locale: Locale) => {
  const [page, home, products, projects, settings] = await Promise.all([
    getPageBySlug(locale, 'about'),
    getPageBySlug(locale, 'home'),
    getProducts(locale),
    getProjects(locale),
    getSiteSettings(locale),
  ])
  return { home, page, products, projects, settings }
}

type RichTextData = Record<string, unknown> | null | undefined

const splitBodyMedia = (data: RichTextData): { content: RichTextData; images: Media[] } => {
  if (!data || !('root' in data)) return { content: data, images: [] }

  const root = (data as { root?: unknown }).root
  if (!root || typeof root !== 'object' || !('children' in root)) {
    return { content: data, images: [] }
  }

  const children = (root as { children?: unknown }).children
  if (!Array.isArray(children)) return { content: data, images: [] }

  const images: Media[] = []
  const contentChildren = children.filter((node) => {
    if (!node || typeof node !== 'object' || !('type' in node) || node.type !== 'upload') {
      return true
    }

    const value = 'value' in node ? node.value : undefined
    if (isImageMedia(value as Media | number | null | undefined)) images.push(value)
    return false
  })

  return {
    content: {
      ...data,
      root: {
        ...root,
        children: contentChildren,
      },
    },
    images,
  }
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale: value } = await params
  if (!isPublicLocale(value)) return {}
  const { home, page, settings } = await loadAbout(value)
  const copy = getWebsiteCopy(value)

  return buildPageMetadata({
    description: page?.summary || copy.pages.aboutSubtitle,
    locale: value,
    media: page?.heroImage || home?.heroImage,
    path: '/about',
    seo: page?.seo || settings.defaultSeo,
    siteName: settings.siteName,
    title: page?.title || copy.navigation.about,
  })
}

export default async function AboutPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: value } = await params
  if (!isPublicLocale(value)) notFound()
  const { home, page, products, projects } = await loadAbout(value)
  if (!page) notFound()
  const copy = getWebsiteCopy(value)
  const { content, images: bodyImages } = splitBodyMedia(page.body)
  const fallbackGallery = [
    home?.heroImage,
    ...products.map((item) => item.coverImage),
    ...projects.map((item) => item.coverImage),
  ].filter(Boolean)
  const gallery = (bodyImages.length ? bodyImages : fallbackGallery).slice(0, 4)

  return (
    <>
      <PageHero image={page.heroImage || home?.heroImage} subtitle={page.summary || copy.pages.aboutSubtitle} title={page.title} />
      <section className="section">
        <div className="container grid cols-2 about-grid">
          <div>
            <div className="section-kicker">{copy.about.kicker}</div>
            <h2>{copy.about.title}</h2>
            <p className="muted">{copy.about.body}</p>
            <RichText data={content} />
            <div className="stats">
              {copy.about.stats.map(([valueText, label]) => (
                <div className="stat" key={label}>
                  <strong>{valueText}</strong>
                  <span>{label}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="grid cols-2 about-gallery">
            {gallery.map((image, index) => (
              <WebsiteImage className="about-image" key={index} media={image} sizes="(max-width: 640px) 100vw, 25vw" type="card" />
            ))}
          </div>
        </div>
      </section>
      <section className="section feature-band">
        <div className="container">
          <SectionHeader
            action={<Link className="button" href={localePath(value, '/contact')}>{copy.actions.contact}</Link>}
            description={copy.about.processDescription}
            kicker={copy.about.kicker}
            title={copy.about.processTitle}
          />
        </div>
      </section>
    </>
  )
}
