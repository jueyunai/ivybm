import {
  IconCheck,
  IconCube3dSphere,
  IconFlame,
  IconPackageExport,
  IconTools,
} from '@tabler/icons-react'
import Link from 'next/link'
import React from 'react'

import { PageHero } from '@/components/website/PageHero'
import { SectionHeader } from '@/components/website/SectionHeader'
import { localePath, type Locale } from '@/lib/i18n'
import { getWebsiteV17Copy } from '@/lib/website-i18n'
import type { Media, Page } from '@/payload-types'

const stepIcons = [IconCube3dSphere, IconFlame, IconTools, IconPackageExport]

export function CapabilitiesView({
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
        subtitle={page?.summary || copy.capabilities.subtitle}
        title={page?.title || copy.capabilities.title}
      />

      <section className="section">
        <div className="container">
          <div className="section-kicker">{copy.capabilities.kicker}</div>
          <h2>{copy.capabilities.title}</h2>
          <p className="muted max-w-prose">{copy.capabilities.subtitle}</p>

          <div className="capabilities-workflow">
            {copy.capabilities.items.map((item, index) => {
              const Icon = stepIcons[index] || IconTools
              return (
                <article className="capability-card" data-testid="capability-card" key={item.id}>
                  <div className="capability-header">
                    <span className="capability-step" dir="ltr">
                      {item.step}
                    </span>
                    <Icon aria-hidden className="text-blue" size={28} stroke={1.6} />
                  </div>
                  <h3>{item.title}</h3>
                  <p className="muted">{item.description}</p>
                  <ul className="capability-features">
                    {item.features.map((feature, fIndex) => (
                      <li key={fIndex}>
                        <IconCheck aria-hidden className="inline-icon text-green" size={16} stroke={2.4} />
                        <span>{feature}</span>
                      </li>
                    ))}
                  </ul>
                </article>
              )
            })}
          </div>

          <div className="stats">
            {copy.capabilities.stats.map(([statVal, statLabel]) => (
              <div className="stat" key={statLabel}>
                <strong className="ltr-text" dir="ltr">
                  {statVal}
                </strong>
                <span>{statLabel}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section feature-band">
        <div className="container">
          <SectionHeader
            action={
              <Link className="button" href={localePath(locale, '/contact')}>
                {copy.capabilities.ctaButton}
              </Link>
            }
            description={copy.capabilities.ctaSubtitle}
            kicker={copy.capabilities.kicker}
            title={copy.capabilities.ctaTitle}
          />
        </div>
      </section>
    </>
  )
}
