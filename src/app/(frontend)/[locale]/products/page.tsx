import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import React from 'react'

import { PageHero } from '@/components/website/PageHero'
import { ProductFilter } from '@/components/website/ProductFilter'
import { getWebsiteCopy, isPublicLocale, type Locale } from '@/lib/i18n'
import { buildPageMetadata } from '@/lib/seo'
import { getProductCategories, getProducts, getSiteSettings } from '@/lib/website-data'

const loadProducts = async (locale: Locale) => {
  const [categories, products, settings] = await Promise.all([
    getProductCategories(locale),
    getProducts(locale),
    getSiteSettings(locale),
  ])
  return { categories, products, settings }
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale: value } = await params
  if (!isPublicLocale(value)) return {}
  const { products, settings } = await loadProducts(value)
  const copy = getWebsiteCopy(value)

  return buildPageMetadata({
    description: copy.pages.productsSubtitle,
    locale: value,
    media: products[0]?.coverImage,
    path: '/products',
    seo: settings.defaultSeo,
    siteName: settings.siteName,
    title: copy.navigation.products,
  })
}

export default async function ProductsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ category?: string | string[] }>
}) {
  const { locale: value } = await params
  if (!isPublicLocale(value)) notFound()
  const { categories, products } = await loadProducts(value)
  const copy = getWebsiteCopy(value)
  const requestedCategory = (await searchParams).category
  const initialCategory = typeof requestedCategory === 'string' ? requestedCategory : undefined

  return (
    <>
      <PageHero image={products[0]?.coverImage} subtitle={copy.pages.productsSubtitle} title={copy.navigation.products} />
      <section className="section">
        <div className="container">
          <ProductFilter
            categories={categories}
            initialCategory={initialCategory}
            key={initialCategory ?? 'all'}
            locale={value}
            products={products}
          />
        </div>
      </section>
    </>
  )
}
