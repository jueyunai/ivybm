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

export interface ContentQuery {
  page: number
  q: string
  status: ContentStatusFilter
  type: ContentTypeId
}

export interface ContentSummaryItem {
  id: number | string
  localeCompleteness: { ar: number; en: number }
  previewHref: null | string
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
  editor: { status: 'dependency-gated' }
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
  id: number | string
  isActive?: boolean | null
  seo?: {
    description?: null | string
    title?: null | string
  } | null
  slug?: null | string
  title?: null | string
  updatedAt: string
}

interface ContentFindResult {
  docs: ContentProjection[]
  page?: number
  totalDocs: number
  totalPages?: number
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
    seo: { description: true, title: true },
    slug: true,
    title: true,
    updatedAt: true,
  } as const

  if (VERSIONED_TYPES.has(type)) return { ...common, _status: true } as const
  if (type === 'downloads') return { ...common, isActive: true } as const
  return common
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
  locale: 'ar' | 'en'
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
  const result = await payload.count({
    collection: type,
    overrideAccess: false,
    req,
    where,
  })
  return result.totalDocs
}

const completeness = (document: ContentProjection | undefined): number => {
  if (!document) return 0
  const values = [document.title, document.seo?.title, document.seo?.description]
  const completed = values.filter((value) => typeof value === 'string' && value.trim()).length
  return Math.round((completed / values.length) * 100)
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
): null | string => {
  if (status !== 'published') return null
  if (type === 'pages') return slug === 'home' ? '/en' : `/en/${slug}`
  if (type === 'products') return `/en/products/${slug}`
  if (type === 'projects') return `/en/projects/${slug}`
  if (type === 'posts') return `/en/news/${slug}`
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
          locale: 'en',
          pagination: true,
          payload,
          req,
          select: { updatedAt: true },
          type,
        }),
      ),
    )

    const english = await findContent({
      fallbackLocale: false,
      limit: PAGE_SIZE,
      locale: 'en',
      page: normalizedQuery.page,
      payload,
      req,
      select: selectionFor(normalizedQuery.type),
      type: normalizedQuery.type,
      where: buildWhere(normalizedQuery),
    })
    const ids = english.docs.map((document) => document.id)
    const arabic =
      ids.length === 0
        ? { docs: [], totalDocs: 0 }
        : await findContent({
            fallbackLocale: false,
            limit: PAGE_SIZE,
            locale: 'ar',
            pagination: false,
            payload,
            req,
            select: selectionFor(normalizedQuery.type),
            type: normalizedQuery.type,
            where: { id: { in: ids } },
          })
    const arabicById = new Map(arabic.docs.map((document) => [String(document.id), document]))

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

    const items = english.docs.map((document): ContentSummaryItem => {
      const status = statusFor(normalizedQuery.type, document)
      const slug = document.slug ?? ''
      return {
        id: document.id,
        localeCompleteness: {
          ar: completeness(arabicById.get(String(document.id))),
          en: completeness(document),
        },
        previewHref: previewHrefFor(normalizedQuery.type, slug, status),
        slug,
        status,
        title: document.title ?? slug,
        updatedAt: document.updatedAt,
      }
    })

    return {
      collections: CONTENT_TYPE_IDS.map((id, index) => ({
        id,
        total: collectionResults[index].totalDocs,
        updatedAt: collectionResults[index].docs[0]?.updatedAt ?? null,
      })),
      editor: { status: 'dependency-gated' },
      items,
      pagination: {
        page: english.page ?? normalizedQuery.page,
        totalDocs: english.totalDocs,
        totalPages: english.totalPages ?? (english.totalDocs === 0 ? 0 : 1),
      },
      query: normalizedQuery,
      statusBreakdown,
    }
  } catch (error) {
    throw new ContentSummaryReadError(error)
  }
}
