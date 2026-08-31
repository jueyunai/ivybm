import {
  IconArrowRight,
  IconBuildingFactory2,
  IconCheck,
  IconCompass,
  IconCube3dSphere,
  IconFlame,
  IconPackageExport,
  IconTools,
  IconTruckDelivery,
} from '@tabler/icons-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import React from 'react'

import { ProductCard, ProjectCard } from '@/components/website/Cards'
import { HeroCarousel } from '@/components/website/HeroCarousel'
import { SectionHeader } from '@/components/website/SectionHeader'
import { isPublicLocale, localePath, type Locale } from '@/lib/i18n'
import { buildPageMetadata } from '@/lib/seo'
import {
  getPageBySlug,
  getProducts,
  getProjects,
  getSiteSettings,
} from '@/lib/website-data'
import { getWebsiteV17Copy } from '@/lib/website-i18n'

const stepIcons = [IconCube3dSphere, IconFlame, IconTools, IconPackageExport]
const roleIcons = [IconCompass, IconBuildingFactory2, IconTruckDelivery]

const loadHome = async (locale: Locale) => {
  const [page, products, projects, settings] = await Promise.all([
    getPageBySlug(locale, 'home'),
    getProducts(locale),
    getProjects(locale),
    getSiteSettings(locale),
  ])

  return { page, products, projects, settings }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale: value } = await params
  if (!isPublicLocale(value)) return {}
  const { page, settings } = await loadHome(value)
  const copy = getWebsiteV17Copy(value)

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
  const copy = getWebsiteV17Copy(locale)

  const heroImages = [
    page.heroImage,
    ...products.slice(0, 2).map((product) => product.coverImage),
    ...projects.slice(0, 1).map((project) => project.coverImage),
  ]

  return (
    <>
      {/* 1. Hero */}
      <HeroCarousel
        images={heroImages}
        locale={locale}
        subtitle={page.summary}
        title={copy.home.heroTitle}
      />

      {/* 2. "How IVY supports your project" 4-Step Engineering Workflow */}
      <section className="section">
        <div className="container">
          <SectionHeader
            action={
              <Link className="button ghost" href={localePath(locale, '/capabilities')}>
                {copy.actions.learnMore}
                <IconArrowRight aria-hidden size={17} />
              </Link>
            }
            description={copy.home.howIvySupportsSubtitle}
            kicker={copy.home.howIvySupportsKicker}
            title={copy.home.howIvySupportsTitle}
          />
          <div className="capabilities-workflow">
            {copy.capabilities.items.map((item, index) => {
              const Icon = stepIcons[index] || IconTools
              return (
                <article className="capability-card" data-testid="workflow-step-card" key={item.id}>
                  <div className="capability-header">
                    <span className="capability-step" dir="ltr">
                      {item.step}
                    </span>
                    <Icon aria-hidden className="text-blue" size={26} stroke={1.6} />
                  </div>
                  <h3>{item.title}</h3>
                  <p className="muted">{item.description}</p>
                  <ul className="capability-features">
                    {item.features.slice(0, 2).map((feat, fIdx) => (
                      <li key={fIdx}>
                        <IconCheck aria-hidden className="inline-icon text-green" size={15} stroke={2.4} />
                        <span>{feat}</span>
                      </li>
                    ))}
                  </ul>
                </article>
              )
            })}
          </div>
        </div>
      </section>

      {/* 3. Core Craftsmanship & Engineering Values (Neutral Craftsmanship) */}
      <section className="section alt">
        <div className="container">
          <SectionHeader
            description={copy.home.coreCapabilitiesSubtitle}
            kicker={copy.home.coreCapabilitiesKicker}
            title={copy.home.coreCapabilitiesTitle}
          />
          <div className="stats">
            {copy.capabilities.stats.map(([statTitle, statDesc]) => (
              <div className="stat" key={statTitle}>
                <strong>{statTitle}</strong>
                <span>{statDesc}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 4. For Professionals 3 Role Pillars */}
      <section className="section">
        <div className="container">
          <SectionHeader
            action={
              <Link className="button ghost" href={localePath(locale, '/for-professionals')}>
                {copy.actions.learnMore}
                <IconArrowRight aria-hidden size={17} />
              </Link>
            }
            description={copy.home.professionalsSubtitle}
            kicker={copy.home.professionalsKicker}
            title={copy.home.professionalsTitle}
          />
          <div className="professionals-grid">
            {copy.forProfessionals.roles.map((role, index) => {
              const Icon = roleIcons[index] || IconCompass
              return (
                <article className="role-card" data-testid="home-role-card" key={role.id}>
                  <div className="capability-header">
                    <span className="role-badge">{role.badge}</span>
                    <Icon aria-hidden className="text-blue" size={24} stroke={1.6} />
                  </div>
                  <h3>{role.title}</h3>
                  <p className="muted">{role.description}</p>
                  <ul className="role-highlights">
                    {role.highlights.slice(0, 2).map((highlight, hIndex) => (
                      <li key={hIndex}>
                        <IconCheck aria-hidden className="inline-icon text-green" size={15} stroke={2.4} />
                        <span>{highlight}</span>
                      </li>
                    ))}
                  </ul>
                  <div className="role-card-action">
                    <Link className="text-link" href={localePath(locale, '/contact')}>
                      {copy.actions.buildabilityReview}
                      <IconArrowRight aria-hidden size={17} />
                    </Link>
                  </div>
                </article>
              )
            })}
          </div>
        </div>
      </section>

      {/* 5. Product Categories */}
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

      {/* 6. Featured Projects */}
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

      {/* 7. Final Buildability Review / Upload Drawing CTA */}
      <section className="section feature-band">
        <div className="container">
          <SectionHeader
            action={
              <Link className="button" href={localePath(locale, '/contact')}>
                {copy.actions.uploadDrawing}
                <IconArrowRight aria-hidden size={19} />
              </Link>
            }
            description={copy.home.ctaSubtitle}
            kicker={copy.home.ctaKicker}
            title={copy.home.ctaTitle}
          />
        </div>
      </section>
    </>
  )
}
