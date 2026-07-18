import type { PostgresAdapter } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'

import type { AiGateway } from '@/modules/ai/gateway'

import { chunkKnowledgeDocument } from './chunk'

type KnowledgePool = Pick<PostgresAdapter['pool'], 'query'>

type SetKnowledgeChunkEmbeddingInput = {
  chunkId: number | string
  embedding: number[]
  model: string
  pool: KnowledgePool
}

type IndexKnowledgeDocumentInput = {
  chunkOptions?: { maxCharacters?: number }
  documentId: number | string
  gateway: Pick<AiGateway, 'embed'>
  payload: Payload
  pool: KnowledgePool
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
  model,
  pool,
}: SetKnowledgeChunkEmbeddingInput): Promise<void> => {
  const result = await pool.query(
    `UPDATE knowledge_chunks
       SET embedding_vector = $1::vector,
           embedding_model = $2,
           embedding_dimensions = $3,
           embedded_at = NOW(),
           updated_at = NOW()
     WHERE id = $4`,
    [formatVector(embedding), model, embedding.length, chunkId],
  )

  if (result.rowCount !== 1) {
    throw new Error(`Knowledge chunk not found: ${String(chunkId)}`)
  }
}

export const indexKnowledgeDocument = async ({
  chunkOptions,
  documentId,
  gateway,
  payload,
  pool,
}: IndexKnowledgeDocumentInput): Promise<{ chunkCount: number; model: string }> => {
  const document = await payload.findByID({
    collection: 'knowledge-documents',
    id: documentId,
    overrideAccess: true,
  })
  if (document.reviewStatus !== 'reviewed') {
    throw new Error('Only reviewed knowledge documents can be indexed')
  }

  const processingDocument = await payload.update({
    collection: 'knowledge-documents',
    data: { indexStatus: 'processing' },
    id: document.id,
    overrideAccess: true,
  })

  try {
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
    const embedded = await gateway.embed({ input: chunks.map(({ content }) => content) })
    const existing = await payload.find({
      collection: 'knowledge-chunks',
      limit: 1_000,
      overrideAccess: true,
      where: { document: { equals: document.id } },
    })
    const existingByStableID = new Map(existing.docs.map((chunk) => [chunk.stableId, chunk]))
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
        embedding: embedded.embeddings[index],
        model: embedded.model,
        pool,
      })
    }

    for (const staleChunk of existing.docs) {
      if (!activeIDs.has(staleChunk.id)) {
        await payload.delete({
          collection: 'knowledge-chunks',
          id: staleChunk.id,
          overrideAccess: true,
        })
      }
    }

    const ready = await pool.query(
      `UPDATE knowledge_documents
          SET embedding_model = $1,
              indexed_at = NOW(),
              index_status = 'ready',
              updated_at = NOW()
        WHERE id = $2
          AND review_status = 'reviewed'
          AND index_status = 'processing'
          AND updated_at = $3`,
      [embedded.model, document.id, processingDocument.updatedAt],
    )
    if (ready.rowCount !== 1) {
      throw new Error('Knowledge document changed while it was being indexed')
    }

    return { chunkCount: chunks.length, model: embedded.model }
  } catch (error) {
    await pool
      .query(
        `UPDATE knowledge_documents
            SET index_status = 'failed', updated_at = NOW()
          WHERE id = $1
            AND review_status = 'reviewed'
            AND index_status = 'processing'`,
        [document.id],
      )
      .catch(() => undefined)
    throw error
  }
}
