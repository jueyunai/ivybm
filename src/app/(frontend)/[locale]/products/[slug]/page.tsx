import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import React from 'react'

import { JsonLd } from '@/components/website/JsonLd'
import { PageHero } from '@/components/website/PageHero'
import { ProductGallery } from '@/components/website/ProductGallery'
import { RichText } from '@/components/website/RichText'
import { SpecificationTable } from '@/components/website/Cards'
import { isPublicLocale } from '@/lib/i18n'
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
          <div>
            <h2>{product.title}</h2>
            {product.shortDescription ? <p className="muted">{product.shortDescription}</p> : null}
            {product.specifications?.length ? (
              <SpecificationTable rows={product.specifications} />
            ) : null}
            <RichText data={product.description} />
          </div>
        </div>
      </section>
    </>
  )
}
