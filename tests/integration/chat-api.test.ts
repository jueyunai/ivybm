import { randomUUID } from 'node:crypto'
import type { PostgresAdapter } from '@payloadcms/db-postgres'
import { NextRequest } from 'next/server'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { getPayload, type Payload } from 'payload'

import { POST as startSession } from '@/app/api/chat/sessions/route'
import { GET as getSession } from '@/app/api/chat/sessions/[id]/route'
import { POST as requestHandoff } from '@/app/api/chat/sessions/[id]/handoff/route'
import { POST as sendMessage } from '@/app/api/chat/sessions/[id]/messages/route'
import { POST as sendOperatorMessage } from '@/app/api/chat/sessions/[id]/operator-messages/route'
import { POST as resolveSession } from '@/app/api/chat/sessions/[id]/resolve/route'
import { POST as takeOverSession } from '@/app/api/chat/sessions/[id]/take-over/route'
import { indexKnowledgeDocument } from '@/modules/knowledge/embed'
import config from '@/payload.config'

let payload: Payload

describe.sequential('chat HTTP API', () => {
  beforeAll(async () => {
    payload = await getPayload({ config, disableOnInit: true, key: 'task9-chat-api-integration' })
  })

  afterAll(async () => {
    await payload.destroy()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    delete process.env.AI_PROVIDER_API_KEY
    delete process.env.AI_PROVIDER_BASE_URL
    delete process.env.AI_TEXT_MODEL
    delete process.env.AI_EMBEDDING_MODEL
  })

  it('sets an HttpOnly visitor cookie, authorizes the session and keeps start idempotent', async () => {
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
    const session = await first.json() as { id: string }
    const cookie = first.headers.get('set-cookie')?.split(';')[0]
    expect(cookie).toContain('ivybm_chat_session=')
    expect(first.headers.get('set-cookie')).toContain('HttpOnly')

    const repeated = await startSession(
      new NextRequest('http://localhost/api/chat/sessions', {
        body,
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      }),
    )
    expect(repeated.status).toBe(201)
    await expect(repeated.json()).resolves.toMatchObject({ id: session.id })

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

    const handoff = await requestHandoff(
      new NextRequest(`http://localhost/api/chat/sessions/${session.id}/handoff`, {
        body: JSON.stringify({ idempotencyKey: `api-handoff-${suffix}`, reason: 'visitor_request' }),
        headers: { 'content-type': 'application/json', cookie: cookie || '' },
        method: 'POST',
      }),
      { params: Promise.resolve({ id: session.id }) },
    )
    expect(handoff.status).toBe(200)
    await expect(handoff.json()).resolves.toMatchObject({ handoffStatus: 'handoff_requested' })

    const conversations = await payload.find({
      collection: 'conversations', limit: 1, overrideAccess: true,
      where: { publicId: { equals: session.id } },
    })
    if (conversations.docs[0]) {
      await payload.delete({ collection: 'conversations', id: conversations.docs[0].id, overrideAccess: true })
    }
    const visitors = await payload.find({
      collection: 'visitor-sessions', limit: 1, overrideAccess: true,
      where: { idempotencyKey: { equals: idempotencyKey } },
    })
    if (visitors.docs[0]) {
      await payload.delete({ collection: 'visitor-sessions', id: visitors.docs[0].id, overrideAccess: true })
    }
    await payload.delete({
      collection: 'conversation-commands', overrideAccess: true,
      where: { idempotencyKey: { contains: suffix } },
    })
  })

  it('answers from reviewed knowledge through a fake provider and persists AI metadata', async () => {
    const suffix = randomUUID()
    const document = await payload.create({
      collection: 'knowledge-documents',
      data: {
        content: 'PVDF, powder coating, and anodized finishes are available after engineering review.',
        indexStatus: 'pending', locale: 'en', reviewStatus: 'reviewed',
        sourceTitle: `Finish manual ${suffix}`, sourceType: 'product-manual', sourceVersion: '1.0',
      },
      overrideAccess: true,
    })
    await indexKnowledgeDocument({
      documentId: document.id,
      gateway: {
        embed: async ({ input }) => ({
          cost: { currency: 'USD' as const, estimated: 0 },
          embeddings: input.map(() => [1, 0, 0]),
          model: 'fake-embedding-model', provider: 'fake',
          usage: { inputTokens: 5, totalTokens: 5 },
        }),
      },
      payload,
      pool: (payload.db as unknown as PostgresAdapter).pool,
    })
    const prompt = await payload.create({
      collection: 'prompt-templates',
      data: {
        key: `customer-chat-${suffix}`, locale: 'en', purpose: 'customer-chat',
        status: 'active', template: 'Answer concisely and cite reviewed knowledge.', version: 1,
      },
      overrideAccess: true,
    })
    process.env.AI_PROVIDER_API_KEY = 'fixture-key'
    process.env.AI_PROVIDER_BASE_URL = 'https://ai.example.invalid/v1'
    process.env.AI_TEXT_MODEL = 'fake-text-model'
    process.env.AI_EMBEDDING_MODEL = 'fake-embedding-model'
    vi.stubGlobal('fetch', vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: [{ embedding: [1, 0, 0], index: 0 }], model: 'fake-embedding-model',
        usage: { prompt_tokens: 4, total_tokens: 4 },
      }), { headers: { 'content-type': 'application/json' }, status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        model: 'fake-text-model',
        output: [{ content: [{ text: 'Available finishes include PVDF, powder coating, and anodizing.', type: 'output_text' }] }],
        usage: { input_tokens: 20, output_tokens: 10, total_tokens: 30 },
      }), { headers: { 'content-type': 'application/json' }, status: 200 })))

    const startKey = `ai-start-${suffix}`
    const started = await startSession(new NextRequest('http://localhost/api/chat/sessions', {
      body: JSON.stringify({ channel: 'website', idempotencyKey: startKey, locale: 'en' }),
      headers: { 'content-type': 'application/json' }, method: 'POST',
    }))
    const session = await started.json() as { id: string }
    const cookie = started.headers.get('set-cookie')?.split(';')[0] || ''
    const response = await sendMessage(
      new NextRequest(`http://localhost/api/chat/sessions/${session.id}/messages`, {
        body: JSON.stringify({ idempotencyKey: `ai-message-${suffix}`, text: 'What finishes are available?' }),
        headers: { 'content-type': 'application/json', cookie }, method: 'POST',
      }),
      { params: Promise.resolve({ id: session.id }) },
    )
    expect(response.status).toBe(200)
    const snapshot = await response.json() as { messages: Array<Record<string, unknown>> }
    expect(snapshot.messages.at(-1)).toMatchObject({
      author: 'ai', model: 'fake-text-model', promptVersion: 1,
    })
    expect(snapshot.messages.at(-1)?.citations).toHaveLength(1)

    const stored = await payload.find({
      collection: 'messages', limit: 10, overrideAccess: true,
      where: { conversation: { equals: (await payload.find({
        collection: 'conversations', limit: 1, overrideAccess: true,
        where: { publicId: { equals: session.id } },
      })).docs[0].id } },
    })
    expect(stored.docs.find(({ author }) => author === 'ai')).toMatchObject({
      model: 'fake-text-model', promptVersion: 1,
      tokenUsage: { inputTokens: 20, outputTokens: 10, totalTokens: 30 },
    })

    const conversation = (await payload.find({
      collection: 'conversations', limit: 1, overrideAccess: true,
      where: { publicId: { equals: session.id } },
    })).docs[0]
    await payload.delete({ collection: 'conversations', id: conversation.id, overrideAccess: true })
    const visitors = await payload.find({ collection: 'visitor-sessions', limit: 1, overrideAccess: true,
      where: { idempotencyKey: { equals: startKey } } })
    if (visitors.docs[0]) await payload.delete({ collection: 'visitor-sessions', id: visitors.docs[0].id, overrideAccess: true })
    await payload.delete({ collection: 'conversation-commands', overrideAccess: true,
      where: { idempotencyKey: { contains: suffix } } })
    await payload.delete({ collection: 'prompt-templates', id: prompt.id, overrideAccess: true })
    await payload.delete({ collection: 'knowledge-documents', id: document.id, overrideAccess: true })
  })

  it('routes high-risk questions to one handoff without calling an AI provider', async () => {
    const suffix = randomUUID()
    const fetchMock = vi.fn<typeof fetch>()
    vi.stubGlobal('fetch', fetchMock)
    const startKey = `risk-start-${suffix}`
    const started = await startSession(new NextRequest('http://localhost/api/chat/sessions', {
      body: JSON.stringify({ channel: 'website', idempotencyKey: startKey, locale: 'en' }),
      headers: { 'content-type': 'application/json', 'x-real-ip': '198.51.100.31' }, method: 'POST',
    }))
    const session = await started.json() as { id: string }
    const cookie = started.headers.get('set-cookie')?.split(';')[0] || ''
    const messageKey = `risk-message-${suffix}`
    const response = await sendMessage(new NextRequest(
      `http://localhost/api/chat/sessions/${session.id}/messages`,
      {
        body: JSON.stringify({ idempotencyKey: messageKey, text: 'Confirm your final price and delivery date.' }),
        headers: { 'content-type': 'application/json', cookie, 'x-real-ip': '198.51.100.31' },
        method: 'POST',
      },
    ), { params: Promise.resolve({ id: session.id }) })
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ handoffStatus: 'handoff_requested' })
    expect(fetchMock).not.toHaveBeenCalled()

    const conversation = (await payload.find({ collection: 'conversations', limit: 1, overrideAccess: true,
      where: { publicId: { equals: session.id } } })).docs[0]
    const handoffs = await payload.find({ collection: 'handoffs', limit: 10, overrideAccess: true,
      where: { conversation: { equals: conversation.id } } })
    expect(handoffs.totalDocs).toBe(1)

    await payload.delete({ collection: 'conversations', id: conversation.id, overrideAccess: true })
    const visitors = await payload.find({ collection: 'visitor-sessions', limit: 1, overrideAccess: true,
      where: { idempotencyKey: { equals: startKey } } })
    if (visitors.docs[0]) await payload.delete({ collection: 'visitor-sessions', id: visitors.docs[0].id, overrideAccess: true })
    await payload.delete({ collection: 'conversation-commands', overrideAccess: true,
      where: { idempotencyKey: { contains: suffix } } })
  })

  it('enforces operator takeover and assigned-sales permissions through the HTTP API', async () => {
    const suffix = randomUUID()
    const password = 'task9-http-operator-password'
    const users = await Promise.all([
      payload.create({ collection: 'users', context: { skipAudit: true }, overrideAccess: true,
        data: { email: `http-op-1-${suffix}@example.invalid`, password, role: 'operator' } }),
      payload.create({ collection: 'users', context: { skipAudit: true }, overrideAccess: true,
        data: { email: `http-op-2-${suffix}@example.invalid`, password, role: 'operator' } }),
      payload.create({ collection: 'users', context: { skipAudit: true }, overrideAccess: true,
        data: { email: `http-sales-1-${suffix}@example.invalid`, password, role: 'sales' } }),
      payload.create({ collection: 'users', context: { skipAudit: true }, overrideAccess: true,
        data: { email: `http-sales-2-${suffix}@example.invalid`, password, role: 'sales' } }),
    ])
    const authHeader = async (email: string) => {
      const login = await payload.login({ collection: 'users', data: { email, password } })
      return { authorization: `JWT ${login.token}` }
    }
    const [firstAuth, secondAuth, salesAuth, otherSalesAuth] = await Promise.all(
      users.map(({ email }) => authHeader(email)),
    )
    const startKey = `operator-start-${suffix}`
    const started = await startSession(new NextRequest('http://localhost/api/chat/sessions', {
      body: JSON.stringify({ channel: 'website', idempotencyKey: startKey, locale: 'en' }),
      headers: { 'content-type': 'application/json', 'x-real-ip': '198.51.100.32' }, method: 'POST',
    }))
    const session = await started.json() as { id: string }
    const cookie = started.headers.get('set-cookie')?.split(';')[0] || ''
    await requestHandoff(new NextRequest(`http://localhost/api/chat/sessions/${session.id}/handoff`, {
      body: JSON.stringify({ idempotencyKey: `operator-handoff-${suffix}`, reason: 'visitor_request' }),
      headers: { 'content-type': 'application/json', cookie }, method: 'POST',
    }), { params: Promise.resolve({ id: session.id }) })

    const unauthenticated = await takeOverSession(new NextRequest(
      `http://localhost/api/chat/sessions/${session.id}/take-over`,
      { body: JSON.stringify({ idempotencyKey: `unauth-${suffix}` }), headers: { 'content-type': 'application/json' }, method: 'POST' },
    ), { params: Promise.resolve({ id: session.id }) })
    expect(unauthenticated.status).toBe(403)
    const salesTakeover = await takeOverSession(new NextRequest(
      `http://localhost/api/chat/sessions/${session.id}/take-over`,
      { body: JSON.stringify({ idempotencyKey: `sales-takeover-${suffix}` }), headers: { ...salesAuth, 'content-type': 'application/json' }, method: 'POST' },
    ), { params: Promise.resolve({ id: session.id }) })
    expect(salesTakeover.status).toBe(403)

    const takeover = await Promise.all([
      takeOverSession(new NextRequest(`http://localhost/api/chat/sessions/${session.id}/take-over`, {
        body: JSON.stringify({ idempotencyKey: `op-1-takeover-${suffix}` }), headers: { ...firstAuth, 'content-type': 'application/json' }, method: 'POST',
      }), { params: Promise.resolve({ id: session.id }) }),
      takeOverSession(new NextRequest(`http://localhost/api/chat/sessions/${session.id}/take-over`, {
        body: JSON.stringify({ idempotencyKey: `op-2-takeover-${suffix}` }), headers: { ...secondAuth, 'content-type': 'application/json' }, method: 'POST',
      }), { params: Promise.resolve({ id: session.id }) }),
    ])
    expect(takeover.map(({ status }) => status).sort()).toEqual([200, 409])

    const conversation = (await payload.find({ collection: 'conversations', depth: 0, limit: 1,
      overrideAccess: true, where: { publicId: { equals: session.id } } })).docs[0]
    await payload.update({ collection: 'conversations', id: conversation.id, overrideAccess: true,
      data: { assignedTo: users[2].id } })

    const otherReply = await sendOperatorMessage(new NextRequest(
      `http://localhost/api/chat/sessions/${session.id}/operator-messages`,
      { body: JSON.stringify({ idempotencyKey: `other-reply-${suffix}`, text: 'Not assigned.' }), headers: { ...otherSalesAuth, 'content-type': 'application/json' }, method: 'POST' },
    ), { params: Promise.resolve({ id: session.id }) })
    expect(otherReply.status).toBe(403)
    const assignedReply = await sendOperatorMessage(new NextRequest(
      `http://localhost/api/chat/sessions/${session.id}/operator-messages`,
      { body: JSON.stringify({ idempotencyKey: `assigned-reply-${suffix}`, text: 'I will assist with your project.' }), headers: { ...salesAuth, 'content-type': 'application/json' }, method: 'POST' },
    ), { params: Promise.resolve({ id: session.id }) })
    expect(assignedReply.status).toBe(200)
    const resolved = await resolveSession(new NextRequest(
      `http://localhost/api/chat/sessions/${session.id}/resolve`,
      { body: JSON.stringify({ idempotencyKey: `assigned-resolve-${suffix}` }), headers: { ...salesAuth, 'content-type': 'application/json' }, method: 'POST' },
    ), { params: Promise.resolve({ id: session.id }) })
    expect(resolved.status).toBe(200)
    await expect(resolved.json()).resolves.toMatchObject({ handoffStatus: 'resolved' })

    const audits = await payload.find({ collection: 'audit-logs', limit: 20, overrideAccess: true,
      where: { resource: { contains: 'conversation.handoff.' } } })
    expect(audits.docs.some(({ resource }) => resource === 'conversation.handoff.human_active')).toBe(true)
    expect(audits.docs.some(({ resource }) => resource === 'conversation.handoff.resolved')).toBe(true)

    await payload.delete({ collection: 'conversations', id: conversation.id, overrideAccess: true })
    const visitors = await payload.find({ collection: 'visitor-sessions', limit: 1, overrideAccess: true,
      where: { idempotencyKey: { equals: startKey } } })
    if (visitors.docs[0]) await payload.delete({ collection: 'visitor-sessions', id: visitors.docs[0].id, overrideAccess: true })
    await payload.delete({ collection: 'conversation-commands', overrideAccess: true,
      where: { idempotencyKey: { contains: suffix } } })
    await payload.delete({ collection: 'audit-logs', overrideAccess: true,
      where: { actor: { in: users.map(({ id }) => id) } } })
    await payload.delete({ collection: 'users', context: { skipAudit: true }, overrideAccess: true,
      where: { id: { in: users.map(({ id }) => id) } } })
  })
})
