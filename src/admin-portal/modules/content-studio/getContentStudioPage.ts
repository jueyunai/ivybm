import type { Payload, PayloadRequest, Where } from 'payload'

import type { PortalEnvironment, PortalRole } from '@/admin-portal/core/modules/types'
import { mediaPreviewUrl } from '@/admin-portal/modules/media/mediaUrls'

import type {
  ContentStudioPlatform,
  ContentStudioStatus,
  ContentStudioType,
  PublishJobMode,
  PublishJobStatus,
} from './contentStudioCommands'
import { CONTENT_STUDIO_MODULE } from './manifest'

export const CONTENT_STUDIO_STATUS_FILTERS = ['all', 'draft', 'review', 'approved'] as const
export const CONTENT_STUDIO_PLATFORM_FILTERS = ['all', 'facebook', 'instagram', 'linkedin'] as const

export type ContentStudioStatusFilter = (typeof CONTENT_STUDIO_STATUS_FILTERS)[number]
export type ContentStudioPlatformFilter = (typeof CONTENT_STUDIO_PLATFORM_FILTERS)[number]
export type ContentStudioQuery = {
  page: number
  platform: ContentStudioPlatformFilter
  q: string
  status: ContentStudioStatusFilter
}

export type ContentStudioOption = {
  id: number
  label: string
  meta?: string
  previewUrl?: null | string
  reference?: string
}
export type ContentStudioSourceReference = { claim: string; source: string }
export type ContentStudioReview = {
  comments: string | null
  createdAt: string
  decision: 'approved' | 'revision-requested'
  id: number
  reviewer: string | null
}
export type ContentStudioPublishJob = {
  id: number
  mode: PublishJobMode
  scheduledFor: string
  status: PublishJobStatus
  updatedAt: string
}
export type ContentStudioItem = {
  assets: ContentStudioOption[]
  body: string
  contentLocale: 'ar' | 'en'
  contentType: ContentStudioType
  id: number
  knowledgeSources: ContentStudioOption[]
  platform: ContentStudioPlatform
  publishJobs: ContentStudioPublishJob[]
  reviews: ContentStudioReview[]
  sourceReferences: ContentStudioSourceReference[]
  status: ContentStudioStatus
  title: string
  updatedAt: string
}
export type ContentStudioSummary = {
  items: ContentStudioItem[]
  options: { assets: ContentStudioOption[]; knowledgeSources: ContentStudioOption[] }
  pagination: { page: number; totalDocs: number; totalPages: number }
  query: ContentStudioQuery
}
export type ContentStudioPageData = {
  state: 'available' | 'forbidden' | 'module-disabled' | 'portal-disabled'
  summary: ContentStudioSummary | null
}

const first = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value
const stringValue = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null
const idValue = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value
  if (value && typeof value === 'object' && typeof (value as { id?: unknown }).id === 'number')
    return (value as { id: number }).id
  return null
}
const relationOptions = (value: unknown): ContentStudioOption[] => {
  const values = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value]
  return values.flatMap((item) => {
    const id = idValue(item)
    if (id === null) return []
    const record = item && typeof item === 'object' ? (item as Record<string, unknown>) : {}
    const sourceTitle = stringValue(record.sourceTitle)
    const sourceVersion = stringValue(record.sourceVersion)
    const sourceURL = stringValue(record.sourceURL)
    const mimeType = stringValue(record.mimeType)
    return [
      {
        id,
        label: sourceTitle ?? stringValue(record.title) ?? stringValue(record.filename) ?? `#${id}`,
        meta: mimeType ?? undefined,
        ...(mimeType?.startsWith('image/') ? { previewUrl: mediaPreviewUrl(record) } : {}),
        ...(sourceTitle && sourceVersion
          ? { reference: sourceURL ?? `${sourceTitle} v${sourceVersion}` }
          : {}),
      },
    ]
  })
}

export const parseContentStudioQuery = (
  input: Record<string, string | string[] | undefined>,
): ContentStudioQuery => {
  const page = Number.parseInt(first(input.page) ?? '1', 10)
  const platform = first(input.platform)
  const status = first(input.status)
  return {
    page: Number.isSafeInteger(page) && page > 0 ? page : 1,
    platform: CONTENT_STUDIO_PLATFORM_FILTERS.includes(platform as ContentStudioPlatformFilter)
      ? (platform as ContentStudioPlatformFilter)
      : 'all',
    q: (first(input.q) ?? '').trim().slice(0, 80),
    status: CONTENT_STUDIO_STATUS_FILTERS.includes(status as ContentStudioStatusFilter)
      ? (status as ContentStudioStatusFilter)
      : 'all',
  }
}

const buildWhere = (query: ContentStudioQuery): Where => {
  const clauses: Where[] = []
  if (query.status !== 'all') clauses.push({ status: { equals: query.status } })
  if (query.platform !== 'all') clauses.push({ platform: { equals: query.platform } })
  if (query.q)
    clauses.push({ or: [{ title: { contains: query.q } }, { body: { contains: query.q } }] })
  return clauses.length === 0 ? {} : clauses.length === 1 ? clauses[0] : { and: clauses }
}

export class ContentStudioPageReadError extends Error {
  readonly code = 'portal-content-studio-read-failed'
  constructor(cause?: unknown) {
    super('Unable to load Content Studio', cause === undefined ? undefined : { cause })
    this.name = 'ContentStudioPageReadError'
  }
}

export const loadContentStudioPageData = async ({
  env,
  payload,
  query,
  req,
  role,
}: {
  env: PortalEnvironment
  payload: Payload
  query: ContentStudioQuery
  req: PayloadRequest
  role: PortalRole
}): Promise<ContentStudioPageData> => {
  if (env.ADMIN_PORTAL_ENABLED !== 'true') return { state: 'portal-disabled', summary: null }
  if (env.ADMIN_PORTAL_CONTENT_STUDIO_ENABLED !== 'true')
    return { state: 'module-disabled', summary: null }
  if (!(CONTENT_STUDIO_MODULE.allowedRoles as readonly PortalRole[]).includes(role))
    return { state: 'forbidden', summary: null }
  try {
    const contents = await payload.find({
      collection: 'generated-contents',
      depth: 1,
      limit: 20,
      overrideAccess: false,
      page: query.page,
      req,
      select: {
        assets: true,
        body: true,
        contentLocale: true,
        contentType: true,
        knowledgeSources: true,
        platform: true,
        sourceReferences: true,
        status: true,
        title: true,
        updatedAt: true,
      },
      sort: '-updatedAt',
      where: buildWhere(query),
    })
    const ids = contents.docs.map((content) => content.id)
    const [assets, knowledgeSources, reviews, jobs] = await Promise.all([
      payload.find({
        collection: 'media',
        depth: 0,
        limit: 100,
        overrideAccess: false,
        pagination: false,
        req,
        select: {
          alt: true,
          filename: true,
          mimeType: true,
          sizes: { card: true, thumbnail: true },
          thumbnailURL: true,
          url: true,
        },
        sort: '-updatedAt',
        where: { mimeType: { in: ['image/jpeg', 'image/png', 'image/webp'] } },
      }),
      payload.find({
        collection: 'knowledge-documents',
        depth: 0,
        limit: 100,
        overrideAccess: false,
        pagination: false,
        req,
        select: {
          indexStatus: true,
          reviewStatus: true,
          sourceTitle: true,
          sourceURL: true,
          sourceVersion: true,
        },
        sort: '-updatedAt',
        where: {
          and: [{ reviewStatus: { equals: 'reviewed' } }, { indexStatus: { equals: 'ready' } }],
        },
      }),
      ids.length
        ? payload.find({
            collection: 'content-reviews',
            depth: 1,
            limit: 100,
            overrideAccess: false,
            pagination: false,
            req,
            select: {
              comments: true,
              content: true,
              createdAt: true,
              decision: true,
              reviewedBy: true,
            },
            sort: '-createdAt',
            where: { content: { in: ids } },
          })
        : Promise.resolve({ docs: [] }),
      ids.length
        ? payload.find({
            collection: 'publish-jobs',
            depth: 0,
            limit: 100,
            overrideAccess: false,
            pagination: false,
            req,
            select: {
              content: true,
              mode: true,
              scheduledFor: true,
              status: true,
              updatedAt: true,
            },
            sort: '-scheduledFor',
            where: { content: { in: ids } },
          })
        : Promise.resolve({ docs: [] }),
    ])
    const reviewsByContent = new Map<number, ContentStudioReview[]>()
    for (const review of reviews.docs) {
      const contentId = idValue(review.content)
      if (contentId === null) continue
      const reviewer =
        review.reviewedBy && typeof review.reviewedBy === 'object'
          ? stringValue((review.reviewedBy as unknown as Record<string, unknown>).email)
          : null
      const existing = reviewsByContent.get(contentId) ?? []
      existing.push({
        comments: stringValue(review.comments),
        createdAt: String(review.createdAt),
        decision: review.decision === 'approved' ? 'approved' : 'revision-requested',
        id: review.id,
        reviewer,
      })
      reviewsByContent.set(contentId, existing)
    }
    const jobsByContent = new Map<number, ContentStudioPublishJob[]>()
    for (const job of jobs.docs) {
      const contentId = idValue(job.content)
      if (contentId === null) continue
      const existing = jobsByContent.get(contentId) ?? []
      existing.push({
        id: job.id,
        mode: job.mode as PublishJobMode,
        scheduledFor: String(job.scheduledFor),
        status: job.status as PublishJobStatus,
        updatedAt: String(job.updatedAt),
      })
      jobsByContent.set(contentId, existing)
    }
    return {
      state: 'available',
      summary: {
        items: contents.docs.map((content) => ({
          assets: relationOptions(content.assets),
          body: String(content.body),
          contentLocale: content.contentLocale as 'ar' | 'en',
          contentType: content.contentType as ContentStudioType,
          id: content.id,
          knowledgeSources: relationOptions(content.knowledgeSources),
          platform: content.platform as ContentStudioPlatform,
          publishJobs: jobsByContent.get(content.id) ?? [],
          reviews: reviewsByContent.get(content.id) ?? [],
          sourceReferences: Array.isArray(content.sourceReferences)
            ? content.sourceReferences
                .map((source) => ({
                  claim: stringValue(source.claim) ?? '',
                  source: stringValue(source.source) ?? '',
                }))
                .filter((source) => source.claim && source.source)
            : [],
          status: content.status as ContentStudioStatus,
          title: String(content.title),
          updatedAt: String(content.updatedAt),
        })),
        options: {
          assets: assets.docs.map((asset) => ({
            id: asset.id,
            label: stringValue(asset.alt) ?? stringValue(asset.filename) ?? `#${asset.id}`,
            meta: stringValue(asset.mimeType) ?? undefined,
            previewUrl: mediaPreviewUrl(asset),
          })),
          knowledgeSources: knowledgeSources.docs.map((source) => ({
            id: source.id,
            label: String(source.sourceTitle),
            meta: `${source.reviewStatus} / ${source.indexStatus}`,
            reference:
              typeof source.sourceURL === 'string' && source.sourceURL.trim()
                ? source.sourceURL.trim()
                : `${String(source.sourceTitle)} v${String(source.sourceVersion)}`,
          })),
        },
        pagination: {
          page: contents.page ?? query.page,
          totalDocs: contents.totalDocs,
          totalPages: contents.totalPages ?? 1,
        },
        query,
      },
    }
  } catch (error) {
    throw new ContentStudioPageReadError(error)
  }
}
