import type { PostgresAdapter } from '@payloadcms/db-postgres'
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getPayload, type Payload } from 'payload'

import {
  retrieveKnowledge,
  retrieveKnowledgeForQuery,
} from '@/modules/knowledge/retrieve'
import { indexKnowledgeDocument, setKnowledgeChunkEmbedding } from '@/modules/knowledge/embed'
import config from '@/payload.config'

let payload: Payload
const documentIDs: Array<number | string> = []
const chunkIDs: Array<number | string> = []
const promptIDs: Array<number | string> = []
const userIDs: Array<number | string> = []

const getDatabase = (): PostgresAdapter => payload.db as unknown as PostgresAdapter

describe.sequential('knowledge retrieval', () => {
  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL is required for knowledge retrieval integration tests')
    }

    payload = await getPayload({
      config,
      disableOnInit: true,
      key: 'knowledge-retrieval-integration-tests',
    })
  })

  afterAll(async () => {
    if (!payload) return

    if (chunkIDs.length > 0) {
      await payload.delete({
        collection: 'knowledge-chunks',
        overrideAccess: true,
        where: { id: { in: chunkIDs } },
      })
    }
    if (documentIDs.length > 0) {
      await payload.delete({
        collection: 'knowledge-documents',
        overrideAccess: true,
        where: { id: { in: documentIDs } },
      })
    }
    if (promptIDs.length > 0) {
      await payload.delete({
        collection: 'prompt-templates',
        overrideAccess: true,
        where: { id: { in: promptIDs } },
      })
    }
    if (userIDs.length > 0) {
      await payload.delete({
        collection: 'audit-logs',
        overrideAccess: true,
        where: { actor: { in: userIDs } },
      })
      await payload.delete({
        collection: 'users',
        context: { skipAudit: true },
        overrideAccess: true,
        where: { id: { in: userIDs } },
      })
    }

    await payload.destroy()
  })

  it('orders approved knowledge by cosine similarity and returns citations', async () => {
    const suffix = randomUUID()
    const reviewedDocument = await payload.create({
      collection: 'knowledge-documents',
      data: {
        content: 'Reviewed facade engineering guidance.',
        indexStatus: 'pending',
        locale: 'en',
        reviewStatus: 'reviewed',
        sourceTitle: `Reviewed manual ${suffix}`,
        sourceType: 'product-manual',
        sourceURL: 'https://example.invalid/reviewed-manual',
        sourceVersion: '1.0',
      },
      overrideAccess: true,
    })
    const draftDocument = await payload.create({
      collection: 'knowledge-documents',
      data: {
        content: 'Unreviewed pricing claim.',
        indexStatus: 'pending',
        locale: 'en',
        reviewStatus: 'draft',
        sourceTitle: `Draft manual ${suffix}`,
        sourceType: 'product-manual',
        sourceVersion: '1.0',
      },
      overrideAccess: true,
    })
    const incompatibleDocument = await payload.create({
      collection: 'knowledge-documents',
      data: {
        content: 'Knowledge embedded by a different model and vector dimension.',
        indexStatus: 'pending',
        locale: 'en',
        reviewStatus: 'reviewed',
        sourceTitle: `Incompatible manual ${suffix}`,
        sourceType: 'product-manual',
        sourceVersion: '1.0',
      },
      overrideAccess: true,
    })
    documentIDs.push(reviewedDocument.id, draftDocument.id, incompatibleDocument.id)

    const nearest = await payload.create({
      collection: 'knowledge-chunks',
      data: {
        content: 'Aluminum facade panels support custom dimensions after engineering review.',
        document: reviewedDocument.id,
        index: 0,
        locale: 'en',
        sourceTitle: reviewedDocument.sourceTitle,
        sourceURL: reviewedDocument.sourceURL,
        sourceVersion: reviewedDocument.sourceVersion,
        stableId: `nearest-${suffix}`,
      },
      overrideAccess: true,
    })
    const farther = await payload.create({
      collection: 'knowledge-chunks',
      data: {
        content: 'Installation depends on the supporting structure.',
        document: reviewedDocument.id,
        index: 1,
        locale: 'en',
        sourceTitle: reviewedDocument.sourceTitle,
        sourceVersion: reviewedDocument.sourceVersion,
        stableId: `farther-${suffix}`,
      },
      overrideAccess: true,
    })
    const forbiddenDraft = await payload.create({
      collection: 'knowledge-chunks',
      data: {
        content: 'This unreviewed chunk must never be returned.',
        document: draftDocument.id,
        index: 0,
        locale: 'en',
        sourceTitle: draftDocument.sourceTitle,
        sourceVersion: draftDocument.sourceVersion,
        stableId: `draft-${suffix}`,
      },
      overrideAccess: true,
    })
    const incompatible = await payload.create({
      collection: 'knowledge-chunks',
      data: {
        content: 'This incompatible vector must be filtered before distance evaluation.',
        document: incompatibleDocument.id,
        index: 0,
        locale: 'en',
        sourceTitle: incompatibleDocument.sourceTitle,
        sourceVersion: incompatibleDocument.sourceVersion,
        stableId: `incompatible-${suffix}`,
      },
      overrideAccess: true,
    })
    chunkIDs.push(nearest.id, farther.id, forbiddenDraft.id, incompatible.id)

    const pool = getDatabase().pool
    await setKnowledgeChunkEmbedding({
      chunkId: nearest.id,
      embedding: [1, 0, 0],
      model: 'fake-embedding-model',
      pool,
    })
    await payload.update({
      collection: 'knowledge-documents',
      data: { embeddingModel: 'fake-embedding-model', indexStatus: 'ready' },
      id: reviewedDocument.id,
      overrideAccess: true,
    })
    await setKnowledgeChunkEmbedding({
      chunkId: farther.id,
      embedding: [0.7, 0.3, 0],
      model: 'fake-embedding-model',
      pool,
    })
    await setKnowledgeChunkEmbedding({
      chunkId: forbiddenDraft.id,
      embedding: [1, 0, 0],
      model: 'fake-embedding-model',
      pool,
    })
    await setKnowledgeChunkEmbedding({
      chunkId: incompatible.id,
      embedding: [1, 0],
      model: 'different-embedding-model',
      pool,
    })
    await payload.update({
      collection: 'knowledge-documents',
      data: { embeddingModel: 'different-embedding-model', indexStatus: 'ready' },
      id: incompatibleDocument.id,
      overrideAccess: true,
    })

    const results = await retrieveKnowledge({
      embedding: [1, 0, 0],
      limit: 5,
      locale: 'en',
      model: 'fake-embedding-model',
      pool,
    })

    expect(results.map(({ id }) => id)).toEqual([nearest.id, farther.id])
    expect(results[0]).toMatchObject({
      citation: {
        documentId: reviewedDocument.id,
        title: reviewedDocument.sourceTitle,
        url: reviewedDocument.sourceURL,
        version: reviewedDocument.sourceVersion,
      },
      content: nearest.content,
      locale: 'en',
    })
    expect(results[0].score).toBeGreaterThan(results[1].score)
    expect(results.some(({ content }) => content.includes('unreviewed'))).toBe(false)
  })

  it('indexes reviewed documents and invalidates approval when source content changes', async () => {
    const suffix = randomUUID()
    const document = await payload.create({
      collection: 'knowledge-documents',
      data: {
        content:
          'Facade panels support custom dimensions after engineering review.\n\nDelivery dates must be confirmed by sales.',
        indexStatus: 'pending',
        locale: 'en',
        reviewStatus: 'reviewed',
        sourceTitle: `Index lifecycle ${suffix}`,
        sourceType: 'faq',
        sourceVersion: '1.0',
      },
      overrideAccess: true,
    })
    documentIDs.push(document.id)

    const indexed = await indexKnowledgeDocument({
      chunkOptions: { maxCharacters: 80 },
      documentId: document.id,
      gateway: {
        embed: async ({ input }) => ({
          cost: { currency: 'USD' as const, estimated: 0 },
          embeddings: input.map((_, index) => (index === 0 ? [1, 0, 0] : [0, 1, 0])),
          model: 'fake-index-model',
          provider: 'fake',
          usage: { inputTokens: 10, totalTokens: 10 },
        }),
      },
      payload,
      pool: getDatabase().pool,
    })

    expect(indexed).toEqual({ chunkCount: 2, model: 'fake-index-model' })
    const readyDocument = await payload.findByID({
      collection: 'knowledge-documents',
      id: document.id,
      overrideAccess: true,
    })
    expect(readyDocument).toMatchObject({
      embeddingModel: 'fake-index-model',
      indexStatus: 'ready',
      reviewStatus: 'reviewed',
    })
    expect(readyDocument.indexedAt).toBeTruthy()

    const createdChunks = await payload.find({
      collection: 'knowledge-chunks',
      overrideAccess: true,
      where: { document: { equals: document.id } },
    })
    chunkIDs.push(...createdChunks.docs.map(({ id }) => id))
    expect(createdChunks.totalDocs).toBe(2)

    const queryResults = await retrieveKnowledgeForQuery({
      gateway: {
        embed: async ({ input }) => ({
          cost: { currency: 'USD' as const, estimated: 0 },
          embeddings: input.map(() => [1, 0, 0]),
          model: 'fake-index-model',
          provider: 'fake',
          usage: { inputTokens: 3, totalTokens: 3 },
        }),
      },
      locale: 'en',
      minScore: 0.1,
      pool: getDatabase().pool,
      query: 'custom facade dimensions',
    })
    expect(queryResults).toHaveLength(1)
    expect(queryResults[0].citation.documentId).toBe(document.id)

    const changed = await payload.update({
      collection: 'knowledge-documents',
      data: { content: `${document.content}\n\nUpdated unreviewed statement.` },
      id: document.id,
      overrideAccess: true,
    })

    expect(changed).toMatchObject({
      embeddingModel: null,
      indexStatus: 'pending',
      reviewStatus: 'draft',
    })
    expect(changed.indexedAt).toBeNull()
    await expect(
      indexKnowledgeDocument({
        documentId: changed.id,
        gateway: {
          embed: async () => {
            throw new Error('must not run')
          },
        },
        payload,
        pool: getDatabase().pool,
      }),
    ).rejects.toThrow('Only reviewed knowledge documents can be indexed')
  })

  it('allows operators to manage knowledge while denying sales and enforces prompt versions', async () => {
    const suffix = randomUUID()
    const operator = await payload.create({
      collection: 'users',
      context: { skipAudit: true },
      data: {
        email: `task8-operator-${suffix}@example.invalid`,
        password: 'task8-operator-integration-password',
        role: 'operator',
      },
      overrideAccess: true,
    })
    const sales = await payload.create({
      collection: 'users',
      context: { skipAudit: true },
      data: {
        email: `task8-sales-${suffix}@example.invalid`,
        password: 'task8-sales-integration-password',
        role: 'sales',
      },
      overrideAccess: true,
    })
    userIDs.push(operator.id, sales.id)

    const document = await payload.create({
      collection: 'knowledge-documents',
      data: {
        content: 'Operator-maintained reviewed knowledge.',
        indexStatus: 'pending',
        locale: 'en',
        reviewStatus: 'draft',
        sourceTitle: `Operator document ${suffix}`,
        sourceType: 'faq',
        sourceVersion: '1.0',
      },
      overrideAccess: false,
      user: operator,
    })
    documentIDs.push(document.id)

    const attemptedReady = await payload.update({
      collection: 'knowledge-documents',
      data: { indexStatus: 'ready' },
      id: document.id,
      overrideAccess: false,
      user: operator,
    })
    expect(attemptedReady.indexStatus).toBe('pending')

    await expect(
      payload.create({
        collection: 'knowledge-chunks',
        data: {
          content: 'Direct chunk edits must not bypass document review.',
          document: document.id,
          index: 0,
          locale: 'en',
          sourceTitle: document.sourceTitle,
          sourceVersion: document.sourceVersion,
          stableId: `direct-${suffix}`,
        },
        overrideAccess: false,
        user: operator,
      }),
    ).rejects.toMatchObject({ status: 403 })

    await expect(
      payload.create({
        collection: 'knowledge-documents',
        data: {
          content: 'Sales users cannot create knowledge.',
          indexStatus: 'pending',
          locale: 'en',
          reviewStatus: 'draft',
          sourceTitle: `Sales document ${suffix}`,
          sourceType: 'faq',
          sourceVersion: '1.0',
        },
        overrideAccess: false,
        user: sales,
      }),
    ).rejects.toMatchObject({ status: 403 })

    const prompt = await payload.create({
      collection: 'prompt-templates',
      data: {
        key: `customer-chat-${suffix}`,
        locale: 'en',
        purpose: 'customer-chat',
        status: 'active',
        template: 'Answer from {{knowledge}} and cite the source.',
        version: 1,
      },
      overrideAccess: false,
      user: operator,
    })
    promptIDs.push(prompt.id)

    await expect(
      payload.update({
        collection: 'prompt-templates',
        data: { template: 'Silently changed active prompt.' },
        id: prompt.id,
        overrideAccess: false,
        user: operator,
      }),
    ).rejects.toMatchObject({ status: 400 })

    await expect(
      payload.create({
        collection: 'prompt-templates',
        data: {
          key: prompt.key,
          locale: prompt.locale,
          purpose: prompt.purpose,
          status: 'draft',
          template: 'Duplicate version.',
          version: prompt.version,
        },
        overrideAccess: false,
        user: operator,
      }),
    ).rejects.toBeDefined()
  })

  it('never marks a document ready when its source changes during embedding', async () => {
    const suffix = randomUUID()
    const document = await payload.create({
      collection: 'knowledge-documents',
      data: {
        content: 'Original reviewed engineering statement.',
        indexStatus: 'pending',
        locale: 'en',
        reviewStatus: 'reviewed',
        sourceTitle: `Concurrent update ${suffix}`,
        sourceType: 'technical-specification',
        sourceVersion: '1.0',
      },
      overrideAccess: true,
    })
    documentIDs.push(document.id)

    await expect(
      indexKnowledgeDocument({
        documentId: document.id,
        gateway: {
          embed: async ({ input }) => {
            await payload.update({
              collection: 'knowledge-documents',
              data: { content: 'Changed while the embedding provider was running.' },
              id: document.id,
              overrideAccess: true,
            })
            return {
              cost: { currency: 'USD' as const, estimated: 0 },
              embeddings: input.map(() => [1, 0, 0]),
              model: 'fake-concurrent-model',
              provider: 'fake',
              usage: { inputTokens: 5, totalTokens: 5 },
            }
          },
        },
        payload,
        pool: getDatabase().pool,
      }),
    ).rejects.toThrow('Knowledge document changed while it was being indexed')

    const changed = await payload.findByID({
      collection: 'knowledge-documents',
      id: document.id,
      overrideAccess: true,
    })
    expect(changed).toMatchObject({ indexStatus: 'pending', reviewStatus: 'draft' })

    const createdChunks = await payload.find({
      collection: 'knowledge-chunks',
      overrideAccess: true,
      where: { document: { equals: document.id } },
    })
    chunkIDs.push(...createdChunks.docs.map(({ id }) => id))
  })
})
