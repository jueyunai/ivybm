import { Buffer } from 'node:buffer'

import { createLocalReq, getPayload, type Payload, type PayloadRequest } from 'payload'

import { getRoleUser } from '@/access/roles'
import config from '@/payload.config'
import { PortalCommandReceiptError } from '@/admin-portal/core/commands/portalCommandReceipts'
import { readLimitedJSONObject } from '@/admin-portal/core/http/readLimitedJSON'
import {
  KNOWLEDGE_SOURCE_MAX_BYTES,
  KNOWLEDGE_SOURCE_MIME_TYPES,
  KnowledgeIngestionError,
  type KnowledgeSourceFile,
} from '@/modules/knowledge/ingestion/parser'
import { KnowledgeSourceCommandError } from '@/modules/knowledge/ingestion/source'

const MAX_UPLOAD_REQUEST_BYTES = KNOWLEDGE_SOURCE_MAX_BYTES + 1_048_576

export type AuthorizedKnowledgeSourceRequest = {
  payload: Payload
  req: PayloadRequest
  role: 'admin' | 'operator'
}

export const authorizeKnowledgeSourceRequest = async (
  request: Request,
  options: { adminOnly?: boolean } = {},
): Promise<AuthorizedKnowledgeSourceRequest> => {
  if (process.env.ADMIN_PORTAL_ENABLED !== 'true') throw new KnowledgeSourceCommandError('portal-disabled', 'The Portal is disabled', 503)
  if (process.env.ADMIN_PORTAL_KNOWLEDGE_ENABLED !== 'true') throw new KnowledgeSourceCommandError('knowledge-module-disabled', 'The knowledge module is disabled', 503)
  const payload = await getPayload({ config })
  const { user } = await payload.auth({ headers: request.headers })
  const actor = getRoleUser(user)
  if (!user || !actor || (user as { collection?: string }).collection !== 'users') throw new KnowledgeSourceCommandError('knowledge-unauthenticated', 'Authentication required', 401)
  if (actor.role !== 'admin' && actor.role !== 'operator') throw new KnowledgeSourceCommandError('knowledge-forbidden', 'Knowledge access denied', 403)
  if (options.adminOnly && actor.role !== 'admin') throw new KnowledgeSourceCommandError('knowledge-admin-required', 'Administrator access required', 403)
  return { payload, req: await createLocalReq({ user }, payload), role: actor.role }
}

const readBody = async (request: Request): Promise<Buffer> => {
  if (!request.body) return Buffer.alloc(0)
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const next = await reader.read()
      if (next.done) break
      if (next.value.byteLength > MAX_UPLOAD_REQUEST_BYTES - total) {
        await reader.cancel('knowledge source upload is too large').catch(() => undefined)
        throw new KnowledgeSourceCommandError('request-too-large', 'The source upload is too large', 413)
      }
      total += next.value.byteLength
      chunks.push(next.value)
    }
  } finally {
    reader.releaseLock()
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), total)
}

export const readKnowledgeSourceUpload = async (request: Request): Promise<{ file: KnowledgeSourceFile; input: Record<string, unknown> }> => {
  const contentLength = Number.parseInt(request.headers.get('content-length') ?? '0', 10)
  if (Number.isFinite(contentLength) && contentLength > MAX_UPLOAD_REQUEST_BYTES) throw new KnowledgeSourceCommandError('request-too-large', 'The source upload is too large', 413)
  let form: FormData
  try {
    const body = await readBody(request)
    const headers = new Headers(request.headers)
    headers.delete('content-length')
    headers.delete('transfer-encoding')
    form = await new Request(request.url, { body, headers, method: request.method }).formData()
  } catch (error) {
    if (error instanceof KnowledgeSourceCommandError) throw error
    throw new KnowledgeSourceCommandError('invalid-form', 'A multipart DOCX or PDF upload is required', 400)
  }
  const candidate = form.get('file') as null | { arrayBuffer?: () => Promise<ArrayBuffer>; name?: string; size?: number; type?: string }
  if (!candidate || typeof candidate.arrayBuffer !== 'function') throw new KnowledgeSourceCommandError('file-required', 'A source file is required', 400)
  const data = Buffer.from(await candidate.arrayBuffer())
  return {
    file: {
      data,
      mimetype: candidate.type ?? '',
      name: candidate.name ?? '',
      size: candidate.size ?? data.length,
    },
    input: {
      originalLanguage: form.get('originalLanguage'),
      sourceTitle: form.get('sourceTitle'),
      sourceType: form.get('sourceType'),
      sourceVersion: form.get('sourceVersion'),
    },
  }
}

export const readKnowledgeSourceJSON = async (request: Request): Promise<Record<string, unknown>> =>
  readLimitedJSONObject(request, {
    invalid: () => new KnowledgeSourceCommandError('invalid-json', 'A JSON object is required', 400),
    maximumBytes: 16_000,
    tooLarge: () => new KnowledgeSourceCommandError('request-too-large', 'The request is too large', 413),
  })

export const requireKnowledgeSourceID = (value: string): number => {
  const id = Number.parseInt(value, 10)
  if (!Number.isSafeInteger(id) || id <= 0 || String(id) !== value) throw new KnowledgeSourceCommandError('invalid-id', 'A valid source id is required', 400)
  return id
}

export const knowledgeSourceJSON = (body: unknown, init?: ResponseInit): Response => Response.json(body, { ...init, headers: { 'Cache-Control': 'no-store', ...init?.headers } })

export const knowledgeSourceErrorResponse = (error: unknown): Response => {
  if (error instanceof PortalCommandReceiptError || error instanceof KnowledgeSourceCommandError) {
    return knowledgeSourceJSON({ error: { code: error.code, message: error.message } }, { status: error.status })
  }
  if (error instanceof KnowledgeIngestionError) {
    return knowledgeSourceJSON({ error: { code: `knowledge-source-${error.code}`, message: error.message } }, { status: error.status })
  }
  const candidate = error as { name?: unknown; status?: unknown }
  if (candidate?.name === 'ValidationError' || candidate?.status === 400) return knowledgeSourceJSON({ error: { code: 'knowledge-source-validation-failed', message: 'Source validation failed' } }, { status: 400 })
  console.error('portal_knowledge_source_command_failed', { error: error instanceof Error ? error.name : typeof error })
  return knowledgeSourceJSON({ error: { code: 'knowledge-source-command-failed', message: 'Unable to complete the source command' } }, { status: 500 })
}

export const safeKnowledgeSourceSummary = (source: Record<string, unknown>) => ({
  completedAt: typeof source.completedAt === 'string' ? source.completedAt : null,
  detectedLanguage: typeof source.detectedLanguage === 'string' ? source.detectedLanguage : null,
  errorCode: typeof source.errorCode === 'string' ? source.errorCode : null,
  errorSummary: typeof source.errorSummary === 'string' ? source.errorSummary : null,
  filename: typeof source.filename === 'string' ? source.filename : '',
  filesize: typeof source.filesize === 'number' ? source.filesize : 0,
  id: source.id as number | string,
  imageCount: typeof source.imageCount === 'number' ? source.imageCount : 0,
  mimeType: typeof source.mimeType === 'string' && KNOWLEDGE_SOURCE_MIME_TYPES.includes(source.mimeType as never) ? source.mimeType : null,
  processingStage: typeof source.processingStage === 'string' ? source.processingStage : 'queued',
  processingStatus: typeof source.processingStatus === 'string' ? source.processingStatus : 'queued',
  sourceTitle: typeof source.sourceTitle === 'string' ? source.sourceTitle : '',
  sourceType: typeof source.sourceType === 'string' ? source.sourceType : 'other',
  sourceVersion: typeof source.sourceVersion === 'string' ? source.sourceVersion : '',
  updatedAt: typeof source.updatedAt === 'string' ? source.updatedAt : '',
})

export const safeKnowledgeSourceOutput = (document: Record<string, unknown>) => ({
  customerVisible: document.customerVisible === true,
  id: document.id as number | string,
  indexStatus: typeof document.indexStatus === 'string' ? document.indexStatus : 'pending',
  locale: document.locale === 'ar' ? 'ar' : 'en',
  reviewStatus: document.reviewStatus === 'reviewed' ? 'reviewed' : 'draft',
  riskTopics: Array.isArray(document.riskTopics)
    ? document.riskTopics.filter((topic): topic is string => typeof topic === 'string')
    : [],
  sourceTitle: typeof document.sourceTitle === 'string' ? document.sourceTitle : '',
})

export const safeKnowledgeSourceAsset = (asset: Record<string, unknown>, sourceId: number | string) => ({
  id: asset.id as number | string,
  mimeType: typeof asset.mimeType === 'string' ? asset.mimeType : null,
  name: typeof asset.originalName === 'string' ? asset.originalName : '',
  previewURL:
    typeof asset.id === 'number' || typeof asset.id === 'string'
      ? `/api/portal/knowledge/sources/${sourceId}/assets/${asset.id}`
      : null,
  sequence: typeof asset.sequence === 'number' ? asset.sequence : 0,
})
