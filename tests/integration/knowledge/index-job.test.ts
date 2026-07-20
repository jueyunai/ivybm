import { randomUUID } from 'node:crypto'

import { NextRequest } from 'next/server'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { getPayload, type Payload } from 'payload'

import { POST as requestKnowledgeIndex } from '@/app/api/knowledge/documents/[id]/index/route'
import { createAiGateway, type AiProvider } from '@/modules/ai/gateway'
import { PayloadJobQueue } from '@/modules/jobs/claim'
import { JobWorker } from '@/modules/jobs/worker'
import { createKnowledgeIndexJobHandler, KNOWLEDGE_INDEX_JOB_TYPE } from '@/modules/knowledge/jobs'
import config from '@/payload.config'
import type { User } from '@/payload-types'

let payload: Payload
let operator: User
let sales: User
let documentID: number
let providerID: number
let profileID: number
let routeID: number
let originalEncryptionKey: string | undefined
const userIDs: number[] = []
const jobIDs: number[] = []

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
      if (documentID) {
        await payload.delete({
          collection: 'knowledge-documents',
          id: documentID,
          overrideAccess: true,
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
    documentID = document.id

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
  })
})
