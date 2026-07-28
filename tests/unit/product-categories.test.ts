import { describe, expect, it } from 'vitest'

import { selectProductCategories } from '@/lib/product-categories'
import type { Product, ProductCategory } from '@/payload-types'

const category = (id: number, slug: string, title: string): ProductCategory =>
  ({ id, slug, title }) as ProductCategory

const product = (id: number, productCategory: Product['category']): Product =>
  ({ category: productCategory, id }) as Product

describe('selectProductCategories', () => {
  it('keeps only categories referenced by visible products and removes duplicate slugs', () => {
    const doubleCurved = category(1, 'double-curved', 'Double-Curved')
    const singleCurved = category(2, 'single-curved', 'Single-Curved')
    const standardFacade = category(3, 'aluminum-panels', 'Standard Facade')
    const polluted = category(99, 'operator-managed-category', 'Operator Managed Category')

    const result = selectProductCategories(
      [
        polluted,
        doubleCurved,
        singleCurved,
        standardFacade,
        category(4, 'double-curved', 'Duplicate'),
      ],
      [product(1, doubleCurved), product(2, singleCurved), product(3, standardFacade)],
    )

    expect(result.map(({ slug }) => slug)).toEqual([
      'double-curved',
      'single-curved',
      'aluminum-panels',
    ])
  })

  it('matches unresolved product relationships by category id', () => {
    const doubleCurved = category(11, 'double-curved', 'Double-Curved')

    expect(selectProductCategories([doubleCurved], [product(1, 11)])).toEqual([doubleCurved])
  })
})
