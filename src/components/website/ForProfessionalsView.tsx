import {
  IconArrowRight,
  IconBuildingFactory2,
  IconCheck,
  IconCompass,
  IconTruckDelivery,
} from '@tabler/icons-react'
import Link from 'next/link'
import React from 'react'

import { PageHero } from '@/components/website/PageHero'
import { SectionHeader } from '@/components/website/SectionHeader'
import { localePath, type Locale } from '@/lib/i18n'
import { getWebsiteV17Copy } from '@/lib/website-i18n'
import type { Media, Page } from '@/payload-types'

const roleIcons = [IconCompass, IconBuildingFactory2, IconTruckDelivery]

export function ForProfessionalsView({
  fallbackImage,
  locale,
  page,
}: {
  fallbackImage?: number | Media | null
  locale: Locale
  page?: Page | null
}) {
  const copy = getWebsiteV17Copy(locale)

  return (
    <>
      <PageHero
        image={page?.heroImage || fallbackImage}
        subtitle={page?.summary || copy.forProfessionals.subtitle}
        title={page?.title || copy.forProfessionals.title}
      />

      <section className="section">
        <div className="container">
          <div className="section-kicker">{copy.forProfessionals.kicker}</div>
          <h2>{copy.forProfessionals.title}</h2>
          <p className="muted max-w-prose">{copy.forProfessionals.subtitle}</p>

          <div className="professionals-grid">
            {copy.forProfessionals.roles.map((role, index) => {
              const Icon = roleIcons[index] || IconCompass
              return (
                <article className="role-card" data-testid="professional-role-card" key={role.id}>
                  <div className="capability-header">
                    <span className="role-badge">{role.badge}</span>
                    <Icon aria-hidden className="text-blue" size={26} stroke={1.6} />
                  </div>
                  <h3>{role.title}</h3>
                  <p className="muted">{role.description}</p>
                  <ul className="role-highlights">
                    {role.highlights.map((highlight, hIndex) => (
                      <li key={hIndex}>
                        <IconCheck aria-hidden className="inline-icon text-green" size={16} stroke={2.4} />
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

      <section className="section feature-band">
        <div className="container">
          <SectionHeader
            action={
              <Link className="button" href={localePath(locale, '/contact')}>
                {copy.forProfessionals.ctaButton}
              </Link>
            }
            description={copy.forProfessionals.ctaSubtitle}
            kicker={copy.forProfessionals.kicker}
            title={copy.forProfessionals.ctaTitle}
          />
        </div>
      </section>
    </>
  )
}
