import type { PostgresAdapter } from '@payloadcms/db-postgres'
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getPayload, type Payload } from 'payload'

import config from '@/payload.config'
import { authorizeVisitorSession, hashVisitorToken } from '@/modules/conversations/auth'
import { PayloadConversationLeadSink } from '@/modules/leads/conversationLeadSink'
import {
  PayloadConversationRepository,
  PayloadHandoffEventSink,
} from '@/modules/conversations/payloadRepository'
import { createConversationService } from '@/modules/conversations/service'

let payload: Payload
const userIDs: number[] = []

describe.sequential('Task 9 conversation persistence', () => {
  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required')
    payload = await getPayload({ config, disableOnInit: true, key: 'task9-chat-integration' })
  })

  afterAll(async () => {
    if (!payload) return
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

  it('stores a conversation, message and handoff while enforcing assigned sales access', async () => {
    const suffix = randomUUID()
    const operator = await payload.create({
      collection: 'users',
      context: { skipAudit: true },
      data: {
        email: `task9-operator-${suffix}@example.invalid`,
        password: 'task9-operator-integration-password',
        role: 'operator',
      },
      overrideAccess: true,
    })
    const assignedSales = await payload.create({
      collection: 'users',
      context: { skipAudit: true },
      data: {
        email: `task9-sales-${suffix}@example.invalid`,
        password: 'task9-assigned-sales-password',
        role: 'sales',
      },
      overrideAccess: true,
    })
    const otherSales = await payload.create({
      collection: 'users',
      context: { skipAudit: true },
      data: {
        email: `task9-other-${suffix}@example.invalid`,
        password: 'task9-other-sales-password',
        role: 'sales',
      },
      overrideAccess: true,
    })
    userIDs.push(operator.id, assignedSales.id, otherSales.id)

    const visitor = await payload.create({
      collection: 'visitor-sessions',
      data: {
        channel: 'website',
        idempotencyKey: `visitor-${suffix}`,
        lastSeenAt: new Date().toISOString(),
        locale: 'en',
        publicId: `visitor-public-${suffix}`,
        sessionTokenHash: `sha256-${suffix}`,
      },
      overrideAccess: true,
    })
    const conversation = await payload.create({
      collection: 'conversations',
      data: {
        assignedTo: assignedSales.id,
        channel: 'website',
        handoffStatus: 'handoff_requested',
        intentLevel: 'a',
        intentScore: 85,
        locale: 'en',
        publicId: `conversation-${suffix}`,
        requestId: `request-${suffix}`,
        visitorSession: visitor.id,
      },
      overrideAccess: true,
      user: operator,
    })
    const message = await payload.create({
      collection: 'messages',
      data: {
        author: 'visitor',
        content: 'We need 3,000 square meters for a tender.',
        conversation: conversation.id,
        idempotencyKey: `message-${suffix}`,
        requestId: `message-request-${suffix}`,
        status: 'sent',
      },
      overrideAccess: true,
    })
    const handoff = await payload.create({
      collection: 'handoffs',
      data: {
        assignedTo: assignedSales.id,
        conversation: conversation.id,
        domainEventId: `handoff-event-${suffix}`,
        idempotencyKey: `handoff-${suffix}`,
        publicId: `handoff-public-${suffix}`,
        reason: 'high_intent',
        requestedAt: new Date().toISOString(),
        source: 'ai_policy',
        status: 'requested',
      },
      overrideAccess: true,
      user: operator,
    })

    const assignedView = await payload.find({
      collection: 'conversations',
      overrideAccess: false,
      user: assignedSales,
      where: { id: { equals: conversation.id } },
    })
    const otherView = await payload.find({
      collection: 'conversations',
      overrideAccess: false,
      user: otherSales,
      where: { id: { equals: conversation.id } },
    })
    const assignedMessages = await payload.find({
      collection: 'messages',
      overrideAccess: false,
      user: assignedSales,
      where: { id: { equals: message.id } },
    })
    expect(assignedView.totalDocs).toBe(1)
    expect(otherView.totalDocs).toBe(0)
    expect(assignedMessages.totalDocs).toBe(1)

    const pool = (payload.db as unknown as PostgresAdapter).pool
    await pool.query('DELETE FROM conversations WHERE id = $1', [conversation.id])
    const children = await pool.query<{ handoffs: string; messages: string }>(
      `SELECT
        (SELECT COUNT(*) FROM handoffs WHERE id = $1) AS handoffs,
        (SELECT COUNT(*) FROM messages WHERE id = $2) AS messages`,
      [handoff.id, message.id],
    )
    expect(children.rows[0]).toEqual({ handoffs: '0', messages: '0' })
    await payload.delete({ collection: 'visitor-sessions', id: visitor.id, overrideAccess: true })
  })

  it('runs the real repository with high-intent lead creation and one concurrent takeover winner', async () => {
    const suffix = randomUUID()
    const firstOperator = await payload.create({
      collection: 'users',
      context: { skipAudit: true },
      data: {
        email: `task9-first-${suffix}@example.invalid`,
        password: 'task9-first-operator-password',
        role: 'operator',
      },
      overrideAccess: true,
    })
    const secondOperator = await payload.create({
      collection: 'users',
      context: { skipAudit: true },
      data: {
        email: `task9-second-${suffix}@example.invalid`,
        password: 'task9-second-operator-password',
        role: 'operator',
      },
      overrideAccess: true,
    })
    userIDs.push(firstOperator.id, secondOperator.id)
    const token = `visitor-token-${suffix}`
    const responder = {
      generateReply: async () => ({
        content: 'This should not run for a high-intent enquiry.',
        estimatedCostUSD: 0,
        model: 'fake-model',
        promptVersion: 1,
        tokenUsage: { inputTokens: 1, totalTokens: 1 },
      }),
    }
    const visitorService = createConversationService({
      eventSink: new PayloadHandoffEventSink(payload),
      leadSink: new PayloadConversationLeadSink(payload),
      repository: new PayloadConversationRepository({
        payload,
        sessionTokenHash: hashVisitorToken(token),
      }),
      responder,
    })
    const session = await visitorService.startSession({
      channel: 'website',
      idempotencyKey: `start-${suffix}`,
      locale: 'en',
    })
    await expect(authorizeVisitorSession(payload, String(session.id), token)).resolves.toMatchObject({
      publicId: session.id,
    })

    const highIntent = await visitorService.sendMessage({
      idempotencyKey: `message-${suffix}`,
      sessionId: session.id,
      text: `I am from UAE at Facade Engineering LLC. We have a tender for 3,200 sqm aluminum facade panels within 3 months. Drawings are ready. Contact buyer-${suffix}@example.invalid or +971 50 000 0000.`,
    })
    expect(highIntent.handoffStatus).toBe('handoff_requested')
    const leads = await payload.find({
      collection: 'leads',
      limit: 2,
      overrideAccess: true,
      where: { idempotencyKey: { equals: `chat-lead:${String(session.id)}` } },
    })
    expect(leads.totalDocs).toBe(1)
    expect(leads.docs[0].intentLevel).toBe('a')

    const createOperatorService = (actor: typeof firstOperator) =>
      createConversationService({
        eventSink: new PayloadHandoffEventSink(payload, actor),
        repository: new PayloadConversationRepository({ actor, payload }),
        responder,
      })
    const firstService = createOperatorService(firstOperator)
    const secondService = createOperatorService(secondOperator)
    const takeover = await Promise.allSettled([
      firstService.takeOver({ idempotencyKey: `takeover-first-${suffix}`, sessionId: session.id }),
      secondService.takeOver({ idempotencyKey: `takeover-second-${suffix}`, sessionId: session.id }),
    ])
    expect(takeover.filter(({ status }) => status === 'fulfilled')).toHaveLength(1)
    expect(takeover.filter(({ status }) => status === 'rejected')).toHaveLength(1)
    const active = await visitorService.getSession(session.id)
    expect(active.handoffStatus).toBe('human_active')
    expect([firstOperator.id, secondOperator.id]).toContain(active.assignedTo?.id)

    const winner = active.assignedTo?.id === firstOperator.id ? firstService : secondService
    const replied = await winner.sendOperatorMessage({
      idempotencyKey: `operator-message-${suffix}`,
      sessionId: session.id,
      text: 'A sales representative has taken over this conversation.',
    })
    expect(replied.messages.at(-1)?.author).toBe('operator')
    await expect(
      winner.resolve({ idempotencyKey: `resolve-${suffix}`, sessionId: session.id }),
    ).resolves.toMatchObject({ handoffStatus: 'resolved' })

    const conversation = await payload.find({
      collection: 'conversations', limit: 1, overrideAccess: true,
      where: { publicId: { equals: String(session.id) } },
    })
    if (conversation.docs[0]) {
      await payload.delete({ collection: 'conversations', id: conversation.docs[0].id, overrideAccess: true })
    }
    const visitors = await payload.find({
      collection: 'visitor-sessions', limit: 1, overrideAccess: true,
      where: { idempotencyKey: { equals: `start-${suffix}` } },
    })
    if (visitors.docs[0]) {
      await payload.delete({ collection: 'visitor-sessions', id: visitors.docs[0].id, overrideAccess: true })
    }
    await payload.delete({
      collection: 'conversation-commands', overrideAccess: true,
      where: { idempotencyKey: { contains: suffix } },
    })
    if (leads.docs[0]) await payload.delete({ collection: 'leads', id: leads.docs[0].id, overrideAccess: true })
  })

  it('rolls back the visitor message when the paired AI message cannot be persisted', async () => {
    const suffix = randomUUID()
    const pool = (payload.db as unknown as PostgresAdapter).pool
    const service = createConversationService({
      eventSink: new PayloadHandoffEventSink(payload),
      repository: new PayloadConversationRepository({
        payload,
        sessionTokenHash: hashVisitorToken(`atomic-token-${suffix}`),
      }),
      responder: {
        generateReply: async () => ({
          content: 'A fixture answer that will be rejected by the database trigger.',
          estimatedCostUSD: 0,
          model: 'fake-model',
          promptVersion: 1,
          tokenUsage: { inputTokens: 2, outputTokens: 2, totalTokens: 4 },
        }),
      },
    })
    const session = await service.startSession({
      channel: 'website',
      idempotencyKey: `atomic-start-${suffix}`,
      locale: 'en',
    })
    const conversation = (await payload.find({
      collection: 'conversations', limit: 1, overrideAccess: true,
      where: { publicId: { equals: String(session.id) } },
    })).docs[0]

    await pool.query(`
      CREATE OR REPLACE FUNCTION task9_reject_ai_message() RETURNS trigger AS $$
      BEGIN
        IF NEW.author = 'ai' THEN RAISE EXCEPTION 'fixture AI insert failure'; END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
      DROP TRIGGER IF EXISTS task9_reject_ai_message ON messages;
      CREATE TRIGGER task9_reject_ai_message
      BEFORE INSERT ON messages
      FOR EACH ROW EXECUTE FUNCTION task9_reject_ai_message();
    `)
    try {
      await expect(service.sendMessage({
        idempotencyKey: `atomic-message-${suffix}`,
        sessionId: session.id,
        text: 'Tell me about available panel finishes.',
      })).rejects.toThrow()

      const stored = await payload.find({
        collection: 'messages', limit: 10, overrideAccess: true,
        where: { conversation: { equals: conversation.id } },
      })
      expect(stored.totalDocs).toBe(0)
    } finally {
      await pool.query(`
        DROP TRIGGER IF EXISTS task9_reject_ai_message ON messages;
        DROP FUNCTION IF EXISTS task9_reject_ai_message();
      `)
      await payload.delete({ collection: 'conversations', id: conversation.id, overrideAccess: true })
      const visitors = await payload.find({ collection: 'visitor-sessions', limit: 1, overrideAccess: true,
        where: { idempotencyKey: { equals: `atomic-start-${suffix}` } } })
      if (visitors.docs[0]) await payload.delete({ collection: 'visitor-sessions', id: visitors.docs[0].id, overrideAccess: true })
      await payload.delete({ collection: 'conversation-commands', overrideAccess: true,
        where: { idempotencyKey: { contains: suffix } } })
    }
  })
})
