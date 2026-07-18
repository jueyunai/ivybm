'use client'

import React, { useState } from 'react'

import { ProductCard } from '@/components/website/Cards'
import { getWebsiteCopy, type Locale } from '@/lib/i18n'
import type { Product, ProductCategory } from '@/payload-types'

export function ProductFilter({
  categories,
  locale,
  products,
}: {
  categories: ProductCategory[]
  locale: Locale
  products: Product[]
}) {
  const copy = getWebsiteCopy(locale)
  const [active, setActive] = useState('all')
  const filtered =
    active === 'all'
      ? products
      : products.filter((product) => {
          const category = typeof product.category === 'object' ? product.category.slug : String(product.category)
          return category === active
        })

  return (
    <>
      <div className="tabs" role="group" aria-label={copy.navigation.products}>
        <button className="tab" data-active={active === 'all'} onClick={() => setActive('all')} type="button">
          {copy.tabs.all}
        </button>
        {categories.map((category) => (
          <button
            className="tab"
            data-active={active === category.slug}
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
