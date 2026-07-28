import type { Product, ProductCategory } from '@/payload-types'

const categoryKeys = (category: Product['category']): string[] => {
  if (typeof category === 'object' && category) {
    return [String(category.id), category.slug].filter(Boolean)
  }

  return [String(category)]
}

export const selectProductCategories = (
  categories: ProductCategory[],
  products: Product[],
): ProductCategory[] => {
  const referenced = new Set(products.flatMap((product) => categoryKeys(product.category)))
  const seenSlugs = new Set<string>()

  return categories.filter((category) => {
    if (!referenced.has(String(category.id)) && !referenced.has(category.slug)) return false
    if (seenSlugs.has(category.slug)) return false

    seenSlugs.add(category.slug)
    return true
  })
}
