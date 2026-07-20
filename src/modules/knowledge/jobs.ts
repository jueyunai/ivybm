import type { PostgresAdapter } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'

import { resolveAiGateway, AI_USAGE_KEYS } from '@/modules/ai/registry'
import { PayloadJobQueue } from '@/modules/jobs/claim'
import type { JobHandler, JobRecord } from '@/modules/jobs/contracts'

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
  documentUpdatedAt: string
  embeddingConfigurationKey: string
  requestedBy: number
}

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

export const parseKnowledgeIndexJobPayload = (
  value: Record<string, unknown>,
): KnowledgeIndexJobPayload => ({
  documentId: positiveInteger(value.documentId, 'documentId'),
  documentUpdatedAt: requiredString(value.documentUpdatedAt, 'documentUpdatedAt'),
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
    documentUpdatedAt: document.updatedAt,
    embeddingConfigurationKey,
    requestedBy,
  }
  return new PayloadJobQueue({ payload }).enqueue({
    idempotencyKey: [
      'knowledge-index',
      documentId,
      document.updatedAt,
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
    if (document.updatedAt !== input.documentUpdatedAt || document.reviewStatus !== 'reviewed') {
      return
    }

    const gateway = await knowledgeEmbeddingGateway(payload, resolveGateway)
    if (gateway.embeddingConfigurationKey !== input.embeddingConfigurationKey) {
      return
    }

    await indexKnowledgeDocument({
      documentId: input.documentId,
      gateway,
      onEmbeddingBatchComplete: async () => {
        await execution.renewLease()
      },
      payload,
      pool: (payload.db as unknown as PostgresAdapter).pool,
    })
  }
