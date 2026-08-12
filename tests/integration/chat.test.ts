import type { PostgresAdapter } from '@payloadcms/db-postgres'
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getPayload, type Payload } from 'payload'

import config from '@/payload.config'
import { authorizeVisitorSession, hashVisitorToken } from '@/modules/conversations/auth'
import { PayloadConversationLeadSink } from '@/modules/leads/conversationLeadSink'
import { PayloadConversationRepository } from '@/modules/conversations/payloadRepository'
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
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1_000).toISOString(),
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
        revision: 1,
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

    await expect(payload.update({
      collection: 'conversations',
      data: { handoffStatus: 'human_active' },
      id: conversation.id,
      overrideAccess: false,
      user: operator,
    })).rejects.toThrow()
    await expect(payload.update({
      collection: 'handoffs',
      data: { status: 'active' },
      id: handoff.id,
      overrideAccess: false,
      user: operator,
    })).rejects.toThrow()

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
      leadSink: new PayloadConversationLeadSink(),
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
      text: `I am from UAE. My company is Facade Engineering LLC. We have a tender for 3,200 sqm aluminum facade panels within 3 months. Drawings are ready. Our budget is USD 450000 and the purchase plan is within 3 months. Contact buyer-${suffix}@example.invalid or +971 50 000 0000.`,
    })
    expect(highIntent.handoffStatus).toBe('handoff_requested')
    const leads = await payload.find({
      collection: 'leads',
      limit: 2,
      overrideAccess: true,
      where: { idempotencyKey: { equals: `chat-lead:${String(session.id)}` } },
    })
    expect(leads.totalDocs).toBe(1)
    expect(leads.docs[0]).toMatchObject({
      budget: expect.stringContaining('USD 450000'),
      hasDrawings: true,
      intentLevel: 'a',
      projectStage: 'tender',
      quantitySquareMeters: 3200,
      timeline: 'within_3_months',
    })
    await expect(visitorService.requestHandoff({
      idempotencyKey: `illegal-handoff-${suffix}`,
      reason: 'duplicate_request',
      sessionId: session.id,
      source: 'visitor',
    })).rejects.toMatchObject({ code: 'conflict' })
    const rejectedAudit = await payload.find({
      collection: 'audit-logs', limit: 10, overrideAccess: true,
      where: { resource: { equals: 'conversation.handoff.rejected.handoff_requested.request' } },
    })
    const conversationForAudit = (await payload.find({
      collection: 'conversations', limit: 1, overrideAccess: true,
      where: { publicId: { equals: String(session.id) } },
    })).docs[0]
    expect(rejectedAudit.docs).toEqual(expect.arrayContaining([
      expect.objectContaining({ documentId: String(conversationForAudit.id) }),
    ]))

    const createOperatorService = (actor: typeof firstOperator) =>
      createConversationService({
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
    expect(active).not.toHaveProperty('assignedTo')
    const persistedActive = (await payload.find({
      collection: 'conversations', depth: 0, limit: 1, overrideAccess: true,
      where: { publicId: { equals: String(session.id) } },
    })).docs[0]
    const assignedID = typeof persistedActive.assignedTo === 'number'
      ? persistedActive.assignedTo
      : persistedActive.assignedTo?.id
    expect([firstOperator.id, secondOperator.id]).toContain(assignedID)
    const activeHandoffs = await payload.find({
      collection: 'handoffs', limit: 10, overrideAccess: true,
      where: { conversation: { equals: persistedActive.id } },
    })
    expect(activeHandoffs.docs).toHaveLength(1)
    const handoffAssignee = activeHandoffs.docs[0].assignedTo
    expect(typeof handoffAssignee === 'number' ? handoffAssignee : handoffAssignee?.id).toBe(assignedID)
    expect(activeHandoffs.docs[0]).toMatchObject({ status: 'active' })

    const winner = assignedID === firstOperator.id ? firstService : secondService
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

  it('creates a linked Lead when the qualification round limit hands off an incomplete enquiry', async () => {
    const suffix = randomUUID()
    const service = createConversationService({
      leadSink: {
        evaluate: async () => ({
          score: { handoffRecommended: false, level: 'c', missingFields: ['company'], reasons: [], score: 20 },
          signals: { contact: { email: `round-limit-${suffix}@example.invalid` }, country: 'United Arab Emirates' },
        }),
      },
      repository: new PayloadConversationRepository({
        payload,
        sessionTokenHash: hashVisitorToken(`round-limit-token-${suffix}`),
      }),
      responder: { generateReply: async () => ({ handoff: { reason: 'qualification_incomplete', source: 'ai_policy' } }) },
    })
    const session = await service.startSession({ channel: 'website', idempotencyKey: `round-limit-start-${suffix}`, locale: 'en' })
    const handedOff = await service.sendMessage({ idempotencyKey: `round-limit-message-${suffix}`, sessionId: session.id, text: `Contact round-limit-${suffix}@example.invalid in the UAE.` })
    expect(handedOff.handoffStatus).toBe('handoff_requested')

    const leads = await payload.find({ collection: 'leads', limit: 1, overrideAccess: true, where: { idempotencyKey: { equals: `chat-lead:${String(session.id)}` } } })
    expect(leads.docs[0]).toMatchObject({ intentLevel: 'c' })
    const conversation = (await payload.find({ collection: 'conversations', limit: 1, overrideAccess: true, where: { publicId: { equals: String(session.id) } } })).docs[0]
    if (conversation) await payload.delete({ collection: 'conversations', id: conversation.id, overrideAccess: true })
    if (leads.docs[0]) await payload.delete({ collection: 'leads', id: leads.docs[0].id, overrideAccess: true })
    await payload.delete({ collection: 'visitor-sessions', overrideAccess: true, where: { idempotencyKey: { equals: `round-limit-start-${suffix}` } } })
    await payload.delete({ collection: 'conversation-commands', overrideAccess: true, where: { idempotencyKey: { contains: suffix } } })
  })

  it('uses the persisted revision to serialize concurrent messages and lets the loser retry safely', async () => {
    const suffix = randomUUID()
    let replyCalls = 0
    let releaseFirstPair: (() => void) | undefined
    const firstPairReady = new Promise<void>((resolve) => {
      releaseFirstPair = resolve
    })
    const service = createConversationService({
      repository: new PayloadConversationRepository({
        payload,
        sessionTokenHash: hashVisitorToken(`revision-token-${suffix}`),
      }),
      responder: {
        generateReply: async () => {
          replyCalls += 1
          if (replyCalls <= 2) {
            if (replyCalls === 2) releaseFirstPair?.()
            await firstPairReady
          }
          return {
            content: 'Concurrent-safe fixture reply.',
            estimatedCostUSD: 0,
            model: 'fake-model',
            promptVersion: 1,
            tokenUsage: { inputTokens: 1, totalTokens: 1 },
          }
        },
      },
    })
    const session = await service.startSession({
      channel: 'website', idempotencyKey: `revision-start-${suffix}`, locale: 'en',
    })
    const inputs = [
      { idempotencyKey: `revision-message-a-${suffix}`, text: 'First concurrent enquiry.' },
      { idempotencyKey: `revision-message-b-${suffix}`, text: 'Second concurrent enquiry.' },
    ]
    const attempts = await Promise.allSettled(inputs.map((input) => service.sendMessage({
      ...input,
      sessionId: session.id,
    })))
    expect(attempts.filter(({ status }) => status === 'fulfilled')).toHaveLength(1)
    expect(attempts.filter(({ status }) => status === 'rejected')).toHaveLength(1)

    const failedIndex = attempts.findIndex(({ status }) => status === 'rejected')
    const recovered = await service.sendMessage({ ...inputs[failedIndex], sessionId: session.id })
    expect(recovered.messages.filter(({ author }) => author === 'visitor')).toHaveLength(2)
    expect(recovered.messages.filter(({ author }) => author === 'ai')).toHaveLength(2)
    expect(recovered.revision).toBe(3)

    const conversation = (await payload.find({
      collection: 'conversations', limit: 1, overrideAccess: true,
      where: { publicId: { equals: String(session.id) } },
    })).docs[0]
    expect(conversation.revision).toBe(3)
    await payload.delete({ collection: 'conversations', id: conversation.id, overrideAccess: true })
    await payload.delete({
      collection: 'visitor-sessions', overrideAccess: true,
      where: { idempotencyKey: { equals: `revision-start-${suffix}` } },
    })
    await payload.delete({
      collection: 'conversation-commands', overrideAccess: true,
      where: { idempotencyKey: { contains: suffix } },
    })
  })

  it('reclaims an expired command lease and fences the prior owner', async () => {
    const suffix = randomUUID()
    let now = new Date('2026-07-19T00:00:00.000Z')
    const repository = new PayloadConversationRepository({
      clock: () => now,
      commandLeaseMs: 1_000,
      payload,
      sessionTokenHash: hashVisitorToken(`lease-token-${suffix}`),
    })
    const service = createConversationService({
      repository,
      responder: {
        generateReply: async () => ({
          content: 'Fixture response.',
          estimatedCostUSD: 0,
          model: 'fake-model',
          promptVersion: 1,
          tokenUsage: { inputTokens: 1, totalTokens: 1 },
        }),
      },
    })
    const session = await service.startSession({
      channel: 'website',
      idempotencyKey: `lease-start-${suffix}`,
      locale: 'en',
    })
    const scope = `lease:${String(session.id)}`
    const key = `lease-command-${suffix}`
    const first = await repository.beginCommand(scope, key)
    if (first.state !== 'claimed') throw new Error('Expected first command claim')
    await expect(repository.beginCommand(scope, key)).resolves.toEqual({ state: 'processing' })

    now = new Date(now.getTime() + 1_001)
    const reclaimed = await repository.beginCommand(scope, key)
    if (reclaimed.state !== 'claimed') throw new Error('Expected expired command reclamation')
    expect(reclaimed.claim.token).not.toBe(first.claim.token)

    const base = await repository.getSession(session.id)
    if (!base) throw new Error('Expected persisted session')
    await expect(repository.saveSession(structuredClone(base), { base }, first.claim)).rejects.toMatchObject({
      code: 'conflict',
    })
    const fenced = await payload.findByID({
      collection: 'conversation-commands', id: reclaimed.claim.id, overrideAccess: true,
    })
    expect(fenced).toMatchObject({ ownerToken: reclaimed.claim.token, status: 'processing' })

    await expect(repository.saveSession(structuredClone(base), { base }, reclaimed.claim)).resolves.toMatchObject({
      id: session.id,
    })
    const completed = await payload.findByID({
      collection: 'conversation-commands', id: reclaimed.claim.id, overrideAccess: true,
    })
    expect(completed).toMatchObject({ status: 'completed' })

    const conversation = (await payload.find({
      collection: 'conversations', limit: 1, overrideAccess: true,
      where: { publicId: { equals: String(session.id) } },
    })).docs[0]
    if (conversation) await payload.delete({ collection: 'conversations', id: conversation.id, overrideAccess: true })
    const visitors = await payload.find({
      collection: 'visitor-sessions', limit: 1, overrideAccess: true,
      where: { idempotencyKey: { equals: `lease-start-${suffix}` } },
    })
    if (visitors.docs[0]) await payload.delete({ collection: 'visitor-sessions', id: visitors.docs[0].id, overrideAccess: true })
    await payload.delete({
      collection: 'conversation-commands', overrideAccess: true,
      where: { idempotencyKey: { contains: suffix } },
    })
  })

  it('scopes an idempotent handoff command to its conversation', async () => {
    const suffix = randomUUID()
    const createVisitorService = (token: string) => createConversationService({
      repository: new PayloadConversationRepository({
        payload,
        sessionTokenHash: hashVisitorToken(token),
      }),
      responder: {
        generateReply: async () => ({
          content: 'Fixture response.',
          estimatedCostUSD: 0,
          model: 'fake-model',
          promptVersion: 1,
          tokenUsage: { inputTokens: 1, totalTokens: 1 },
        }),
      },
    })
    const firstService = createVisitorService(`handoff-first-${suffix}`)
    const secondService = createVisitorService(`handoff-second-${suffix}`)
    const [first, second] = await Promise.all([
      firstService.startSession({ channel: 'website', idempotencyKey: `handoff-start-first-${suffix}`, locale: 'en' }),
      secondService.startSession({ channel: 'website', idempotencyKey: `handoff-start-second-${suffix}`, locale: 'en' }),
    ])
    const sharedKey = `handoff-shared-${suffix}`
    await Promise.all([
      firstService.requestHandoff({
        idempotencyKey: sharedKey, reason: 'visitor_request', sessionId: first.id, source: 'visitor',
      }),
      secondService.requestHandoff({
        idempotencyKey: sharedKey, reason: 'visitor_request', sessionId: second.id, source: 'visitor',
      }),
    ])
    const handoffs = await payload.find({
      collection: 'handoffs', limit: 10, overrideAccess: true,
      where: { idempotencyKey: { equals: sharedKey } },
    })
    expect(handoffs.docs).toHaveLength(2)

    for (const session of [first, second]) {
      const conversation = (await payload.find({
        collection: 'conversations', limit: 1, overrideAccess: true,
        where: { publicId: { equals: String(session.id) } },
      })).docs[0]
      if (conversation) await payload.delete({ collection: 'conversations', id: conversation.id, overrideAccess: true })
    }
    await payload.delete({
      collection: 'visitor-sessions', overrideAccess: true,
      where: { idempotencyKey: { contains: suffix } },
    })
    await payload.delete({
      collection: 'conversation-commands', overrideAccess: true,
      where: { idempotencyKey: { contains: suffix } },
    })
  })

  it('rolls back the visitor message when the paired AI message cannot be persisted', async () => {
    const suffix = randomUUID()
    const pool = (payload.db as unknown as PostgresAdapter).pool
    const service = createConversationService({
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
      const unchangedConversation = await payload.findByID({
        collection: 'conversations', id: conversation.id, overrideAccess: true,
      })
      expect(unchangedConversation).toMatchObject({
        handoffStatus: 'ai_active',
        lastMessageAt: null,
      })
      const failedCommand = await payload.find({
        collection: 'conversation-commands', limit: 1, overrideAccess: true,
        where: {
          and: [
            { scope: { equals: `message:${String(session.id)}` } },
            { idempotencyKey: { equals: `atomic-message-${suffix}` } },
          ],
        },
      })
      expect(failedCommand.docs[0]).toMatchObject({ status: 'failed' })

      await pool.query(`
        DROP TRIGGER IF EXISTS task9_reject_ai_message ON messages;
        DROP FUNCTION IF EXISTS task9_reject_ai_message();
      `)
      const recovered = await service.sendMessage({
        idempotencyKey: `atomic-message-${suffix}`,
        sessionId: session.id,
        text: 'Tell me about available panel finishes.',
      })
      expect(recovered.messages.map(({ author }) => author)).toEqual(['visitor', 'ai'])
      const completedCommand = await payload.find({
        collection: 'conversation-commands', limit: 1, overrideAccess: true,
        where: {
          and: [
            { scope: { equals: `message:${String(session.id)}` } },
            { idempotencyKey: { equals: `atomic-message-${suffix}` } },
          ],
        },
      })
      expect(completedCommand.docs[0]).toMatchObject({
        result: { sessionId: session.id },
        status: 'completed',
      })
      expect(completedCommand.docs[0]?.result).not.toHaveProperty('messages')
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
