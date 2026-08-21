import type { Payload, PayloadRequest } from 'payload'

import { KNOWLEDGE_DOCUMENT_MAX_CONTENT_CHARACTERS } from '@/modules/knowledge/limits'

import type {
  KnowledgeIndexStatus,
  KnowledgeLocale,
  KnowledgeReviewStatus,
  KnowledgeSourceType,
} from './getKnowledgePage'

type LooseRecord = Record<string, unknown>

export interface KnowledgeCommandPayload {
  count?: (args: LooseRecord) => Promise<{ totalDocs: number }>
  create?: (args: LooseRecord) => Promise<LooseRecord>
  delete?: (args: LooseRecord) => Promise<LooseRecord>
  find?: (args: LooseRecord) => Promise<{ docs: LooseRecord[] }>
  findByID?: (args: LooseRecord) => Promise<LooseRecord>
  update?: (args: LooseRecord) => Promise<LooseRecord>
}

type KnowledgeCommandPayloadLike = KnowledgeCommandPayload | Payload

export type KnowledgeMutationAction = 'archive' | 'review' | 'save'

export interface ParsedKnowledgeDocument {
  action: KnowledgeMutationAction
  data: LooseRecord
  updatedAt: null | string
}

export interface KnowledgeCommandResult {
  id: number | string
  indexStatus: KnowledgeIndexStatus
  reviewStatus: KnowledgeReviewStatus
  sourceTitle: string
  updatedAt: string
}

export interface KnowledgeEditorOption {
  id: number | string
  label: string
  meta?: string
}

export interface KnowledgeEditorRecord {
  data: {
    content: string
    customerVisible: boolean
    locale: KnowledgeLocale
    sourceFileId: null | number | string
    sourceTitle: string
    sourceType: KnowledgeSourceType
    sourceURL: string
    sourceVersion: string
  }
  id: number | string
  indexStatus: KnowledgeIndexStatus
  reviewStatus: KnowledgeReviewStatus
  updatedAt: string
}

export class KnowledgeCommandError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'KnowledgeCommandError'
  }
}

const SOURCE_TYPES = new Set<KnowledgeSourceType>([
  'faq',
  'product-manual',
  'technical-specification',
  'sales-script',
  'project-case',
  'other',
])

const asRecord = (value: unknown): LooseRecord =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as LooseRecord) : {}

const stringValue = (
  input: LooseRecord,
  key: string,
  { max, required = false }: { max: number; required?: boolean },
): string => {
  const raw = input[key]
  if (raw === undefined || raw === null || typeof raw !== 'string') {
    if (required)
      throw new KnowledgeCommandError('knowledge-invalid-input', `${key} is required`, 400)
    return ''
  }
  const value = raw.trim()
  if (required && !value) {
    throw new KnowledgeCommandError('knowledge-invalid-input', `${key} is required`, 400)
  }
  if (value.length > max) {
    throw new KnowledgeCommandError('knowledge-invalid-input', `${key} is too long`, 400)
  }
  return value
}

const booleanValue = (input: LooseRecord, key: string): boolean => {
  const raw = input[key]
  if (raw === true || raw === 'true' || raw === 1 || raw === '1') return true
  if (raw === false || raw === 'false' || raw === 0 || raw === '0' || raw === undefined) {
    return false
  }
  throw new KnowledgeCommandError('knowledge-invalid-input', `${key} must be a boolean`, 400)
}

const relationID = (value: unknown): null | number | string => {
  if (typeof value === 'number' || typeof value === 'string') return value
  if (value && typeof value === 'object') {
    const id = (value as { id?: unknown }).id
    return typeof id === 'number' || typeof id === 'string' ? id : null
  }
  return null
}

const numericID = (input: LooseRecord, key: string): null | number => {
  const raw = input[key]
  if (raw === undefined || raw === null || raw === '') return null
  const value = typeof raw === 'number' ? raw : Number.parseInt(String(raw), 10)
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new KnowledgeCommandError('knowledge-invalid-input', `${key} must be a positive id`, 400)
  }
  return value
}

const safeSourceURL = (input: LooseRecord): null | string => {
  const value = stringValue(input, 'sourceURL', { max: 2000 })
  if (!value) return null
  try {
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
      throw new Error()
    return url.toString()
  } catch {
    throw new KnowledgeCommandError(
      'knowledge-invalid-source-url',
      'sourceURL must be a safe HTTP or HTTPS URL',
      400,
    )
  }
}

export function parseKnowledgeMutation(value: unknown): ParsedKnowledgeDocument {
  const input = asRecord(value)
  const action = input.action ?? 'save'
  if (!['save', 'review', 'archive'].includes(String(action))) {
    throw new KnowledgeCommandError('knowledge-invalid-action', 'Unsupported knowledge action', 400)
  }
  const normalizedAction = action as KnowledgeMutationAction
  const updatedAt = stringValue(input, 'updatedAt', { max: 100 }) || null
  if (normalizedAction !== 'save') {
    return {
      action: normalizedAction,
      data: { reviewStatus: normalizedAction === 'review' ? 'reviewed' : 'archived' },
      updatedAt,
    }
  }

  const locale = input.locale
  if (locale !== 'en' && locale !== 'ar') {
    throw new KnowledgeCommandError('knowledge-invalid-locale', 'locale must be en or ar', 400)
  }
  const sourceType = input.sourceType
  if (!SOURCE_TYPES.has(sourceType as KnowledgeSourceType)) {
    throw new KnowledgeCommandError('knowledge-invalid-source-type', 'Invalid sourceType', 400)
  }

  return {
    action: normalizedAction,
    data: {
      content: stringValue(input, 'content', {
        max: KNOWLEDGE_DOCUMENT_MAX_CONTENT_CHARACTERS,
        required: true,
      }),
      customerVisible: booleanValue(input, 'customerVisible'),
      embeddingModel: null,
      embeddingSpace: null,
      indexedAt: null,
      indexStatus: 'pending',
      locale,
      reviewStatus: 'draft',
      reviewedAt: null,
      reviewedBy: null,
      sourceFile: numericID(input, 'sourceFileId'),
      sourceTitle: stringValue(input, 'sourceTitle', { max: 500, required: true }),
      sourceType,
      sourceURL: safeSourceURL(input),
      sourceVersion: stringValue(input, 'sourceVersion', { max: 100, required: true }),
    },
    updatedAt,
  }
}

const requireMethod = <T extends keyof KnowledgeCommandPayload>(
  payload: KnowledgeCommandPayloadLike,
  method: T,
): NonNullable<KnowledgeCommandPayload[T]> => {
  const port = payload as KnowledgeCommandPayload
  const value = port[method]
  if (!value) {
    throw new KnowledgeCommandError(
      'knowledge-command-unavailable',
      'Knowledge command unavailable',
      500,
    )
  }
  return value.bind(payload) as NonNullable<KnowledgeCommandPayload[T]>
}

const resultFrom = (document: LooseRecord): KnowledgeCommandResult => ({
  id: document.id as number | string,
  indexStatus:
    document.indexStatus === 'processing' ||
    document.indexStatus === 'ready' ||
    document.indexStatus === 'failed'
      ? document.indexStatus
      : 'pending',
  reviewStatus:
    document.reviewStatus === 'reviewed' || document.reviewStatus === 'archived'
      ? document.reviewStatus
      : 'draft',
  sourceTitle: typeof document.sourceTitle === 'string' ? document.sourceTitle : '',
  updatedAt: typeof document.updatedAt === 'string' ? document.updatedAt : '',
})

const assertRevision = (document: LooseRecord, updatedAt: null | string) => {
  if (!updatedAt || typeof document.updatedAt !== 'string' || document.updatedAt !== updatedAt) {
    throw new KnowledgeCommandError(
      'knowledge-stale',
      'This document changed after the editor was opened. Reload before saving.',
      409,
    )
  }
}

const writeKnowledgeAudit = async ({
  action,
  documentId,
  payload,
  req,
}: {
  action: 'create' | 'delete' | 'update'
  documentId: number | string
  payload: KnowledgeCommandPayloadLike
  req: PayloadRequest
}) => {
  const create = requireMethod(payload, 'create')
  await create({
    collection: 'audit-logs',
    context: { skipAudit: true },
    data: {
      action,
      actor: req.user?.id,
      documentId: String(documentId),
      resource: 'knowledge-documents',
    },
    overrideAccess: true,
    req,
  })
}

export async function createPortalKnowledgeDocument({
  input,
  payload,
  req,
}: {
  input: unknown
  payload: KnowledgeCommandPayloadLike
  req: PayloadRequest
}): Promise<KnowledgeCommandResult> {
  const mutation = parseKnowledgeMutation(input)
  if (mutation.action !== 'save') {
    throw new KnowledgeCommandError(
      'knowledge-invalid-action',
      'New documents must start as drafts',
      400,
    )
  }
  const create = requireMethod(payload, 'create')
  const document = await create({
    collection: 'knowledge-documents',
    context: { skipAudit: true },
    data: mutation.data,
    overrideAccess: false,
    req,
  })
  await writeKnowledgeAudit({
    action: 'create',
    documentId: document.id as number | string,
    payload,
    req,
  })
  return resultFrom(document)
}

export async function updatePortalKnowledgeDocument({
  id,
  input,
  payload,
  req,
}: {
  id: number | string
  input: unknown
  payload: KnowledgeCommandPayloadLike
  req: PayloadRequest
}): Promise<KnowledgeCommandResult> {
  const mutation = parseKnowledgeMutation(input)
  const findByID = requireMethod(payload, 'findByID')
  const current = await findByID({
    collection: 'knowledge-documents',
    depth: 0,
    id,
    overrideAccess: false,
    req,
  })
  assertRevision(current, mutation.updatedAt)
  if (mutation.action === 'review' && current.reviewStatus === 'reviewed')
    return resultFrom(current)
  if (mutation.action === 'archive' && current.reviewStatus === 'archived')
    return resultFrom(current)
  if (mutation.action === 'review' && current.reviewStatus !== 'draft') {
    throw new KnowledgeCommandError(
      'knowledge-invalid-transition',
      'Only a draft knowledge document can be reviewed',
      409,
    )
  }
  if (mutation.action === 'archive' && current.reviewStatus !== 'reviewed') {
    throw new KnowledgeCommandError(
      'knowledge-invalid-transition',
      'Only a reviewed knowledge document can be archived',
      409,
    )
  }
  if (mutation.action === 'save' && current.indexStatus === 'processing') {
    throw new KnowledgeCommandError(
      'knowledge-index-processing',
      'Wait for the active index operation before editing this document',
      409,
    )
  }

  const update = requireMethod(payload, 'update')
  const document = await update({
    collection: 'knowledge-documents',
    context: { skipAudit: true },
    data: mutation.data,
    id,
    overrideAccess: false,
    overrideLock: false,
    req,
  })
  await writeKnowledgeAudit({
    action: 'update',
    documentId: document.id as number | string,
    payload,
    req,
  })
  return resultFrom(document)
}

export async function deletePortalKnowledgeDocument({
  id,
  payload,
  req,
  updatedAt,
}: {
  id: number | string
  payload: KnowledgeCommandPayloadLike
  req: PayloadRequest
  updatedAt: string
}): Promise<KnowledgeCommandResult> {
  const findByID = requireMethod(payload, 'findByID')
  const current = await findByID({
    collection: 'knowledge-documents',
    depth: 0,
    id,
    overrideAccess: false,
    req,
  })
  assertRevision(current, updatedAt)
  if (current.indexStatus === 'processing') {
    throw new KnowledgeCommandError(
      'knowledge-index-processing',
      'Wait for the active index operation before deleting this document',
      409,
    )
  }

  const count = requireMethod(payload, 'count')
  const usage = await count({
    collection: 'generated-contents',
    overrideAccess: false,
    req,
    where: { knowledgeSources: { equals: id } },
  })
  if (usage.totalDocs > 0) {
    throw new KnowledgeCommandError(
      'knowledge-in-use',
      'This document is used as a source by generated content and cannot be deleted.',
      409,
    )
  }

  const chunks = await count({
    collection: 'knowledge-chunks',
    overrideAccess: false,
    req,
    where: { document: { equals: id } },
  })
  if (chunks.totalDocs > 0) {
    throw new KnowledgeCommandError(
      'knowledge-indexed',
      'Indexed documents must be archived instead of deleted.',
      409,
    )
  }

  const deleteDocument = requireMethod(payload, 'delete')
  const document = await deleteDocument({
    collection: 'knowledge-documents',
    context: { skipAudit: true },
    id,
    overrideAccess: false,
    overrideLock: false,
    req,
  })
  await writeKnowledgeAudit({
    action: 'delete',
    documentId: document.id as number | string,
    payload,
    req,
  })
  return resultFrom(document)
}

export async function getPortalKnowledgeEditor({
  id,
  payload,
  req,
}: {
  id: number | string
  payload: KnowledgeCommandPayloadLike
  req: PayloadRequest
}): Promise<KnowledgeEditorRecord> {
  const findByID = requireMethod(payload, 'findByID')
  const document = await findByID({
    collection: 'knowledge-documents',
    depth: 1,
    id,
    overrideAccess: false,
    req,
  })
  const result = resultFrom(document)
  return {
    data: {
      content: typeof document.content === 'string' ? document.content : '',
      customerVisible: document.customerVisible === true,
      locale: document.locale === 'ar' ? 'ar' : 'en',
      sourceFileId: relationID(document.sourceFile),
      sourceTitle: result.sourceTitle,
      sourceType: SOURCE_TYPES.has(document.sourceType as KnowledgeSourceType)
        ? (document.sourceType as KnowledgeSourceType)
        : 'other',
      sourceURL: typeof document.sourceURL === 'string' ? document.sourceURL : '',
      sourceVersion: typeof document.sourceVersion === 'string' ? document.sourceVersion : '',
    },
    id: result.id,
    indexStatus: result.indexStatus,
    reviewStatus: result.reviewStatus,
    updatedAt: result.updatedAt,
  }
}

export async function getPortalKnowledgeOptions({
  payload,
  req,
}: {
  payload: KnowledgeCommandPayloadLike
  req: PayloadRequest
}): Promise<{ media: KnowledgeEditorOption[] }> {
  const find = requireMethod(payload, 'find')
  const result = await find({
    collection: 'media',
    depth: 0,
    limit: 200,
    overrideAccess: false,
    pagination: false,
    req,
    select: { alt: true, filename: true, id: true, mimeType: true },
    sort: '-updatedAt',
  })
  return {
    media: result.docs.map((document) => ({
      id: document.id as number | string,
      label:
        typeof document.filename === 'string'
          ? document.filename
          : typeof document.alt === 'string'
            ? document.alt
            : String(document.id),
      meta: typeof document.mimeType === 'string' ? document.mimeType : undefined,
    })),
  }
}
