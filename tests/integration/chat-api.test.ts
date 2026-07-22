import { randomUUID } from 'node:crypto'
import type { PostgresAdapter } from '@payloadcms/db-postgres'
import { NextRequest } from 'next/server'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { getPayload, type Payload } from 'payload'

import { POST as startSession } from '@/app/api/chat/sessions/route'
import { GET as getSession } from '@/app/api/chat/sessions/[id]/route'
import { GET as listOperatorSessions } from '@/app/api/chat/operator/sessions/route'
import { POST as requestHandoff } from '@/app/api/chat/sessions/[id]/handoff/route'
import { POST as sendMessage } from '@/app/api/chat/sessions/[id]/messages/route'
import { POST as sendOperatorMessage } from '@/app/api/chat/sessions/[id]/operator-messages/route'
import { POST as resolveSession } from '@/app/api/chat/sessions/[id]/resolve/route'
import { POST as takeOverSession } from '@/app/api/chat/sessions/[id]/take-over/route'
import { createAiGateway } from '@/modules/ai/gateway'
import { AI_USAGE_KEYS } from '@/modules/ai/registry'
import { indexKnowledgeDocument } from '@/modules/knowledge/embed'
import config from '@/payload.config'

let payload: Payload
let originalTrustProxyHeaders: string | undefined

describe.sequential('chat HTTP API', () => {
  beforeAll(async () => {
    originalTrustProxyHeaders = process.env.TRUST_PROXY_HEADERS
    process.env.TRUST_PROXY_HEADERS = 'true'
    payload = await getPayload({ config, disableOnInit: true, key: 'task9-chat-api-integration' })
  })

  afterAll(async () => {
    await payload.destroy()
    if (originalTrustProxyHeaders === undefined) {
      delete process.env.TRUST_PROXY_HEADERS
    } else {
      process.env.TRUST_PROXY_HEADERS = originalTrustProxyHeaders
    }
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    delete process.env.AI_PROVIDER_API_KEY
    delete process.env.AI_PROVIDER_BASE_URL
    delete process.env.AI_TEXT_MODEL
    delete process.env.AI_EMBEDDING_DIMENSIONS
    delete process.env.AI_EMBEDDING_MODEL
    delete process.env.AI_CONFIG_ENCRYPTION_KEY
    delete process.env.AI_REASONING_ENABLED
    delete process.env.AI_REASONING_EFFORT
  })

  it('sets an HttpOnly random visitor cookie, isolates sessions and only resumes an owned duplicate', async () => {
    const suffix = randomUUID()
    const idempotencyKey = `api-start-${suffix}`
    const body = JSON.stringify({ channel: 'website', idempotencyKey, locale: 'en' })
    const first = await startSession(
      new NextRequest('http://localhost/api/chat/sessions', {
        body,
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      }),
    )
    expect(first.status).toBe(201)
    expect(first.headers.get('cache-control')).toBe('private, no-store')
    const session = (await first.json()) as { id: string }
    const cookie = first.headers.get('set-cookie')?.split(';')[0]
    expect(cookie).toContain('ivybm_chat_session=')
    expect(first.headers.get('set-cookie')).toContain('HttpOnly')

    const repeated = await startSession(
      new NextRequest('http://localhost/api/chat/sessions', {
        body,
        headers: { 'content-type': 'application/json', cookie: cookie || '' },
        method: 'POST',
      }),
    )
    expect(repeated.status).toBe(201)
    await expect(repeated.json()).resolves.toMatchObject({ id: session.id })

    const unownedRepeat = await startSession(
      new NextRequest('http://localhost/api/chat/sessions', {
        body,
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      }),
    )
    expect(unownedRepeat.status).toBe(403)

    const authorized = await getSession(
      new NextRequest(`http://localhost/api/chat/sessions/${session.id}`, {
        headers: { cookie: cookie || '' },
      }),
      { params: Promise.resolve({ id: session.id }) },
    )
    expect(authorized.status).toBe(200)

    const forbidden = await getSession(
      new NextRequest(`http://localhost/api/chat/sessions/${session.id}`, {
        headers: { cookie: 'ivybm_chat_session=wrong-token' },
      }),
      { params: Promise.resolve({ id: session.id }) },
    )
    expect(forbidden.status).toBe(403)

    const otherStartKey = `api-start-other-${suffix}`
    const other = await startSession(
      new NextRequest('http://localhost/api/chat/sessions', {
        body: JSON.stringify({ channel: 'website', idempotencyKey: otherStartKey, locale: 'en' }),
        headers: { 'content-type': 'application/json', 'x-real-ip': '198.51.100.201' },
        method: 'POST',
      }),
    )
    expect(other.status).toBe(201)
    const otherSession = (await other.json()) as { id: string }
    const crossSession = await getSession(
      new NextRequest(`http://localhost/api/chat/sessions/${otherSession.id}`, {
        headers: { cookie: cookie || '' },
      }),
      { params: Promise.resolve({ id: otherSession.id }) },
    )
    expect(crossSession.status).toBe(403)

    const handoff = await requestHandoff(
      new NextRequest(`http://localhost/api/chat/sessions/${session.id}/handoff`, {
        body: JSON.stringify({
          idempotencyKey: `api-handoff-${suffix}`,
          reason: 'visitor_request',
        }),
        headers: { 'content-type': 'application/json', cookie: cookie || '' },
        method: 'POST',
      }),
      { params: Promise.resolve({ id: session.id }) },
    )
    expect(handoff.status).toBe(200)
    await expect(handoff.json()).resolves.toMatchObject({ handoffStatus: 'handoff_requested' })

    const conversations = await payload.find({
      collection: 'conversations',
      limit: 1,
      overrideAccess: true,
      where: { publicId: { equals: session.id } },
    })
    if (conversations.docs[0]) {
      await payload.delete({
        collection: 'conversations',
        id: conversations.docs[0].id,
        overrideAccess: true,
      })
    }
    const visitors = await payload.find({
      collection: 'visitor-sessions',
      limit: 1,
      overrideAccess: true,
      where: { idempotencyKey: { equals: idempotencyKey } },
    })
    if (visitors.docs[0]) {
      await payload.delete({
        collection: 'visitor-sessions',
        id: visitors.docs[0].id,
        overrideAccess: true,
      })
    }
    const otherConversations = await payload.find({
      collection: 'conversations',
      limit: 1,
      overrideAccess: true,
      where: { publicId: { equals: otherSession.id } },
    })
    if (otherConversations.docs[0]) {
      await payload.delete({
        collection: 'conversations',
        id: otherConversations.docs[0].id,
        overrideAccess: true,
      })
    }
    const otherVisitors = await payload.find({
      collection: 'visitor-sessions',
      limit: 1,
      overrideAccess: true,
      where: { idempotencyKey: { equals: otherStartKey } },
    })
    if (otherVisitors.docs[0]) {
      await payload.delete({
        collection: 'visitor-sessions',
        id: otherVisitors.docs[0].id,
        overrideAccess: true,
      })
    }
    await payload.delete({
      collection: 'conversation-commands',
      overrideAccess: true,
      where: { idempotencyKey: { contains: suffix } },
    })
  })

  it('accepts only the website channel and rejects an expired server-side visitor credential', async () => {
    const suffix = randomUUID()
    const unsupported = await startSession(
      new NextRequest('http://localhost/api/chat/sessions', {
        body: JSON.stringify({
          channel: 'facebook',
          idempotencyKey: `external-${suffix}`,
          locale: 'en',
        }),
        headers: { 'content-type': 'application/json', 'x-real-ip': '198.51.100.211' },
        method: 'POST',
      }),
    )
    expect(unsupported.status).toBe(400)

    const idempotencyKey = `expired-${suffix}`
    const started = await startSession(
      new NextRequest('http://localhost/api/chat/sessions', {
        body: JSON.stringify({ channel: 'website', idempotencyKey, locale: 'en' }),
        headers: { 'content-type': 'application/json', 'x-real-ip': '198.51.100.212' },
        method: 'POST',
      }),
    )
    const session = (await started.json()) as { id: string }
    const cookie = started.headers.get('set-cookie')?.split(';')[0] || ''
    const visitor = (
      await payload.find({
        collection: 'visitor-sessions',
        limit: 1,
        overrideAccess: true,
        where: { idempotencyKey: { equals: idempotencyKey } },
      })
    ).docs[0]
    await payload.update({
      collection: 'visitor-sessions',
      data: { expiresAt: '2026-07-01T00:00:00.000Z' },
      id: visitor.id,
      overrideAccess: true,
    })

    const expired = await getSession(
      new NextRequest(`http://localhost/api/chat/sessions/${session.id}`, { headers: { cookie } }),
      { params: Promise.resolve({ id: session.id }) },
    )
    expect(expired.status).toBe(403)

    const conversation = (
      await payload.find({
        collection: 'conversations',
        limit: 1,
        overrideAccess: true,
        where: { publicId: { equals: session.id } },
      })
    ).docs[0]
    if (conversation)
      await payload.delete({
        collection: 'conversations',
        id: conversation.id,
        overrideAccess: true,
      })
    await payload.delete({ collection: 'visitor-sessions', id: visitor.id, overrideAccess: true })
    await payload.delete({
      collection: 'conversation-commands',
      overrideAccess: true,
      where: { idempotencyKey: { contains: suffix } },
    })
  })

  it('bounds an anonymous mutation body before attempting visitor authorization', async () => {
    const response = await sendMessage(
      new NextRequest('http://localhost/api/chat/sessions/session_oversized/messages', {
        body: JSON.stringify({ idempotencyKey: 'oversized-body', text: 'x'.repeat(32 * 1024) }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      }),
      { params: Promise.resolve({ id: 'session_oversized' }) },
    )
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'invalid_request' },
    })
  })

  it('safely creates a handoff when the AI runtime is unavailable', async () => {
    const suffix = randomUUID()
    const startKey = `unavailable-start-${suffix}`
    const started = await startSession(
      new NextRequest('http://localhost/api/chat/sessions', {
        body: JSON.stringify({ channel: 'website', idempotencyKey: startKey, locale: 'en' }),
        headers: { 'content-type': 'application/json', 'x-real-ip': '198.51.100.202' },
        method: 'POST',
      }),
    )
    const session = (await started.json()) as { id: string }
    const cookie = started.headers.get('set-cookie')?.split(';')[0] || ''
    const response = await sendMessage(
      new NextRequest(`http://localhost/api/chat/sessions/${session.id}/messages`, {
        body: JSON.stringify({
          idempotencyKey: `unavailable-message-${suffix}`,
          text: 'What finishes are available?',
        }),
        headers: { 'content-type': 'application/json', cookie, 'x-real-ip': '198.51.100.202' },
        method: 'POST',
      }),
      { params: Promise.resolve({ id: session.id }) },
    )
    expect(response.status).toBe(200)
    const snapshot = (await response.json()) as {
      handoffStatus: string
      messages: Array<{ author: string }>
    }
    expect(snapshot.handoffStatus).toBe('handoff_requested')
    expect(snapshot.messages).toEqual([expect.objectContaining({ author: 'visitor' })])

    const conversation = (
      await payload.find({
        collection: 'conversations',
        limit: 1,
        overrideAccess: true,
        where: { publicId: { equals: session.id } },
      })
    ).docs[0]
    const handoffs = await payload.find({
      collection: 'handoffs',
      limit: 10,
      overrideAccess: true,
      where: { conversation: { equals: conversation.id } },
    })
    expect(handoffs.docs).toHaveLength(1)
    expect(handoffs.docs[0]).toMatchObject({
      reason: 'ai_service_unavailable',
      status: 'requested',
    })

    await payload.delete({ collection: 'conversations', id: conversation.id, overrideAccess: true })
    const visitors = await payload.find({
      collection: 'visitor-sessions',
      limit: 1,
      overrideAccess: true,
      where: { idempotencyKey: { equals: startKey } },
    })
    if (visitors.docs[0])
      await payload.delete({
        collection: 'visitor-sessions',
        id: visitors.docs[0].id,
        overrideAccess: true,
      })
    await payload.delete({
      collection: 'conversation-commands',
      overrideAccess: true,
      where: { idempotencyKey: { contains: suffix } },
    })
  })

  it('answers from reviewed knowledge through a fake provider and persists AI metadata', async () => {
    const suffix = randomUUID()
    const document = await payload.create({
      collection: 'knowledge-documents',
      data: {
        content:
          'PVDF, powder coating, and anodized finishes are available after engineering review.',
        customerVisible: true,
        indexStatus: 'pending',
        locale: 'en',
        reviewStatus: 'reviewed',
        sourceTitle: `Finish manual ${suffix}`,
        sourceType: 'product-manual',
        sourceVersion: '1.0',
      },
      overrideAccess: true,
    })
    await indexKnowledgeDocument({
      documentId: document.id,
      gateway: createAiGateway({
        operations: {
          embedding: {
            dimensions: 3,
            embeddingSpaceIdentity: 'openai-compatible:https://ai.example.invalid/v1',
            model: 'fake-embedding-model',
            provider: {
              embed: async ({ input, model }) => ({
                embeddings: input.map(() => [1, 0, 0]),
                model,
                usage: { inputTokens: 5, totalTokens: 5 },
              }),
              generateText: async () => {
                throw new Error('Text generation is not used while indexing')
              },
              name: 'index-fixture',
            },
          },
        },
      }),
      payload,
      pool: (payload.db as unknown as PostgresAdapter).pool,
    })
    const prompt = await payload.create({
      collection: 'prompt-templates',
      data: {
        key: `customer-chat-${suffix}`,
        locale: 'en',
        purpose: 'customer-chat',
        status: 'active',
        template: 'Answer concisely and cite reviewed knowledge.',
        version: 1,
      },
      overrideAccess: true,
    })
    process.env.AI_PROVIDER_API_KEY = 'fixture-key'
    process.env.AI_PROVIDER_BASE_URL = 'https://ai.example.invalid/v1'
    process.env.AI_TEXT_MODEL = 'fake-text-model'
    process.env.AI_EMBEDDING_DIMENSIONS = '3'
    process.env.AI_EMBEDDING_MODEL = 'fake-embedding-model'
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              data: [{ embedding: [1, 0, 0], index: 0 }],
              model: 'fake-embedding-model',
              usage: { prompt_tokens: 4, total_tokens: 4 },
            }),
            { headers: { 'content-type': 'application/json' }, status: 200 },
          ),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              model: 'fake-text-model',
              output: [
                {
                  content: [
                    {
                      text: 'Available finishes include PVDF, powder coating, and anodizing.',
                      type: 'output_text',
                    },
                  ],
                },
              ],
              usage: { input_tokens: 20, output_tokens: 10, total_tokens: 30 },
            }),
            { headers: { 'content-type': 'application/json' }, status: 200 },
          ),
        ),
    )

    const startKey = `ai-start-${suffix}`
    const started = await startSession(
      new NextRequest('http://localhost/api/chat/sessions', {
        body: JSON.stringify({ channel: 'website', idempotencyKey: startKey, locale: 'en' }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      }),
    )
    const session = (await started.json()) as { id: string }
    const cookie = started.headers.get('set-cookie')?.split(';')[0] || ''
    const response = await sendMessage(
      new NextRequest(`http://localhost/api/chat/sessions/${session.id}/messages`, {
        body: JSON.stringify({
          idempotencyKey: `ai-message-${suffix}`,
          text: 'What finishes are available?',
        }),
        headers: { 'content-type': 'application/json', cookie },
        method: 'POST',
      }),
      { params: Promise.resolve({ id: session.id }) },
    )
    expect(response.status).toBe(200)
    const snapshot = (await response.json()) as { messages: Array<Record<string, unknown>> }
    expect(snapshot.messages.at(-1)).toMatchObject({
      author: 'ai',
      status: 'sent',
    })
    expect(snapshot.messages.at(-1)?.citations).toHaveLength(1)
    expect(snapshot.messages.at(-1)).not.toHaveProperty('estimatedCostUSD')
    expect(snapshot.messages.at(-1)).not.toHaveProperty('model')
    expect(snapshot.messages.at(-1)).not.toHaveProperty('promptVersion')
    expect(snapshot.messages.at(-1)).not.toHaveProperty('tokenUsage')

    const stored = await payload.find({
      collection: 'messages',
      limit: 10,
      overrideAccess: true,
      where: {
        conversation: {
          equals: (
            await payload.find({
              collection: 'conversations',
              limit: 1,
              overrideAccess: true,
              where: { publicId: { equals: session.id } },
            })
          ).docs[0].id,
        },
      },
    })
    expect(stored.docs.find(({ author }) => author === 'ai')).toMatchObject({
      model: 'fake-text-model',
      promptVersion: 1,
      tokenUsage: { inputTokens: 20, outputTokens: 10, totalTokens: 30 },
    })

    const conversation = (
      await payload.find({
        collection: 'conversations',
        limit: 1,
        overrideAccess: true,
        where: { publicId: { equals: session.id } },
      })
    ).docs[0]
    await payload.delete({ collection: 'conversations', id: conversation.id, overrideAccess: true })
    const visitors = await payload.find({
      collection: 'visitor-sessions',
      limit: 1,
      overrideAccess: true,
      where: { idempotencyKey: { equals: startKey } },
    })
    if (visitors.docs[0])
      await payload.delete({
        collection: 'visitor-sessions',
        id: visitors.docs[0].id,
        overrideAccess: true,
      })
    await payload.delete({
      collection: 'conversation-commands',
      overrideAccess: true,
      where: { idempotencyKey: { contains: suffix } },
    })
    await payload.delete({ collection: 'prompt-templates', id: prompt.id, overrideAccess: true })
    await payload.delete({
      collection: 'knowledge-documents',
      id: document.id,
      overrideAccess: true,
    })
  })

  it('uses CMS-selected provider profiles for the real chat runtime before legacy environment fallback', async () => {
    const suffix = randomUUID()
    process.env.AI_CONFIG_ENCRYPTION_KEY = 'd'.repeat(64)
    const provider = await payload.create({
      collection: 'ai-providers',
      context: { skipAudit: true },
      data: {
        apiKey: `cms-provider-key-${suffix}`,
        apiKeyConfigured: true,
        baseURL: 'https://cms.example.invalid/v1',
        enabled: true,
        name: `CMS provider ${suffix}`,
        protocol: 'openai-compatible',
      },
      overrideAccess: true,
    })
    const textProfile = await payload.create({
      collection: 'ai-model-profiles',
      context: { skipAudit: true },
      data: {
        capability: 'text',
        enabled: true,
        model: 'cms-text-model',
        name: `CMS text ${suffix}`,
        parameters: {
          maxOutputTokens: 64,
          reasoningEffort: 'low',
          reasoningEnabled: true,
          temperature: 0.3,
          timeoutMs: 30_000,
          topP: 0.8,
        },
        provider: provider.id,
      },
      overrideAccess: true,
    })
    const embeddingProfile = await payload.create({
      collection: 'ai-model-profiles',
      context: { skipAudit: true },
      data: {
        capability: 'embedding',
        enabled: true,
        model: 'cms-embedding-model',
        name: `CMS embedding ${suffix}`,
        parameters: {
          dimensions: 3,
          reasoningEffort: 'medium',
          reasoningEnabled: false,
          timeoutMs: 15_000,
        },
        provider: provider.id,
      },
      overrideAccess: true,
    })
    const [textRoute, embeddingRoute] = await Promise.all([
      payload.create({
        collection: 'ai-usage-routes',
        context: { skipAudit: true },
        data: {
          enabled: true,
          operation: 'text',
          profile: textProfile.id,
          usageKey: AI_USAGE_KEYS.chatReply,
        },
        overrideAccess: true,
      }),
      payload.create({
        collection: 'ai-usage-routes',
        context: { skipAudit: true },
        data: {
          enabled: true,
          operation: 'embedding',
          profile: embeddingProfile.id,
          usageKey: AI_USAGE_KEYS.knowledgeEmbedding,
        },
        overrideAccess: true,
      }),
    ])

    let documentID: number | undefined
    let promptID: number | undefined
    let sessionID: string | undefined
    const startKey = `cms-route-start-${suffix}`
    try {
      const document = await payload.create({
        collection: 'knowledge-documents',
        data: {
          content: 'CMS-routed knowledge confirms that configured finishes are available.',
          customerVisible: true,
          indexStatus: 'pending',
          locale: 'en',
          reviewStatus: 'reviewed',
          sourceTitle: `CMS finish manual ${suffix}`,
          sourceType: 'product-manual',
          sourceVersion: '1.0',
        },
        overrideAccess: true,
      })
      documentID = document.id
      await indexKnowledgeDocument({
        documentId: document.id,
        gateway: createAiGateway({
          operations: {
            embedding: {
              dimensions: 3,
              embeddingSpaceIdentity: 'openai-compatible:https://cms.example.invalid/v1',
              model: 'cms-embedding-model',
              provider: {
                embed: async ({ input, model }) => ({
                  embeddings: input.map(() => [1, 0, 0]),
                  model,
                  usage: { inputTokens: 3, totalTokens: 3 },
                }),
                generateText: async () => {
                  throw new Error('Text generation is not used while indexing')
                },
                name: 'index-fixture',
              },
            },
          },
        }),
        payload,
        pool: (payload.db as unknown as PostgresAdapter).pool,
      })
      const prompt = await payload.create({
        collection: 'prompt-templates',
        data: {
          key: `cms-customer-chat-${suffix}`,
          locale: 'en',
          purpose: 'customer-chat',
          status: 'active',
          template: 'Answer only from reviewed knowledge.',
          version: 1,
        },
        overrideAccess: true,
      })
      promptID = prompt.id

      process.env.AI_PROVIDER_API_KEY = 'legacy-key-must-not-be-used'
      process.env.AI_PROVIDER_BASE_URL = 'https://legacy.example.invalid/v1'
      process.env.AI_TEXT_MODEL = 'legacy-text-model'
      process.env.AI_EMBEDDING_MODEL = 'legacy-embedding-model'
      process.env.AI_REASONING_ENABLED = 'not-a-valid-legacy-value'
      const fetchMock = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              data: [{ embedding: [1, 0, 0], index: 0 }],
              model: 'cms-embedding-model',
              usage: { prompt_tokens: 4, total_tokens: 4 },
            }),
            { headers: { 'content-type': 'application/json' }, status: 200 },
          ),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              model: 'cms-text-model',
              output: [
                { content: [{ text: 'CMS routing selected this model.', type: 'output_text' }] },
              ],
              usage: { input_tokens: 12, output_tokens: 4, total_tokens: 16 },
            }),
            { headers: { 'content-type': 'application/json' }, status: 200 },
          ),
        )
      vi.stubGlobal('fetch', fetchMock)

      const started = await startSession(
        new NextRequest('http://localhost/api/chat/sessions', {
          body: JSON.stringify({ channel: 'website', idempotencyKey: startKey, locale: 'en' }),
          headers: { 'content-type': 'application/json', 'x-real-ip': '198.51.100.233' },
          method: 'POST',
        }),
      )
      const session = (await started.json()) as { id: string }
      sessionID = session.id
      const cookie = started.headers.get('set-cookie')?.split(';')[0] || ''
      const response = await sendMessage(
        new NextRequest(`http://localhost/api/chat/sessions/${session.id}/messages`, {
          body: JSON.stringify({
            idempotencyKey: `cms-route-message-${suffix}`,
            text: 'Which finishes are configured?',
          }),
          headers: { 'content-type': 'application/json', cookie, 'x-real-ip': '198.51.100.233' },
          method: 'POST',
        }),
        { params: Promise.resolve({ id: session.id }) },
      )

      expect(response.status).toBe(200)
      await expect(response.json()).resolves.toMatchObject({
        messages: expect.arrayContaining([expect.objectContaining({ author: 'ai' })]),
      })
      expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
        'https://cms.example.invalid/v1/embeddings',
        'https://cms.example.invalid/v1/responses',
      ])
      expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toMatchObject({
        max_output_tokens: 64,
        model: 'cms-text-model',
        reasoning: { effort: 'low' },
        temperature: 0.3,
        top_p: 0.8,
      })
    } finally {
      if (sessionID) {
        const conversation = (
          await payload.find({
            collection: 'conversations',
            limit: 1,
            overrideAccess: true,
            where: { publicId: { equals: sessionID } },
          })
        ).docs[0]
        if (conversation) {
          await payload.delete({
            collection: 'conversations',
            id: conversation.id,
            overrideAccess: true,
          })
        }
      }
      await payload.delete({
        collection: 'visitor-sessions',
        overrideAccess: true,
        where: { idempotencyKey: { equals: startKey } },
      })
      await payload.delete({
        collection: 'conversation-commands',
        overrideAccess: true,
        where: { idempotencyKey: { contains: suffix } },
      })
      if (promptID) {
        await payload.delete({ collection: 'prompt-templates', id: promptID, overrideAccess: true })
      }
      if (documentID) {
        await payload.delete({
          collection: 'knowledge-documents',
          id: documentID,
          overrideAccess: true,
        })
      }
      await payload.delete({
        collection: 'ai-usage-routes',
        id: textRoute.id,
        overrideAccess: true,
      })
      await payload.delete({
        collection: 'ai-usage-routes',
        id: embeddingRoute.id,
        overrideAccess: true,
      })
      await payload.delete({
        collection: 'ai-model-profiles',
        id: textProfile.id,
        overrideAccess: true,
      })
      await payload.delete({
        collection: 'ai-model-profiles',
        id: embeddingProfile.id,
        overrideAccess: true,
      })
      await payload.delete({ collection: 'ai-providers', id: provider.id, overrideAccess: true })
    }
  })

  it('routes high-risk questions to one handoff without calling an AI provider', async () => {
    const suffix = randomUUID()
    const fetchMock = vi.fn<typeof fetch>()
    vi.stubGlobal('fetch', fetchMock)
    const startKey = `risk-start-${suffix}`
    const started = await startSession(
      new NextRequest('http://localhost/api/chat/sessions', {
        body: JSON.stringify({ channel: 'website', idempotencyKey: startKey, locale: 'en' }),
        headers: { 'content-type': 'application/json', 'x-real-ip': '198.51.100.31' },
        method: 'POST',
      }),
    )
    const session = (await started.json()) as { id: string }
    const cookie = started.headers.get('set-cookie')?.split(';')[0] || ''
    const messageKey = `risk-message-${suffix}`
    const response = await sendMessage(
      new NextRequest(`http://localhost/api/chat/sessions/${session.id}/messages`, {
        body: JSON.stringify({
          idempotencyKey: messageKey,
          text: 'Confirm your final price and delivery date.',
        }),
        headers: { 'content-type': 'application/json', cookie, 'x-real-ip': '198.51.100.31' },
        method: 'POST',
      }),
      { params: Promise.resolve({ id: session.id }) },
    )
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ handoffStatus: 'handoff_requested' })
    expect(fetchMock).not.toHaveBeenCalled()

    const conversation = (
      await payload.find({
        collection: 'conversations',
        limit: 1,
        overrideAccess: true,
        where: { publicId: { equals: session.id } },
      })
    ).docs[0]
    const handoffs = await payload.find({
      collection: 'handoffs',
      limit: 10,
      overrideAccess: true,
      where: { conversation: { equals: conversation.id } },
    })
    expect(handoffs.totalDocs).toBe(1)

    await payload.delete({ collection: 'conversations', id: conversation.id, overrideAccess: true })
    const visitors = await payload.find({
      collection: 'visitor-sessions',
      limit: 1,
      overrideAccess: true,
      where: { idempotencyKey: { equals: startKey } },
    })
    if (visitors.docs[0])
      await payload.delete({
        collection: 'visitor-sessions',
        id: visitors.docs[0].id,
        overrideAccess: true,
      })
    await payload.delete({
      collection: 'conversation-commands',
      overrideAccess: true,
      where: { idempotencyKey: { contains: suffix } },
    })
  })

  it('enforces operator takeover and assigned-sales permissions through the HTTP API', async () => {
    const suffix = randomUUID()
    const password = 'task9-http-operator-password'
    const users = await Promise.all([
      payload.create({
        collection: 'users',
        context: { skipAudit: true },
        overrideAccess: true,
        data: { email: `http-op-1-${suffix}@example.invalid`, password, role: 'operator' },
      }),
      payload.create({
        collection: 'users',
        context: { skipAudit: true },
        overrideAccess: true,
        data: { email: `http-op-2-${suffix}@example.invalid`, password, role: 'operator' },
      }),
      payload.create({
        collection: 'users',
        context: { skipAudit: true },
        overrideAccess: true,
        data: { email: `http-sales-1-${suffix}@example.invalid`, password, role: 'sales' },
      }),
      payload.create({
        collection: 'users',
        context: { skipAudit: true },
        overrideAccess: true,
        data: { email: `http-sales-2-${suffix}@example.invalid`, password, role: 'sales' },
      }),
    ])
    const authHeader = async (email: string) => {
      const login = await payload.login({ collection: 'users', data: { email, password } })
      return { authorization: `JWT ${login.token}` }
    }
    const [firstAuth, secondAuth, salesAuth, otherSalesAuth] = await Promise.all(
      users.map(({ email }) => authHeader(email)),
    )
    const startKey = `operator-start-${suffix}`
    const started = await startSession(
      new NextRequest('http://localhost/api/chat/sessions', {
        body: JSON.stringify({ channel: 'website', idempotencyKey: startKey, locale: 'en' }),
        headers: { 'content-type': 'application/json', 'x-real-ip': '198.51.100.32' },
        method: 'POST',
      }),
    )
    const session = (await started.json()) as { id: string }
    const cookie = started.headers.get('set-cookie')?.split(';')[0] || ''
    await requestHandoff(
      new NextRequest(`http://localhost/api/chat/sessions/${session.id}/handoff`, {
        body: JSON.stringify({
          idempotencyKey: `operator-handoff-${suffix}`,
          reason: 'visitor_request',
        }),
        headers: { 'content-type': 'application/json', cookie },
        method: 'POST',
      }),
      { params: Promise.resolve({ id: session.id }) },
    )

    const unauthenticated = await takeOverSession(
      new NextRequest(`http://localhost/api/chat/sessions/${session.id}/take-over`, {
        body: JSON.stringify({ idempotencyKey: `unauth-${suffix}` }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      }),
      { params: Promise.resolve({ id: session.id }) },
    )
    expect(unauthenticated.status).toBe(403)
    const salesTakeover = await takeOverSession(
      new NextRequest(`http://localhost/api/chat/sessions/${session.id}/take-over`, {
        body: JSON.stringify({ idempotencyKey: `sales-takeover-${suffix}` }),
        headers: { ...salesAuth, 'content-type': 'application/json' },
        method: 'POST',
      }),
      { params: Promise.resolve({ id: session.id }) },
    )
    expect(salesTakeover.status).toBe(403)

    const takeover = await Promise.all([
      takeOverSession(
        new NextRequest(`http://localhost/api/chat/sessions/${session.id}/take-over`, {
          body: JSON.stringify({ idempotencyKey: `op-1-takeover-${suffix}` }),
          headers: { ...firstAuth, 'content-type': 'application/json' },
          method: 'POST',
        }),
        { params: Promise.resolve({ id: session.id }) },
      ),
      takeOverSession(
        new NextRequest(`http://localhost/api/chat/sessions/${session.id}/take-over`, {
          body: JSON.stringify({ idempotencyKey: `op-2-takeover-${suffix}` }),
          headers: { ...secondAuth, 'content-type': 'application/json' },
          method: 'POST',
        }),
        { params: Promise.resolve({ id: session.id }) },
      ),
    ])
    expect(takeover.map(({ status }) => status).sort()).toEqual([200, 409])

    const visitorSnapshot = await getSession(
      new NextRequest(`http://localhost/api/chat/sessions/${session.id}`, { headers: { cookie } }),
      { params: Promise.resolve({ id: session.id }) },
    )
    expect(visitorSnapshot.status).toBe(200)
    await expect(visitorSnapshot.json()).resolves.not.toHaveProperty('assignedTo')

    const operatorSnapshot = await getSession(
      new NextRequest(`http://localhost/api/chat/sessions/${session.id}?view=operator`, {
        headers: firstAuth,
      }),
      { params: Promise.resolve({ id: session.id }) },
    )
    expect(operatorSnapshot.status).toBe(200)
    await expect(operatorSnapshot.json()).resolves.toMatchObject({
      allowedActions: ['send_operator_message', 'resolve'],
    })
    const unassignedSalesSnapshot = await getSession(
      new NextRequest(`http://localhost/api/chat/sessions/${session.id}?view=operator`, {
        headers: otherSalesAuth,
      }),
      { params: Promise.resolve({ id: session.id }) },
    )
    expect(unassignedSalesSnapshot.status).toBe(403)

    const conversation = (
      await payload.find({
        collection: 'conversations',
        depth: 0,
        limit: 1,
        overrideAccess: true,
        where: { publicId: { equals: session.id } },
      })
    ).docs[0]
    await payload.update({
      collection: 'conversations',
      id: conversation.id,
      overrideAccess: true,
      data: { assignedTo: users[2].id },
    })

    const salesSnapshot = await getSession(
      new NextRequest(`http://localhost/api/chat/sessions/${session.id}?view=operator`, {
        headers: salesAuth,
      }),
      { params: Promise.resolve({ id: session.id }) },
    )
    expect(salesSnapshot.status).toBe(200)
    await expect(salesSnapshot.json()).resolves.toMatchObject({
      allowedActions: ['send_operator_message', 'resolve'],
      assignedTo: { id: users[2].id },
    })
    const operatorInbox = await listOperatorSessions(
      new NextRequest('http://localhost/api/chat/operator/sessions?limit=10', {
        headers: firstAuth,
      }),
    )
    expect(operatorInbox.status).toBe(200)
    const operatorInboxBody = (await operatorInbox.json()) as {
      docs: Array<Record<string, unknown>>
    }
    expect(operatorInboxBody.docs).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: session.id })]),
    )
    expect(operatorInboxBody.docs.find(({ id }) => id === session.id)).not.toHaveProperty(
      'messages',
    )
    const salesInbox = await listOperatorSessions(
      new NextRequest('http://localhost/api/chat/operator/sessions?limit=10', {
        headers: salesAuth,
      }),
    )
    expect(salesInbox.status).toBe(200)
    await expect(salesInbox.json()).resolves.toMatchObject({
      docs: expect.arrayContaining([expect.objectContaining({ id: session.id })]),
    })
    const otherSalesInbox = await listOperatorSessions(
      new NextRequest('http://localhost/api/chat/operator/sessions?limit=10', {
        headers: otherSalesAuth,
      }),
    )
    expect(otherSalesInbox.status).toBe(200)
    await expect(otherSalesInbox.json()).resolves.toMatchObject({
      docs: expect.not.arrayContaining([expect.objectContaining({ id: session.id })]),
    })

    const otherReply = await sendOperatorMessage(
      new NextRequest(`http://localhost/api/chat/sessions/${session.id}/operator-messages`, {
        body: JSON.stringify({ idempotencyKey: `other-reply-${suffix}`, text: 'Not assigned.' }),
        headers: { ...otherSalesAuth, 'content-type': 'application/json' },
        method: 'POST',
      }),
      { params: Promise.resolve({ id: session.id }) },
    )
    expect(otherReply.status).toBe(403)
    const assignedReply = await sendOperatorMessage(
      new NextRequest(`http://localhost/api/chat/sessions/${session.id}/operator-messages`, {
        body: JSON.stringify({
          idempotencyKey: `assigned-reply-${suffix}`,
          text: 'I will assist with your project.',
        }),
        headers: { ...salesAuth, 'content-type': 'application/json' },
        method: 'POST',
      }),
      { params: Promise.resolve({ id: session.id }) },
    )
    expect(assignedReply.status).toBe(200)
    const resolved = await resolveSession(
      new NextRequest(`http://localhost/api/chat/sessions/${session.id}/resolve`, {
        body: JSON.stringify({ idempotencyKey: `assigned-resolve-${suffix}` }),
        headers: { ...salesAuth, 'content-type': 'application/json' },
        method: 'POST',
      }),
      { params: Promise.resolve({ id: session.id }) },
    )
    expect(resolved.status).toBe(200)
    await expect(resolved.json()).resolves.toMatchObject({ handoffStatus: 'resolved' })

    const audits = await payload.find({
      collection: 'audit-logs',
      limit: 20,
      overrideAccess: true,
      where: { resource: { contains: 'conversation.handoff.' } },
    })
    expect(
      audits.docs.some(({ resource }) => resource === 'conversation.handoff.human_active'),
    ).toBe(true)
    expect(audits.docs.some(({ resource }) => resource === 'conversation.handoff.resolved')).toBe(
      true,
    )

    await payload.delete({ collection: 'conversations', id: conversation.id, overrideAccess: true })
    const visitors = await payload.find({
      collection: 'visitor-sessions',
      limit: 1,
      overrideAccess: true,
      where: { idempotencyKey: { equals: startKey } },
    })
    if (visitors.docs[0])
      await payload.delete({
        collection: 'visitor-sessions',
        id: visitors.docs[0].id,
        overrideAccess: true,
      })
    await payload.delete({
      collection: 'conversation-commands',
      overrideAccess: true,
      where: { idempotencyKey: { contains: suffix } },
    })
    await payload.delete({
      collection: 'audit-logs',
      overrideAccess: true,
      where: { actor: { in: users.map(({ id }) => id) } },
    })
    await payload.delete({
      collection: 'users',
      context: { skipAudit: true },
      overrideAccess: true,
      where: { id: { in: users.map(({ id }) => id) } },
    })
  })
})
