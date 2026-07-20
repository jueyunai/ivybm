import type { PostgresAdapter } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'

import {
  createEmbeddingSpaceFingerprint,
  type AiGatewayEmbedInput,
  type AiGatewayEmbedResult,
} from '@/modules/ai/gateway'
import type { KnowledgeChunk as KnowledgeChunkRecord } from '@/payload-types'

import { chunkKnowledgeDocument } from './chunk'

type KnowledgePool = Pick<PostgresAdapter['pool'], 'query'>

export type KnowledgeEmbeddingGateway = {
  embed: (
    input: AiGatewayEmbedInput,
  ) => Promise<Omit<AiGatewayEmbedResult, 'embeddingSpace'> & { embeddingSpace?: string }>
}

type SetKnowledgeChunkEmbeddingInput = {
  chunkId: number | string
  embedding: number[]
  embeddingSpace: string
  model: string
  pool: KnowledgePool
}

type IndexKnowledgeDocumentInput = {
  chunkOptions?: { maxCharacters?: number }
  documentId: number | string
  gateway: KnowledgeEmbeddingGateway
  limits?: Partial<KnowledgeIndexLimits>
  onEmbeddingBatchComplete?: () => Promise<void>
  payload: Payload
  pool: KnowledgePool
}

export type KnowledgeIndexLimits = {
  documentMaxBytes: number
  embeddingBatchMaxItems: number
  embeddingBatchMaxTokens: number
  existingChunkPageSize: number
  maxChunksPerDocument: number
}

export const DEFAULT_KNOWLEDGE_INDEX_LIMITS: KnowledgeIndexLimits = {
  documentMaxBytes: 2_000_000,
  embeddingBatchMaxItems: 64,
  embeddingBatchMaxTokens: 8_000,
  existingChunkPageSize: 500,
  maxChunksPerDocument: 5_000,
}

const estimateTokens = (text: string): number => Math.ceil(Buffer.byteLength(text, 'utf8') / 4)

const validateLimits = (limits: KnowledgeIndexLimits): void => {
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isInteger(value) || value <= 0) {
      throw new Error(`${name} must be a positive integer`)
    }
  }
}

const createEmbeddingBatches = (inputs: string[], limits: KnowledgeIndexLimits): string[][] => {
  const batches: string[][] = []
  let batch: string[] = []
  let batchTokens = 0

  for (const input of inputs) {
    const inputTokens = estimateTokens(input)
    if (inputTokens > limits.embeddingBatchMaxTokens) {
      throw new Error('Knowledge chunk exceeds the embedding batch token limit')
    }

    if (
      batch.length > 0 &&
      (batch.length >= limits.embeddingBatchMaxItems ||
        batchTokens + inputTokens > limits.embeddingBatchMaxTokens)
    ) {
      batches.push(batch)
      batch = []
      batchTokens = 0
    }

    batch.push(input)
    batchTokens += inputTokens
  }

  if (batch.length > 0) batches.push(batch)
  return batches
}

const findAllDocumentChunks = async (
  payload: Payload,
  documentId: number | string,
  pageSize: number,
): Promise<KnowledgeChunkRecord[]> => {
  const chunks: KnowledgeChunkRecord[] = []
  let page = 1

  while (true) {
    const result = await payload.find({
      collection: 'knowledge-chunks',
      limit: pageSize,
      overrideAccess: true,
      page,
      sort: 'id',
      where: { document: { equals: documentId } },
    })
    chunks.push(...result.docs)
    if (!result.hasNextPage) return chunks
    page += 1
  }
}

export const formatVector = (embedding: number[]): string => {
  if (embedding.length === 0 || embedding.some((value) => !Number.isFinite(value))) {
    throw new Error('Embedding must contain finite numeric values')
  }

  return `[${embedding.join(',')}]`
}

export const setKnowledgeChunkEmbedding = async ({
  chunkId,
  embedding,
  embeddingSpace,
  model,
  pool,
}: SetKnowledgeChunkEmbeddingInput): Promise<void> => {
  const result = await pool.query(
    `UPDATE knowledge_chunks
       SET embedding_vector = $1::vector,
           embedding_model = $2,
           embedding_dimensions = $3,
           embedding_space = $4,
           embedded_at = NOW(),
           updated_at = NOW()
     WHERE id = $5`,
    [formatVector(embedding), model, embedding.length, embeddingSpace, chunkId],
  )

  if (result.rowCount !== 1) {
    throw new Error(`Knowledge chunk not found: ${String(chunkId)}`)
  }
}

export const indexKnowledgeDocument = async ({
  chunkOptions,
  documentId,
  gateway,
  limits: limitOverrides,
  onEmbeddingBatchComplete,
  payload,
  pool,
}: IndexKnowledgeDocumentInput): Promise<{
  chunkCount: number
  embeddingSpace: string
  model: string
}> => {
  const limits = { ...DEFAULT_KNOWLEDGE_INDEX_LIMITS, ...limitOverrides }
  validateLimits(limits)
  const claim = await pool.query<{ updated_at: Date }>(
    `UPDATE knowledge_documents
        SET index_status = 'processing',
            indexed_at = NULL,
            updated_at = clock_timestamp()
      WHERE id = $1
        AND review_status = 'reviewed'
        AND index_status <> 'processing'
    RETURNING updated_at`,
    [documentId],
  )
  if (claim.rowCount !== 1) {
    const current = await payload.findByID({
      collection: 'knowledge-documents',
      id: documentId,
      overrideAccess: true,
    })
    if (current.reviewStatus !== 'reviewed') {
      throw new Error('Only reviewed knowledge documents can be indexed')
    }
    if (current.indexStatus === 'processing') {
      throw new Error('Knowledge document is already being indexed')
    }
    throw new Error('Knowledge document indexing claim was not acquired')
  }
  const claimToken = claim.rows[0].updated_at

  try {
    const document = await payload.findByID({
      collection: 'knowledge-documents',
      id: documentId,
      overrideAccess: true,
    })
    if (
      document.reviewStatus !== 'reviewed' ||
      document.indexStatus !== 'processing' ||
      new Date(document.updatedAt).getTime() !== claimToken.getTime()
    ) {
      throw new Error('Knowledge document changed while it was being indexed')
    }
    if (Buffer.byteLength(document.content, 'utf8') > limits.documentMaxBytes) {
      throw new Error('Knowledge document exceeds the configured size limit')
    }
    const chunks = chunkKnowledgeDocument(
      {
        documentId: document.id,
        locale: document.locale,
        sourceTitle: document.sourceTitle,
        sourceURL: document.sourceURL || undefined,
        sourceVersion: document.sourceVersion,
        text: document.content,
      },
      chunkOptions,
    )
    if (chunks.length > limits.maxChunksPerDocument) {
      throw new Error('Knowledge document exceeds the configured chunk limit')
    }

    const embeddings: number[][] = []
    let embeddingModel: string | undefined
    let embeddingDimensions: number | undefined
    let embeddingSpace: string | undefined
    for (const batch of createEmbeddingBatches(
      chunks.map(({ content }) => content),
      limits,
    )) {
      const embedded = await gateway.embed({ input: batch })
      if (embedded.embeddings.length !== batch.length) {
        throw new Error('Embedding provider returned an unexpected result count')
      }
      const batchDimensions = embedded.embeddings[0]?.length
      if (
        !batchDimensions ||
        embedded.embeddings.some((value) => value.length !== batchDimensions)
      ) {
        throw new Error('Embedding provider returned inconsistent vector dimensions')
      }
      if (embeddingModel && embedded.model !== embeddingModel) {
        throw new Error('Embedding provider changed model during document indexing')
      }
      if (embeddingDimensions && batchDimensions !== embeddingDimensions) {
        throw new Error('Embedding provider changed vector dimensions during document indexing')
      }
      const batchEmbeddingSpace =
        embedded.embeddingSpace ??
        createEmbeddingSpaceFingerprint(
          `provider-name:${embedded.provider}`,
          embedded.model,
          batchDimensions,
        )
      if (embeddingSpace && batchEmbeddingSpace !== embeddingSpace) {
        throw new Error('Embedding provider changed vector space during document indexing')
      }
      embeddingModel = embedded.model
      embeddingDimensions = batchDimensions
      embeddingSpace = batchEmbeddingSpace
      embeddings.push(...embedded.embeddings)
      await onEmbeddingBatchComplete?.()
    }
    if (!embeddingModel || !embeddingSpace) {
      throw new Error('Knowledge document produced no embeddings')
    }

    const existing = await findAllDocumentChunks(payload, document.id, limits.existingChunkPageSize)
    const existingByStableID = new Map(existing.map((chunk) => [chunk.stableId, chunk]))
    const activeIDs = new Set<number | string>()

    for (const [index, chunk] of chunks.entries()) {
      const data = {
        content: chunk.content,
        document: document.id,
        index: chunk.index,
        locale: chunk.locale,
        sourceTitle: chunk.citation.title,
        sourceURL: chunk.citation.url,
        sourceVersion: chunk.citation.version,
        stableId: chunk.stableId,
      }
      const existingChunk = existingByStableID.get(chunk.stableId)
      const stored = existingChunk
        ? await payload.update({
            collection: 'knowledge-chunks',
            data,
            id: existingChunk.id,
            overrideAccess: true,
          })
        : await payload.create({
            collection: 'knowledge-chunks',
            data,
            overrideAccess: true,
          })

      activeIDs.add(stored.id)
      await setKnowledgeChunkEmbedding({
        chunkId: stored.id,
        embedding: embeddings[index],
        embeddingSpace,
        model: embeddingModel,
        pool,
      })
    }

    const staleIDs = existing.filter((chunk) => !activeIDs.has(chunk.id)).map((chunk) => chunk.id)
    if (staleIDs.length > 0) {
      await payload.delete({
        collection: 'knowledge-chunks',
        overrideAccess: true,
        where: { id: { in: staleIDs } },
      })
    }

    const ready = await pool.query(
      `UPDATE knowledge_documents
          SET embedding_model = $1,
              embedding_space = $2,
              indexed_at = NOW(),
              index_status = 'ready',
              updated_at = NOW()
        WHERE id = $3
          AND review_status = 'reviewed'
          AND index_status = 'processing'
          AND updated_at = $4`,
      [embeddingModel, embeddingSpace, document.id, claimToken],
    )
    if (ready.rowCount !== 1) {
      throw new Error('Knowledge document changed while it was being indexed')
    }

    return { chunkCount: chunks.length, embeddingSpace, model: embeddingModel }
  } catch (error) {
    await pool
      .query(
        `UPDATE knowledge_documents
            SET index_status = 'failed', updated_at = NOW()
          WHERE id = $1
            AND review_status = 'reviewed'
            AND index_status = 'processing'
            AND updated_at = $2`,
        [documentId, claimToken],
      )
      .catch(() => undefined)
    throw error
  }
}
