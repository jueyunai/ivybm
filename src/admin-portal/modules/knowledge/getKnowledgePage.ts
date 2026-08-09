import type { Payload, PayloadRequest, Where } from 'payload'

import { resolvePortalModule } from '@/admin-portal/core/modules'
import type { PortalEnvironment, PortalRole } from '@/admin-portal/core/modules'

import { KNOWLEDGE_MODULE } from './manifest'

export const KNOWLEDGE_REVIEW_FILTERS = ['all', 'draft', 'reviewed', 'archived'] as const
export const KNOWLEDGE_INDEX_FILTERS = ['all', 'pending', 'processing', 'ready', 'failed'] as const
export const KNOWLEDGE_LOCALE_FILTERS = ['all', 'en', 'ar'] as const
export const KNOWLEDGE_VISIBILITY_FILTERS = ['all', 'customer', 'internal'] as const
export const KNOWLEDGE_SOURCE_TYPE_FILTERS = [
  'all',
  'faq',
  'product-manual',
  'technical-specification',
  'sales-script',
  'project-case',
  'other',
] as const

export type KnowledgeReviewStatus = Exclude<(typeof KNOWLEDGE_REVIEW_FILTERS)[number], 'all'>
export type KnowledgeIndexStatus = Exclude<(typeof KNOWLEDGE_INDEX_FILTERS)[number], 'all'>
export type KnowledgeLocale = Exclude<(typeof KNOWLEDGE_LOCALE_FILTERS)[number], 'all'>
export type KnowledgeVisibilityFilter = (typeof KNOWLEDGE_VISIBILITY_FILTERS)[number]
export type KnowledgeSourceType = Exclude<(typeof KNOWLEDGE_SOURCE_TYPE_FILTERS)[number], 'all'>
export type KnowledgeReviewFilter = (typeof KNOWLEDGE_REVIEW_FILTERS)[number]
export type KnowledgeIndexFilter = (typeof KNOWLEDGE_INDEX_FILTERS)[number]
export type KnowledgeLocaleFilter = (typeof KNOWLEDGE_LOCALE_FILTERS)[number]
export type KnowledgeSourceTypeFilter = (typeof KNOWLEDGE_SOURCE_TYPE_FILTERS)[number]

export interface KnowledgeQuery {
  index: KnowledgeIndexFilter
  locale: KnowledgeLocaleFilter
  page: number
  q: string
  review: KnowledgeReviewFilter
  sourceType: KnowledgeSourceTypeFilter
  visibility: KnowledgeVisibilityFilter
}

export interface KnowledgeDocumentSummary {
  customerVisible: boolean
  embeddingModel: null | string
  embeddingSpace: null | string
  id: number | string
  indexStatus: KnowledgeIndexStatus
  indexedAt: null | string
  locale: KnowledgeLocale
  reviewStatus: KnowledgeReviewStatus
  reviewedAt: null | string
  sourceTitle: string
  sourceType: KnowledgeSourceType
  sourceVersion: string
  updatedAt: string
}

export interface KnowledgePromptSummary {
  id: number | string
  key: string
  locale: 'all' | KnowledgeLocale
  model: null | string
  purpose: 'content-generation' | 'conversation-summary' | 'customer-chat' | 'translation'
  status: 'active' | 'archived' | 'draft'
  updatedAt: string
  version: number
}

export interface KnowledgeAiRouteSummary {
  dimensions: null | number
  model: null | string
  operation: 'embedding' | 'text'
  provider: null | string
  status: 'action-required' | 'ready'
  usageKey: string
}

export interface KnowledgePageSummary {
  ai: {
    access: 'admin' | 'admin-only'
    routes: KnowledgeAiRouteSummary[]
  }
  commands: readonly string[]
  counts: {
    draft: number
    failed: number
    processing: number
    ready: number
  }
  documents: KnowledgeDocumentSummary[]
  editor: { status: 'available' }
  pagination: { page: number; totalDocs: number; totalPages: number }
  prompts: KnowledgePromptSummary[]
  query: KnowledgeQuery
  role: 'admin' | 'operator'
}

export type KnowledgePageState = 'available' | 'forbidden' | 'module-disabled' | 'portal-disabled'

export interface KnowledgePageData {
  state: KnowledgePageState
  summary: KnowledgePageSummary | null
}

interface KnowledgeProjection {
  customerVisible?: boolean | null
  embeddingModel?: null | string
  embeddingSpace?: null | string
  id: number | string
  indexStatus?: KnowledgeIndexStatus | null
  indexedAt?: null | string
  locale?: KnowledgeLocale | null
  reviewStatus?: KnowledgeReviewStatus | null
  reviewedAt?: null | string
  sourceTitle?: null | string
  sourceType?: KnowledgeSourceType | null
  sourceVersion?: null | string
  updatedAt: string
}

interface PromptProjection {
  id: number | string
  key?: null | string
  locale?: 'all' | KnowledgeLocale | null
  model?: null | string
  purpose?: KnowledgePromptSummary['purpose'] | null
  status?: KnowledgePromptSummary['status'] | null
  updatedAt: string
  version?: null | number
}

interface FindResult<T> {
  docs: T[]
  page?: number
  totalDocs?: number
  totalPages?: number
}

const PAGE_SIZE = 12
const PROMPT_LIMIT = 6
const REQUIRED_AI_ROUTES = [
  { operation: 'embedding' as const, usageKey: 'knowledge.embedding' },
  { operation: 'text' as const, usageKey: 'chat.reply' },
  { operation: 'text' as const, usageKey: 'knowledge.translation' },
]

const firstValue = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value

const parseEnum = <T extends readonly string[]>(
  values: T,
  value: string | undefined,
  fallback: T[number],
): T[number] => (values.includes(value as T[number]) ? (value as T[number]) : fallback)

export function parseKnowledgeQuery(
  input: Record<string, string | string[] | undefined>,
): KnowledgeQuery {
  const pageValue = Number.parseInt(firstValue(input.page) ?? '1', 10)

  return {
    index: parseEnum(KNOWLEDGE_INDEX_FILTERS, firstValue(input.index), 'all'),
    locale: parseEnum(KNOWLEDGE_LOCALE_FILTERS, firstValue(input.locale), 'all'),
    page: Number.isSafeInteger(pageValue) && pageValue > 0 ? pageValue : 1,
    q: (firstValue(input.q) ?? '').trim().slice(0, 80),
    review: parseEnum(KNOWLEDGE_REVIEW_FILTERS, firstValue(input.review), 'all'),
    sourceType: parseEnum(KNOWLEDGE_SOURCE_TYPE_FILTERS, firstValue(input.sourceType), 'all'),
    visibility: parseEnum(KNOWLEDGE_VISIBILITY_FILTERS, firstValue(input.visibility), 'all'),
  }
}

const buildWhere = (query: KnowledgeQuery): Where => {
  const clauses: Where[] = []
  if (query.q) clauses.push({ sourceTitle: { contains: query.q } })
  if (query.review !== 'all') clauses.push({ reviewStatus: { equals: query.review } })
  if (query.index !== 'all') clauses.push({ indexStatus: { equals: query.index } })
  if (query.locale !== 'all') clauses.push({ locale: { equals: query.locale } })
  if (query.sourceType !== 'all') clauses.push({ sourceType: { equals: query.sourceType } })
  if (query.visibility === 'customer') clauses.push({ customerVisible: { equals: true } })
  if (query.visibility === 'internal') clauses.push({ customerVisible: { equals: false } })
  if (clauses.length === 0) return {}
  if (clauses.length === 1) return clauses[0]
  return { and: clauses }
}

const mapDocument = (document: KnowledgeProjection): KnowledgeDocumentSummary => ({
  customerVisible: document.customerVisible === true,
  embeddingModel: document.embeddingModel ?? null,
  embeddingSpace: document.embeddingSpace ?? null,
  id: document.id,
  indexStatus: document.indexStatus ?? 'pending',
  indexedAt: document.indexedAt ?? null,
  locale: document.locale ?? 'en',
  reviewStatus: document.reviewStatus ?? 'draft',
  reviewedAt: document.reviewedAt ?? null,
  sourceTitle: document.sourceTitle ?? `knowledge-${document.id}`,
  sourceType: document.sourceType ?? 'other',
  sourceVersion: document.sourceVersion ?? '—',
  updatedAt: document.updatedAt,
})

const mapPrompt = (prompt: PromptProjection): KnowledgePromptSummary => ({
  id: prompt.id,
  key: prompt.key ?? `prompt-${prompt.id}`,
  locale: prompt.locale ?? 'all',
  model: prompt.model ?? null,
  purpose: prompt.purpose ?? 'customer-chat',
  status: prompt.status ?? 'draft',
  updatedAt: prompt.updatedAt,
  version: prompt.version ?? 1,
})

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object'

const stringValue = (value: unknown): null | string =>
  typeof value === 'string' && value.trim() ? value : null

const numberValue = (value: unknown): null | number =>
  typeof value === 'number' && Number.isFinite(value) ? value : null

const mapAiRoutes = (documents: unknown[]): KnowledgeAiRouteSummary[] =>
  REQUIRED_AI_ROUTES.map(({ operation, usageKey }) => {
    const route = documents.find((document) => isRecord(document) && document.usageKey === usageKey)
    if (!isRecord(route)) {
      return {
        dimensions: null,
        model: null,
        operation,
        provider: null,
        status: 'action-required',
        usageKey,
      }
    }

    const profile = isRecord(route.profile) ? route.profile : null
    const provider = profile && isRecord(profile.provider) ? profile.provider : null
    const parameters = profile && isRecord(profile.parameters) ? profile.parameters : null
    const model = profile ? stringValue(profile.model) : null
    const dimensions = parameters ? numberValue(parameters.dimensions) : null
    const routeReady =
      route.enabled === true &&
      route.operation === operation &&
      profile?.enabled === true &&
      provider?.enabled === true &&
      provider.apiKeyConfigured === true &&
      model !== null &&
      (operation !== 'embedding' || (dimensions !== null && Number.isInteger(dimensions)))

    return {
      dimensions,
      model,
      operation,
      provider: provider ? stringValue(provider.name) : null,
      status: routeReady ? 'ready' : 'action-required',
      usageKey,
    }
  })

export class KnowledgePageReadError extends Error {
  readonly code = 'portal-knowledge-read-failed'

  constructor(cause?: unknown) {
    super('Unable to read the Portal knowledge page', cause === undefined ? undefined : { cause })
    this.name = 'KnowledgePageReadError'
  }
}

export async function getKnowledgePage({
  payload,
  query,
  req,
  role,
}: {
  payload: Payload
  query: KnowledgeQuery
  req: PayloadRequest
  role: 'admin' | 'operator'
}): Promise<KnowledgePageSummary> {
  try {
    const [ready, draft, processing, failed, documents, prompts, aiRoutes] = await Promise.all([
      payload.count({
        collection: 'knowledge-documents',
        overrideAccess: false,
        req,
        where: {
          and: [{ reviewStatus: { equals: 'reviewed' } }, { indexStatus: { equals: 'ready' } }],
        },
      }),
      payload.count({
        collection: 'knowledge-documents',
        overrideAccess: false,
        req,
        where: { reviewStatus: { equals: 'draft' } },
      }),
      payload.count({
        collection: 'knowledge-documents',
        overrideAccess: false,
        req,
        where: { indexStatus: { equals: 'processing' } },
      }),
      payload.count({
        collection: 'knowledge-documents',
        overrideAccess: false,
        req,
        where: { indexStatus: { equals: 'failed' } },
      }),
      payload.find({
        collection: 'knowledge-documents',
        depth: 0,
        limit: PAGE_SIZE,
        overrideAccess: false,
        page: query.page,
        pagination: true,
        req,
        select: {
          customerVisible: true,
          embeddingModel: true,
          embeddingSpace: true,
          id: true,
          indexStatus: true,
          indexedAt: true,
          locale: true,
          reviewStatus: true,
          reviewedAt: true,
          sourceTitle: true,
          sourceType: true,
          sourceVersion: true,
          updatedAt: true,
        },
        sort: '-updatedAt',
        where: buildWhere(query),
      }),
      payload.find({
        collection: 'prompt-templates',
        depth: 0,
        limit: PROMPT_LIMIT,
        overrideAccess: false,
        pagination: false,
        req,
        select: {
          id: true,
          key: true,
          locale: true,
          model: true,
          purpose: true,
          status: true,
          updatedAt: true,
          version: true,
        },
        sort: '-updatedAt',
      }),
      role === 'admin'
        ? payload.find({
            collection: 'ai-usage-routes',
            depth: 2,
            limit: REQUIRED_AI_ROUTES.length,
            overrideAccess: false,
            pagination: false,
            req,
            select: {
              enabled: true,
              operation: true,
              profile: true,
              usageKey: true,
            },
            where: { usageKey: { in: REQUIRED_AI_ROUTES.map(({ usageKey }) => usageKey) } },
          })
        : Promise.resolve({ docs: [] }),
    ])

    const documentResult = documents as unknown as FindResult<KnowledgeProjection>
    const promptResult = prompts as unknown as FindResult<PromptProjection>
    const routeResult = aiRoutes as unknown as FindResult<unknown>

    return {
      ai: {
        access: role === 'admin' ? 'admin' : 'admin-only',
        routes: role === 'admin' ? mapAiRoutes(routeResult.docs) : [],
      },
      commands:
        role === 'admin'
          ? KNOWLEDGE_MODULE.commands
          : KNOWLEDGE_MODULE.commands.filter((command) => command !== 'knowledge:ai-debug'),
      counts: {
        draft: draft.totalDocs,
        failed: failed.totalDocs,
        processing: processing.totalDocs,
        ready: ready.totalDocs,
      },
      documents: documentResult.docs.map(mapDocument),
      editor: { status: 'available' },
      pagination: {
        page: documentResult.page ?? query.page,
        totalDocs: documentResult.totalDocs ?? documentResult.docs.length,
        totalPages: documentResult.totalPages ?? (documentResult.docs.length === 0 ? 0 : 1),
      },
      prompts: promptResult.docs.map(mapPrompt),
      query,
      role,
    }
  } catch (error) {
    throw new KnowledgePageReadError(error)
  }
}

export async function loadKnowledgePageData({
  env,
  payload,
  query,
  req,
  role,
}: {
  env: PortalEnvironment
  payload: Payload
  query: KnowledgeQuery
  req: PayloadRequest
  role: PortalRole
}): Promise<KnowledgePageData> {
  const resolved = resolvePortalModule({ env, module: KNOWLEDGE_MODULE, role })
  if (!resolved) return { state: 'forbidden', summary: null }
  if (!resolved.featureState.enabled) {
    return {
      state:
        resolved.featureState.reason === 'portal-disabled' ? 'portal-disabled' : 'module-disabled',
      summary: null,
    }
  }

  return {
    state: 'available',
    summary: await getKnowledgePage({
      payload,
      query,
      req,
      role: role as 'admin' | 'operator',
    }),
  }
}
