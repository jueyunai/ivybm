import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createLocalReq, getPayload, type Payload } from 'payload'

import {
  getKnowledgePage,
  loadKnowledgePageData,
  type KnowledgeQuery,
} from '@/admin-portal/modules/knowledge/getKnowledgePage'
import {
  createPortalKnowledgeDocument,
  deletePortalKnowledgeDocument,
  updatePortalKnowledgeDocument,
} from '@/admin-portal/modules/knowledge/knowledgeCommands'
import type { User } from '@/payload-types'
import config from '@/payload.config'

let payload: Payload
let admin: User
let operator: User
let sales: User
let originalEncryptionKey: string | undefined
let queryToken = ''

const createdDocumentIDs: Array<number | string> = []
const createdProfileIDs: Array<number | string> = []
const createdPromptIDs: Array<number | string> = []
const createdProviderIDs: Array<number | string> = []
const createdRouteIDs: Array<number | string> = []
const createdUserIDs: Array<number | string> = []

const requestFor = (user: User) => createLocalReq({ user }, payload)

const query = (overrides: Partial<KnowledgeQuery> = {}): KnowledgeQuery => ({
  index: 'all',
  locale: 'all',
  page: 1,
  q: queryToken,
  review: 'all',
  sourceType: 'all',
  visibility: 'all',
  ...overrides,
})

const assertIsolatedDatabase = () => {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required for Portal knowledge integration tests')
  }
  const url = new URL(process.env.DATABASE_URL)
  const database = decodeURIComponent(url.pathname.replace(/^\//, ''))
  const localHosts = new Set(['127.0.0.1', 'localhost', '::1'])
  if (!localHosts.has(url.hostname) || (!database.endsWith('_test') && !database.endsWith('_ci'))) {
    throw new Error('Portal knowledge integration tests require a local _test or _ci database')
  }
}

describe.sequential('Portal knowledge access', () => {
  beforeAll(async () => {
    assertIsolatedDatabase()
    originalEncryptionKey = process.env.AI_CONFIG_ENCRYPTION_KEY
    process.env.AI_CONFIG_ENCRYPTION_KEY = 'e'.repeat(64)

    payload = await getPayload({
      config,
      disableOnInit: true,
      key: 'admin-portal-knowledge-access-integration-tests',
    })

    const suffix = randomUUID()
    queryToken = `P08B-${suffix}`

    for (const role of ['admin', 'operator', 'sales'] as const) {
      const user = await payload.create({
        collection: 'users',
        context: { skipAudit: true },
        data: {
          email: `portal-knowledge-${role}-${suffix}@example.invalid`,
          password: 'portal-knowledge-integration-password',
          role,
        },
        overrideAccess: true,
      })
      createdUserIDs.push(user.id)
      if (role === 'admin') admin = user
      if (role === 'operator') operator = user
      if (role === 'sales') sales = user
    }

    const documentInputs = [
      {
        customerVisible: true,
        locale: 'en' as const,
        reviewStatus: 'reviewed' as const,
        sourceTitle: `${queryToken} Ready FAQ`,
        sourceType: 'faq' as const,
        sourceVersion: '1.0',
        targetIndexStatus: 'ready' as const,
      },
      {
        customerVisible: false,
        locale: 'ar' as const,
        reviewStatus: 'draft' as const,
        sourceTitle: `${queryToken} Draft Manual`,
        sourceType: 'product-manual' as const,
        sourceVersion: '2.0',
        targetIndexStatus: 'pending' as const,
      },
      {
        customerVisible: false,
        locale: 'en' as const,
        reviewStatus: 'reviewed' as const,
        sourceTitle: `${queryToken} Processing Specification`,
        sourceType: 'technical-specification' as const,
        sourceVersion: '3.0',
        targetIndexStatus: 'processing' as const,
      },
      {
        customerVisible: false,
        locale: 'en' as const,
        reviewStatus: 'reviewed' as const,
        sourceTitle: `${queryToken} Failed Script`,
        sourceType: 'sales-script' as const,
        sourceVersion: '4.0',
        targetIndexStatus: 'failed' as const,
      },
    ]

    for (const input of documentInputs) {
      const document = await payload.create({
        collection: 'knowledge-documents',
        data: {
          content: `private-content-${suffix}`,
          customerVisible: input.customerVisible,
          indexStatus: 'pending',
          locale: input.locale,
          reviewStatus: input.reviewStatus,
          sourceTitle: input.sourceTitle,
          sourceType: input.sourceType,
          sourceURL: `https://private-source.example.invalid/${suffix}`,
          sourceVersion: input.sourceVersion,
        },
        draft: false,
        overrideAccess: false,
        user: admin,
      })
      createdDocumentIDs.push(document.id)

      if (input.targetIndexStatus !== 'pending') {
        await payload.update({
          collection: 'knowledge-documents',
          data: {
            embeddingModel:
              input.targetIndexStatus === 'ready' ? 'portal-embedding-test' : undefined,
            embeddingSpace: input.targetIndexStatus === 'ready' ? 'a'.repeat(64) : undefined,
            indexStatus: input.targetIndexStatus,
            indexedAt: input.targetIndexStatus === 'ready' ? '2026-07-30T00:00:00.000Z' : undefined,
          },
          id: document.id,
          overrideAccess: true,
        })
      }
    }

    const prompt = await payload.create({
      collection: 'prompt-templates',
      data: {
        key: `portal-customer-chat-${suffix}`,
        locale: 'all',
        model: 'portal-chat-test',
        purpose: 'customer-chat',
        status: 'active',
        template: `private-template-${suffix}`,
        variables: { privateVariable: suffix },
        version: 1,
      },
      overrideAccess: false,
      user: admin,
    })
    createdPromptIDs.push(prompt.id)

    const provider = await payload.create({
      collection: 'ai-providers',
      data: {
        apiKey: `private-provider-key-${suffix}`,
        apiKeyConfigured: true,
        baseURL: 'https://portal-ai.example.invalid/v1',
        enabled: true,
        name: `Portal AI ${suffix}`,
        protocol: 'openai-compatible',
        textGenerationContract: 'responses',
      },
      overrideAccess: false,
      user: admin,
    })
    createdProviderIDs.push(provider.id)

    for (const definition of [
      {
        capability: 'embedding' as const,
        dimensions: 3,
        model: 'portal-embedding-test',
        name: `Portal embedding ${suffix}`,
        operation: 'embedding' as const,
        usageKey: 'knowledge.embedding',
      },
      {
        capability: 'text' as const,
        dimensions: undefined,
        model: 'portal-chat-test',
        name: `Portal chat ${suffix}`,
        operation: 'text' as const,
        usageKey: 'chat.reply',
      },
    ]) {
      const profile = await payload.create({
        collection: 'ai-model-profiles',
        data: {
          capability: definition.capability,
          enabled: true,
          model: definition.model,
          name: definition.name,
          parameters: {
            dimensions: definition.dimensions,
            reasoningEffort: 'medium',
            reasoningEnabled: false,
            timeoutMs: 15_000,
          },
          provider: provider.id,
        },
        overrideAccess: false,
        user: admin,
      })
      createdProfileIDs.push(profile.id)
      const route = await payload.create({
        collection: 'ai-usage-routes',
        data: {
          enabled: true,
          operation: definition.operation,
          profile: profile.id,
          usageKey: definition.usageKey,
        },
        overrideAccess: false,
        user: admin,
      })
      createdRouteIDs.push(route.id)
    }
  })

  afterAll(async () => {
    if (payload) {
      for (const [collection, ids] of [
        ['ai-usage-routes', createdRouteIDs],
        ['ai-model-profiles', createdProfileIDs],
        ['ai-providers', createdProviderIDs],
        ['prompt-templates', createdPromptIDs],
        ['knowledge-documents', createdDocumentIDs],
      ] as const) {
        if (ids.length > 0) {
          await payload.delete({ collection, overrideAccess: true, where: { id: { in: ids } } })
        }
      }
      if (createdUserIDs.length > 0) {
        await payload.delete({
          collection: 'audit-logs',
          overrideAccess: true,
          where: { actor: { in: createdUserIDs } },
        })
        await payload.delete({
          collection: 'users',
          context: { skipAudit: true },
          overrideAccess: true,
          where: { id: { in: createdUserIDs } },
        })
      }
      await payload.destroy()
    }

    if (originalEncryptionKey === undefined) delete process.env.AI_CONFIG_ENCRYPTION_KEY
    else process.env.AI_CONFIG_ENCRYPTION_KEY = originalEncryptionKey
  })

  it('returns safe documents, prompts, filters, and AI readiness to administrators', async () => {
    const summary = await getKnowledgePage({
      payload,
      query: query(),
      req: await requestFor(admin),
      role: 'admin',
    })

    expect(summary.documents).toHaveLength(4)
    expect(summary.documents.map(({ indexStatus }) => indexStatus).sort()).toEqual([
      'failed',
      'pending',
      'processing',
      'ready',
    ])
    expect(summary.commands).toEqual([
      'knowledge:create',
      'knowledge:update',
      'knowledge:review',
      'knowledge:archive',
      'knowledge:delete',
      'knowledge:index',
      'knowledge:ai-debug',
    ])
    expect(summary.editor).toEqual({ status: 'available' })
    expect(summary.ai).toMatchObject({
      access: 'admin',
      routes: [
        { dimensions: 3, operation: 'embedding', status: 'ready', usageKey: 'knowledge.embedding' },
        { dimensions: null, operation: 'text', status: 'ready', usageKey: 'chat.reply' },
        {
          dimensions: null,
          operation: 'text',
          status: 'action-required',
          usageKey: 'knowledge.translation',
        },
      ],
    })
    expect(summary.prompts).toEqual([
      expect.objectContaining({
        key: expect.stringContaining('portal-customer-chat-'),
        version: 1,
      }),
    ])

    for (const document of summary.documents) {
      expect(document).not.toHaveProperty('content')
      expect(document).not.toHaveProperty('sourceURL')
      expect(document).not.toHaveProperty('sourceFile')
      expect(document).not.toHaveProperty('indexJobId')
      expect(document).not.toHaveProperty('indexOwnerToken')
    }
    for (const promptSummary of summary.prompts) {
      expect(promptSummary).not.toHaveProperty('template')
      expect(promptSummary).not.toHaveProperty('variables')
    }
    expect(JSON.stringify(summary)).not.toMatch(
      /private-content|private-source|private-template|privateVariable|private-provider-key|apiKey|baseURL|indexJobId|indexOwnerToken|\/admin/i,
    )

    const filtered = await getKnowledgePage({
      payload,
      query: query({
        index: 'ready',
        locale: 'en',
        review: 'reviewed',
        sourceType: 'faq',
        visibility: 'customer',
      }),
      req: await requestFor(admin),
      role: 'admin',
    })
    expect(filtered.documents).toHaveLength(1)
    expect(filtered.documents[0]).toMatchObject({
      customerVisible: true,
      indexStatus: 'ready',
      locale: 'en',
      reviewStatus: 'reviewed',
      sourceType: 'faq',
    })
  })

  it('keeps AI configuration admin-only while preserving operator knowledge access', async () => {
    const summary = await getKnowledgePage({
      payload,
      query: query(),
      req: await requestFor(operator),
      role: 'operator',
    })

    expect(summary.documents).toHaveLength(4)
    expect(summary.prompts).toHaveLength(1)
    expect(summary.ai).toEqual({ access: 'admin-only', routes: [] })
  })

  it('lets an operator create, edit, review, audit, and delete a knowledge document', async () => {
    const req = await requestFor(operator)
    const created = await createPortalKnowledgeDocument({
      input: {
        content: 'Initial controlled knowledge.',
        customerVisible: false,
        locale: 'en',
        sourceTitle: `${queryToken} Portal CRUD`,
        sourceType: 'faq',
        sourceURL: 'https://docs.example.invalid/portal-crud',
        sourceVersion: '1.0',
      },
      payload,
      req,
    })
    createdDocumentIDs.push(created.id)
    expect(created).toMatchObject({ indexStatus: 'pending', reviewStatus: 'draft' })

    const saved = await updatePortalKnowledgeDocument({
      id: created.id,
      input: {
        action: 'save',
        content: 'Updated controlled knowledge.',
        customerVisible: true,
        locale: 'en',
        sourceTitle: `${queryToken} Portal CRUD`,
        sourceType: 'faq',
        sourceURL: 'https://docs.example.invalid/portal-crud',
        sourceVersion: '1.1',
        updatedAt: created.updatedAt,
      },
      payload,
      req,
    })
    expect(saved).toMatchObject({ indexStatus: 'pending', reviewStatus: 'draft' })

    const reviewed = await updatePortalKnowledgeDocument({
      id: created.id,
      input: { action: 'review', updatedAt: saved.updatedAt },
      payload,
      req,
    })
    expect(reviewed).toMatchObject({ indexStatus: 'pending', reviewStatus: 'reviewed' })
    const reviewedDocument = await payload.findByID({
      collection: 'knowledge-documents',
      id: created.id,
      overrideAccess: true,
    })
    expect(reviewedDocument.reviewedAt).toBeTruthy()
    expect(
      typeof reviewedDocument.reviewedBy === 'object'
        ? reviewedDocument.reviewedBy?.id
        : reviewedDocument.reviewedBy,
    ).toBe(operator.id)

    await expect(
      deletePortalKnowledgeDocument({
        id: created.id,
        payload,
        req,
        updatedAt: reviewed.updatedAt,
      }),
    ).resolves.toMatchObject({ id: created.id })
    createdDocumentIDs.splice(createdDocumentIDs.indexOf(created.id), 1)

    const audits = await payload.find({
      collection: 'audit-logs',
      overrideAccess: true,
      pagination: false,
      where: {
        and: [
          { actor: { equals: operator.id } },
          { documentId: { equals: String(created.id) } },
          { resource: { equals: 'knowledge-documents' } },
        ],
      },
    })
    expect(audits.docs.map((audit) => audit.action).sort()).toEqual([
      'create',
      'delete',
      'update',
      'update',
    ])
  })

  it('short-circuits sales and disabled modules before Payload reads', async () => {
    const count = vi.spyOn(payload, 'count')
    const find = vi.spyOn(payload, 'find')
    count.mockClear()
    find.mockClear()

    await expect(
      loadKnowledgePageData({
        env: { ADMIN_PORTAL_ENABLED: 'true', ADMIN_PORTAL_KNOWLEDGE_ENABLED: 'true' },
        payload,
        query: query(),
        req: await requestFor(sales),
        role: 'sales',
      }),
    ).resolves.toEqual({ state: 'forbidden', summary: null })
    await expect(
      loadKnowledgePageData({
        env: { ADMIN_PORTAL_ENABLED: 'true' },
        payload,
        query: query(),
        req: await requestFor(admin),
        role: 'admin',
      }),
    ).resolves.toEqual({ state: 'module-disabled', summary: null })

    expect(count).not.toHaveBeenCalled()
    expect(find).not.toHaveBeenCalled()
    count.mockRestore()
    find.mockRestore()
  })
})
