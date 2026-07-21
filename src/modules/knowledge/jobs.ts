import { createHash } from 'node:crypto'

import type { PostgresAdapter } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'

import { resolveAiGateway, AI_USAGE_KEYS } from '@/modules/ai/registry'
import { PayloadJobQueue } from '@/modules/jobs/claim'
import type { JobExecution, JobHandler, JobRecord } from '@/modules/jobs/contracts'
import type { KnowledgeDocument } from '@/payload-types'

import { indexKnowledgeDocument } from './embed'

export const KNOWLEDGE_INDEX_JOB_TYPE = 'knowledge.index'

export class KnowledgeIndexRequestError extends Error {
  readonly code: 'not_reviewed' | 'provider_unavailable'

  constructor(code: KnowledgeIndexRequestError['code'], message: string) {
    super(message)
    this.code = code
    this.name = 'KnowledgeIndexRequestError'
  }
}

export type KnowledgeIndexJobPayload = {
  documentId: number
  documentRevision: string
  embeddingConfigurationKey: string
  requestedBy: number
}

export const KNOWLEDGE_INDEX_LEASE_RENEW_EVERY_PROGRESS_EVENTS = 25

type ResolveKnowledgeGateway = typeof resolveAiGateway

const positiveInteger = (value: unknown, field: string): number => {
  const number = typeof value === 'number' ? value : Number(value)
  if (!Number.isInteger(number) || number < 1) {
    throw new Error(`Knowledge index job ${field} is invalid`)
  }
  return number
}

const requiredString = (value: unknown, field: string): string => {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Knowledge index job ${field} is invalid`)
  }
  return value
}

const relationshipID = (value: unknown): number | string | null => {
  if (typeof value === 'number' || typeof value === 'string') return value
  if (value && typeof value === 'object' && 'id' in value) {
    const id = (value as { id?: unknown }).id
    if (typeof id === 'number' || typeof id === 'string') return id
  }
  return null
}

export const createKnowledgeDocumentRevision = (
  document: Pick<
    KnowledgeDocument,
    | 'content'
    | 'customerVisible'
    | 'locale'
    | 'reviewStatus'
    | 'reviewedAt'
    | 'reviewedBy'
    | 'sourceFile'
    | 'sourceTitle'
    | 'sourceType'
    | 'sourceURL'
    | 'sourceVersion'
  >,
): string =>
  createHash('sha256')
    .update(
      JSON.stringify({
        content: document.content,
        customerVisible: document.customerVisible ?? false,
        locale: document.locale,
        reviewStatus: document.reviewStatus,
        reviewedAt: document.reviewedAt ?? null,
        reviewedBy: relationshipID(document.reviewedBy),
        sourceFile: relationshipID(document.sourceFile),
        sourceTitle: document.sourceTitle,
        sourceType: document.sourceType,
        sourceURL: document.sourceURL ?? null,
        sourceVersion: document.sourceVersion,
      }),
    )
    .digest('hex')

export const createLeaseRenewalProgress = (
  execution: JobExecution,
  every = KNOWLEDGE_INDEX_LEASE_RENEW_EVERY_PROGRESS_EVENTS,
): (() => Promise<void>) => {
  if (!Number.isInteger(every) || every < 1) {
    throw new RangeError('Knowledge index lease renewal interval must be a positive integer')
  }
  let progressEvents = 0
  return async () => {
    progressEvents += 1
    if (progressEvents % every === 0) {
      await execution.renewLease()
    }
  }
}

export const parseKnowledgeIndexJobPayload = (
  value: Record<string, unknown>,
): KnowledgeIndexJobPayload => ({
  documentId: positiveInteger(value.documentId, 'documentId'),
  documentRevision: requiredString(value.documentRevision, 'documentRevision'),
  embeddingConfigurationKey: requiredString(
    value.embeddingConfigurationKey,
    'embeddingConfigurationKey',
  ),
  requestedBy: positiveInteger(value.requestedBy, 'requestedBy'),
})

const knowledgeEmbeddingGateway = async (
  payload: Payload,
  resolveGateway: ResolveKnowledgeGateway,
) =>
  resolveGateway({
    payload,
    routes: [{ operation: 'embedding', usageKey: AI_USAGE_KEYS.knowledgeEmbedding }],
  })

export const enqueueKnowledgeIndexJob = async ({
  documentId,
  payload,
  requestedBy,
  resolveGateway = resolveAiGateway,
}: {
  documentId: number
  payload: Payload
  requestedBy: number
  resolveGateway?: ResolveKnowledgeGateway
}): Promise<{ job: JobRecord; state: 'created' | 'duplicate' }> => {
  const document = await payload.findByID({
    collection: 'knowledge-documents',
    id: documentId,
    overrideAccess: true,
  })
  if (document.reviewStatus !== 'reviewed') {
    throw new KnowledgeIndexRequestError(
      'not_reviewed',
      'Only reviewed knowledge documents can be indexed',
    )
  }

  const gateway = await knowledgeEmbeddingGateway(payload, resolveGateway)
  const embeddingConfigurationKey = gateway.embeddingConfigurationKey
  if (!embeddingConfigurationKey) {
    throw new KnowledgeIndexRequestError(
      'provider_unavailable',
      'Knowledge embedding route is not configured',
    )
  }
  const jobPayload: KnowledgeIndexJobPayload = {
    documentId,
    documentRevision: createKnowledgeDocumentRevision(document),
    embeddingConfigurationKey,
    requestedBy,
  }
  return new PayloadJobQueue({ payload }).enqueue({
    idempotencyKey: [
      'knowledge-index',
      documentId,
      jobPayload.documentRevision,
      embeddingConfigurationKey,
    ].join(':'),
    payload: jobPayload,
    type: KNOWLEDGE_INDEX_JOB_TYPE,
  })
}

export const createKnowledgeIndexJobHandler =
  ({
    payload,
    resolveGateway = resolveAiGateway,
  }: {
    payload: Payload
    resolveGateway?: ResolveKnowledgeGateway
  }): JobHandler =>
  async (job, execution) => {
    const input = parseKnowledgeIndexJobPayload(job.payload)
    const document = await payload.findByID({
      collection: 'knowledge-documents',
      id: input.documentId,
      overrideAccess: true,
    })
    if (
      document.reviewStatus !== 'reviewed' ||
      createKnowledgeDocumentRevision(document) !== input.documentRevision
    ) {
      return
    }

    const gateway = await knowledgeEmbeddingGateway(payload, resolveGateway)
    if (gateway.embeddingConfigurationKey !== input.embeddingConfigurationKey) {
      return
    }

    await indexKnowledgeDocument({
      documentId: input.documentId,
      gateway,
      onProgress: createLeaseRenewalProgress(execution),
      payload,
      pool: (payload.db as unknown as PostgresAdapter).pool,
    })
  }
