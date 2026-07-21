import { cache } from 'react'
import { getPayload } from 'payload'

import type { Locale } from '@/lib/i18n'
import type { Page, Post, Product, ProductCategory, Project, SiteSetting } from '@/payload-types'
import config from '@/payload.config'

const getPayloadClient = cache(async () => getPayload({ config }))

export const getSiteSettings = cache(async (locale: Locale): Promise<SiteSetting> => {
  const payload = await getPayloadClient()

  return payload.findGlobal({
    depth: 1,
    fallbackLocale: false,
    locale,
    overrideAccess: false,
    slug: 'site-settings',
  })
})

export const getPageBySlug = cache(async (locale: Locale, slug: string): Promise<null | Page> => {
  const payload = await getPayloadClient()
  const result = await payload.find({
    collection: 'pages',
    depth: 1,
    draft: false,
    fallbackLocale: false,
    limit: 1,
    locale,
    overrideAccess: false,
    where: { slug: { equals: slug } },
  })

  return result.docs[0] || null
})

export const getProductCategories = cache(async (locale: Locale): Promise<ProductCategory[]> => {
  const payload = await getPayloadClient()
  const result = await payload.find({
    collection: 'product-categories',
    depth: 0,
    fallbackLocale: false,
    limit: 100,
    locale,
    overrideAccess: false,
    sort: 'sortOrder',
  })

  return result.docs
})

export const getProducts = cache(async (locale: Locale): Promise<Product[]> => {
  const payload = await getPayloadClient()
  const result = await payload.find({
    collection: 'products',
    depth: 1,
    draft: false,
    fallbackLocale: false,
    limit: 100,
    locale,
    overrideAccess: false,
    sort: 'title',
  })

  return result.docs
})

export const getProductBySlug = cache(
  async (locale: Locale, slug: string): Promise<null | Product> => {
    const payload = await getPayloadClient()
    const result = await payload.find({
      collection: 'products',
      depth: 1,
      draft: false,
      fallbackLocale: false,
      limit: 1,
      locale,
      overrideAccess: false,
      where: { slug: { equals: slug } },
    })

    return result.docs[0] || null
  },
)

export const getProjects = cache(async (locale: Locale): Promise<Project[]> => {
  const payload = await getPayloadClient()
  const result = await payload.find({
    collection: 'projects',
    depth: 1,
    draft: false,
    fallbackLocale: false,
    limit: 100,
    locale,
    overrideAccess: false,
    sort: '-createdAt',
  })

  return result.docs
})

export const getProjectBySlug = cache(
  async (locale: Locale, slug: string): Promise<null | Project> => {
    const payload = await getPayloadClient()
    const result = await payload.find({
      collection: 'projects',
      depth: 1,
      draft: false,
      fallbackLocale: false,
      limit: 1,
      locale,
      overrideAccess: false,
      where: { slug: { equals: slug } },
    })

    return result.docs[0] || null
  },
)

export const getPosts = cache(async (locale: Locale): Promise<Post[]> => {
  const payload = await getPayloadClient()
  const result = await payload.find({
    collection: 'posts',
    depth: 1,
    draft: false,
    fallbackLocale: false,
    limit: 100,
    locale,
    overrideAccess: false,
    sort: '-publishedAt',
  })

  return result.docs
})

export const getPostBySlug = cache(async (locale: Locale, slug: string): Promise<null | Post> => {
  const payload = await getPayloadClient()
  const result = await payload.find({
    collection: 'posts',
    depth: 1,
    draft: false,
    fallbackLocale: false,
    limit: 1,
    locale,
    overrideAccess: false,
    where: { slug: { equals: slug } },
  })

  return result.docs[0] || null
})
