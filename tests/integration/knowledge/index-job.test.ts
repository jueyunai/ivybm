import { randomUUID } from 'node:crypto'

import { NextRequest } from 'next/server'
import type { PostgresAdapter } from '@payloadcms/db-postgres'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { getPayload, type Payload } from 'payload'

import { POST as requestKnowledgeIndex } from '@/app/api/knowledge/documents/[id]/index/route'
import {
  createAiGateway,
  createEmbeddingSpaceFingerprint,
  type AiProvider,
} from '@/modules/ai/gateway'
import { PayloadJobQueue } from '@/modules/jobs/claim'
import { JobWorker } from '@/modules/jobs/worker'
import {
  createKnowledgeIndexJobHandler,
  enqueueKnowledgeIndexJob,
  enqueueLegacyKnowledgeRebuilds,
  KNOWLEDGE_INDEX_JOB_TYPE,
  recoverDeadKnowledgeIndexDocuments,
} from '@/modules/knowledge/jobs'
import { retrieveKnowledge } from '@/modules/knowledge/retrieve'
import config from '@/payload.config'
import type { User } from '@/payload-types'

let payload: Payload
let operator: User
let sales: User
let providerID: number
let profileID: number
let routeID: number
let originalEncryptionKey: string | undefined
const userIDs: number[] = []
const jobIDs: number[] = []
const documentIDs: number[] = []

const loginHeader = async (user: User, password: string): Promise<string> => {
  const login = await payload.login({
    collection: 'users',
    data: { email: user.email, password },
  })
  return `JWT ${login.token}`
}

describe.sequential('knowledge index job', () => {
  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL is required for knowledge index job integration tests')
    }
    originalEncryptionKey = process.env.AI_CONFIG_ENCRYPTION_KEY
    process.env.AI_CONFIG_ENCRYPTION_KEY = 'd'.repeat(64)
    payload = await getPayload({
      config,
      disableOnInit: true,
      key: 'knowledge-index-job-integration-tests',
    })

    const suffix = randomUUID()
    operator = await payload.create({
      collection: 'users',
      context: { skipAudit: true },
      data: {
        email: `knowledge-operator-${suffix}@example.invalid`,
        password: 'knowledge-operator-password',
        role: 'operator',
      },
      overrideAccess: true,
    })
    sales = await payload.create({
      collection: 'users',
      context: { skipAudit: true },
      data: {
        email: `knowledge-sales-${suffix}@example.invalid`,
        password: 'knowledge-sales-password',
        role: 'sales',
      },
      overrideAccess: true,
    })
    userIDs.push(operator.id, sales.id)

    const provider = await payload.create({
      collection: 'ai-providers',
      data: {
        apiKey: `knowledge-provider-secret-${suffix}`,
        apiKeyConfigured: true,
        baseURL: 'https://knowledge-provider.example.invalid/v1',
        enabled: true,
        name: `Knowledge provider ${suffix}`,
        protocol: 'openai-compatible',
      },
      overrideAccess: true,
    })
    providerID = provider.id
    const profile = await payload.create({
      collection: 'ai-model-profiles',
      data: {
        capability: 'embedding',
        enabled: true,
        model: 'knowledge-test-embedding',
        name: `Knowledge embedding ${suffix}`,
        parameters: {
          dimensions: 3,
          reasoningEffort: 'medium',
          reasoningEnabled: false,
          timeoutMs: 15_000,
        },
        provider: providerID,
      },
      overrideAccess: true,
    })
    profileID = profile.id
    const route = await payload.create({
      collection: 'ai-usage-routes',
      data: {
        enabled: true,
        operation: 'embedding',
        profile: profileID,
        usageKey: 'knowledge.embedding',
      },
      overrideAccess: true,
    })
    routeID = route.id
  })

  afterAll(async () => {
    if (payload) {
      if (jobIDs.length > 0) {
        await payload.delete({
          collection: 'jobs',
          overrideAccess: true,
          where: { id: { in: jobIDs } },
        })
      }
      if (documentIDs.length > 0) {
        await payload.delete({
          collection: 'knowledge-documents',
          overrideAccess: true,
          where: { id: { in: documentIDs } },
        })
      }
      for (const [collection, id] of [
        ['ai-usage-routes', routeID],
        ['ai-model-profiles', profileID],
        ['ai-providers', providerID],
      ] as const) {
        if (id) await payload.delete({ collection, id, overrideAccess: true })
      }
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
      await payload.destroy()
    }
    if (originalEncryptionKey === undefined) delete process.env.AI_CONFIG_ENCRYPTION_KEY
    else process.env.AI_CONFIG_ENCRYPTION_KEY = originalEncryptionKey
  })

  it('protects the trigger, deduplicates requests and indexes through the worker', async () => {
    const suffix = randomUUID()
    const document = await payload.create({
      collection: 'knowledge-documents',
      data: {
        content: 'Aluminum panels support project-specific dimensions after engineering review.',
        indexStatus: 'pending',
        locale: 'en',
        reviewStatus: 'reviewed',
        sourceTitle: `Worker knowledge ${suffix}`,
        sourceType: 'faq',
        sourceVersion: '1.0',
      },
      overrideAccess: true,
    })
    documentIDs.push(document.id)

    const salesAuthorization = await loginHeader(sales, 'knowledge-sales-password')
    const forbidden = await requestKnowledgeIndex(
      new NextRequest(`http://localhost/api/knowledge/documents/${document.id}/index`, {
        headers: { authorization: salesAuthorization },
        method: 'POST',
      }),
      { params: Promise.resolve({ id: String(document.id) }) },
    )
    expect(forbidden.status).toBe(403)

    const operatorAuthorization = await loginHeader(operator, 'knowledge-operator-password')
    const createRequest = () =>
      requestKnowledgeIndex(
        new NextRequest(`http://localhost/api/knowledge/documents/${document.id}/index`, {
          headers: { authorization: operatorAuthorization },
          method: 'POST',
        }),
        { params: Promise.resolve({ id: String(document.id) }) },
      )
    const created = await createRequest()
    const createdBody = (await created.json()) as { jobId: number; state: string }
    expect(created.status).toBe(202)
    expect(createdBody.state).toBe('created')
    jobIDs.push(createdBody.jobId)

    const duplicate = await createRequest()
    expect(duplicate.status).toBe(200)
    await expect(duplicate.json()).resolves.toMatchObject({
      jobId: createdBody.jobId,
      state: 'duplicate',
    })

    const embed = vi.fn<AiProvider['embed']>(async ({ input, model }) => ({
      embeddings: input.map(() => [1, 0, 0]),
      model,
      usage: { inputTokens: input.length, totalTokens: input.length },
    }))
    const fakeGateway = createAiGateway({
      operations: {
        embedding: {
          dimensions: 3,
          embeddingSpaceIdentity: 'openai-compatible:https://knowledge-provider.example.invalid/v1',
          model: 'knowledge-test-embedding',
          provider: {
            embed,
            generateText: async () => {
              throw new Error('Text generation is not used by knowledge indexing')
            },
            name: 'renamed-test-provider',
          },
        },
      },
    })
    const queue = new PayloadJobQueue({ payload })
    const worker = new JobWorker({
      handlers: {
        [KNOWLEDGE_INDEX_JOB_TYPE]: createKnowledgeIndexJobHandler({
          payload,
          resolveGateway: async () => fakeGateway,
        }),
      },
      queue,
    })
    await expect(worker.runOnce()).resolves.toBe('succeeded')
    expect(embed).toHaveBeenCalledTimes(1)

    const ready = await payload.findByID({
      collection: 'knowledge-documents',
      id: document.id,
      overrideAccess: true,
    })
    expect(ready).toMatchObject({
      embeddingModel: 'knowledge-test-embedding',
      embeddingSpace: expect.stringMatching(/^[a-f0-9]{64}$/),
      indexStatus: 'ready',
    })
    const chunks = await payload.find({
      collection: 'knowledge-chunks',
      overrideAccess: true,
      where: { document: { equals: document.id } },
    })
    expect(chunks.totalDocs).toBeGreaterThan(0)
    expect(chunks.docs.every((chunk) => chunk.embeddingSpace === ready.embeddingSpace)).toBe(true)

    const duplicateAfterSuccess = await createRequest()
    expect(duplicateAfterSuccess.status).toBe(200)
    await expect(duplicateAfterSuccess.json()).resolves.toMatchObject({
      jobId: createdBody.jobId,
      state: 'duplicate',
      status: 'succeeded',
    })
  })

  it('retries a failed provider call using the stable reviewed-content revision', async () => {
    const suffix = randomUUID()
    const document = await payload.create({
      collection: 'knowledge-documents',
      data: {
        content: 'Retryable knowledge remains the same when only index status timestamps change.',
        indexStatus: 'pending',
        locale: 'en',
        reviewStatus: 'reviewed',
        sourceTitle: `Retry knowledge ${suffix}`,
        sourceType: 'faq',
        sourceVersion: '1.0',
      },
      overrideAccess: true,
    })
    documentIDs.push(document.id)

    const embed = vi
      .fn<AiProvider['embed']>()
      .mockRejectedValueOnce(new Error('temporary embedding timeout'))
      .mockImplementation(async ({ input, model }) => ({
        embeddings: input.map(() => [1, 0, 0]),
        model,
        usage: { inputTokens: input.length, totalTokens: input.length },
      }))
    const fakeGateway = createAiGateway({
      operations: {
        embedding: {
          dimensions: 3,
          embeddingSpaceIdentity: 'openai-compatible:https://knowledge-provider.example.invalid/v1',
          model: 'knowledge-test-embedding',
          provider: {
            embed,
            generateText: async () => {
              throw new Error('Text generation is not used by knowledge indexing')
            },
            name: 'retry-test-provider',
          },
        },
      },
    })
    const created = await enqueueKnowledgeIndexJob({
      documentId: document.id,
      payload,
      requestedBy: operator.id,
      resolveGateway: async () => fakeGateway,
    })
    jobIDs.push(created.job.id)

    let now = new Date(Date.now() + 100)
    const queue = new PayloadJobQueue({ clock: () => now, payload })
    const worker = new JobWorker({
      handlers: {
        [KNOWLEDGE_INDEX_JOB_TYPE]: createKnowledgeIndexJobHandler({
          payload,
          resolveGateway: async () => fakeGateway,
        }),
      },
      queue,
    })

    await expect(worker.runOnce()).resolves.toBe('failed')
    const failedDocument = await payload.findByID({
      collection: 'knowledge-documents',
      id: document.id,
      overrideAccess: true,
    })
    expect(failedDocument.indexStatus).toBe('failed')

    const duplicate = await enqueueKnowledgeIndexJob({
      documentId: document.id,
      payload,
      requestedBy: operator.id,
      resolveGateway: async () => fakeGateway,
    })
    expect(duplicate).toMatchObject({ job: { id: created.job.id }, state: 'duplicate' })

    now = new Date(now.getTime() + 2_000)
    await expect(worker.runOnce()).resolves.toBe('succeeded')
    expect(embed).toHaveBeenCalledTimes(2)
    await expect(
      payload.findByID({
        collection: 'knowledge-documents',
        id: document.id,
        overrideAccess: true,
      }),
    ).resolves.toMatchObject({ indexStatus: 'ready' })
  })

  it('recovers a document after its final leased job dies without handler cleanup', async () => {
    const suffix = randomUUID()
    const document = await payload.create({
      collection: 'knowledge-documents',
      data: {
        content: 'A dead-lettered final job must not leave knowledge permanently processing.',
        indexStatus: 'pending',
        locale: 'en',
        reviewStatus: 'reviewed',
        sourceTitle: `Dead-letter recovery knowledge ${suffix}`,
        sourceType: 'faq',
        sourceVersion: '1.0',
      },
      overrideAccess: true,
    })
    documentIDs.push(document.id)

    let releaseEmbedding: (() => void) | undefined
    let markEmbeddingStarted: (() => void) | undefined
    const embeddingStarted = new Promise<void>((resolve) => {
      markEmbeddingStarted = resolve
    })
    const blockedEmbedding = new Promise<void>((resolve) => {
      releaseEmbedding = resolve
    })
    const fakeGateway = createAiGateway({
      operations: {
        embedding: {
          dimensions: 3,
          embeddingSpaceIdentity: 'openai-compatible:https://knowledge-provider.example.invalid/v1',
          model: 'knowledge-test-embedding',
          provider: {
            embed: async ({ input, model }) => {
              markEmbeddingStarted?.()
              await blockedEmbedding
              return {
                embeddings: input.map(() => [1, 0, 0]),
                model,
                usage: { inputTokens: input.length, totalTokens: input.length },
              }
            },
            generateText: async () => {
              throw new Error('Text generation is not used by knowledge indexing')
            },
            name: 'dead-letter-recovery-provider',
          },
        },
      },
    })
    const created = await enqueueKnowledgeIndexJob({
      documentId: document.id,
      payload,
      requestedBy: operator.id,
      resolveGateway: async () => fakeGateway,
    })
    jobIDs.push(created.job.id)

    const pool = (payload.db as unknown as PostgresAdapter).pool
    await pool.query('UPDATE jobs SET max_attempts = 1 WHERE id = $1', [created.job.id])
    const queue = new PayloadJobQueue({ leaseMs: 1_000, payload })
    const claimed = await queue.claimNext()
    if (!claimed) throw new Error('Expected the final knowledge indexing claim')
    const controller = new AbortController()
    const execution = createKnowledgeIndexJobHandler({
      payload,
      resolveGateway: async () => fakeGateway,
    })(claimed, {
      assertLease: () => undefined,
      renewLease: () => queue.renew(claimed),
      signal: controller.signal,
    })
    await embeddingStarted
    await pool.query(
      "UPDATE jobs SET lease_expires_at = NOW() - INTERVAL '1 second' WHERE id = $1",
      [claimed.id],
    )

    await queue.claimNext()
    await expect(
      payload.findByID({
        collection: 'knowledge-documents',
        id: document.id,
        overrideAccess: true,
      }),
    ).resolves.toMatchObject({ indexStatus: 'processing' })

    try {
      await expect(recoverDeadKnowledgeIndexDocuments({ payload })).resolves.toBe(1)
      await expect(
        payload.findByID({
          collection: 'knowledge-documents',
          id: document.id,
          overrideAccess: true,
        }),
      ).resolves.toMatchObject({
        indexJobId: null,
        indexOwnerToken: null,
        indexStatus: 'failed',
      })
      await expect(
        enqueueKnowledgeIndexJob({
          documentId: document.id,
          manualRetryActor: { id: operator.id, role: 'admin' },
          payload,
          requestedBy: operator.id,
          resolveGateway: async () => fakeGateway,
        }),
      ).resolves.toMatchObject({
        job: { id: created.job.id, manualRetryCount: 1, status: 'pending' },
        state: 'created',
      })
    } finally {
      controller.abort(new Error('simulated worker process termination'))
      releaseEmbedding?.()
      await execution.catch(() => undefined)
      // This test proves an administrator can re-arm a dead idempotent Job.
      // Remove the pending fixture so following claim-race tests only see
      // their own Jobs, independent of file execution order.
      await payload.delete({
        collection: 'jobs',
        id: created.job.id,
        overrideAccess: true,
      })
    }
  })

  it('leaves a recovered document and its chunks untouched when the zombie worker resumes', async () => {
    const suffix = randomUUID()
    const document = await payload.create({
      collection: 'knowledge-documents',
      data: {
        content: 'A resumed zombie worker must not mutate recovered knowledge state.',
        indexStatus: 'pending',
        locale: 'en',
        reviewStatus: 'reviewed',
        sourceTitle: `Zombie recovery knowledge ${suffix}`,
        sourceType: 'faq',
        sourceVersion: '1.0',
      },
      overrideAccess: true,
    })
    documentIDs.push(document.id)

    let releaseEmbedding: (() => void) | undefined
    let markEmbeddingStarted: (() => void) | undefined
    const embeddingStarted = new Promise<void>((resolve) => {
      markEmbeddingStarted = resolve
    })
    const blockedEmbedding = new Promise<void>((resolve) => {
      releaseEmbedding = resolve
    })
    const embed = vi.fn<AiProvider['embed']>(async ({ input, model }) => {
      markEmbeddingStarted?.()
      await blockedEmbedding
      return {
        embeddings: input.map(() => [1, 0, 0]),
        model,
        usage: { inputTokens: input.length, totalTokens: input.length },
      }
    })
    const fakeGateway = createAiGateway({
      operations: {
        embedding: {
          dimensions: 3,
          embeddingSpaceIdentity: 'openai-compatible:https://knowledge-provider.example.invalid/v1',
          model: 'knowledge-test-embedding',
          provider: {
            embed,
            generateText: async () => {
              throw new Error('Text generation is not used by knowledge indexing')
            },
            name: 'zombie-recovery-provider',
          },
        },
      },
    })
    const created = await enqueueKnowledgeIndexJob({
      documentId: document.id,
      payload,
      requestedBy: operator.id,
      resolveGateway: async () => fakeGateway,
    })
    jobIDs.push(created.job.id)

    const pool = (payload.db as unknown as PostgresAdapter).pool
    await pool.query('UPDATE jobs SET max_attempts = 1 WHERE id = $1', [created.job.id])
    const queue = new PayloadJobQueue({ leaseMs: 1_000, payload })
    const claimed = await queue.claimNext()
    if (!claimed) throw new Error('Expected the zombie indexing claim')

    const execution = createKnowledgeIndexJobHandler({
      payload,
      resolveGateway: async () => fakeGateway,
    })(claimed, {
      assertLease: () => undefined,
      renewLease: () => queue.renew(claimed),
      signal: new AbortController().signal,
    })
    await embeddingStarted

    await pool.query(
      "UPDATE jobs SET lease_expires_at = NOW() - INTERVAL '1 second' WHERE id = $1",
      [claimed.id],
    )
    await queue.claimNext()
    await expect(queue.getByID(claimed.id)).resolves.toMatchObject({
      ownerToken: null,
      status: 'dead',
    })
    await expect(
      payload.findByID({
        collection: 'knowledge-documents',
        id: document.id,
        overrideAccess: true,
      }),
    ).resolves.toMatchObject({
      indexJobId: claimed.id,
      indexOwnerToken: claimed.ownerToken,
      indexStatus: 'processing',
    })

    try {
      await expect(recoverDeadKnowledgeIndexDocuments({ payload })).resolves.toBe(1)
      const recovered = await payload.findByID({
        collection: 'knowledge-documents',
        id: document.id,
        overrideAccess: true,
      })
      expect(recovered).toMatchObject({
        indexJobId: null,
        indexOwnerToken: null,
        indexStatus: 'failed',
      })
      const recoveredDocumentSnapshot = {
        embeddingModel: recovered.embeddingModel,
        embeddingSpace: recovered.embeddingSpace,
        indexJobId: recovered.indexJobId,
        indexOwnerToken: recovered.indexOwnerToken,
        indexStatus: recovered.indexStatus,
        indexedAt: recovered.indexedAt,
        updatedAt: recovered.updatedAt,
      }
      const recoveredChunks = await payload.find({
        collection: 'knowledge-chunks',
        overrideAccess: true,
        where: { document: { equals: document.id } },
      })
      expect(recoveredChunks.totalDocs).toBe(0)

      releaseEmbedding?.()
      await execution.catch(() => undefined)

      const afterResume = await payload.findByID({
        collection: 'knowledge-documents',
        id: document.id,
        overrideAccess: true,
      })
      expect({
        embeddingModel: afterResume.embeddingModel,
        embeddingSpace: afterResume.embeddingSpace,
        indexJobId: afterResume.indexJobId,
        indexOwnerToken: afterResume.indexOwnerToken,
        indexStatus: afterResume.indexStatus,
        indexedAt: afterResume.indexedAt,
        updatedAt: afterResume.updatedAt,
      }).toEqual(recoveredDocumentSnapshot)
      const chunksAfterResume = await payload.find({
        collection: 'knowledge-chunks',
        overrideAccess: true,
        where: { document: { equals: document.id } },
      })
      expect(chunksAfterResume.totalDocs).toBe(0)
      expect(chunksAfterResume.docs).toEqual([])
      expect(embed).toHaveBeenCalledTimes(1)
    } finally {
      releaseEmbedding?.()
      await execution.catch(() => undefined)
      await payload.delete({
        collection: 'knowledge-chunks',
        overrideAccess: true,
        where: { document: { equals: document.id } },
      })
    }
  })

  it('recovers an unfenced processing document left by a pre-upgrade worker', async () => {
    const suffix = randomUUID()
    const document = await payload.create({
      collection: 'knowledge-documents',
      data: {
        content: 'A legacy worker can leave processing knowledge without a job ownership fence.',
        indexStatus: 'pending',
        locale: 'en',
        reviewStatus: 'reviewed',
        sourceTitle: `Unfenced recovery knowledge ${suffix}`,
        sourceType: 'faq',
        sourceVersion: '1.0',
      },
      overrideAccess: true,
    })
    documentIDs.push(document.id)

    const pool = (payload.db as unknown as PostgresAdapter).pool
    await pool.query(
      `UPDATE knowledge_documents
          SET index_status = 'processing',
              index_job_id = NULL,
              index_owner_token = NULL
        WHERE id = $1`,
      [document.id],
    )

    await expect(recoverDeadKnowledgeIndexDocuments({ payload })).resolves.toBe(1)
    await expect(
      payload.findByID({
        collection: 'knowledge-documents',
        id: document.id,
        overrideAccess: true,
      }),
    ).resolves.toMatchObject({
      indexJobId: null,
      indexOwnerToken: null,
      indexStatus: 'failed',
    })
    await expect(recoverDeadKnowledgeIndexDocuments({ payload })).resolves.toBe(0)
  })

  it('requeues the current revision when a stale index job is claimed', async () => {
    const suffix = randomUUID()
    const document = await payload.create({
      collection: 'knowledge-documents',
      data: {
        content: 'The first revision is obsolete before its job can start.',
        indexStatus: 'pending',
        locale: 'en',
        reviewStatus: 'reviewed',
        sourceTitle: `Stale revision knowledge ${suffix}`,
        sourceType: 'faq',
        sourceVersion: '1.0',
      },
      overrideAccess: true,
    })
    documentIDs.push(document.id)

    const fakeGateway = createAiGateway({
      operations: {
        embedding: {
          dimensions: 3,
          embeddingSpaceIdentity: 'openai-compatible:https://knowledge-provider.example.invalid/v1',
          model: 'knowledge-test-embedding',
          provider: {
            embed: async ({ input, model }) => ({
              embeddings: input.map(() => [1, 0, 0]),
              model,
              usage: { inputTokens: input.length, totalTokens: input.length },
            }),
            generateText: async () => {
              throw new Error('Text generation is not used by knowledge indexing')
            },
            name: 'stale-revision-provider',
          },
        },
      },
    })
    const original = await enqueueKnowledgeIndexJob({
      documentId: document.id,
      payload,
      requestedBy: operator.id,
      resolveGateway: async () => fakeGateway,
    })
    jobIDs.push(original.job.id)

    await payload.update({
      collection: 'knowledge-documents',
      data: { content: 'The revised document must be indexed instead of the obsolete revision.' },
      id: document.id,
      overrideAccess: true,
    })
    await payload.update({
      collection: 'knowledge-documents',
      data: { reviewStatus: 'reviewed' },
      id: document.id,
      overrideAccess: true,
    })

    const queue = new PayloadJobQueue({ payload })
    const obsolete = await queue.claimNext()
    if (!obsolete) throw new Error('Expected the obsolete indexing job')
    const handler = createKnowledgeIndexJobHandler({
      payload,
      resolveGateway: async () => fakeGateway,
    })
    await handler(obsolete, {
      assertLease: () => undefined,
      renewLease: () => queue.renew(obsolete),
      signal: new AbortController().signal,
    })
    await queue.complete(obsolete)

    const replacement = await enqueueKnowledgeIndexJob({
      documentId: document.id,
      payload,
      requestedBy: operator.id,
      resolveGateway: async () => fakeGateway,
    })
    expect(replacement).toMatchObject({ state: 'duplicate' })
    expect(replacement.job.id).not.toBe(original.job.id)
    jobIDs.push(replacement.job.id)

    const current = await queue.claimNext()
    if (!current) throw new Error('Expected the replacement indexing job')
    await handler(current, {
      assertLease: () => undefined,
      renewLease: () => queue.renew(current),
      signal: new AbortController().signal,
    })
    await queue.complete(current)
    await expect(
      payload.findByID({
        collection: 'knowledge-documents',
        id: document.id,
        overrideAccess: true,
      }),
    ).resolves.toMatchObject({ indexStatus: 'ready' })
  })

  it('fences a slow embedding request after its job lease is reclaimed', async () => {
    const suffix = randomUUID()
    const document = await payload.create({
      collection: 'knowledge-documents',
      data: {
        content: 'A slow embedding request must not commit after its worker loses ownership.',
        indexStatus: 'pending',
        locale: 'en',
        reviewStatus: 'reviewed',
        sourceTitle: `Fenced knowledge ${suffix}`,
        sourceType: 'faq',
        sourceVersion: '1.0',
      },
      overrideAccess: true,
    })
    documentIDs.push(document.id)

    let releaseEmbedding: (() => void) | undefined
    let markEmbeddingStarted: (() => void) | undefined
    const embeddingStarted = new Promise<void>((resolve) => {
      markEmbeddingStarted = resolve
    })
    const slowEmbedding = new Promise<void>((resolve) => {
      releaseEmbedding = resolve
    })
    const embed = vi
      .fn<AiProvider['embed']>()
      .mockImplementationOnce(async ({ input, model }) => {
        markEmbeddingStarted?.()
        await slowEmbedding
        return {
          embeddings: input.map(() => [1, 0, 0]),
          model,
          usage: { inputTokens: input.length, totalTokens: input.length },
        }
      })
      .mockImplementation(async ({ input, model }) => ({
        embeddings: input.map(() => [1, 0, 0]),
        model,
        usage: { inputTokens: input.length, totalTokens: input.length },
      }))
    const fakeGateway = createAiGateway({
      operations: {
        embedding: {
          dimensions: 3,
          embeddingSpaceIdentity: 'openai-compatible:https://knowledge-provider.example.invalid/v1',
          model: 'knowledge-test-embedding',
          provider: {
            embed,
            generateText: async () => {
              throw new Error('Text generation is not used by knowledge indexing')
            },
            name: 'fencing-test-provider',
          },
        },
      },
    })
    const created = await enqueueKnowledgeIndexJob({
      documentId: document.id,
      payload,
      requestedBy: operator.id,
      resolveGateway: async () => fakeGateway,
    })
    jobIDs.push(created.job.id)

    let now = new Date(Date.now() + 1_000)
    const queueA = new PayloadJobQueue({ clock: () => now, leaseMs: 1_000, payload })
    const queueB = new PayloadJobQueue({ clock: () => now, leaseMs: 1_000, payload })
    const handler = createKnowledgeIndexJobHandler({
      payload,
      resolveGateway: async () => fakeGateway,
    })
    const workerA = new JobWorker({
      handlers: { [KNOWLEDGE_INDEX_JOB_TYPE]: handler },
      heartbeatIntervalMs: 60_000,
      queue: queueA,
    })

    const staleOutcome = workerA.runOnce()
    await embeddingStarted
    now = new Date(now.getTime() + 1_001)
    const reclaimed = await queueB.claimNext()
    if (!reclaimed) throw new Error('Expected the indexing job lease to be reclaimed')
    releaseEmbedding?.()

    await expect(staleOutcome).resolves.toBe('failed')
    await expect(
      payload.findByID({
        collection: 'knowledge-documents',
        id: document.id,
        overrideAccess: true,
      }),
    ).resolves.toMatchObject({ indexStatus: 'processing' })

    const controller = new AbortController()
    await handler(reclaimed, {
      assertLease: () => undefined,
      renewLease: () => queueB.renew(reclaimed),
      signal: controller.signal,
    })
    await queueB.complete(reclaimed)
    await expect(
      payload.findByID({
        collection: 'knowledge-documents',
        id: document.id,
        overrideAccess: true,
      }),
    ).resolves.toMatchObject({ indexStatus: 'ready' })
    expect(embed).toHaveBeenCalledTimes(2)
  })

  it('marks a final-attempt failure after lease expiry instead of stranding processing', async () => {
    const suffix = randomUUID()
    const document = await payload.create({
      collection: 'knowledge-documents',
      data: {
        content: 'A final indexing attempt must leave an actionable failed document.',
        indexStatus: 'pending',
        locale: 'en',
        reviewStatus: 'reviewed',
        sourceTitle: `Expired failure knowledge ${suffix}`,
        sourceType: 'faq',
        sourceVersion: '1.0',
      },
      overrideAccess: true,
    })
    documentIDs.push(document.id)

    let releaseEmbedding: (() => void) | undefined
    let markEmbeddingStarted: (() => void) | undefined
    const embeddingStarted = new Promise<void>((resolve) => {
      markEmbeddingStarted = resolve
    })
    const blockedEmbedding = new Promise<void>((resolve) => {
      releaseEmbedding = resolve
    })
    const fakeGateway = createAiGateway({
      operations: {
        embedding: {
          dimensions: 3,
          embeddingSpaceIdentity: 'openai-compatible:https://knowledge-provider.example.invalid/v1',
          model: 'knowledge-test-embedding',
          provider: {
            embed: async () => {
              markEmbeddingStarted?.()
              await blockedEmbedding
              throw new Error('final embedding attempt failed')
            },
            generateText: async () => {
              throw new Error('Text generation is not used by knowledge indexing')
            },
            name: 'expired-failure-provider',
          },
        },
      },
    })
    const created = await enqueueKnowledgeIndexJob({
      documentId: document.id,
      payload,
      requestedBy: operator.id,
      resolveGateway: async () => fakeGateway,
    })
    jobIDs.push(created.job.id)

    const pool = (payload.db as unknown as PostgresAdapter).pool
    await pool.query('UPDATE jobs SET max_attempts = 1 WHERE id = $1', [created.job.id])
    const queue = new PayloadJobQueue({ leaseMs: 1_000, payload })
    const claimed = await queue.claimNext()
    if (!claimed) throw new Error('Expected the final indexing claim')
    const handler = createKnowledgeIndexJobHandler({
      payload,
      resolveGateway: async () => fakeGateway,
    })
    const execution = handler(claimed, {
      assertLease: () => undefined,
      renewLease: () => queue.renew(claimed),
      signal: new AbortController().signal,
    })
    await embeddingStarted
    await pool.query(
      "UPDATE jobs SET lease_expires_at = NOW() - INTERVAL '1 second' WHERE id = $1",
      [claimed.id],
    )
    releaseEmbedding?.()

    await expect(execution).rejects.toThrow('AI provider request failed')
    await expect(
      payload.findByID({
        collection: 'knowledge-documents',
        id: document.id,
        overrideAccess: true,
      }),
    ).resolves.toMatchObject({ indexStatus: 'failed' })
    await expect(
      queue.fail({ error: new Error('final embedding attempt failed'), job: claimed }),
    ).resolves.toMatchObject({ status: 'dead' })
  })

  it('reclaims a document left processing when the prior worker dies without cleanup', async () => {
    const suffix = randomUUID()
    const document = await payload.create({
      collection: 'knowledge-documents',
      data: {
        content: 'A reclaimed indexing lease must recover a document after process termination.',
        indexStatus: 'pending',
        locale: 'en',
        reviewStatus: 'reviewed',
        sourceTitle: `Crash recovery knowledge ${suffix}`,
        sourceType: 'faq',
        sourceVersion: '1.0',
      },
      overrideAccess: true,
    })
    documentIDs.push(document.id)

    let releaseEmbedding: (() => void) | undefined
    let markEmbeddingStarted: (() => void) | undefined
    const embeddingStarted = new Promise<void>((resolve) => {
      markEmbeddingStarted = resolve
    })
    const blockedEmbedding = new Promise<void>((resolve) => {
      releaseEmbedding = resolve
    })
    const embed = vi
      .fn<AiProvider['embed']>()
      .mockImplementationOnce(async ({ input, model }) => {
        markEmbeddingStarted?.()
        await blockedEmbedding
        return {
          embeddings: input.map(() => [1, 0, 0]),
          model,
          usage: { inputTokens: input.length, totalTokens: input.length },
        }
      })
      .mockImplementation(async ({ input, model }) => ({
        embeddings: input.map(() => [0, 1, 0]),
        model,
        usage: { inputTokens: input.length, totalTokens: input.length },
      }))
    const fakeGateway = createAiGateway({
      operations: {
        embedding: {
          dimensions: 3,
          embeddingSpaceIdentity: 'openai-compatible:https://knowledge-provider.example.invalid/v1',
          model: 'knowledge-test-embedding',
          provider: {
            embed,
            generateText: async () => {
              throw new Error('Text generation is not used by knowledge indexing')
            },
            name: 'crash-recovery-provider',
          },
        },
      },
    })
    const created = await enqueueKnowledgeIndexJob({
      documentId: document.id,
      payload,
      requestedBy: operator.id,
      resolveGateway: async () => fakeGateway,
    })
    jobIDs.push(created.job.id)

    let now = new Date(Date.now() + 2_000)
    const queueA = new PayloadJobQueue({ clock: () => now, leaseMs: 1_000, payload })
    const queueB = new PayloadJobQueue({ clock: () => now, leaseMs: 1_000, payload })
    const first = await queueA.claimNext()
    if (!first) throw new Error('Expected the first indexing claim')
    const handler = createKnowledgeIndexJobHandler({
      payload,
      resolveGateway: async () => fakeGateway,
    })
    const firstController = new AbortController()
    const firstExecution = handler(first, {
      assertLease: () => undefined,
      renewLease: () => queueA.renew(first),
      signal: firstController.signal,
    })
    await embeddingStarted
    await expect(
      payload.findByID({
        collection: 'knowledge-documents',
        id: document.id,
        overrideAccess: true,
      }),
    ).resolves.toMatchObject({ indexStatus: 'processing' })

    now = new Date(now.getTime() + 1_001)
    const reclaimed = await queueB.claimNext()
    if (!reclaimed) throw new Error('Expected the indexing job lease to be reclaimed')

    try {
      await handler(reclaimed, {
        assertLease: () => undefined,
        renewLease: () => queueB.renew(reclaimed),
        signal: new AbortController().signal,
      })
      await queueB.complete(reclaimed)
    } finally {
      firstController.abort(new Error('simulated worker process termination'))
      releaseEmbedding?.()
      await firstExecution.catch(() => undefined)
    }

    await expect(
      payload.findByID({
        collection: 'knowledge-documents',
        id: document.id,
        overrideAccess: true,
      }),
    ).resolves.toMatchObject({ indexStatus: 'ready' })
    expect(embed).toHaveBeenCalledTimes(2)
  })

  it('queues and rebuilds legacy ready knowledge before strict vector retrieval', async () => {
    const suffix = randomUUID()
    const document = await payload.create({
      collection: 'knowledge-documents',
      data: {
        content:
          'Legacy indexed panels use controlled rebuilding after the embedding-space upgrade.',
        customerVisible: true,
        indexStatus: 'pending',
        locale: 'en',
        reviewStatus: 'reviewed',
        sourceTitle: `Legacy knowledge ${suffix}`,
        sourceType: 'product-manual',
        sourceVersion: '1.0',
      },
      overrideAccess: true,
    })
    documentIDs.push(document.id)
    const chunk = await payload.create({
      collection: 'knowledge-chunks',
      data: {
        content: document.content,
        document: document.id,
        index: 0,
        locale: 'en',
        sourceTitle: document.sourceTitle,
        sourceVersion: document.sourceVersion,
        stableId: `legacy-${suffix}`,
      },
      overrideAccess: true,
    })
    const pool = (payload.db as unknown as PostgresAdapter).pool
    const legacyEmbeddingSpace = createEmbeddingSpaceFingerprint(
      'openai-compatible:https://knowledge-provider.example.invalid/v1',
      'knowledge-test-embedding',
      'provider-default',
      'knowledge-test-embedding',
      3,
    )
    await pool.query(
      `UPDATE knowledge_chunks
          SET embedding_vector = $1::vector,
              embedding_model = $2,
              embedding_dimensions = 3,
              embedding_space = $3
        WHERE id = $4`,
      ['[1,0,0]', 'knowledge-test-embedding', legacyEmbeddingSpace, chunk.id],
    )
    await pool.query(
      `UPDATE knowledge_documents
          SET index_status = 'ready',
              embedding_model = $1,
              embedding_space = $2
        WHERE id = $3`,
      ['knowledge-test-embedding', legacyEmbeddingSpace, document.id],
    )

    const fakeGateway = createAiGateway({
      operations: {
        embedding: {
          dimensions: 3,
          embeddingSpaceIdentity: 'openai-compatible:https://knowledge-provider.example.invalid/v1',
          model: 'knowledge-test-embedding',
          provider: {
            embed: async ({ input, model }) => ({
              embeddings: input.map(() => [1, 0, 0]),
              model,
              usage: { inputTokens: input.length, totalTokens: input.length },
            }),
            generateText: async () => {
              throw new Error('Text generation is not used by knowledge indexing')
            },
            name: 'legacy-rebuild-provider',
          },
        },
      },
    })
    const probe = await fakeGateway.embed({ input: ['probe'] })
    if (!probe.embeddingSpace) throw new Error('Expected the gateway embedding space')
    expect(fakeGateway.embeddingConfigurationKey).toBe(probe.embeddingSpace)
    await expect(
      retrieveKnowledge({
        customerVisible: true,
        embedding: [1, 0, 0],
        embeddingSpace: probe.embeddingSpace,
        locale: 'en',
        model: probe.model,
        pool,
      }),
    ).resolves.toEqual([])

    const firstPass = await enqueueLegacyKnowledgeRebuilds({
      payload,
      requestedBy: null,
      resolveGateway: async () => fakeGateway,
    })
    expect(firstPass).toMatchObject({ created: 1, duplicate: 0, failed: 0 })
    jobIDs.push(...firstPass.jobIDs)
    await expect(
      enqueueLegacyKnowledgeRebuilds({
        payload,
        requestedBy: null,
        resolveGateway: async () => fakeGateway,
      }),
    ).resolves.toMatchObject({
      created: 0,
      duplicate: 1,
      failed: 0,
      jobIDs: firstPass.jobIDs,
    })

    const worker = new JobWorker({
      handlers: {
        [KNOWLEDGE_INDEX_JOB_TYPE]: createKnowledgeIndexJobHandler({
          payload,
          resolveGateway: async () => fakeGateway,
        }),
      },
      queue: new PayloadJobQueue({ payload }),
    })
    await expect(worker.runOnce()).resolves.toBe('succeeded')
    await expect(
      retrieveKnowledge({
        customerVisible: true,
        embedding: [1, 0, 0],
        embeddingSpace: probe.embeddingSpace,
        locale: 'en',
        model: probe.model,
        pool,
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        citation: expect.objectContaining({ documentId: document.id }),
        content: document.content,
      }),
    ])
    await expect(
      enqueueLegacyKnowledgeRebuilds({
        payload,
        requestedBy: null,
        resolveGateway: async () => fakeGateway,
      }),
    ).resolves.toMatchObject({ created: 0, duplicate: 0, failed: 0, jobIDs: [] })
  })
})
