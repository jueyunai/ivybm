import { cache } from 'react'
import { getPayload, type Where } from 'payload'

import type { Locale } from '@/lib/i18n'
import type { Page, Post, Product, ProductCategory, Project, SiteSetting } from '@/payload-types'
import config from '@/payload.config'

const getPayloadClient = cache(async () => getPayload({ config }))

export type PostContentType = 'news' | 'knowledge'

export type GetPostsOptions = {
  contentType?: PostContentType
  fallbackLocale?: false | 'en'
  limit?: number
}

export const getSiteSettings = cache(
  async (
    locale: Locale,
    options: { fallbackLocale?: false | 'en' } = {},
  ): Promise<SiteSetting> => {
    const payload = await getPayloadClient()

    return payload.findGlobal({
      depth: 1,
      fallbackLocale: options.fallbackLocale ?? 'en',
      locale,
      overrideAccess: false,
      slug: 'site-settings',
    })
  },
)

export const getPageBySlug = cache(
  async (
    locale: Locale,
    slug: string,
    options: { fallbackLocale?: false | 'en' } = {},
  ): Promise<null | Page> => {
    const payload = await getPayloadClient()
    const result = await payload.find({
      collection: 'pages',
      depth: 1,
      draft: false,
      fallbackLocale: options.fallbackLocale ?? 'en',
      limit: 1,
      locale,
      overrideAccess: false,
      where: { slug: { equals: slug } },
    })

    return result.docs[0] || null
  },
)

export const getProductCategories = cache(
  async (
    locale: Locale,
    options: { fallbackLocale?: false | 'en' } = {},
  ): Promise<ProductCategory[]> => {
    const payload = await getPayloadClient()
    const result = await payload.find({
      collection: 'product-categories',
      depth: 0,
      fallbackLocale: options.fallbackLocale ?? 'en',
      limit: 100,
      locale,
      overrideAccess: false,
      sort: 'sortOrder',
    })

    return result.docs
  },
)

export const getProducts = cache(
  async (
    locale: Locale,
    options: { fallbackLocale?: false | 'en' } = {},
  ): Promise<Product[]> => {
    const payload = await getPayloadClient()
    const result = await payload.find({
      collection: 'products',
      depth: 1,
      draft: false,
      fallbackLocale: options.fallbackLocale ?? 'en',
      limit: 100,
      locale,
      overrideAccess: false,
      sort: 'title',
    })

    return result.docs
  },
)

export const getProductBySlug = cache(
  async (
    locale: Locale,
    slug: string,
    options: { fallbackLocale?: false | 'en' } = {},
  ): Promise<null | Product> => {
    const payload = await getPayloadClient()
    const result = await payload.find({
      collection: 'products',
      depth: 1,
      draft: false,
      fallbackLocale: options.fallbackLocale ?? 'en',
      limit: 1,
      locale,
      overrideAccess: false,
      where: { slug: { equals: slug } },
    })

    return result.docs[0] || null
  },
)

export const getProjects = cache(
  async (
    locale: Locale,
    options: { fallbackLocale?: false | 'en' } = {},
  ): Promise<Project[]> => {
    const payload = await getPayloadClient()
    const result = await payload.find({
      collection: 'projects',
      depth: 1,
      draft: false,
      fallbackLocale: options.fallbackLocale ?? 'en',
      limit: 100,
      locale,
      overrideAccess: false,
      sort: '-createdAt',
    })

    return result.docs
  },
)

export const getProjectBySlug = cache(
  async (
    locale: Locale,
    slug: string,
    options: { fallbackLocale?: false | 'en' } = {},
  ): Promise<null | Project> => {
    const payload = await getPayloadClient()
    const result = await payload.find({
      collection: 'projects',
      depth: 1,
      draft: false,
      fallbackLocale: options.fallbackLocale ?? 'en',
      limit: 1,
      locale,
      overrideAccess: false,
      where: { slug: { equals: slug } },
    })

    return result.docs[0] || null
  },
)

export const getPosts = cache(
  async (locale: Locale, options: GetPostsOptions = {}): Promise<Post[]> => {
    const payload = await getPayloadClient()
    const where: Where = {
      ...(options.contentType ? { contentType: { equals: options.contentType } } : {}),
    }

    const result = await payload.find({
      collection: 'posts',
      depth: 1,
      draft: false,
      fallbackLocale: options.fallbackLocale ?? 'en',
      limit: options.limit ?? 100,
      locale,
      overrideAccess: false,
      sort: '-publishedAt',
      where,
    })

    return result.docs
  },
)

export const getPostBySlug = cache(
  async (
    locale: Locale,
    slug: string,
    options: { contentType?: PostContentType; fallbackLocale?: false | 'en' } = {},
  ): Promise<null | Post> => {
    const payload = await getPayloadClient()
    const result = await payload.find({
      collection: 'posts',
      depth: 1,
      draft: false,
      fallbackLocale: options.fallbackLocale ?? 'en',
      limit: 1,
      locale,
      overrideAccess: false,
      where: {
        and: [
          { slug: { equals: slug } },
          ...(options.contentType ? [{ contentType: { equals: options.contentType } }] : []),
        ],
      },
    })

    return result.docs[0] || null
  },
)
