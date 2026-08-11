import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { sql, type PostgresAdapter } from '@payloadcms/db-postgres'
import {
  commitTransaction,
  createLocalReq,
  initTransaction,
  killTransaction,
  type Payload,
  type PayloadRequest,
} from 'payload'

import { resolveAiGateway, AI_USAGE_KEYS } from '@/modules/ai/registry'
import { PayloadJobQueue } from '@/modules/jobs/claim'
import type { JobHandler, JobRecord, JobRetryActor } from '@/modules/jobs/contracts'
import type { KnowledgeDocument } from '@/payload-types'

import {
  KNOWLEDGE_SOURCE_MAX_BYTES,
  KNOWLEDGE_INGESTION_PARSER_VERSION,
  parseKnowledgeSource,
  type KnowledgeSourceFile,
  type ParsedKnowledgeSource,
} from './parser'
import {
  detectKnowledgeRiskTopics,
  resolveKnowledgeTranslationPrompt,
  translateKnowledgeText,
  type KnowledgeRiskTopic,
  type TranslationPrompt,
} from './translation'

export const KNOWLEDGE_INGEST_JOB_TYPE = 'knowledge.ingest'

export type KnowledgeIngestJobPayload = {
  requestedBy: number | null
  sourceHash: string
  sourceId: number
  sourceRevision: string
}

export type KnowledgeIngestionPayloadPort = Pick<
  Payload,
  'create' | 'delete' | 'find' | 'findByID' | 'update'
>

type IngestionDependencies = {
  parse?: (file: KnowledgeSourceFile) => ParsedKnowledgeSource | Promise<ParsedKnowledgeSource>
  readFile?: (filename: string) => Promise<Buffer>
  resolveGateway?: typeof resolveAiGateway
  resolvePrompt?: typeof resolveKnowledgeTranslationPrompt
}

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}

const requiredString = (value: unknown, field: string): string => {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Invalid ingestion job ${field}`)
  return value.trim()
}

const positiveInteger = (value: unknown, field: string): number => {
  const result = typeof value === 'number' ? value : Number(value)
  if (!Number.isSafeInteger(result) || result <= 0) throw new Error(`Invalid ingestion job ${field}`)
  return result
}

const optionalPositiveInteger = (value: unknown): number | null => {
  if (value === null || value === undefined) return null
  return positiveInteger(value, 'requestedBy')
}

export const parseKnowledgeIngestJobPayload = (value: Record<string, unknown>): KnowledgeIngestJobPayload => ({
  requestedBy: optionalPositiveInteger(value.requestedBy),
  sourceHash: requiredString(value.sourceHash, 'sourceHash'),
  sourceId: positiveInteger(value.sourceId, 'sourceId'),
  sourceRevision: requiredString(value.sourceRevision, 'sourceRevision'),
})

const sourceFilePath = (filename: string): string => {
  if (
    !filename ||
    filename === '.' ||
    filename === '..' ||
    filename.includes('\0') ||
    path.basename(filename) !== filename
  ) {
    throw new Error('Invalid source file name')
  }
  return path.join(process.cwd(), 'private/knowledge-sources', filename)
}

const databaseForRequest = async (payload: Payload, req: PayloadRequest) => {
  const adapter = payload.db as unknown as PostgresAdapter
  const transactionID = await req.transactionID
  if (!transactionID) return adapter.drizzle
  const database = adapter.sessions[transactionID]?.db
  if (!database) throw new Error('Knowledge ingestion transaction session is unavailable')
  return database
}

const sourceUpdateWasApplied = (result: { rows: unknown[] }): void => {
  if (!result.rows[0]) throw new Error('Knowledge ingestion source lease was lost')
}

const claimSourceForJob = async ({
  job,
  payload,
  sourceId,
  sourceRevision,
}: {
  job: Parameters<JobHandler>[0]
  payload: Payload
  sourceId: number
  sourceRevision: string
}) => {
  const pool = (payload.db as unknown as PostgresAdapter).pool
  const result = await pool.query(
    `UPDATE knowledge_source_documents AS source
        SET current_job_id = $2,
            current_job_owner_token = $3,
            error_code = NULL,
            error_summary = NULL,
            processing_stage = 'parsing',
            processing_status = 'processing',
            updated_at = NOW()
      WHERE source.id = $1
        AND source.ingestion_revision = $4
        AND EXISTS (
          SELECT 1 FROM jobs
          WHERE jobs.id = $2
            AND jobs.owner_token = $3
            AND jobs.status = 'processing'
            AND jobs.lease_expires_at > NOW()
        )
    RETURNING source.id`,
    [sourceId, job.id, job.ownerToken, sourceRevision],
  )
  sourceUpdateWasApplied(result)
}

const persistParsedSource = async ({
  job,
  parsed,
  payload,
  sourceId,
  sourceRevision,
}: {
  job: Parameters<JobHandler>[0]
  parsed: ParsedKnowledgeSource
  payload: Payload
  sourceId: number
  sourceRevision: string
}) => {
  const pool = (payload.db as unknown as PostgresAdapter).pool
  const result = await pool.query(
    `UPDATE knowledge_source_documents AS source
        SET detected_language = $4,
            extracted_text = $5,
            image_count = $6,
            page_count = $7,
            paragraph_count = $8,
            parser_version = $10,
            processing_stage = 'translating',
            updated_at = NOW()
      WHERE source.id = $1
        AND source.ingestion_revision = $9
        AND source.current_job_id = $2
        AND source.current_job_owner_token = $3
        AND EXISTS (
          SELECT 1 FROM jobs
          WHERE jobs.id = $2
            AND jobs.owner_token = $3
            AND jobs.status = 'processing'
            AND jobs.lease_expires_at > NOW()
        )
    RETURNING source.id`,
    [
      sourceId,
      job.id,
      job.ownerToken,
      parsed.detectedLanguage,
      parsed.text,
      parsed.images.length,
      parsed.pageCount,
      parsed.paragraphCount,
      sourceRevision,
      KNOWLEDGE_INGESTION_PARSER_VERSION,
    ],
  )
  sourceUpdateWasApplied(result)
}

const persistSourceFailure = async ({
  code,
  job,
  payload,
  sourceId,
  sourceRevision,
  summary,
}: {
  code: string
  job: Parameters<JobHandler>[0]
  payload: Payload
  sourceId: number
  sourceRevision: string
  summary: string
}) => {
  const pool = (payload.db as unknown as PostgresAdapter).pool
  await pool.query(
    `UPDATE knowledge_source_documents AS source
        SET error_code = $4,
            error_summary = $5,
            processing_stage = 'queued',
            processing_status = 'failed',
            current_job_owner_token = NULL,
            updated_at = NOW()
      WHERE source.id = $1
        AND source.ingestion_revision = $6
        AND source.current_job_id = $2
        AND source.current_job_owner_token = $3
        AND EXISTS (
          SELECT 1 FROM jobs
          WHERE jobs.id = $2
            AND jobs.owner_token = $3
            AND jobs.status = 'processing'
        )`,
    [sourceId, job.id, job.ownerToken, code, summary, sourceRevision],
  )
}

const safeFailure = (error: unknown): { code: string; summary: string } => {
  const code = error && typeof error === 'object' && typeof (error as { code?: unknown }).code === 'string'
    ? (error as { code: string }).code.slice(0, 100)
    : 'ingestion-failed'
  const known: Record<string, string> = {
    'external-docx-relation': 'The document contains an external relationship',
    'file-signature-mismatch': 'The file signature does not match its declared type',
    'image-too-large': 'An embedded image exceeds the allowed size',
    'image-signature-mismatch': 'An embedded image has an invalid file signature',
    'invalid-docx': 'The DOCX document is invalid',
    'invalid-docx-archive': 'The DOCX archive is invalid',
    'invalid-docx-image': 'A referenced DOCX image is missing',
    'invalid-pdf': 'The PDF document is invalid',
    'ocr-required': 'This PDF needs OCR before it can be translated',
    'pdf-page-limit': 'The PDF contains too many pages',
    'pdf-password-required': 'The PDF is password protected',
    'text-too-large': 'The extracted text exceeds the allowed size',
    'translation-prompt-ambiguous': 'The translation prompt configuration is ambiguous',
    'translation-prompt-unavailable': 'An active translation prompt is not configured',
    'translation-fidelity': 'The translation changed a required number or image placeholder',
    'translation-empty': 'The translation provider returned empty text',
    'translation-too-large': 'The document is too large to translate safely',
    'unsupported-image': 'The document contains an unsupported image',
  }
  return { code, summary: known[code] ?? 'The document could not be processed safely' }
}

const sourceLocale = (source: Record<string, unknown>, parsed: ParsedKnowledgeSource): string => {
  const explicit = source.originalLanguage
  if (explicit === 'en' || explicit === 'ar' || explicit === 'zh') return explicit
  return parsed.detectedLanguage
}

const sourceDocumentInput = (source: Record<string, unknown>, locale: 'en' | 'ar', content: string, model: string, promptVersion: number, sourceHash: string, riskTopics: KnowledgeRiskTopic[]) => ({
  content,
  customerVisible: false,
  generationModel: model,
  generationPromptVersion: promptVersion,
  ingestionSource: Number(source.id),
  indexStatus: 'pending' as const,
  locale,
  reviewStatus: 'draft' as const,
  reviewedAt: null,
  reviewedBy: null,
  riskTopics: riskTopics as KnowledgeDocument['riskTopics'],
  sourceAnchor: `knowledge-source:${source.id}`,
  sourceHash,
  sourceTitle: typeof source.sourceTitle === 'string' ? source.sourceTitle : 'Knowledge source',
  sourceType: (typeof source.sourceType === 'string' ? source.sourceType : 'other') as KnowledgeDocument['sourceType'],
  sourceVersion: typeof source.sourceVersion === 'string' ? source.sourceVersion : '1',
})

const upsertKnowledgeDocument = async ({
  content,
  locale,
  model,
  payload,
  promptVersion,
  req,
  riskTopics,
  source,
  sourceHash,
}: {
  content: string
  locale: 'en' | 'ar'
  model: string
  payload: KnowledgeIngestionPayloadPort
  promptVersion: number
  req?: unknown
  riskTopics: KnowledgeRiskTopic[]
  source: Record<string, unknown>
  sourceHash: string
}) => {
  const existingResult = await payload.find({
    collection: 'knowledge-documents',
    depth: 0,
    limit: 2,
    overrideAccess: true,
    pagination: false,
    ...(req ? { req } : {}),
    where: { and: [{ ingestionSource: { equals: source.id } }, { locale: { equals: locale } }] },
  })
  const existing = existingResult.docs[0] as { id?: number | string } | undefined
  const data = sourceDocumentInput(source, locale, content, model, promptVersion, sourceHash, riskTopics)
  if (existing?.id !== undefined) {
    return payload.update({
      collection: 'knowledge-documents',
      context: { knowledgeIngestion: true, skipAudit: true },
      data,
      id: existing.id,
      overrideAccess: true,
      ...(req ? { req } : {}),
    })
  }
  return payload.create({
    collection: 'knowledge-documents',
    context: { knowledgeIngestion: true, skipAudit: true },
    data,
    overrideAccess: true,
    ...(req ? { req } : {}),
  })
}

const createAsset = async ({
  asset,
  payload,
  req,
  sourceId,
}: {
  asset: ParsedKnowledgeSource['images'][number]
  payload: KnowledgeIngestionPayloadPort
  req?: unknown
  sourceId: number
}) => payload.create({
  collection: 'knowledge-source-assets',
  context: { knowledgeIngestion: true, skipAudit: true },
  data: {
    accessibility: 'preview-only',
    byteSize: asset.data.length,
    originalName: asset.name,
    sequence: asset.sequence,
    sha256: asset.sha256,
    source: sourceId,
  },
  file: { data: asset.data, mimetype: asset.mimeType, name: `source-${sourceId}-${asset.sequence}-${asset.name}`, size: asset.data.length },
  overrideAccess: true,
  ...(req ? { req } : {}),
})

const finalizeKnowledgeIngestion = async ({
  arabic,
  arPrompt,
  english,
  enPrompt,
  input,
  job,
  parsed,
  payload,
  riskTopics,
  source,
}: {
  arabic: Awaited<ReturnType<typeof translateKnowledgeText>>
  arPrompt: TranslationPrompt
  english: Awaited<ReturnType<typeof translateKnowledgeText>>
  enPrompt: TranslationPrompt
  input: KnowledgeIngestJobPayload
  job: Parameters<JobHandler>[0]
  parsed: ParsedKnowledgeSource
  payload: Payload
  riskTopics: KnowledgeRiskTopic[]
  source: Record<string, unknown>
}) => {
  const req = await createLocalReq({}, payload)
  await initTransaction(req)
  try {
    const database = await databaseForRequest(payload, req)
    const locked = await database.execute(sql`
      SELECT source.id
      FROM knowledge_source_documents AS source
      JOIN jobs AS ingestion_job ON ingestion_job.id = ${job.id}
      WHERE source.id = ${input.sourceId}
        AND source.ingestion_revision = ${input.sourceRevision}
        AND source.current_job_id = ${job.id}
        AND source.current_job_owner_token = ${job.ownerToken}
        AND ingestion_job.owner_token = ${job.ownerToken}
        AND ingestion_job.status = 'processing'
        AND ingestion_job.lease_expires_at > NOW()
      FOR UPDATE OF source, ingestion_job
    `)
    if (!locked.rows[0]) throw new Error('Knowledge ingestion source lease was lost')

    await payload.update({
      collection: 'knowledge-source-documents',
      context: { knowledgeIngestion: true, skipAudit: true },
      data: { processingStage: 'finalizing' },
      id: input.sourceId,
      overrideAccess: true,
      req,
    })
    await payload.delete({
      collection: 'knowledge-source-assets',
      context: { knowledgeIngestion: true, skipAudit: true },
      overrideAccess: true,
      req,
      where: { source: { equals: input.sourceId } },
    })
    for (const image of parsed.images) {
      await createAsset({ asset: image, payload, req, sourceId: input.sourceId })
    }
    await upsertKnowledgeDocument({
      content: english.text,
      locale: 'en',
      model: english.model,
      payload,
      promptVersion: enPrompt.version,
      req,
      riskTopics: [...riskTopics],
      source,
      sourceHash: input.sourceHash,
    })
    await upsertKnowledgeDocument({
      content: arabic.text,
      locale: 'ar',
      model: arabic.model,
      payload,
      promptVersion: arPrompt.version,
      req,
      riskTopics: [...riskTopics],
      source,
      sourceHash: input.sourceHash,
    })
    await payload.update({
      collection: 'knowledge-source-documents',
      context: { knowledgeIngestion: true, skipAudit: true },
      data: {
        completedAt: new Date().toISOString(),
        currentJobId: job.id,
        currentJobOwnerToken: null,
        processingStage: 'complete',
        processingStatus: 'needs_review',
      },
      id: input.sourceId,
      overrideAccess: true,
      req,
    })
    await commitTransaction(req)
  } catch (error) {
    await killTransaction(req).catch(() => undefined)
    throw error
  }
}

export const enqueueKnowledgeIngestJob = async ({
  manualRetryActor,
  payload,
  req,
  requestedBy,
  sourceHash,
  sourceId,
  sourceRevision,
}: {
  manualRetryActor?: JobRetryActor
  payload: KnowledgeIngestionPayloadPort
  req?: PayloadRequest
  requestedBy: number | null
  sourceHash: string
  sourceId: number
  sourceRevision: string
}): Promise<{ job: JobRecord; state: 'created' | 'duplicate' }> => {
  const queue = new PayloadJobQueue({ payload: payload as Payload })
  const enqueued = await queue.enqueue({
    idempotencyKey: [KNOWLEDGE_INGEST_JOB_TYPE, sourceId, sourceRevision].join(':'),
    payload: { requestedBy, sourceHash, sourceId, sourceRevision },
    type: KNOWLEDGE_INGEST_JOB_TYPE,
  }, req)
  if (
    manualRetryActor?.role === 'admin' &&
    enqueued.state === 'duplicate' &&
    (enqueued.job.status === 'dead' || enqueued.job.status === 'failed')
  ) {
    return { job: await queue.retryManually(enqueued.job.id, manualRetryActor, req), state: 'created' }
  }
  return enqueued
}

export const createKnowledgeIngestJobHandler = ({
  payload,
  parse = parseKnowledgeSource,
  readFile: readSourceFile = async (filename) => readFile(sourceFilePath(filename)),
  resolveGateway: resolveTranslationGateway = resolveAiGateway,
  resolvePrompt: resolveTranslationPrompt = resolveKnowledgeTranslationPrompt,
}: {
  payload: KnowledgeIngestionPayloadPort
} & IngestionDependencies): JobHandler => async (job, execution) => {
  const fullPayload = payload as Payload
  const input = parseKnowledgeIngestJobPayload(job.payload)
  const source = record(await payload.findByID({ collection: 'knowledge-source-documents', depth: 0, id: input.sourceId, overrideAccess: true }))
  if (!source.id || source.sourceHash !== input.sourceHash || source.ingestionRevision !== input.sourceRevision) return
  const filename = typeof source.filename === 'string' ? source.filename : ''
  const mimeType = typeof source.mimeType === 'string' ? source.mimeType : ''
  const filesize = typeof source.filesize === 'number' ? source.filesize : 0
  if (!filename || !mimeType || !Number.isSafeInteger(filesize) || filesize <= 0 || filesize > KNOWLEDGE_SOURCE_MAX_BYTES) {
    throw new Error('Source file metadata is invalid')
  }

  const setFailure = async (error: unknown): Promise<void> => {
    const failure = safeFailure(error)
    await persistSourceFailure({
      code: failure.code,
      job,
      payload: fullPayload,
      sourceId: input.sourceId,
      sourceRevision: input.sourceRevision,
      summary: failure.summary,
    }).catch(() => undefined)
  }

  try {
    execution.assertLease()
    await claimSourceForJob({
      job,
      payload: fullPayload,
      sourceId: input.sourceId,
      sourceRevision: input.sourceRevision,
    })
    const data = await readSourceFile(filename)
    if (data.length !== filesize || data.length > KNOWLEDGE_SOURCE_MAX_BYTES) throw new Error('Source file size is invalid')
    execution.assertLease()
    const parsed = await parse({ data, mimetype: mimeType, name: filename, size: data.length })
    execution.assertLease()
    await persistParsedSource({
      job,
      parsed,
      payload: fullPayload,
      sourceId: input.sourceId,
      sourceRevision: input.sourceRevision,
    })
    const [gateway, enPrompt, arPrompt] = await Promise.all([
      resolveTranslationGateway({
        allowEnvironmentFallback: false,
        payload: payload as Payload,
        routes: [{ operation: 'text', usageKey: AI_USAGE_KEYS.knowledgeTranslation }],
      }),
      resolveTranslationPrompt({ locale: 'en', payload: payload as Payload }),
      resolveTranslationPrompt({ locale: 'ar', payload: payload as Payload }),
    ])
    const locale = sourceLocale(source, parsed)
    const [english, arabic] = await Promise.all([
      translateKnowledgeText({ gateway, prompt: enPrompt, sourceLocale: locale, targetLocale: 'en', text: parsed.text }),
      translateKnowledgeText({ gateway, prompt: arPrompt, sourceLocale: locale, targetLocale: 'ar', text: parsed.text }),
    ])
    execution.assertLease()
    const riskTopics = detectKnowledgeRiskTopics(`${parsed.text}\n${english.text}\n${arabic.text}`)
    await finalizeKnowledgeIngestion({
      arabic,
      arPrompt,
      english,
      enPrompt,
      input,
      job,
      parsed,
      payload: fullPayload,
      riskTopics,
      source,
    })
  } catch (error) {
    if (execution.signal.aborted) throw error
    try {
      execution.assertLease()
    } catch {
      throw error
    }
    await setFailure(error)
    throw error
  }
}

export const createKnowledgeIngestJobHandlerWithDefaults = createKnowledgeIngestJobHandler

export { TranslationPrompt }
