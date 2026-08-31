import { IconArrowRight, IconChecklist, IconCube3dSphere } from '@tabler/icons-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import React from 'react'

import { SpecificationTable } from '@/components/website/Cards'
import { JsonLd } from '@/components/website/JsonLd'
import { PageHero } from '@/components/website/PageHero'
import { ProductGallery } from '@/components/website/ProductGallery'
import { RichText } from '@/components/website/RichText'
import { WebsiteImage } from '@/components/website/WebsiteImage'
import { isPublicLocale } from '@/lib/i18n'
import { normalizeProductGallery } from '@/lib/product-gallery'
import { getProductProcurementContent } from '@/lib/product-procurement'
import { buildPageMetadata, buildProductJsonLd, getMediaURL } from '@/lib/seo'
import { getProductBySlug, getSiteSettings } from '@/lib/website-data'
import { getWebsiteV17Copy } from '@/lib/website-i18n'
import type { Product } from '@/payload-types'

type ProductV17Fields = Product & {
  disclaimer?: string | Record<string, unknown> | null
  engineeringWorkflow?:
    | string
    | Record<string, unknown>
    | Array<{ description?: string | null; step?: string | null; title?: string | null }>
    | null
  faqs?: Array<{ answer?: string | null; question?: string | null }> | null
}

const loadProduct = async (locale: 'ar' | 'en', slug: string) => {
  const [product, settings] = await Promise.all([
    getProductBySlug(locale, slug),
    getSiteSettings(locale),
  ])
  return { product: product as ProductV17Fields | null, settings }
}

function RenderContentField({ data }: { data: unknown }) {
  if (!data) return null
  if (typeof data === 'string' && data.trim()) {
    return <p className="muted pre-line">{data}</p>
  }
  if (typeof data === 'object' && 'root' in (data as Record<string, unknown>)) {
    return <RichText data={data as Record<string, unknown>} />
  }
  return null
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>
}): Promise<Metadata> {
  const { locale, slug } = await params
  if (!isPublicLocale(locale)) return {}
  const { product, settings } = await loadProduct(locale, slug)
  if (!product) notFound()

  return buildPageMetadata({
    description: product.shortDescription,
    locale,
    media: product.coverImage,
    path: `/products/${slug}`,
    seo: product.seo,
    siteName: settings.siteName,
    title: product.title,
  })
}

export default async function ProductDetailPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>
}) {
  const { locale, slug } = await params
  if (!isPublicLocale(locale)) notFound()
  const { product } = await loadProduct(locale, slug)
  if (!product) notFound()

  const copy = getWebsiteV17Copy(locale)
  const gallery = normalizeProductGallery(product.coverImage, product.gallery)
  const procurement = getProductProcurementContent(locale, slug)
  const storyImages = gallery.slice(1)

  const jsonLd = buildProductJsonLd({
    description: product.shortDescription,
    image: getMediaURL(product.coverImage, 'large'),
    locale,
    name: product.title,
    path: `/products/${slug}`,
  })

  // Dynamic CMS fields with fallback
  const hasCmsWorkflow = Boolean(product.engineeringWorkflow)
  const hasCmsDisclaimer = Boolean(product.disclaimer)
  const effectiveFaqs =
    product.faqs && product.faqs.length > 0
      ? product.faqs.filter(
          (faq): faq is { answer: string; question: string } =>
            Boolean(faq.question?.trim()) && Boolean(faq.answer?.trim()),
        )
      : procurement.faqs

  return (
    <>
      <JsonLd data={jsonLd} />
      <PageHero
        image={product.coverImage}
        subtitle={product.shortDescription}
        title={product.title}
      />
      <section className="section">
        <div className="container detail-grid">
          <div className="detail-media">
            <ProductGallery images={gallery} locale={locale} productTitle={product.title} />
          </div>
          <div className="product-summary">
            <p className="section-kicker">{procurement.procurementKicker}</p>
            <h2>{procurement.snapshotTitle}</h2>
            <p className="product-qualification-note">{procurement.snapshotNote}</p>
            {product.specifications?.length ? (
              <SpecificationTable
                caption={procurement.specificationCaption}
                rows={product.specifications}
              />
            ) : null}
            <Link className="button product-quote-button" href={procurement.quoteHref}>
              {copy.actions.uploadDrawing}
              <IconArrowRight aria-hidden size={19} />
            </Link>
          </div>
        </div>
      </section>
      <section className="section alt product-decision-section">
        <div className="container product-decision-layout">
          <article className="product-description-card">
            <RichText data={product.description} />

            {/* Engineering Workflow (CMS field prioritized, unified 4-step fallback) */}
            <section aria-labelledby="product-workflow-title" className="product-workflow-section">
              <h2 id="product-workflow-title">
                {locale === 'ar'
                  ? 'مسار العمل الهندسي وضبط التصنيع'
                  : 'Engineering Workflow & Production Control'}
              </h2>
              {hasCmsWorkflow ? (
                Array.isArray(product.engineeringWorkflow) ? (
                  <div className="capabilities-workflow">
                    {product.engineeringWorkflow.map((stepItem, idx) => (
                      <div className="capability-card" key={idx}>
                        <div className="capability-header">
                          <span className="capability-step" dir="ltr">
                            {stepItem.step || `0${idx + 1}`}
                          </span>
                          <IconCube3dSphere aria-hidden className="text-blue" size={24} />
                        </div>
                        {stepItem.title ? <h3>{stepItem.title}</h3> : null}
                        {stepItem.description ? <p className="muted">{stepItem.description}</p> : null}
                      </div>
                    ))}
                  </div>
                ) : (
                  <RenderContentField data={product.engineeringWorkflow} />
                )
              ) : (
                <div className="capabilities-workflow">
                  {copy.capabilities.items.map((item) => (
                    <div className="capability-card" key={item.id}>
                      <div className="capability-header">
                        <span className="capability-step" dir="ltr">
                          {item.step}
                        </span>
                        <IconCube3dSphere aria-hidden className="text-blue" size={24} />
                      </div>
                      <h3>{item.title}</h3>
                      <p className="muted">{item.description}</p>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {storyImages.length ? (
              <section aria-labelledby="product-story-title" className="product-story">
                <h2 id="product-story-title">{procurement.productStoryTitle}</h2>
                <div className="product-story-grid">
                  {storyImages.map((image, index) => {
                    const caption = procurement.storyCaptions[index] ?? image.alt
                    return (
                      <figure key={image.id ?? image.url ?? index}>
                        <WebsiteImage
                          alt={caption}
                          className="product-story-image"
                          media={image}
                          sizes="(max-width: 640px) 100vw, 38vw"
                          type="original"
                        />
                        <figcaption>{caption}</figcaption>
                      </figure>
                    )
                  })}
                </div>
              </section>
            ) : null}

            <section
              aria-labelledby="product-legacy-reference-title"
              className="product-legacy-reference"
            >
              <h2 id="product-legacy-reference-title">{procurement.legacyReferenceTitle}</h2>
              <p className="product-qualification-note">{procurement.legacyReferenceNote}</p>
              <SpecificationTable
                caption={procurement.legacyReferenceCaption}
                rows={[...procurement.legacyReferenceRows]}
              />

              {/* Disclaimer block (CMS field prioritized, safe fallback) */}
              <div className="product-disclaimer-box">
                {hasCmsDisclaimer ? (
                  <RenderContentField data={product.disclaimer} />
                ) : (
                  <p>{procurement.legacyReferenceNote}</p>
                )}
              </div>
            </section>
          </article>
          <aside className="product-procurement-aside">
            <section className="procurement-card">
              <IconChecklist aria-hidden size={30} stroke={1.6} />
              <h2>{procurement.quoteTitle}</h2>
              <p className="muted">{procurement.quoteBody}</p>
              <ul>
                {procurement.quoteItems.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
              <Link className="button" href={procurement.quoteHref}>
                {copy.actions.uploadDrawing}
                <IconArrowRight aria-hidden size={19} />
              </Link>
            </section>
            {procurement.evidence.length ? (
              <nav aria-label={procurement.evidenceTitle} className="product-evidence-card">
                <h2>{procurement.evidenceTitle}</h2>
                {procurement.evidence.map((item) => (
                  <Link className="text-link" href={item.href} key={item.href}>
                    {item.label}
                    <IconArrowRight aria-hidden size={17} />
                  </Link>
                ))}
              </nav>
            ) : null}
          </aside>
        </div>
        {effectiveFaqs.length ? (
          <div className="container product-faq">
            <h2>{procurement.faqTitle}</h2>
            <div className="product-faq-list">
              {effectiveFaqs.map((item) => (
                <details key={item.question}>
                  <summary>{item.question}</summary>
                  <p>{item.answer}</p>
                </details>
              ))}
            </div>
          </div>
        ) : null}
      </section>
    </>
  )
}
