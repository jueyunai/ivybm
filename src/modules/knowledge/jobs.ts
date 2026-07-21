import { createHash } from 'node:crypto'

import type { PostgresAdapter } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'

import { resolveAiGateway, AI_USAGE_KEYS } from '@/modules/ai/registry'
import { PayloadJobQueue } from '@/modules/jobs/claim'
import type { JobHandler, JobRecord } from '@/modules/jobs/contracts'
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
  requestedBy: number | null
}

type ResolveKnowledgeGateway = typeof resolveAiGateway

const positiveInteger = (value: unknown, field: string): number => {
  const number = typeof value === 'number' ? value : Number(value)
  if (!Number.isInteger(number) || number < 1) {
    throw new Error(`Knowledge index job ${field} is invalid`)
  }
  return number
}

const optionalPositiveInteger = (value: unknown, field: string): number | null =>
  value === null || value === undefined ? null : positiveInteger(value, field)

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

export const parseKnowledgeIndexJobPayload = (
  value: Record<string, unknown>,
): KnowledgeIndexJobPayload => ({
  documentId: positiveInteger(value.documentId, 'documentId'),
  documentRevision: requiredString(value.documentRevision, 'documentRevision'),
  embeddingConfigurationKey: requiredString(
    value.embeddingConfigurationKey,
    'embeddingConfigurationKey',
  ),
  requestedBy: optionalPositiveInteger(value.requestedBy, 'requestedBy'),
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
  requestedBy: number | null
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

export const enqueueLegacyKnowledgeRebuilds = async ({
  payload,
  requestedBy,
  resolveGateway = resolveAiGateway,
}: {
  payload: Payload
  requestedBy?: number | null
  resolveGateway?: ResolveKnowledgeGateway
}): Promise<{ created: number; duplicate: number; failed: number; jobIDs: number[] }> => {
  const gateway = await knowledgeEmbeddingGateway(payload, resolveGateway)
  const embeddingConfigurationKey = gateway.embeddingConfigurationKey
  if (!embeddingConfigurationKey) {
    throw new KnowledgeIndexRequestError(
      'provider_unavailable',
      'Knowledge embedding route is not configured',
    )
  }
  const queue = new PayloadJobQueue({ payload })
  let created = 0
  let duplicate = 0
  let failed = 0
  const jobIDs: number[] = []
  let page = 1

  while (true) {
    const result = await payload.find({
      collection: 'knowledge-documents',
      depth: 0,
      limit: 100,
      overrideAccess: true,
      page,
      sort: 'id',
      where: {
        and: [
          { reviewStatus: { equals: 'reviewed' } },
          { indexStatus: { equals: 'ready' } },
          {
            or: [
              { embeddingSpace: { exists: false } },
              { embeddingSpace: { not_equals: embeddingConfigurationKey } },
            ],
          },
        ],
      },
    })

    for (const document of result.docs) {
      try {
        const jobPayload: KnowledgeIndexJobPayload = {
          documentId: document.id,
          documentRevision: createKnowledgeDocumentRevision(document),
          embeddingConfigurationKey,
          requestedBy: requestedBy ?? null,
        }
        const enqueued = await queue.enqueue({
          idempotencyKey: [
            'knowledge-index',
            document.id,
            jobPayload.documentRevision,
            embeddingConfigurationKey,
          ].join(':'),
          payload: jobPayload,
          type: KNOWLEDGE_INDEX_JOB_TYPE,
        })
        jobIDs.push(enqueued.job.id)
        if (enqueued.state === 'created') created += 1
        else duplicate += 1
      } catch {
        failed += 1
        payload.logger.error(`Legacy knowledge rebuild enqueue failed for document ${document.id}`)
      }
    }

    if (!result.hasNextPage) break
    page += 1
  }

  return { created, duplicate, failed, jobIDs }
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
      leaseFence: { jobId: job.id, ownerToken: job.ownerToken },
      payload,
      pool: (payload.db as unknown as PostgresAdapter).pool,
      signal: execution.signal,
    })
  }
