import {
  IconBuildingFactory2,
  IconCertificate,
  IconSettings,
  IconShip,
} from '@tabler/icons-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import React from 'react'

import { ProductCard, ProjectCard } from '@/components/website/Cards'
import { HeroCarousel } from '@/components/website/HeroCarousel'
import { SectionHeader } from '@/components/website/SectionHeader'
import { getWebsiteCopy, isPublicLocale, localePath, type Locale } from '@/lib/i18n'
import { buildPageMetadata } from '@/lib/seo'
import {
  getPageBySlug,
  getProducts,
  getProjects,
  getSiteSettings,
} from '@/lib/website-data'

const valueIcons = [IconBuildingFactory2, IconSettings, IconShip, IconCertificate]

const loadHome = async (locale: Locale) => {
  const [page, products, projects, settings] = await Promise.all([
    getPageBySlug(locale, 'home'),
    getProducts(locale),
    getProjects(locale),
    getSiteSettings(locale),
  ])

  return { page, products, projects, settings }
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale: value } = await params
  if (!isPublicLocale(value)) return {}
  const { page, settings } = await loadHome(value)
  const copy = getWebsiteCopy(value)

  return buildPageMetadata({
    description: page?.summary || copy.home.heroSubtitle,
    locale: value,
    media: page?.heroImage,
    path: '/',
    seo: page?.seo || settings.defaultSeo,
    siteName: settings.siteName,
    title: copy.home.heroTitle,
  })
}

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: value } = await params
  if (!isPublicLocale(value)) notFound()
  const locale: Locale = value
  const { page, products, projects } = await loadHome(locale)
  if (!page) notFound()
  const copy = getWebsiteCopy(locale)
  const heroImages = [
    page.heroImage,
    ...products.slice(0, 2).map((product) => product.coverImage),
    ...projects.slice(0, 1).map((project) => project.coverImage),
  ]

  return (
    <>
      <HeroCarousel images={heroImages} locale={locale} subtitle={page.summary} title={copy.home.heroTitle} />
      <section className="section">
        <div className="container">
          <SectionHeader
            description={copy.home.advantagesSubtitle}
            kicker={copy.home.advantagesKicker}
            title={copy.home.advantagesTitle}
          />
          <div className="grid cols-4">
            {copy.home.values.map(([title, description], index) => {
              const Icon = valueIcons[index]
              return (
                <article className="value-card" key={title}>
                  <Icon aria-hidden size={30} stroke={1.7} />
                  <h3>{title}</h3>
                  <p className="muted">{description}</p>
                </article>
              )
            })}
          </div>
        </div>
      </section>
      <section className="section alt">
        <div className="container">
          <SectionHeader
            description={copy.home.productsSubtitle}
            kicker={copy.navigation.products}
            title={copy.home.productsTitle}
          />
          <div className="grid cols-3">
            {products.slice(0, 3).map((product) => (
              <ProductCard key={product.id} locale={locale} product={product} />
            ))}
          </div>
        </div>
      </section>
      <section className="section">
        <div className="container">
          <SectionHeader
            action={
              <Link className="button ghost" href={localePath(locale, '/projects')}>
                {copy.actions.allProjects}
              </Link>
            }
            description={copy.home.projectsSubtitle}
            kicker={copy.navigation.projects}
            title={copy.home.projectsTitle}
          />
          <div className="grid cols-3">
            {projects.slice(0, 6).map((project) => (
              <ProjectCard key={project.id} locale={locale} project={project} />
            ))}
          </div>
        </div>
      </section>
    </>
  )
}
