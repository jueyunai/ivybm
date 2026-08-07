import type { Metadata } from 'next'
import Link from 'next/link'
import React from 'react'

import { getLegalDocument, type LegalDocumentType } from '@/lib/legal'
import { localePath, type Locale } from '@/lib/i18n'
import { buildPageMetadata } from '@/lib/seo'
import { getSiteSettings } from '@/lib/website-data'

import { PageHero } from './PageHero'

export async function generateLegalMetadata(
  locale: Locale,
  type: LegalDocumentType,
): Promise<Metadata> {
  const [document, settings] = await Promise.all([
    Promise.resolve(getLegalDocument(locale, type)),
    getSiteSettings(locale),
  ])
  return buildPageMetadata({
    description: document.description,
    locale,
    path: `/${type}`,
    siteName: settings.siteName,
    title: document.title,
  })
}

export async function LegalPage({ locale, type }: { locale: Locale; type: LegalDocumentType }) {
  const [document, settings] = await Promise.all([
    Promise.resolve(getLegalDocument(locale, type)),
    getSiteSettings(locale),
  ])
  const contactEmail = settings.contact?.email?.trim()

  return (
    <>
      <PageHero subtitle={document.description} title={document.title} />
      <section className="section">
        <article className="container article-content legal-document">
          <p className="legal-document__effective-date">
            <strong>{document.effectiveDateLabel}:</strong> {document.effectiveDate}
          </p>
          {document.sections.map((section) => (
            <section className="legal-document__section" key={section.title}>
              <h2>{section.title}</h2>
              {section.paragraphs.map((paragraph) => (
                <p key={paragraph}>{paragraph}</p>
              ))}
              {section.items ? (
                <ul>
                  {section.items.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              ) : null}
              {section.steps ? (
                <ol>
                  {section.steps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
              ) : null}
            </section>
          ))}
          <aside className="legal-document__contact">
            <strong>{document.contactLabel}:</strong>{' '}
            {contactEmail ? (
              <a href={`mailto:${contactEmail}`}>{contactEmail}</a>
            ) : (
              <Link href={localePath(locale, '/contact')}>{localePath(locale, '/contact')}</Link>
            )}
          </aside>
        </article>
      </section>
    </>
  )
}
