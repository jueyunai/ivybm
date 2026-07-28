import { IconArrowRight, IconChecklist } from '@tabler/icons-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import React from 'react'

import { JsonLd } from '@/components/website/JsonLd'
import { PageHero } from '@/components/website/PageHero'
import { ProductGallery } from '@/components/website/ProductGallery'
import { RichText } from '@/components/website/RichText'
import { SpecificationTable } from '@/components/website/Cards'
import { WebsiteImage } from '@/components/website/WebsiteImage'
import { isPublicLocale } from '@/lib/i18n'
import { getProductProcurementContent } from '@/lib/product-procurement'
import { normalizeProductGallery } from '@/lib/product-gallery'
import { buildPageMetadata, buildProductJsonLd, getMediaURL } from '@/lib/seo'
import { getProductBySlug, getSiteSettings } from '@/lib/website-data'

const loadProduct = async (locale: 'ar' | 'en', slug: string) => {
  const [product, settings] = await Promise.all([
    getProductBySlug(locale, slug),
    getSiteSettings(locale),
  ])
  return { product, settings }
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
              {procurement.quoteAction}
              <IconArrowRight aria-hidden size={19} />
            </Link>
          </div>
        </div>
      </section>
      <section className="section alt product-decision-section">
        <div className="container product-decision-layout">
          <article className="product-description-card">
            <RichText data={product.description} />
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
                {procurement.quoteAction}
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
        <div className="container product-faq">
          <h2>{procurement.faqTitle}</h2>
          <div className="product-faq-list">
            {procurement.faqs.map((item) => (
              <details key={item.question}>
                <summary>{item.question}</summary>
                <p>{item.answer}</p>
              </details>
            ))}
          </div>
        </div>
      </section>
    </>
  )
}
