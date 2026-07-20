import type { PostgresAdapter } from '@payloadcms/db-postgres'
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getPayload, type Payload } from 'payload'

import { retrieveKnowledge, retrieveKnowledgeForQuery } from '@/modules/knowledge/retrieve'
import { indexKnowledgeDocument, setKnowledgeChunkEmbedding } from '@/modules/knowledge/embed'
import { chunkKnowledgeDocument } from '@/modules/knowledge/chunk'
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

  it('requires an explicit customer-visible review boundary for website-chat retrieval', async () => {
    const suffix = randomUUID()
    const internal = await payload.create({
      collection: 'knowledge-documents',
      data: {
        content: 'Internal sales margin guidance must never reach customers.',
        customerVisible: false,
        indexStatus: 'pending',
        locale: 'en',
        reviewStatus: 'reviewed',
        sourceTitle: `Internal briefing ${suffix}`,
        sourceType: 'sales-script',
        sourceVersion: '1.0',
      },
      overrideAccess: true,
    })
    const customer = await payload.create({
      collection: 'knowledge-documents',
      data: {
        content: 'Customers can request a finish sample after engineering review.',
        customerVisible: true,
        indexStatus: 'pending',
        locale: 'en',
        reviewStatus: 'reviewed',
        sourceTitle: `Customer FAQ ${suffix}`,
        sourceType: 'faq',
        sourceVersion: '1.0',
      },
      overrideAccess: true,
    })
    documentIDs.push(internal.id, customer.id)
    const internalChunk = await payload.create({
      collection: 'knowledge-chunks',
      data: {
        content: internal.content,
        document: internal.id,
        index: 0,
        locale: 'en',
        sourceTitle: internal.sourceTitle,
        sourceVersion: internal.sourceVersion,
        stableId: `internal-visible-boundary-${suffix}`,
      },
      overrideAccess: true,
    })
    const customerChunk = await payload.create({
      collection: 'knowledge-chunks',
      data: {
        content: customer.content,
        document: customer.id,
        index: 0,
        locale: 'en',
        sourceTitle: customer.sourceTitle,
        sourceVersion: customer.sourceVersion,
        stableId: `customer-visible-boundary-${suffix}`,
      },
      overrideAccess: true,
    })
    chunkIDs.push(internalChunk.id, customerChunk.id)
    const pool = getDatabase().pool
    await Promise.all([
      setKnowledgeChunkEmbedding({
        chunkId: internalChunk.id,
        embedding: [1, 0, 0],
        model: 'public-boundary-model',
        pool,
      }),
      setKnowledgeChunkEmbedding({
        chunkId: customerChunk.id,
        embedding: [1, 0, 0],
        model: 'public-boundary-model',
        pool,
      }),
      payload.update({
        collection: 'knowledge-documents',
        data: { embeddingModel: 'public-boundary-model', indexStatus: 'ready' },
        id: internal.id,
        overrideAccess: true,
      }),
      payload.update({
        collection: 'knowledge-documents',
        data: { embeddingModel: 'public-boundary-model', indexStatus: 'ready' },
        id: customer.id,
        overrideAccess: true,
      }),
    ])

    const results = await retrieveKnowledge({
      customerVisible: true,
      embedding: [1, 0, 0],
      locale: 'en',
      model: 'public-boundary-model',
      pool,
    })
    expect(results.map(({ id }) => id)).toEqual([customerChunk.id])
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

  it('requires reindexing before a changed embedding route can retrieve existing knowledge', async () => {
    const suffix = randomUUID()
    const document = await payload.create({
      collection: 'knowledge-documents',
      data: {
        content: 'A reviewed finish specification requires an engineering confirmation.',
        indexStatus: 'pending',
        locale: 'en',
        reviewStatus: 'reviewed',
        sourceTitle: `Embedding route change ${suffix}`,
        sourceType: 'technical-specification',
        sourceVersion: '1.0',
      },
      overrideAccess: true,
    })
    documentIDs.push(document.id)
    const pool = getDatabase().pool

    const oldRouteGateway = {
      embed: async ({ input }: { input: string[] }) => ({
        cost: { currency: 'USD' as const, estimated: 0 },
        embeddings: input.map(() => [1, 0, 0]),
        model: 'embedding-route-old',
        provider: 'old-route-fixture',
        usage: { inputTokens: input.length * 3, totalTokens: input.length * 3 },
      }),
    }
    const newRouteGateway = {
      embed: async ({ input }: { input: string[] }) => ({
        cost: { currency: 'USD' as const, estimated: 0 },
        embeddings: input.map(() => [0, 1, 0]),
        model: 'embedding-route-new',
        provider: 'new-route-fixture',
        usage: { inputTokens: input.length * 3, totalTokens: input.length * 3 },
      }),
    }

    await expect(
      indexKnowledgeDocument({
        documentId: document.id,
        gateway: oldRouteGateway,
        payload,
        pool,
      }),
    ).resolves.toEqual({ chunkCount: 1, model: 'embedding-route-old' })

    await expect(
      retrieveKnowledgeForQuery({
        gateway: newRouteGateway,
        locale: 'en',
        pool,
        query: 'Which finish specification needs engineering confirmation?',
      }),
    ).resolves.toEqual([])

    await expect(
      indexKnowledgeDocument({
        documentId: document.id,
        gateway: newRouteGateway,
        payload,
        pool,
      }),
    ).resolves.toEqual({ chunkCount: 1, model: 'embedding-route-new' })

    const results = await retrieveKnowledgeForQuery({
      gateway: newRouteGateway,
      locale: 'en',
      pool,
      query: 'Which finish specification needs engineering confirmation?',
    })
    expect(results).toHaveLength(1)
    expect(results[0].citation.documentId).toBe(document.id)

    const chunks = await payload.find({
      collection: 'knowledge-chunks',
      overrideAccess: true,
      where: { document: { equals: document.id } },
    })
    chunkIDs.push(...chunks.docs.map(({ id }) => id))
    expect(chunks.docs).toHaveLength(1)
    expect(chunks.docs[0]).toMatchObject({ embeddingModel: 'embedding-route-new' })
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

  it('atomically allows only one concurrent indexing run for a document', async () => {
    const suffix = randomUUID()
    const document = await payload.create({
      collection: 'knowledge-documents',
      data: {
        content: 'Only one concurrent request may index this reviewed engineering statement.',
        indexStatus: 'pending',
        locale: 'en',
        reviewStatus: 'reviewed',
        sourceTitle: `Concurrent index ${suffix}`,
        sourceType: 'technical-specification',
        sourceVersion: '1.0',
      },
      overrideAccess: true,
    })
    documentIDs.push(document.id)

    let releaseEmbedding!: () => void
    const embeddingReleased = new Promise<void>((resolve) => {
      releaseEmbedding = resolve
    })
    let signalEmbeddingStarted!: () => void
    const embeddingStarted = new Promise<void>((resolve) => {
      signalEmbeddingStarted = resolve
    })
    const gateway = {
      embed: async ({ input }: { input: string[] }) => {
        signalEmbeddingStarted()
        await embeddingReleased
        return {
          cost: { currency: 'USD' as const, estimated: 0 },
          embeddings: input.map(() => [1, 0, 0]),
          model: 'fake-concurrent-index-model',
          provider: 'fake',
          usage: { inputTokens: 5, totalTokens: 5 },
        }
      },
    }

    const first = indexKnowledgeDocument({
      documentId: document.id,
      gateway,
      payload,
      pool: getDatabase().pool,
    })
    await embeddingStarted

    await expect(
      indexKnowledgeDocument({
        documentId: document.id,
        gateway,
        payload,
        pool: getDatabase().pool,
      }),
    ).rejects.toThrow('Knowledge document is already being indexed')

    releaseEmbedding()
    await expect(first).resolves.toEqual({
      chunkCount: 1,
      model: 'fake-concurrent-index-model',
    })

    const indexedDocument = await payload.findByID({
      collection: 'knowledge-documents',
      id: document.id,
      overrideAccess: true,
    })
    expect(indexedDocument.indexStatus).toBe('ready')
    const chunks = await payload.find({
      collection: 'knowledge-chunks',
      overrideAccess: true,
      where: { document: { equals: document.id } },
    })
    chunkIDs.push(...chunks.docs.map(({ id }) => id))
    expect(chunks.totalDocs).toBe(1)
  })

  it('paginates all existing chunks when reindexing more than 1000 rows', async () => {
    const suffix = randomUUID()
    const content = 'Stable reviewed knowledge that must reuse its existing chunk.'
    const document = await payload.create({
      collection: 'knowledge-documents',
      data: {
        content,
        indexStatus: 'pending',
        locale: 'en',
        reviewStatus: 'reviewed',
        sourceTitle: `Large reindex ${suffix}`,
        sourceType: 'faq',
        sourceVersion: '1.0',
      },
      overrideAccess: true,
    })
    documentIDs.push(document.id)
    const [expectedChunk] = chunkKnowledgeDocument({
      documentId: document.id,
      locale: document.locale,
      sourceTitle: document.sourceTitle,
      sourceVersion: document.sourceVersion,
      text: document.content,
    })
    const pool = getDatabase().pool

    await pool.query(
      `INSERT INTO knowledge_chunks
        (document_id, stable_id, "index", locale, content, source_title, source_version)
       SELECT $1, $3 || value, value, 'en', 'stale', $2, '0.9'
       FROM generate_series(1, 1000) AS value`,
      [document.id, document.sourceTitle, `stale-${suffix}-`],
    )
    const matching = await payload.create({
      collection: 'knowledge-chunks',
      data: {
        content: expectedChunk.content,
        document: document.id,
        index: expectedChunk.index,
        locale: expectedChunk.locale,
        sourceTitle: expectedChunk.citation.title,
        sourceVersion: expectedChunk.citation.version,
        stableId: expectedChunk.stableId,
      },
      overrideAccess: true,
    })

    await expect(
      indexKnowledgeDocument({
        documentId: document.id,
        gateway: {
          embed: async ({ input }) => ({
            cost: { currency: 'USD' as const, estimated: 0 },
            embeddings: input.map(() => [1, 0, 0]),
            model: 'fake-large-reindex-model',
            provider: 'fake',
            usage: { inputTokens: 5, totalTokens: 5 },
          }),
        },
        payload,
        pool,
      }),
    ).resolves.toEqual({ chunkCount: 1, model: 'fake-large-reindex-model' })

    const remaining = await payload.find({
      collection: 'knowledge-chunks',
      limit: 10,
      overrideAccess: true,
      where: { document: { equals: document.id } },
    })
    chunkIDs.push(...remaining.docs.map(({ id }) => id))
    expect(remaining.totalDocs).toBe(1)
    expect(remaining.docs[0].id).toBe(matching.id)
  })

  it('batches embedding calls within item and estimated token limits', async () => {
    const suffix = randomUUID()
    const paragraphs = Array.from(
      { length: 5 },
      (_, index) => `Section ${index + 1} ${'x'.repeat(44)}.`,
    )
    const document = await payload.create({
      collection: 'knowledge-documents',
      data: {
        content: paragraphs.join('\n\n'),
        indexStatus: 'pending',
        locale: 'en',
        reviewStatus: 'reviewed',
        sourceTitle: `Batch limits ${suffix}`,
        sourceType: 'product-manual',
        sourceVersion: '1.0',
      },
      overrideAccess: true,
    })
    documentIDs.push(document.id)
    const batches: string[][] = []

    await expect(
      indexKnowledgeDocument({
        chunkOptions: { maxCharacters: 60 },
        documentId: document.id,
        gateway: {
          embed: async ({ input }) => {
            batches.push(input)
            return {
              cost: { currency: 'USD' as const, estimated: 0 },
              embeddings: input.map(() => [1, 0, 0]),
              model: 'fake-batched-model',
              provider: 'fake',
              usage: { inputTokens: input.length * 10, totalTokens: input.length * 10 },
            }
          },
        },
        limits: {
          embeddingBatchMaxItems: 2,
          embeddingBatchMaxTokens: 30,
        },
        payload,
        pool: getDatabase().pool,
      }),
    ).resolves.toEqual({ chunkCount: 5, model: 'fake-batched-model' })

    expect(batches.map((batch) => batch.length)).toEqual([2, 2, 1])
    expect(
      batches.every(
        (batch) =>
          batch.reduce((tokens, text) => tokens + Math.ceil(Buffer.byteLength(text) / 4), 0) <= 30,
      ),
    ).toBe(true)

    const chunks = await payload.find({
      collection: 'knowledge-chunks',
      overrideAccess: true,
      where: { document: { equals: document.id } },
    })
    chunkIDs.push(...chunks.docs.map(({ id }) => id))
  })

  it('rejects documents that exceed configured byte or chunk limits before embedding', async () => {
    const suffix = randomUUID()
    const oversizedDocument = await payload.create({
      collection: 'knowledge-documents',
      data: {
        content: 'This reviewed document is larger than its deliberately tiny test limit.',
        indexStatus: 'pending',
        locale: 'en',
        reviewStatus: 'reviewed',
        sourceTitle: `Byte limit ${suffix}`,
        sourceType: 'faq',
        sourceVersion: '1.0',
      },
      overrideAccess: true,
    })
    const overChunkedDocument = await payload.create({
      collection: 'knowledge-documents',
      data: {
        content: `${'First section '.repeat(5)}\n\n${'Second section '.repeat(5)}`,
        indexStatus: 'pending',
        locale: 'en',
        reviewStatus: 'reviewed',
        sourceTitle: `Chunk limit ${suffix}`,
        sourceType: 'faq',
        sourceVersion: '1.0',
      },
      overrideAccess: true,
    })
    documentIDs.push(oversizedDocument.id, overChunkedDocument.id)
    const embed = async () => {
      throw new Error('embedding must not run when limits are exceeded')
    }

    await expect(
      indexKnowledgeDocument({
        documentId: oversizedDocument.id,
        gateway: { embed },
        limits: { documentMaxBytes: 10 },
        payload,
        pool: getDatabase().pool,
      }),
    ).rejects.toThrow('Knowledge document exceeds the configured size limit')
    await expect(
      indexKnowledgeDocument({
        chunkOptions: { maxCharacters: 60 },
        documentId: overChunkedDocument.id,
        gateway: { embed },
        limits: { maxChunksPerDocument: 1 },
        payload,
        pool: getDatabase().pool,
      }),
    ).rejects.toThrow('Knowledge document exceeds the configured chunk limit')
  })

  it('relies on the database foreign key to delete chunks with their document', async () => {
    const suffix = randomUUID()
    const document = await payload.create({
      collection: 'knowledge-documents',
      data: {
        content: 'Document deleted directly in the database.',
        indexStatus: 'pending',
        locale: 'en',
        reviewStatus: 'reviewed',
        sourceTitle: `Cascade delete ${suffix}`,
        sourceType: 'faq',
        sourceVersion: '1.0',
      },
      overrideAccess: true,
    })
    const chunk = await payload.create({
      collection: 'knowledge-chunks',
      data: {
        content: document.content,
        document: document.id,
        index: 0,
        locale: document.locale,
        sourceTitle: document.sourceTitle,
        sourceVersion: document.sourceVersion,
        stableId: `cascade-${suffix}`,
      },
      overrideAccess: true,
    })
    const pool = getDatabase().pool

    await expect(
      pool.query('DELETE FROM knowledge_documents WHERE id = $1', [document.id]),
    ).resolves.toMatchObject({
      rowCount: 1,
    })
    const remaining = await pool.query<{ count: string }>(
      'SELECT COUNT(*) AS count FROM knowledge_chunks WHERE id = $1',
      [chunk.id],
    )
    expect(remaining.rows[0].count).toBe('0')
  })
})
