'use client'

import React, { useState } from 'react'

import { ProductCard } from '@/components/website/Cards'
import { getWebsiteCopy, type Locale } from '@/lib/i18n'
import { selectProductCategories } from '@/lib/product-categories'
import type { Product, ProductCategory } from '@/payload-types'

export function ProductFilter({
  categories,
  initialCategory,
  locale,
  products,
}: {
  categories: ProductCategory[]
  initialCategory?: string
  locale: Locale
  products: Product[]
}) {
  const copy = getWebsiteCopy(locale)
  const [active, setActive] = useState(initialCategory ?? 'all')
  const availableCategories = selectProductCategories(categories, products)
  const selectedCategory =
    active === 'all' || availableCategories.some((category) => category.slug === active)
      ? active
      : 'all'

  const filtered =
    selectedCategory === 'all'
      ? products
      : products.filter((product) => {
          const category =
            typeof product.category === 'object' ? product.category.slug : String(product.category)
          return category === selectedCategory
        })

  return (
    <>
      <div className="tabs product-tabs" role="group" aria-label={copy.navigation.products}>
        <button
          aria-controls="product-grid"
          aria-pressed={selectedCategory === 'all'}
          className="tab"
          data-active={selectedCategory === 'all'}
          onClick={() => setActive('all')}
          type="button"
        >
          {copy.tabs.all}
        </button>
        {availableCategories.map((category) => (
          <button
            aria-controls="product-grid"
            aria-pressed={selectedCategory === category.slug}
            className="tab"
            data-active={selectedCategory === category.slug}
            key={category.id}
            onClick={() => setActive(category.slug)}
            type="button"
          >
            {category.title}
          </button>
        ))}
      </div>
      <div className="grid cols-3" id="product-grid">
        {filtered.map((product) => (
          <ProductCard key={product.id} locale={locale} product={product} showSpecs />
        ))}
      </div>
    </>
  )
}
