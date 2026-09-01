import { revalidatePath } from 'next/cache.js'
import type {
  CollectionAfterChangeHook,
  CollectionAfterDeleteHook,
  GlobalAfterChangeHook,
  PayloadRequest,
} from 'payload'

import { purgeCloudflareEverything, purgeCloudflareUrls } from '@/lib/cloudflare'

const PUBLIC_LOCALES = ['en', 'ar'] as const

type PublicCollectionSlug =
  | 'downloads'
  | 'pages'
  | 'posts'
  | 'product-categories'
  | 'products'
  | 'projects'

type PublicDocument = {
  _status?: unknown
  category?: unknown
  contentType?: unknown
  isActive?: unknown
  slug?: unknown
}

type RevalidationTarget = {
  path: string
  type?: 'layout' | 'page'
}

const isPublicDocument = (collection: PublicCollectionSlug, doc: PublicDocument): boolean => {
  if (collection === 'downloads') {
    return doc.isActive === true
  }

  if (collection === 'product-categories') {
    return true
  }

  return doc._status === 'published'
}

export const localizedPaths = (collection: PublicCollectionSlug, doc: PublicDocument): string[] => {
  const slug = typeof doc.slug === 'string' ? doc.slug : undefined
  const paths: string[] = []

  for (const locale of PUBLIC_LOCALES) {
    if (collection === 'pages') {
      paths.push(slug === 'home' || !slug ? `/${locale}` : `/${locale}/${slug}`)
      continue
    }

    if (collection === 'product-categories') {
      paths.push(`/${locale}/products`)
      continue
    }

    if (collection === 'products') {
      paths.push(`/${locale}/products`)
      if (slug) paths.push(`/${locale}/products/${slug}`)
      continue
    }

    if (collection === 'projects') {
      paths.push(`/${locale}/projects`)
      if (slug) paths.push(`/${locale}/projects/${slug}`)
      continue
    }

    if (collection === 'posts') {
      const isKnowledge = doc.contentType === 'knowledge'
      const section = isKnowledge ? 'knowledge' : 'news'
      paths.push(`/${locale}/${section}`)
      if (slug) paths.push(`/${locale}/${section}/${slug}`)
      continue
    }

    paths.push(`/${locale}`)
  }

  return paths
}

const revalidateSafely = (targets: RevalidationTarget[], req: PayloadRequest): void => {
  for (const target of targets) {
    try {
      if (target.type) {
        revalidatePath(target.path, target.type)
      } else {
        revalidatePath(target.path)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown revalidation error'

      if (message.includes('static generation store missing')) {
        req.payload.logger.debug(`Skipped revalidation outside a Next.js request: ${target.path}`)
      } else {
        req.payload.logger.warn(`Unable to revalidate ${target.path}: ${message}`)
      }
    }
  }
}

const uniquePageTargets = (...pathGroups: string[][]): RevalidationTarget[] =>
  [...new Set(pathGroups.flat())].map((path) => ({ path }))

const localizedLayoutTargets = (root = ''): RevalidationTarget[] =>
  PUBLIC_LOCALES.map((locale) => ({ path: `/${locale}${root}`, type: 'layout' as const }))

const purgeCloudflarePaths = (paths: string[], req: PayloadRequest): void => {
  if (paths.length === 0) return
  void purgeCloudflareUrls(paths, { logger: req.payload.logger })
}

const purgeCloudflareZone = (req: PayloadRequest): void => {
  void purgeCloudflareEverything({ logger: req.payload.logger })
}

export const revalidateContentAfterChange: CollectionAfterChangeHook = ({
  collection,
  context,
  doc,
  previousDoc,
  req,
}) => {
  if (context.disableRevalidate === true) {
    return doc
  }

  const collectionSlug = collection.slug as PublicCollectionSlug
  const currentPaths = isPublicDocument(collectionSlug, doc)
    ? localizedPaths(collectionSlug, doc)
    : []
  const previousPaths =
    previousDoc && isPublicDocument(collectionSlug, previousDoc)
      ? localizedPaths(collectionSlug, previousDoc)
      : []

  const categoryDetails =
    collectionSlug === 'product-categories'
      ? PUBLIC_LOCALES.map((locale) => ({
          path: `/${locale}/products/[slug]`,
          type: 'page' as const,
        }))
      : []

  const publicPaths = [...new Set([...currentPaths, ...previousPaths])]

  revalidateSafely([...uniquePageTargets(publicPaths), ...categoryDetails], req)
  purgeCloudflarePaths(publicPaths, req)

  return doc
}

export const revalidateContentAfterDelete: CollectionAfterDeleteHook = ({
  collection,
  context,
  doc,
  req,
}) => {
  if (context.disableRevalidate === true) {
    return doc
  }

  const collectionSlug = collection.slug as PublicCollectionSlug

  if (isPublicDocument(collectionSlug, doc)) {
    const categoryDetails =
      collectionSlug === 'product-categories'
        ? PUBLIC_LOCALES.map((locale) => ({
            path: `/${locale}/products/[slug]`,
            type: 'page' as const,
          }))
        : []

    revalidateSafely(
      [...uniquePageTargets(localizedPaths(collectionSlug, doc)), ...categoryDetails],
      req,
    )
    purgeCloudflarePaths(localizedPaths(collectionSlug, doc), req)
  }

  return doc
}

export const revalidateSiteSettingsAfterChange: GlobalAfterChangeHook = ({ context, doc, req }) => {
  if (context.disableRevalidate === true) {
    return doc
  }

  revalidateSafely(localizedLayoutTargets(), req)
  purgeCloudflareZone(req)

  return doc
}

export const revalidateMediaAfterChange: CollectionAfterChangeHook = ({
  context,
  doc,
  previousDoc,
  req,
}) => {
  if (context.disableRevalidate === true) {
    return doc
  }

  if (doc.isPublic === true || previousDoc?.isPublic === true) {
    revalidateSafely(localizedLayoutTargets(), req)
  }

  return doc
}

export const revalidateMediaAfterDelete: CollectionAfterDeleteHook = ({ context, doc, req }) => {
  if (context.disableRevalidate === true) {
    return doc
  }

  if (doc.isPublic === true) {
    revalidateSafely(localizedLayoutTargets(), req)
  }

  return doc
}
