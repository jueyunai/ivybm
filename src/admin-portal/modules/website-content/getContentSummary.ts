import type { Payload, PayloadRequest, Where } from 'payload'

import type { PortalEnvironment, PortalRole } from '@/admin-portal/core/modules/types'

import { WEBSITE_CONTENT_MODULE } from './manifest'

export const CONTENT_TYPE_IDS = [
  'pages',
  'products',
  'product-categories',
  'projects',
  'posts',
  'downloads',
] as const

export const CONTENT_STATUS_FILTERS = ['all', 'draft', 'published', 'active', 'inactive'] as const

export type ContentTypeId = (typeof CONTENT_TYPE_IDS)[number]
export type ContentStatusFilter = (typeof CONTENT_STATUS_FILTERS)[number]
export type ContentItemStatus = 'active' | 'always-visible' | 'draft' | 'inactive' | 'published'
export type ContentLocale = 'ar' | 'en'

export interface ContentQuery {
  page: number
  q: string
  status: ContentStatusFilter
  type: ContentTypeId
}

export interface ContentSummaryItem {
  id: number | string
  localeCompleteness: Record<ContentLocale, number>
  localeMissing: Record<ContentLocale, string[]>
  previewHrefs: Record<ContentLocale, null | string>
  slug: string
  status: ContentItemStatus
  title: string
  updatedAt: string
}

export interface ContentSummary {
  collections: Array<{
    id: ContentTypeId
    total: number
    updatedAt: null | string
  }>
  editor: { status: 'available' }
  items: ContentSummaryItem[]
  pagination: {
    page: number
    totalDocs: number
    totalPages: number
  }
  query: ContentQuery
  statusBreakdown:
    { active: number; inactive: number } | { draft: number; published: number } | null
}

export type WebsiteContentPageState =
  'available' | 'forbidden' | 'module-disabled' | 'portal-disabled'

export interface WebsiteContentPageData {
  state: WebsiteContentPageState
  summary: ContentSummary | null
}

interface ContentProjection {
  _status?: 'draft' | 'published' | null
  application?: unknown
  body?: unknown
  category?: unknown
  content?: unknown
  coverImage?: unknown
  description?: unknown
  excerpt?: unknown
  featuredImage?: unknown
  file?: unknown
  gallery?: unknown
  heroImage?: unknown
  id: number | string
  isActive?: boolean | null
  location?: unknown
  seo?: {
    canonical?: unknown
    description?: unknown
    keywords?: unknown
    ogImage?: unknown
    title?: unknown
  } | null
  shortDescription?: unknown
  slug?: null | string
  summary?: unknown
  title?: null | string
  updatedAt: string
}

interface ContentFindResult {
  docs: ContentProjection[]
  page?: number
  totalDocs: number
  totalPages?: number
}

interface MediaProjection {
  alt?: null | string
  id: number | string
  isPublic?: boolean | null
  url?: null | string
}

const VERSIONED_TYPES = new Set<ContentTypeId>(['pages', 'posts', 'products', 'projects'])
const PAGE_SIZE = 12

const firstValue = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value

export function parseContentQuery(
  input: Record<string, string | string[] | undefined>,
): ContentQuery {
  const typeValue = firstValue(input.type)
  const statusValue = firstValue(input.status)
  const pageValue = Number.parseInt(firstValue(input.page) ?? '1', 10)

  return {
    page: Number.isSafeInteger(pageValue) && pageValue > 0 ? pageValue : 1,
    q: (firstValue(input.q) ?? '').trim().slice(0, 80),
    status: CONTENT_STATUS_FILTERS.includes(statusValue as ContentStatusFilter)
      ? (statusValue as ContentStatusFilter)
      : 'all',
    type: CONTENT_TYPE_IDS.includes(typeValue as ContentTypeId)
      ? (typeValue as ContentTypeId)
      : 'pages',
  }
}

const normalizedStatus = (
  type: ContentTypeId,
  status: ContentStatusFilter,
): ContentStatusFilter => {
  if (VERSIONED_TYPES.has(type)) {
    return status === 'draft' || status === 'published' ? status : 'all'
  }
  if (type === 'downloads') {
    return status === 'active' || status === 'inactive' ? status : 'all'
  }
  return 'all'
}

const buildWhere = (query: ContentQuery): Where => {
  const clauses: Where[] = []
  const status = normalizedStatus(query.type, query.status)

  if (query.q) {
    clauses.push({
      or: [{ title: { contains: query.q } }, { slug: { contains: query.q } }],
    })
  }
  if (status === 'draft' || status === 'published') {
    clauses.push({ _status: { equals: status } })
  }
  if (status === 'active' || status === 'inactive') {
    clauses.push({ isActive: { equals: status === 'active' } })
  }

  if (clauses.length === 0) return {}
  if (clauses.length === 1) return clauses[0]
  return { and: clauses }
}

const selectionFor = (type: ContentTypeId) => {
  const common = {
    id: true,
    seo: { description: true, ogImage: true, title: true },
    slug: true,
    title: true,
    updatedAt: true,
  } as const

  switch (type) {
    case 'pages':
      return { ...common, _status: true, body: true, heroImage: true, summary: true } as const
    case 'products':
      return {
        ...common,
        _status: true,
        category: true,
        coverImage: true,
        description: true,
        gallery: true,
        shortDescription: true,
      } as const
    case 'product-categories':
      return { ...common, description: true } as const
    case 'projects':
      return {
        ...common,
        _status: true,
        application: true,
        coverImage: true,
        description: true,
        gallery: true,
        location: true,
        summary: true,
      } as const
    case 'posts':
      return {
        ...common,
        _status: true,
        content: true,
        excerpt: true,
        featuredImage: true,
      } as const
    case 'downloads':
      return {
        ...common,
        coverImage: true,
        description: true,
        file: true,
        isActive: true,
      } as const
  }
}

const findContent = async ({
  fallbackLocale,
  limit,
  locale,
  page,
  pagination = true,
  payload,
  req,
  select,
  sort = '-updatedAt',
  type,
  where,
}: {
  fallbackLocale: false
  limit: number
  locale: 'all' | 'ar' | 'en'
  page?: number
  pagination?: boolean
  payload: Payload
  req: PayloadRequest
  select: Record<string, unknown>
  sort?: string
  type: ContentTypeId
  where?: Where
}): Promise<ContentFindResult> => {
  const options = {
    depth: 0,
    fallbackLocale,
    limit,
    locale,
    overrideAccess: false as const,
    ...(page === undefined ? {} : { page }),
    pagination,
    req,
    select,
    sort,
    ...(where === undefined ? {} : { where }),
  }

  switch (type) {
    case 'pages':
      return (await payload.find({
        collection: 'pages',
        draft: true,
        ...options,
      })) as ContentFindResult
    case 'products':
      return (await payload.find({
        collection: 'products',
        draft: true,
        ...options,
      })) as ContentFindResult
    case 'product-categories':
      return (await payload.find({
        collection: 'product-categories',
        ...options,
      })) as ContentFindResult
    case 'projects':
      return (await payload.find({
        collection: 'projects',
        draft: true,
        ...options,
      })) as ContentFindResult
    case 'posts':
      return (await payload.find({
        collection: 'posts',
        draft: true,
        ...options,
      })) as ContentFindResult
    case 'downloads':
      return (await payload.find({ collection: 'downloads', ...options })) as ContentFindResult
  }
}

const countContent = async ({
  payload,
  req,
  type,
  where,
}: {
  payload: Payload
  req: PayloadRequest
  type: ContentTypeId
  where: Where
}): Promise<number> => {
  if (VERSIONED_TYPES.has(type)) {
    const result = await findContent({
      fallbackLocale: false,
      limit: 1,
      locale: 'all',
      pagination: true,
      payload,
      req,
      select: { id: true },
      type,
      where,
    })
    return result.totalDocs
  }

  const result = await payload.count({
    collection: type,
    overrideAccess: false,
    req,
    where,
  })
  return result.totalDocs
}

const REQUIRED_FIELDS: Record<ContentTypeId, string[]> = {
  downloads: ['title', 'description', 'file', 'coverImage', 'seo.title', 'seo.description'],
  pages: ['title', 'summary', 'body', 'heroImage', 'seo.title', 'seo.description'],
  posts: ['title', 'excerpt', 'content', 'featuredImage', 'seo.title', 'seo.description'],
  'product-categories': ['title', 'description', 'seo.title', 'seo.description'],
  products: [
    'title',
    'shortDescription',
    'description',
    'category',
    'coverImage',
    'seo.title',
    'seo.description',
  ],
  projects: [
    'title',
    'summary',
    'description',
    'location',
    'application',
    'coverImage',
    'seo.title',
    'seo.description',
  ],
}

const STRUCTURAL_RICH_TEXT_KEYS = new Set(['direction', 'format', 'indent', 'type', 'version'])

const hasMeaningfulValue = (value: unknown): boolean => {
  if (value === null || value === undefined) return false
  if (typeof value === 'string') return value.trim().length > 0
  if (typeof value === 'number') return Number.isFinite(value)
  if (typeof value === 'boolean') return true
  if (Array.isArray(value)) return value.some(hasMeaningfulValue)
  if (typeof value !== 'object') return false

  const record = value as Record<string, unknown>
  if (typeof record.text === 'string') return record.text.trim().length > 0
  if (Array.isArray(record.children)) return record.children.some(hasMeaningfulValue)
  if (record.root !== undefined) return hasMeaningfulValue(record.root)

  return Object.entries(record).some(
    ([key, nested]) => !STRUCTURAL_RICH_TEXT_KEYS.has(key) && hasMeaningfulValue(nested),
  )
}

const readPath = (document: ContentProjection | undefined, path: string): unknown =>
  path
    .split('.')
    .reduce<unknown>(
      (value, key) =>
        value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined,
      document,
    )

const relationId = (value: unknown): null | string => {
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  if (!value || typeof value !== 'object') return null
  const id = (value as { id?: unknown }).id
  return typeof id === 'string' || typeof id === 'number' ? String(id) : null
}

const localizedValue = <Value>(value: unknown, locale: ContentLocale): Value | undefined => {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, unknown>
    if (Object.hasOwn(record, 'ar') || Object.hasOwn(record, 'en')) {
      return record[locale] as Value | undefined
    }
  }
  return value as Value | undefined
}

const localizedProjection = (
  document: ContentProjection,
  locale: ContentLocale,
): ContentProjection => {
  const seo = document.seo && typeof document.seo === 'object'
    ? document.seo as Record<string, unknown>
    : undefined

  return {
    ...document,
    body: localizedValue(document.body, locale),
    content: localizedValue(document.content, locale),
    description: localizedValue(document.description, locale),
    excerpt: localizedValue(document.excerpt, locale),
    shortDescription: localizedValue(document.shortDescription, locale),
    summary: localizedValue(document.summary, locale),
    title: localizedValue<string | null>(document.title, locale),
    seo: seo
      ? {
          ...seo,
          canonical: localizedValue<string | null>(seo.canonical, locale),
          description: localizedValue<string | null>(seo.description, locale),
          keywords: localizedValue<string | null>(seo.keywords, locale),
          title: localizedValue<string | null>(seo.title, locale),
        }
      : null,
  }
}

const imageReferencesFor = (
  type: ContentTypeId,
  document: ContentProjection | undefined,
): Array<{ field: string; id: string }> => {
  if (!document) return []

  const references: Array<{ field: string; id: string }> = []
  const addReference = (field: string, value: unknown) => {
    const id = relationId(value)
    if (id) references.push({ field, id })
  }

  if (type === 'pages') addReference('heroImage', document.heroImage)
  if (type === 'products' || type === 'projects') {
    addReference('coverImage', document.coverImage)
    if (Array.isArray(document.gallery)) {
      document.gallery.forEach((value, index) => addReference(`gallery.${index}`, value))
    }
  }
  if (type === 'posts') addReference('featuredImage', document.featuredImage)
  if (type === 'downloads') addReference('coverImage', document.coverImage)
  addReference('seo.ogImage', document.seo?.ogImage)

  return references
}

const completeness = ({
  document,
  mediaAltById,
  type,
}: {
  document: ContentProjection | undefined
  mediaAltById: ReadonlyMap<string, string>
  type: ContentTypeId
}): { missing: string[]; percent: number } => {
  const checks = REQUIRED_FIELDS[type].map((field) => ({
    complete: hasMeaningfulValue(readPath(document, field)),
    field,
  }))

  for (const reference of imageReferencesFor(type, document)) {
    checks.push({
      complete: Boolean(mediaAltById.get(reference.id)?.trim()),
      field: `${reference.field}.alt`,
    })
  }

  const missing = checks.filter(({ complete }) => !complete).map(({ field }) => field)
  return {
    missing,
    percent: Math.round(((checks.length - missing.length) / checks.length) * 100),
  }
}

const statusFor = (type: ContentTypeId, document: ContentProjection): ContentItemStatus => {
  if (VERSIONED_TYPES.has(type)) return document._status === 'published' ? 'published' : 'draft'
  if (type === 'downloads') return document.isActive === false ? 'inactive' : 'active'
  return 'always-visible'
}

const previewHrefFor = (
  type: ContentTypeId,
  slug: string,
  status: ContentItemStatus,
  locale: ContentLocale,
  downloadHref?: string,
): null | string => {
  if (type === 'product-categories') {
    return status === 'always-visible' ? `/${locale}/products?category=${encodeURIComponent(slug)}` : null
  }
  if (type === 'downloads') return status === 'active' ? downloadHref ?? null : null
  if (status !== 'published') return null
  if (type === 'pages') return slug === 'home' ? `/${locale}` : `/${locale}/${slug}`
  if (type === 'products') return `/${locale}/products/${slug}`
  if (type === 'projects') return `/${locale}/projects/${slug}`
  if (type === 'posts') return `/${locale}/news/${slug}`
  return null
}

export class ContentSummaryReadError extends Error {
  readonly code = 'portal-content-summary-read-failed'

  constructor(cause?: unknown) {
    super('Unable to read the website content summary', cause === undefined ? undefined : { cause })
    this.name = 'ContentSummaryReadError'
  }
}

const isExplicitlyEnabled = (value: string | undefined): boolean => value === 'true'

export async function loadWebsiteContentPageData({
  env,
  payload,
  query,
  req,
  role,
}: {
  env: PortalEnvironment
  payload: Payload
  query: ContentQuery
  req: PayloadRequest
  role: PortalRole
}): Promise<WebsiteContentPageData> {
  if (!(WEBSITE_CONTENT_MODULE.allowedRoles as readonly PortalRole[]).includes(role)) {
    return { state: 'forbidden', summary: null }
  }

  if (!isExplicitlyEnabled(env.ADMIN_PORTAL_ENABLED)) {
    return { state: 'portal-disabled', summary: null }
  }

  if (!isExplicitlyEnabled(env[WEBSITE_CONTENT_MODULE.featureFlag])) {
    return { state: 'module-disabled', summary: null }
  }

  return {
    state: 'available',
    summary: await getContentSummary({ payload, query, req }),
  }
}

export async function getContentSummary({
  payload,
  query,
  req,
}: {
  payload: Payload
  query: ContentQuery
  req: PayloadRequest
}): Promise<ContentSummary> {
  const normalizedQuery = { ...query, status: normalizedStatus(query.type, query.status) }

  try {
    const collectionResults = await Promise.all(
      CONTENT_TYPE_IDS.map((type) =>
        findContent({
          fallbackLocale: false,
          limit: 1,
          locale: 'all',
          pagination: true,
          payload,
          req,
          select: { updatedAt: true },
          type,
        }),
      ),
    )

    const localized = await findContent({
      fallbackLocale: false,
      limit: PAGE_SIZE,
      locale: 'all',
      page: normalizedQuery.page,
      payload,
      req,
      select: selectionFor(normalizedQuery.type),
      type: normalizedQuery.type,
      where: buildWhere(normalizedQuery),
    })
    const mediaIds = new Set(
      localized.docs.flatMap((document) =>
        imageReferencesFor(normalizedQuery.type, document).map(({ id }) => id),
      ),
    )
    if (normalizedQuery.type === 'downloads') {
      for (const document of localized.docs) {
        const fileId = relationId(document.file)
        if (fileId) mediaIds.add(fileId)
      }
    }
    const media =
      mediaIds.size === 0
        ? { docs: [] as MediaProjection[] }
        : ((await payload.find({
            collection: 'media',
            depth: 0,
            limit: Math.min(mediaIds.size, 100),
            overrideAccess: false,
            pagination: false,
            req,
            select: { alt: true, id: true, isPublic: true, url: true },
            where: { id: { in: [...mediaIds] } },
          })) as { docs: MediaProjection[] })
    const mediaAltById = new Map(
      media.docs.map((document) => [String(document.id), document.alt ?? '']),
    )
    const publicMediaURLById = new Map(
      media.docs.flatMap((document) =>
        document.isPublic && typeof document.url === 'string'
          ? [[String(document.id), document.url] as const]
          : [],
      ),
    )

    const statusBreakdown = VERSIONED_TYPES.has(normalizedQuery.type)
      ? {
          draft: await countContent({
            payload,
            req,
            type: normalizedQuery.type,
            where: { _status: { equals: 'draft' } },
          }),
          published: await countContent({
            payload,
            req,
            type: normalizedQuery.type,
            where: { _status: { equals: 'published' } },
          }),
        }
      : normalizedQuery.type === 'downloads'
        ? {
            active: await countContent({
              payload,
              req,
              type: normalizedQuery.type,
              where: { isActive: { equals: true } },
            }),
            inactive: await countContent({
              payload,
              req,
              type: normalizedQuery.type,
              where: { isActive: { equals: false } },
            }),
          }
        : null

    const items = localized.docs.map((document): ContentSummaryItem => {
      const status = statusFor(normalizedQuery.type, document)
      const slug = document.slug ?? ''
      const englishDocument = localizedProjection(document, 'en')
      const arabicDocument = localizedProjection(document, 'ar')
      const englishCompleteness = completeness({
        document: englishDocument,
        mediaAltById,
        type: normalizedQuery.type,
      })
      const arabicCompleteness = completeness({
        document: arabicDocument,
        mediaAltById,
        type: normalizedQuery.type,
      })
      const downloadHref =
        normalizedQuery.type === 'downloads'
          ? publicMediaURLById.get(relationId(document.file) ?? '')
          : undefined
      return {
        id: document.id,
        localeCompleteness: {
          ar: arabicCompleteness.percent,
          en: englishCompleteness.percent,
        },
        localeMissing: {
          ar: arabicCompleteness.missing,
          en: englishCompleteness.missing,
        },
        previewHrefs: {
          ar: previewHrefFor(normalizedQuery.type, slug, status, 'ar', downloadHref),
          en: previewHrefFor(normalizedQuery.type, slug, status, 'en', downloadHref),
        },
        slug,
        status,
        title: englishDocument.title?.trim() || arabicDocument.title?.trim() || slug,
        updatedAt: document.updatedAt,
      }
    })

    return {
      collections: CONTENT_TYPE_IDS.map((id, index) => ({
        id,
        total: collectionResults[index].totalDocs,
        updatedAt: collectionResults[index].docs[0]?.updatedAt ?? null,
      })),
      editor: { status: 'available' },
      items,
      pagination: {
        page: localized.page ?? normalizedQuery.page,
        totalDocs: localized.totalDocs,
        totalPages: localized.totalPages ?? (localized.totalDocs === 0 ? 0 : 1),
      },
      query: normalizedQuery,
      statusBreakdown,
    }
  } catch (error) {
    throw new ContentSummaryReadError(error)
  }
}
