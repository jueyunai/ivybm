import type { PostgresAdapter } from '@payloadcms/db-postgres'

import { createEmbeddingSpaceFingerprint } from '@/modules/ai/gateway'

import { formatVector, type KnowledgeEmbeddingGateway } from './embed'
import type { KnowledgeLocale } from './chunk'

type KnowledgePool = Pick<PostgresAdapter['pool'], 'query'>

export type RetrieveKnowledgeInput = {
  /** Restrict retrieval to documents explicitly approved for customer chat. */
  customerVisible?: boolean
  embedding: number[]
  embeddingSpace: string
  limit?: number
  locale: KnowledgeLocale
  minScore?: number
  model: string
  pool: KnowledgePool
}

type RetrieveKnowledgeForQueryInput = Omit<
  RetrieveKnowledgeInput,
  'embedding' | 'embeddingSpace' | 'model'
> & {
  gateway: KnowledgeEmbeddingGateway
  query: string
}

type KnowledgeRow = {
  content: string
  documentId: number | string
  id: number | string
  locale: KnowledgeLocale
  score: number
  sourceTitle: string
  sourceURL: string | null
  sourceVersion: string
  stableId: string
}

export type RetrievedKnowledge = {
  citation: {
    documentId: number | string
    title: string
    url?: string
    version: string
  }
  content: string
  id: number | string
  locale: KnowledgeLocale
  score: number
  stableId: string
}

export const retrieveKnowledge = async ({
  customerVisible = false,
  embedding,
  embeddingSpace,
  limit = 5,
  locale,
  minScore = 0,
  model,
  pool,
}: RetrieveKnowledgeInput): Promise<RetrievedKnowledge[]> => {
  if (!Number.isInteger(limit) || limit < 1 || limit > 20) {
    throw new Error('Knowledge retrieval limit must be between 1 and 20')
  }
  if (!Number.isFinite(minScore) || minScore < -1 || minScore > 1) {
    throw new Error('Knowledge retrieval minScore must be between -1 and 1')
  }
  if (!model.trim()) {
    throw new Error('Knowledge retrieval embedding model is required')
  }
  if (!embeddingSpace.trim()) {
    throw new Error('Knowledge retrieval embedding space is required')
  }

  const vector = formatVector(embedding)
  const result = await pool.query<KnowledgeRow>(
    `WITH eligible_chunks AS MATERIALIZED (
       SELECT kc.id,
              kc.stable_id,
              kc.content,
              kc.locale,
              kc.embedding_vector,
              kd.id AS document_id,
              kd.source_title,
              kd.source_version,
              kd.source_u_r_l
         FROM knowledge_chunks kc
         JOIN knowledge_documents kd ON kd.id = kc.document_id
        WHERE kd.review_status = 'reviewed'
          AND kd.index_status = 'ready'
          AND kd.locale::text = $2
          AND kc.locale::text = $2
          AND kd.embedding_model = $4
          AND kc.embedding_model = $4
          AND kd.embedding_space = $8
          AND kc.embedding_space = $8
          AND kc.embedding_dimensions = $3
          AND kc.embedding_vector IS NOT NULL
          AND ($6::boolean = false OR kd.customer_visible = true)
     )
     SELECT id,
            stable_id AS "stableId",
            content,
            locale,
            document_id AS "documentId",
            source_title AS "sourceTitle",
            source_version AS "sourceVersion",
            source_u_r_l AS "sourceURL",
            (1 - (embedding_vector <=> $1::vector))::double precision AS score
       FROM eligible_chunks
      WHERE (1 - (embedding_vector <=> $1::vector)) >= $5
      ORDER BY embedding_vector <=> $1::vector, id
      LIMIT $7`,
    [vector, locale, embedding.length, model, minScore, customerVisible, limit, embeddingSpace],
  )

  return result.rows.map((row) => ({
    citation: {
      documentId: row.documentId,
      title: row.sourceTitle,
      ...(row.sourceURL ? { url: row.sourceURL } : {}),
      version: row.sourceVersion,
    },
    content: row.content,
    id: row.id,
    locale: row.locale,
    score: row.score,
    stableId: row.stableId,
  }))
}

export const retrieveKnowledgeForQuery = async ({
  gateway,
  query,
  ...options
}: RetrieveKnowledgeForQueryInput): Promise<RetrievedKnowledge[]> => {
  if (!query.trim()) {
    throw new Error('Knowledge retrieval query is required')
  }

  const embedded = await gateway.embed({ input: [query] })
  const embedding = embedded.embeddings[0]
  const embeddingSpace =
    embedded.embeddingSpace ??
    createEmbeddingSpaceFingerprint(
      `provider-name:${embedded.provider}`,
      embedded.model,
      embedding.length,
    )

  return retrieveKnowledge({
    ...options,
    embedding,
    embeddingSpace,
    model: embedded.model,
  })
}
