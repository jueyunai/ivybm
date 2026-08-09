import path from 'node:path'

import type { Payload, PayloadRequest } from 'payload'

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

export type KnowledgeSourceCommandResult = {
  job: JobRecord
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

const resultFrom = (source: Record<string, unknown>, job: JobRecord, state: 'created' | 'duplicate'): KnowledgeSourceCommandResult => ({
  job,
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
  const validFile = validateKnowledgeSourceFile(file)
  const parsedMetadata = parseKnowledgeSourceMetadata(metadata)
  const sourceHash = sha256(validFile.data)
  const ingestionRevision = sourceIngestionRevision(sourceHash, parsedMetadata.sourceVersion)
  const existingResult = await payload.find({
    collection: 'knowledge-source-documents',
    depth: 0,
    limit: 2,
    overrideAccess: false,
    pagination: false,
    req,
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
      requestedBy: Number(req.user?.id) || null,
      sourceId: existing.id as number,
      sourceHash,
      sourceRevision: ingestionRevision,
    })
    return resultFrom(existing, jobResult.job, jobResult.state)
  }

  // A new version of the same titled source invalidates every prior generated
  // output before the new worker can produce drafts. This prevents an old
  // reviewed/visible translation from remaining customer-retrievable while a
  // replacement is being parsed.
  const previousSources = await payload.find({
    collection: 'knowledge-source-documents',
    depth: 0,
    limit: 100,
    overrideAccess: true,
    pagination: false,
    req,
    where: {
      and: [
        { sourceTitle: { equals: parsedMetadata.sourceTitle } },
        { sourceType: { equals: parsedMetadata.sourceType } },
      ],
    },
  })
  for (const previous of previousSources.docs.map(asRecord)) {
    if (sourceMatch(previous, sourceHash, parsedMetadata.sourceVersion) || typeof previous.id !== 'number') continue
    const outputs = await payload.find({
      collection: 'knowledge-documents',
      depth: 0,
      limit: 10,
      overrideAccess: true,
      pagination: false,
      req,
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
        req,
      })
    }
  }

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
    req,
  }))
  const sourceId = source.id
  if (typeof sourceId !== 'number' && typeof sourceId !== 'string') {
    throw new KnowledgeSourceCommandError('source-create-failed', 'The source could not be created', 500)
  }
  try {
    const jobResult = await enqueueKnowledgeIngestJob({
      payload,
      requestedBy: Number(req.user?.id) || null,
      sourceId: Number(sourceId),
      sourceHash,
      sourceRevision: ingestionRevision,
    })
    await payload.update({
      collection: 'knowledge-source-documents',
      context: { knowledgeIngestion: true, skipAudit: true },
      data: { currentJobId: jobResult.job.id },
      id: sourceId,
      overrideAccess: true,
      req,
    })
    const refreshed = asRecord({ ...source, currentJobId: jobResult.job.id })
    return resultFrom(refreshed, jobResult.job, jobResult.state)
  } catch (error) {
    await payload.update({
      collection: 'knowledge-source-documents',
      context: { knowledgeIngestion: true, skipAudit: true },
      data: { errorCode: 'queue-failed', errorSummary: 'The ingestion task could not be queued', processingStatus: 'failed' },
      id: sourceId,
      overrideAccess: true,
      req,
    }).catch(() => undefined)
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
  const source = asRecord(await payload.findByID({ collection: 'knowledge-source-documents', depth: 0, id, overrideAccess: false, req }))
  if (!source.id || source.processingStatus !== 'failed') {
    throw new KnowledgeSourceCommandError('source-not-retryable', 'Only failed sources can be retried', 409)
  }
  const queue = new PayloadJobQueue({ payload: payload as Payload })
  const jobID = typeof source.currentJobId === 'number' ? source.currentJobId : null
  let job: JobRecord
  let state: 'created' | 'duplicate' = 'created'
  if (jobID) {
    const retried = await queue.retryManually(jobID, actor)
    job = retried
  } else {
    const enqueued = await enqueueKnowledgeIngestJob({
      payload,
      requestedBy: Number(req.user?.id) || null,
      sourceId: Number(source.id),
      sourceHash: String(source.sourceHash),
      sourceRevision: String(source.ingestionRevision),
    })
    job = enqueued.job
    state = enqueued.state
  }
  await payload.update({
    collection: 'knowledge-source-documents',
    context: { knowledgeIngestion: true, skipAudit: true },
    data: { errorCode: null, errorSummary: null, processingStage: 'queued', processingStatus: 'queued', currentJobId: job.id },
    id,
    overrideAccess: true,
    req,
  })
  return resultFrom({ ...source, processingStage: 'queued', processingStatus: 'queued', currentJobId: job.id }, job, state)
}

export const knowledgeSourceStoragePath = (filename: string, asset = false): string => {
  if (!filename || path.basename(filename) !== filename) throw new KnowledgeSourceCommandError('invalid-file-name', 'A safe file name is required')
  return path.join(process.cwd(), asset ? 'private/knowledge-source-assets' : 'private/knowledge-sources', filename)
}

export { KNOWLEDGE_INGEST_JOB_TYPE, KNOWLEDGE_SOURCE_MAX_BYTES, KNOWLEDGE_SOURCE_MIME_TYPES }
