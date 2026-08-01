import type { Payload, PayloadRequest, Where } from 'payload'

import type { PortalEnvironment, PortalRole } from '@/admin-portal/core/modules/types'
import { MEDIA_IMAGE_MAX_BYTES, MEDIA_MIME_TYPES, MEDIA_PDF_MAX_BYTES } from '@/collections/Media'

import { MEDIA_MODULE } from './manifest'

export const MEDIA_KIND_FILTERS = ['all', 'image', 'pdf'] as const
export const MEDIA_VISIBILITY_FILTERS = ['all', 'public', 'private'] as const
export const MEDIA_VIEWS = ['grid', 'list'] as const

export type MediaKindFilter = (typeof MEDIA_KIND_FILTERS)[number]
export type MediaVisibilityFilter = (typeof MEDIA_VISIBILITY_FILTERS)[number]
export type MediaView = (typeof MEDIA_VIEWS)[number]
export type MediaItemKind = 'image' | 'pdf' | 'unknown'

export interface MediaQuery {
  kind: MediaKindFilter
  page: number
  q: string
  source: string
  view: MediaView
  visibility: MediaVisibilityFilter
}

export interface MediaSummaryItem {
  alt: string
  filename: string
  filesize: null | number
  height: null | number
  id: number | string
  isPublic: boolean
  kind: MediaItemKind
  mimeType: null | string
  originalUrl: null | string
  previewUrl: null | string
  source: string
  updatedAt: string
  width: null | number
}

export interface MediaPageSummary {
  editor: { status: 'available' }
  items: MediaSummaryItem[]
  limits: {
    imageMaxBytes: number
    mimeTypes: readonly string[]
    pdfMaxBytes: number
  }
  pagination: {
    page: number
    totalDocs: number
    totalPages: number
  }
  query: MediaQuery
}

export type MediaPageState = 'available' | 'forbidden' | 'module-disabled' | 'portal-disabled'

export interface MediaPageData {
  state: MediaPageState
  summary: MediaPageSummary | null
}

interface MediaProjection {
  alt?: null | string
  filename?: null | string
  filesize?: null | number
  height?: null | number
  id: number | string
  isPublic?: boolean | null
  mimeType?: null | string
  sizes?: {
    card?: { url?: null | string } | null
    thumbnail?: { url?: null | string } | null
  } | null
  source?: null | string
  thumbnailURL?: null | string
  updatedAt: string
  url?: null | string
  width?: null | number
}

interface MediaFindResult {
  docs: MediaProjection[]
  page?: number
  totalDocs: number
  totalPages?: number
}

const IMAGE_MIME_TYPES = MEDIA_MIME_TYPES.filter((mimeType) => mimeType.startsWith('image/'))
const PAGE_SIZE = 12

const firstValue = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value

export function parseMediaQuery(input: Record<string, string | string[] | undefined>): MediaQuery {
  const kindValue = firstValue(input.kind)
  const visibilityValue = firstValue(input.visibility)
  const viewValue = firstValue(input.view)
  const pageValue = Number.parseInt(firstValue(input.page) ?? '1', 10)

  return {
    kind: MEDIA_KIND_FILTERS.includes(kindValue as MediaKindFilter)
      ? (kindValue as MediaKindFilter)
      : 'all',
    page: Number.isSafeInteger(pageValue) && pageValue > 0 ? pageValue : 1,
    q: (firstValue(input.q) ?? '').trim().slice(0, 80),
    source: (firstValue(input.source) ?? '').trim().slice(0, 80),
    view: MEDIA_VIEWS.includes(viewValue as MediaView) ? (viewValue as MediaView) : 'grid',
    visibility: MEDIA_VISIBILITY_FILTERS.includes(visibilityValue as MediaVisibilityFilter)
      ? (visibilityValue as MediaVisibilityFilter)
      : 'all',
  }
}

const buildWhere = (query: MediaQuery): Where => {
  const clauses: Where[] = []

  if (query.q) {
    clauses.push({ or: [{ alt: { contains: query.q } }, { filename: { contains: query.q } }] })
  }
  if (query.source) clauses.push({ source: { contains: query.source } })
  if (query.kind === 'image') clauses.push({ mimeType: { in: [...IMAGE_MIME_TYPES] } })
  if (query.kind === 'pdf') clauses.push({ mimeType: { equals: 'application/pdf' } })
  if (query.visibility === 'public') clauses.push({ isPublic: { equals: true } })
  if (query.visibility === 'private') clauses.push({ isPublic: { equals: false } })

  if (clauses.length === 0) return {}
  if (clauses.length === 1) return clauses[0]
  return { and: clauses }
}

const safeMediaUrl = (value: null | string | undefined): null | string => {
  if (!value || value.includes('\\')) return null
  if (value.startsWith('/') && !value.startsWith('//')) return value

  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null
  } catch {
    return null
  }
}

const kindFor = (mimeType: null | string | undefined): MediaItemKind => {
  if (mimeType === 'application/pdf') return 'pdf'
  if (mimeType?.startsWith('image/')) return 'image'
  return 'unknown'
}

const mapMediaItem = (document: MediaProjection): MediaSummaryItem => {
  const kind = kindFor(document.mimeType)
  const originalUrl = safeMediaUrl(document.url)
  const imagePreview =
    safeMediaUrl(document.sizes?.card?.url) ??
    safeMediaUrl(document.sizes?.thumbnail?.url) ??
    safeMediaUrl(document.thumbnailURL) ??
    originalUrl

  return {
    alt: document.alt ?? '',
    filename: document.filename ?? `media-${document.id}`,
    filesize: document.filesize ?? null,
    height: document.height ?? null,
    id: document.id,
    isPublic: document.isPublic === true,
    kind,
    mimeType: document.mimeType ?? null,
    originalUrl,
    previewUrl: kind === 'image' ? imagePreview : kind === 'pdf' ? originalUrl : null,
    source: document.source ?? '',
    updatedAt: document.updatedAt,
    width: document.width ?? null,
  }
}

export class MediaPageReadError extends Error {
  readonly code = 'portal-media-read-failed'

  constructor(cause?: unknown) {
    super('Unable to read the Portal media page', cause === undefined ? undefined : { cause })
    this.name = 'MediaPageReadError'
  }
}

export async function getMediaPage({
  payload,
  query,
  req,
}: {
  payload: Payload
  query: MediaQuery
  req: PayloadRequest
}): Promise<MediaPageSummary> {
  try {
    const result = (await payload.find({
      collection: 'media',
      depth: 0,
      limit: PAGE_SIZE,
      overrideAccess: false,
      page: query.page,
      pagination: true,
      req,
      select: {
        alt: true,
        filename: true,
        filesize: true,
        height: true,
        id: true,
        isPublic: true,
        mimeType: true,
        sizes: {
          card: { url: true },
          thumbnail: { url: true },
        },
        source: true,
        thumbnailURL: true,
        updatedAt: true,
        url: true,
        width: true,
      },
      sort: '-updatedAt',
      where: buildWhere(query),
    })) as unknown as MediaFindResult

    return {
      editor: { status: 'available' },
      items: result.docs.map(mapMediaItem),
      limits: {
        imageMaxBytes: MEDIA_IMAGE_MAX_BYTES,
        mimeTypes: MEDIA_MIME_TYPES,
        pdfMaxBytes: MEDIA_PDF_MAX_BYTES,
      },
      pagination: {
        page: result.page ?? query.page,
        totalDocs: result.totalDocs,
        totalPages: result.totalPages ?? (result.totalDocs === 0 ? 0 : 1),
      },
      query,
    }
  } catch (error) {
    throw new MediaPageReadError(error)
  }
}

const isExplicitlyEnabled = (value: string | undefined): boolean => value === 'true'

export async function loadMediaPageData({
  env,
  payload,
  query,
  req,
  role,
}: {
  env: PortalEnvironment
  payload: Payload
  query: MediaQuery
  req: PayloadRequest
  role: PortalRole
}): Promise<MediaPageData> {
  if (!(MEDIA_MODULE.allowedRoles as readonly PortalRole[]).includes(role)) {
    return { state: 'forbidden', summary: null }
  }
  if (!isExplicitlyEnabled(env.ADMIN_PORTAL_ENABLED)) {
    return { state: 'portal-disabled', summary: null }
  }
  if (!isExplicitlyEnabled(env[MEDIA_MODULE.featureFlag])) {
    return { state: 'module-disabled', summary: null }
  }

  return { state: 'available', summary: await getMediaPage({ payload, query, req }) }
}
