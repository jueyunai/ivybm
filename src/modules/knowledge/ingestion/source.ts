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

import { PayloadJobQueue } from '@/modules/jobs/claim'
import type { JobRecord, JobRetryActor } from '@/modules/jobs/contracts'

import {
  KNOWLEDGE_SOURCE_MAX_BYTES,
  KNOWLEDGE_SOURCE_MIME_TYPES,
  type KnowledgeSourceFile,
  sha256,
  validateKnowledgeSourceFile,
} from './parser'
import { KNOWLEDGE_INGEST_JOB_TYPE, enqueueKnowledgeIngestJob } from './jobs'

export const KNOWLEDGE_SOURCE_TYPES = [
  'faq',
  'product-manual',
  'technical-specification',
  'sales-script',
  'project-case',
  'other',
] as const

export type KnowledgeSourceType = (typeof KNOWLEDGE_SOURCE_TYPES)[number]
export type KnowledgeSourceLanguage = 'ar' | 'auto' | 'en' | 'zh'

export type KnowledgeSourceMetadata = {
  originalLanguage: KnowledgeSourceLanguage
  sourceTitle: string
  sourceType: KnowledgeSourceType
  sourceVersion: string
}

export type KnowledgeIngestionPayload = Pick<
  Payload,
  'create' | 'delete' | 'find' | 'findByID' | 'update'
>

export class KnowledgeSourceCommandError extends Error {
  readonly code: string
  readonly status: number

  constructor(code: string, message: string, status = 400) {
    super(message)
    this.name = 'KnowledgeSourceCommandError'
    this.code = code
    this.status = status
  }
}

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}

const textValue = (input: Record<string, unknown>, key: string, maximum: number, required = false): string => {
  const value = input[key]
  if (typeof value !== 'string') {
    if (required) throw new KnowledgeSourceCommandError('invalid-input', `${key} is required`)
    return ''
  }
  const normalized = value.trim()
  if (required && !normalized) throw new KnowledgeSourceCommandError('invalid-input', `${key} is required`)
  if (normalized.length > maximum) throw new KnowledgeSourceCommandError('invalid-input', `${key} is too long`)
  return normalized
}

export const parseKnowledgeSourceMetadata = (value: unknown): KnowledgeSourceMetadata => {
  const input = asRecord(value)
  const sourceType = textValue(input, 'sourceType', 80, true)
  if (!KNOWLEDGE_SOURCE_TYPES.includes(sourceType as KnowledgeSourceType)) {
    throw new KnowledgeSourceCommandError('invalid-source-type', 'The source type is invalid')
  }
  const originalLanguage = textValue(input, 'originalLanguage', 10) || 'auto'
  if (!['auto', 'en', 'ar', 'zh'].includes(originalLanguage)) {
    throw new KnowledgeSourceCommandError('invalid-language', 'The source language is invalid')
  }
  return {
    originalLanguage: originalLanguage as KnowledgeSourceLanguage,
    sourceTitle: textValue(input, 'sourceTitle', 500, true),
    sourceType: sourceType as KnowledgeSourceType,
    sourceVersion: textValue(input, 'sourceVersion', 100, true),
  }
}

export const sourceIngestionRevision = (hash: string, version: string): string => `${hash}:${version}`

export const knowledgeSourceFileToUpload = (file: KnowledgeSourceFile) => ({
  data: file.data,
  mimetype: file.mimetype,
  name: file.name,
  size: file.size,
})

const sourceMatch = (source: Record<string, unknown>, hash: string, version: string): boolean =>
  source.sourceHash === hash && source.sourceVersion === version

const lockKnowledgeSourceRevision = async (
  payload: KnowledgeIngestionPayload,
  req: PayloadRequest,
  ingestionRevision: string,
): Promise<void> => {
  const transactionID = await req.transactionID
  if (!transactionID) throw new Error('Knowledge source transaction session is unavailable')
  const adapter = (payload as Payload).db as unknown as PostgresAdapter
  const database = adapter.sessions[transactionID]?.db
  if (!database) throw new Error('Knowledge source transaction database is unavailable')
  await database.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${ingestionRevision}, 0))`)
}

export type KnowledgeSourceCommandResult = {
  /** Job metadata safe to return through the Portal API; lease/payload data is server-only. */
  job: Pick<
    JobRecord,
    | 'attempts'
    | 'completedAt'
    | 'createdAt'
    | 'deadAt'
    | 'id'
    | 'manualRetryCount'
    | 'maxAttempts'
    | 'nextRunAt'
    | 'status'
    | 'type'
    | 'updatedAt'
  >
  source: {
    id: number | string
    ingestionRevision: string
    processingStage: string
    processingStatus: string
    sourceHash: string
    sourceTitle: string
    sourceVersion: string
  }
  state: 'created' | 'duplicate'
}

const safeJob = (job: JobRecord): KnowledgeSourceCommandResult['job'] => ({
  attempts: job.attempts,
  completedAt: job.completedAt,
  createdAt: job.createdAt,
  deadAt: job.deadAt,
  id: job.id,
  manualRetryCount: job.manualRetryCount,
  maxAttempts: job.maxAttempts,
  nextRunAt: job.nextRunAt,
  status: job.status,
  type: job.type,
  updatedAt: job.updatedAt,
})

const resultFrom = (source: Record<string, unknown>, job: JobRecord, state: 'created' | 'duplicate'): KnowledgeSourceCommandResult => ({
  job: safeJob(job),
  source: {
    id: source.id as number | string,
    ingestionRevision: typeof source.ingestionRevision === 'string' ? source.ingestionRevision : '',
    processingStage: typeof source.processingStage === 'string' ? source.processingStage : 'queued',
    processingStatus: typeof source.processingStatus === 'string' ? source.processingStatus : 'queued',
    sourceHash: typeof source.sourceHash === 'string' ? source.sourceHash : '',
    sourceTitle: typeof source.sourceTitle === 'string' ? source.sourceTitle : '',
    sourceVersion: typeof source.sourceVersion === 'string' ? source.sourceVersion : '',
  },
  state,
})

export const createKnowledgeSourceAndEnqueue = async ({
  file,
  metadata,
  payload,
  req,
}: {
  file: KnowledgeSourceFile
  metadata: unknown
  payload: KnowledgeIngestionPayload
  req: PayloadRequest
}): Promise<KnowledgeSourceCommandResult> => {
  const run = async (commandReq: PayloadRequest): Promise<KnowledgeSourceCommandResult> => {
    const validFile = validateKnowledgeSourceFile(file)
    const parsedMetadata = parseKnowledgeSourceMetadata(metadata)
    const sourceHash = sha256(validFile.data)
    const ingestionRevision = sourceIngestionRevision(sourceHash, parsedMetadata.sourceVersion)
    // Serialize the empty-read/create boundary for one hash + version. The lock
    // belongs to the surrounding transaction, so a concurrent command waits
    // until the winner's source and Job are both committed before re-reading.
    await lockKnowledgeSourceRevision(payload, commandReq, ingestionRevision)
    const existingResult = await payload.find({
      collection: 'knowledge-source-documents',
      depth: 0,
      limit: 2,
      overrideAccess: false,
      pagination: false,
      req: commandReq,
      where: {
        and: [
          { sourceHash: { equals: sourceHash } },
          { sourceVersion: { equals: parsedMetadata.sourceVersion } },
        ],
      },
    })
    const existing = (existingResult.docs as unknown[]).map(asRecord).find((source) => sourceMatch(source, sourceHash, parsedMetadata.sourceVersion))
    if (existing?.id !== undefined) {
      const jobResult = await enqueueKnowledgeIngestJob({
        payload,
        req: commandReq,
        requestedBy: Number(commandReq.user?.id) || null,
        sourceId: existing.id as number,
        sourceHash,
        sourceRevision: ingestionRevision,
      })
      return resultFrom(existing, jobResult.job, jobResult.state)
    }

    // Keep source creation, queue association, and historical invalidation in
    // one transaction. The queue insert uses the same Payload transaction
    // session, so workers cannot observe the Job before the source commits.
    const source = asRecord(await payload.create({
      collection: 'knowledge-source-documents',
      context: { knowledgeIngestion: true, skipAudit: false },
      data: {
        ...parsedMetadata,
        ingestionRevision,
        processingStage: 'queued',
        processingStatus: 'queued',
        sourceHash,
      },
      file: knowledgeSourceFileToUpload(validFile),
      overrideAccess: false,
      req: commandReq,
    }))
    const sourceId = source.id
    if (typeof sourceId !== 'number' && typeof sourceId !== 'string') {
      throw new KnowledgeSourceCommandError('source-create-failed', 'The source could not be created', 500)
    }
    const jobResult = await enqueueKnowledgeIngestJob({
      payload,
      req: commandReq,
      requestedBy: Number(commandReq.user?.id) || null,
      sourceId: Number(sourceId),
      sourceHash,
      sourceRevision: ingestionRevision,
    })

    // A new version of the same titled source invalidates every prior output.
    // Paginate both dimensions: there is no safe fixed cap on historical
    // sources or generated outputs.
    const previousSources: Record<string, unknown>[] = []
    for (let page = 1; ; page += 1) {
      const result = await payload.find({
        collection: 'knowledge-source-documents',
        depth: 0,
        limit: 100,
        overrideAccess: true,
        page,
        pagination: true,
        req: commandReq,
        where: {
          and: [
            { sourceTitle: { equals: parsedMetadata.sourceTitle } },
            { sourceType: { equals: parsedMetadata.sourceType } },
          ],
        },
      })
      previousSources.push(...result.docs.map(asRecord))
      if (!result.hasNextPage || result.docs.length === 0) break
    }
    for (const previous of previousSources) {
      if (sourceMatch(previous, sourceHash, parsedMetadata.sourceVersion) || typeof previous.id !== 'number') continue
      for (let page = 1; ; page += 1) {
        const outputs = await payload.find({
          collection: 'knowledge-documents',
          depth: 0,
          limit: 100,
          overrideAccess: true,
          page,
          pagination: true,
          req: commandReq,
          where: { ingestionSource: { equals: previous.id } },
        })
        for (const output of outputs.docs.map(asRecord)) {
          if (typeof output.id !== 'number') continue
          await payload.update({
            collection: 'knowledge-documents',
            context: { knowledgeIngestion: true, skipAudit: true },
            data: {
              customerVisible: false,
              embeddingModel: null,
              embeddingSpace: null,
              indexJobId: null,
              indexOwnerToken: null,
              indexStatus: 'pending',
              indexedAt: null,
              reviewStatus: 'draft',
              reviewedAt: null,
              reviewedBy: null,
            },
            id: output.id,
            overrideAccess: true,
            req: commandReq,
          })
        }
        if (!outputs.hasNextPage || outputs.docs.length === 0) break
      }
    }

    await payload.update({
      collection: 'knowledge-source-documents',
      context: { knowledgeIngestion: true, skipAudit: true },
      data: { currentJobId: jobResult.job.id },
      id: sourceId,
      overrideAccess: true,
      req: commandReq,
    })
    const refreshed = asRecord({ ...source, currentJobId: jobResult.job.id })
    return resultFrom(refreshed, jobResult.job, jobResult.state)
  }

  if (await req.transactionID) return run(req)
  const transactionReq = await createLocalReq({ user: req.user ?? undefined }, payload as Payload)
  await initTransaction(transactionReq)
  try {
    const result = await run(transactionReq)
    await commitTransaction(transactionReq)
    return result
  } catch (error) {
    await killTransaction(transactionReq).catch(() => undefined)
    throw error
  }
}

export const retryKnowledgeSource = async ({
  id,
  payload,
  req,
  actor,
}: {
  id: number
  payload: KnowledgeIngestionPayload
  req: PayloadRequest
  actor: JobRetryActor
}): Promise<KnowledgeSourceCommandResult> => {
  if (actor.role !== 'admin') throw new KnowledgeSourceCommandError('admin-required', 'Administrator access required', 403)
  const run = async (commandReq: PayloadRequest): Promise<KnowledgeSourceCommandResult> => {
    const source = asRecord(await payload.findByID({ collection: 'knowledge-source-documents', depth: 0, id, overrideAccess: false, req: commandReq }))
    if (!source.id || source.processingStatus !== 'failed') {
      throw new KnowledgeSourceCommandError('source-not-retryable', 'Only failed sources can be retried', 409)
    }
    const queue = new PayloadJobQueue({ payload: payload as Payload })
    const jobID = typeof source.currentJobId === 'number' ? source.currentJobId : null
    let job: JobRecord
    let state: 'created' | 'duplicate' = 'created'
    if (jobID) {
      job = await queue.retryManually(jobID, actor, commandReq)
    } else {
      const enqueued = await enqueueKnowledgeIngestJob({
        manualRetryActor: actor,
        payload,
        req: commandReq,
        requestedBy: Number(commandReq.user?.id) || null,
        sourceId: Number(source.id),
        sourceHash: String(source.sourceHash),
        sourceRevision: String(source.ingestionRevision),
      })
      job = enqueued.job
      state = enqueued.state
    }
    if (job.status !== 'pending') {
      throw new KnowledgeSourceCommandError('source-job-not-retryable', 'The source Job cannot be retried', 409)
    }
    const updated = await payload.update({
      collection: 'knowledge-source-documents',
      context: { knowledgeIngestion: true, skipAudit: true },
      data: { errorCode: null, errorSummary: null, processingStage: 'queued', processingStatus: 'queued', currentJobId: job.id },
      overrideAccess: true,
      req: commandReq,
      where: { and: [{ id: { equals: id } }, { ingestionRevision: { equals: String(source.ingestionRevision) } }, { processingStatus: { equals: 'failed' } }] },
    })
    if (updated.docs.length !== 1) {
      throw new KnowledgeSourceCommandError('source-changed', 'The source changed before it could be retried', 409)
    }
    return resultFrom(asRecord(updated.docs[0]), job, state)
  }

  if (await req.transactionID) return run(req)
  const transactionReq = await createLocalReq({ user: req.user ?? undefined }, payload as Payload)
  await initTransaction(transactionReq)
  try {
    const result = await run(transactionReq)
    await commitTransaction(transactionReq)
    return result
  } catch (error) {
    await killTransaction(transactionReq).catch(() => undefined)
    throw error
  }
}

export const knowledgeSourceStoragePath = (filename: string, asset = false): string => {
  if (
    !filename ||
    filename === '.' ||
    filename === '..' ||
    filename.includes('\0') ||
    path.basename(filename) !== filename
  ) {
    throw new KnowledgeSourceCommandError('invalid-file-name', 'A safe file name is required')
  }
  return path.join(process.cwd(), asset ? 'private/knowledge-source-assets' : 'private/knowledge-sources', filename)
}

export { KNOWLEDGE_INGEST_JOB_TYPE, KNOWLEDGE_SOURCE_MAX_BYTES, KNOWLEDGE_SOURCE_MIME_TYPES }
