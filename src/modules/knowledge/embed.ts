import type { PostgresAdapter } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'

import { type AiGatewayEmbedInput, type AiGatewayEmbedResult } from '@/modules/ai/gateway'
import { chunkKnowledgeDocument } from './chunk'

type KnowledgePool = Pick<PostgresAdapter['pool'], 'query'>

export type KnowledgeEmbeddingGateway = {
  embed: (input: AiGatewayEmbedInput) => Promise<AiGatewayEmbedResult>
}

type SetKnowledgeChunkEmbeddingInput = {
  chunkId: number | string
  embedding: number[]
  embeddingSpace: string
  model: string
  pool: KnowledgePool
}

type StoreKnowledgeChunkInput = {
  chunk: {
    citation: { title: string; url?: string; version: string }
    content: string
    index: number
    locale: 'ar' | 'en'
    stableId: string
  }
  claimToken: Date
  documentId: number | string
  embedding: number[]
  embeddingSpace: string
  leaseFence?: { jobId: number; ownerToken: string }
  model: string
  pool: KnowledgePool
}

type DeleteStaleKnowledgeChunksInput = {
  activeIDs: number[]
  claimToken: Date
  documentId: number | string
  leaseFence?: { jobId: number; ownerToken: string }
  pool: KnowledgePool
}

type IndexKnowledgeDocumentInput = {
  chunkOptions?: { maxCharacters?: number }
  documentId: number | string
  gateway: KnowledgeEmbeddingGateway
  leaseFence?: {
    jobId: number
    ownerToken: string
  }
  limits?: Partial<KnowledgeIndexLimits>
  payload: Payload
  pool: KnowledgePool
  signal?: AbortSignal
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

const assertNotAborted = (signal?: AbortSignal): void => {
  if (!signal?.aborted) return
  if (signal.reason instanceof Error) throw signal.reason
  throw new Error('Knowledge indexing was aborted')
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

/**
 * Every chunk mutation carries the document/job ownership fence in the same
 * SQL statement. A worker that resumes after its lease was reclaimed or its
 * document was dead-letter recovered can therefore never mutate chunks that a
 * newer attempt may publish.
 */
const storeKnowledgeChunk = async ({
  chunk,
  claimToken,
  documentId,
  embedding,
  embeddingSpace,
  leaseFence,
  model,
  pool,
}: StoreKnowledgeChunkInput): Promise<number> => {
  const result = await pool.query<{ id: number }>(
    `WITH owned_document AS (
       SELECT document.id
       FROM knowledge_documents AS document
       WHERE document.id = $1
         AND document.review_status = 'reviewed'
         AND document.index_status = 'processing'
         AND document.updated_at = $2
         AND (
           (
             $3::integer IS NULL
             AND document.index_job_id IS NULL
             AND document.index_owner_token IS NULL
           )
           OR (
             document.index_job_id = $3
             AND document.index_owner_token = $4
             AND EXISTS (
               SELECT 1
               FROM jobs AS job
               WHERE job.id = $3
                 AND job.owner_token = $4
                 AND job.status = 'processing'
                 AND job.lease_expires_at > NOW()
             )
           )
         )
       FOR SHARE
     )
     INSERT INTO knowledge_chunks (
       document_id,
       stable_id,
       "index",
       locale,
       content,
       source_title,
       source_version,
       source_u_r_l,
       embedding_vector,
       embedding_model,
       embedding_dimensions,
       embedding_space,
       embedded_at,
       updated_at
     )
     SELECT
       owned_document.id,
       $5,
       $6,
       $7,
       $8,
       $9,
       $10,
       $11,
       $12::vector,
       $13,
       $14,
       $15,
       NOW(),
       NOW()
     FROM owned_document
     ON CONFLICT (stable_id) DO UPDATE
       SET "index" = EXCLUDED."index",
           locale = EXCLUDED.locale,
           content = EXCLUDED.content,
           source_title = EXCLUDED.source_title,
           source_version = EXCLUDED.source_version,
           source_u_r_l = EXCLUDED.source_u_r_l,
           embedding_vector = EXCLUDED.embedding_vector,
           embedding_model = EXCLUDED.embedding_model,
           embedding_dimensions = EXCLUDED.embedding_dimensions,
           embedding_space = EXCLUDED.embedding_space,
           embedded_at = EXCLUDED.embedded_at,
           updated_at = EXCLUDED.updated_at
       WHERE knowledge_chunks.document_id = $1
         AND EXISTS (SELECT 1 FROM owned_document)
     RETURNING id`,
    [
      documentId,
      claimToken,
      leaseFence?.jobId ?? null,
      leaseFence?.ownerToken ?? null,
      chunk.stableId,
      chunk.index,
      chunk.locale,
      chunk.content,
      chunk.citation.title,
      chunk.citation.version,
      chunk.citation.url ?? null,
      formatVector(embedding),
      model,
      embedding.length,
      embeddingSpace,
    ],
  )

  const id = result.rows[0]?.id
  if (!Number.isInteger(id)) {
    throw new Error('Knowledge document changed while it was being indexed')
  }
  return id
}

const deleteStaleKnowledgeChunks = async ({
  activeIDs,
  claimToken,
  documentId,
  leaseFence,
  pool,
}: DeleteStaleKnowledgeChunksInput): Promise<void> => {
  const result = await pool.query<{ owner_count: number | string }>(
    `WITH owned_document AS (
       SELECT document.id
       FROM knowledge_documents AS document
       WHERE document.id = $1
         AND document.review_status = 'reviewed'
         AND document.index_status = 'processing'
         AND document.updated_at = $2
         AND (
           (
             $3::integer IS NULL
             AND document.index_job_id IS NULL
             AND document.index_owner_token IS NULL
           )
           OR (
             document.index_job_id = $3
             AND document.index_owner_token = $4
             AND EXISTS (
               SELECT 1
               FROM jobs AS job
               WHERE job.id = $3
                 AND job.owner_token = $4
                 AND job.status = 'processing'
                 AND job.lease_expires_at > NOW()
             )
           )
         )
       FOR SHARE
     ),
     deleted AS (
       DELETE FROM knowledge_chunks AS chunk
       WHERE chunk.document_id = $1
         AND NOT (chunk.id = ANY($5::integer[]))
         AND EXISTS (SELECT 1 FROM owned_document)
       RETURNING chunk.id
     )
     SELECT (SELECT count(*) FROM owned_document) AS owner_count`,
    [
      documentId,
      claimToken,
      leaseFence?.jobId ?? null,
      leaseFence?.ownerToken ?? null,
      activeIDs,
    ],
  )

  if (Number(result.rows[0]?.owner_count) !== 1) {
    throw new Error('Knowledge document changed while it was being indexed')
  }
}

export const indexKnowledgeDocument = async ({
  chunkOptions,
  documentId,
  gateway,
  leaseFence,
  limits: limitOverrides,
  payload,
  pool,
  signal,
}: IndexKnowledgeDocumentInput): Promise<{
  chunkCount: number
  embeddingSpace: string
  model: string
}> => {
  const limits = { ...DEFAULT_KNOWLEDGE_INDEX_LIMITS, ...limitOverrides }
  validateLimits(limits)
  assertNotAborted(signal)
  const claim = await pool.query<{ updated_at: Date }>(
    `UPDATE knowledge_documents AS document
        SET index_status = 'processing',
            indexed_at = NULL,
            index_job_id = $2,
            index_owner_token = $3,
            updated_at = clock_timestamp()
      WHERE document.id = $1
        AND document.review_status = 'reviewed'
        AND (
          $2::integer IS NULL
          OR EXISTS (
            SELECT 1
            FROM jobs AS current_job
            WHERE current_job.id = $2
              AND current_job.owner_token = $3
              AND current_job.status = 'processing'
              AND current_job.lease_expires_at > NOW()
          )
        )
        AND (
          document.index_status <> 'processing'
          OR (
            $2::integer IS NOT NULL
            AND NOT EXISTS (
              SELECT 1
              FROM jobs AS previous_job
              WHERE previous_job.id = document.index_job_id
                AND previous_job.owner_token = document.index_owner_token
                AND previous_job.status = 'processing'
                AND previous_job.lease_expires_at > NOW()
            )
          )
        )
    RETURNING updated_at`,
    [documentId, leaseFence?.jobId ?? null, leaseFence?.ownerToken ?? null],
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
    assertNotAborted(signal)
    const document = await payload.findByID({
      collection: 'knowledge-documents',
      id: documentId,
      overrideAccess: true,
    })
    if (
      document.reviewStatus !== 'reviewed' ||
      document.indexStatus !== 'processing' ||
      new Date(document.updatedAt).getTime() !== claimToken.getTime() ||
      (leaseFence !== undefined &&
        (document.indexJobId !== leaseFence.jobId ||
          document.indexOwnerToken !== leaseFence.ownerToken))
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
      assertNotAborted(signal)
      const embedded = await gateway.embed({ input: batch, signal })
      assertNotAborted(signal)
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
      const batchEmbeddingSpace = embedded.embeddingSpace
      if (!batchEmbeddingSpace?.trim()) {
        throw new Error('Knowledge embedding gateway did not return a stable embedding space')
      }
      if (embeddingSpace && batchEmbeddingSpace !== embeddingSpace) {
        throw new Error('Embedding provider changed vector space during document indexing')
      }
      embeddingModel = embedded.model
      embeddingDimensions = batchDimensions
      embeddingSpace = batchEmbeddingSpace
      embeddings.push(...embedded.embeddings)
    }
    if (!embeddingModel || !embeddingSpace) {
      throw new Error('Knowledge document produced no embeddings')
    }

    const activeIDs: number[] = []

    for (const [index, chunk] of chunks.entries()) {
      assertNotAborted(signal)
      const storedID = await storeKnowledgeChunk({
        chunk,
        claimToken,
        documentId: document.id,
        embedding: embeddings[index],
        embeddingSpace,
        leaseFence,
        model: embeddingModel,
        pool,
      })
      activeIDs.push(storedID)
      assertNotAborted(signal)
    }

    await deleteStaleKnowledgeChunks({
      activeIDs,
      claimToken,
      documentId: document.id,
      leaseFence,
      pool,
    })
    assertNotAborted(signal)

    assertNotAborted(signal)
    const ready = await pool.query(
      `UPDATE knowledge_documents
          SET embedding_model = $1,
              embedding_space = $2,
              index_job_id = NULL,
              index_owner_token = NULL,
              indexed_at = NOW(),
              index_status = 'ready',
              updated_at = NOW()
        WHERE id = $3
          AND review_status = 'reviewed'
          AND index_status = 'processing'
          AND updated_at = $4
          AND (
            (
              $5::integer IS NULL
              AND index_job_id IS NULL
              AND index_owner_token IS NULL
            )
            OR (
              index_job_id = $5
              AND index_owner_token = $6
              AND EXISTS (
                SELECT 1
                FROM jobs
                WHERE id = $5
                  AND owner_token = $6
                  AND status = 'processing'
                  AND lease_expires_at > NOW()
              )
            )
          )`,
      [
        embeddingModel,
        embeddingSpace,
        document.id,
        claimToken,
        leaseFence?.jobId ?? null,
        leaseFence?.ownerToken ?? null,
      ],
    )
    if (ready.rowCount !== 1) {
      throw new Error('Knowledge document changed while it was being indexed')
    }

    return { chunkCount: chunks.length, embeddingSpace, model: embeddingModel }
  } catch (error) {
    await deleteStaleKnowledgeChunks({
      activeIDs: [],
      claimToken,
      documentId,
      leaseFence,
      pool,
    }).catch(() => undefined)
    await pool
      .query(
        `UPDATE knowledge_documents
            SET index_status = 'failed',
                index_job_id = NULL,
                index_owner_token = NULL,
                updated_at = NOW()
          WHERE id = $1
            AND review_status = 'reviewed'
            AND index_status = 'processing'
            AND updated_at = $2
            AND (
              (
                $3::integer IS NULL
                AND index_job_id IS NULL
                AND index_owner_token IS NULL
              )
              OR (
                index_job_id = $3
                AND index_owner_token = $4
                AND EXISTS (
                  SELECT 1
                  FROM jobs
                  WHERE id = $3
                    AND owner_token = $4
                    AND status = 'processing'
                )
              )
            )`,
        [documentId, claimToken, leaseFence?.jobId ?? null, leaseFence?.ownerToken ?? null],
      )
      .catch(() => undefined)
    throw error
  }
}
