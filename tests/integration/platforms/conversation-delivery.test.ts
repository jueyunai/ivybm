import { randomUUID } from 'node:crypto'

import type { PostgresAdapter } from '@payloadcms/db-postgres'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { getPayload, type Payload } from 'payload'

import config from '@/payload.config'
import { hashVisitorToken } from '@/modules/conversations/auth'
import { PayloadConversationRepository } from '@/modules/conversations/payloadRepository'
import { createConversationService } from '@/modules/conversations/service'
import { PayloadJobQueue } from '@/modules/jobs/claim'
import { PayloadConversationLeadSink } from '@/modules/leads/conversationLeadSink'
import { createPlatformConversationDeliveryService } from '@/modules/platforms/conversationDelivery'
import {
  createPlatformConversationDeliveryJobHandler,
  PLATFORM_CONVERSATION_DELIVERY_JOB_TYPE,
} from '@/modules/platforms/conversationDeliveryJobs'
import { PayloadPlatformConversationPort } from '@/modules/platforms/payloadConversationPort'
import { PayloadPlatformConversationDeliveryAuthority } from '@/modules/platforms/payloadConversationDeliveryAuthority'
import type { PlatformConversationDeliveryIntent } from '@/modules/platforms/types'

let payload: Payload
const testThreads: string[] = []
const testUserIDs: number[] = []
const testAccountIDs: number[] = []

const pool = (): PostgresAdapter['pool'] => (payload.db as unknown as PostgresAdapter).pool
const relationshipID = (value: number | { id: number }): number =>
  typeof value === 'number' ? value : value.id

const createPlatformAccount = async ({
  accountExternalId,
  accountKind = 'facebook-page',
  aiAutoReplyEnabled,
}: {
  accountExternalId: string
  accountKind?: 'facebook-page' | 'instagram-professional'
  aiAutoReplyEnabled: boolean
}) => {
  const account = await payload.create({
    collection: 'platform-accounts',
    context: { skipAudit: true },
    data: {
      accountKind,
      aiAutoReplyEnabled,
      authorization: { state: 'not_started' },
      authorizationRevision: 0,
      externalAccountId: accountExternalId,
      name: `Task 14 ${accountKind} ${accountExternalId}`,
      platformFamily: 'meta',
    },
    overrideAccess: true,
  })
  testAccountIDs.push(account.id)
  return account
}

const persistedIntent = async (
  conversationId: number,
): Promise<PlatformConversationDeliveryIntent> => {
  const found = await payload.find({
    collection: 'conversation-delivery-intents',
    depth: 0,
    limit: 2,
    overrideAccess: true,
    where: { conversation: { equals: conversationId } },
  })
  if (found.docs.length !== 1) throw new Error('Expected one conversation delivery intent')
  const intent = found.docs[0]
  return {
    conversationId: relationshipID(intent.conversation),
    expectedRevision: intent.expectedRevision,
    jobId: relationshipID(intent.queueJob),
    replyId: relationshipID(intent.replyMessage),
    transport: {
      accountExternalId: intent.accountExternalId,
      deliveryKey: intent.deliveryKey,
      platform: intent.platform,
      recipientExternalId: intent.recipientExternalId,
      text: intent.text,
    },
  }
}

describe.sequential('Task 13 persisted platform conversation delivery', () => {
  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required')
    payload = await getPayload({
      config,
      disableOnInit: true,
      key: 'task13-platform-conversation-delivery',
    })
  })

  afterEach(async () => {
    if (testThreads.length === 0) return
    const conversations = await payload.find({
      collection: 'conversations',
      depth: 0,
      limit: 100,
      overrideAccess: true,
      where: { externalThreadId: { in: testThreads } },
    })
    const conversationIDs = conversations.docs.map(({ id }) => id)
    const visitorIDs = conversations.docs.map(({ visitorSession }) =>
      relationshipID(visitorSession),
    )
    const intents =
      conversationIDs.length > 0
        ? await pool().query<{ id: number; queue_job_id: number }>(
            `SELECT id, queue_job_id FROM conversation_delivery_intents
             WHERE conversation_id = ANY($1::int[])`,
            [conversationIDs],
          )
        : { rows: [] }
    const jobIDs = intents.rows.map(({ queue_job_id }) => queue_job_id)
    const documentIDs = [
      ...conversationIDs,
      ...visitorIDs,
      ...intents.rows.map(({ id }) => id),
      ...jobIDs,
    ].map(String)

    if (conversationIDs.length > 0) {
      await pool().query(
        'DELETE FROM conversation_commands WHERE conversation_id = ANY($1::int[])',
        [conversationIDs],
      )
      await pool().query(
        'DELETE FROM conversation_delivery_intents WHERE conversation_id = ANY($1::int[])',
        [conversationIDs],
      )
      await pool().query('DELETE FROM conversations WHERE id = ANY($1::int[])', [conversationIDs])
    }
    if (jobIDs.length > 0) {
      await pool().query('DELETE FROM jobs WHERE id = ANY($1::int[])', [jobIDs])
    }
    if (visitorIDs.length > 0) {
      await pool().query('DELETE FROM visitor_sessions WHERE id = ANY($1::int[])', [visitorIDs])
    }
    if (documentIDs.length > 0) {
      await pool().query(
        `DELETE FROM audit_logs
         WHERE document_id = ANY($1::text[])
           AND (
             resource IN (
               'conversation-delivery-intents', 'conversations', 'jobs', 'messages',
               'visitor-sessions'
             )
             OR resource LIKE 'conversation.handoff.%'
           )`,
        [documentIDs],
      )
    }
    for (const userID of testUserIDs) {
      await payload.delete({ collection: 'users', id: userID, overrideAccess: true })
    }
    for (const accountID of testAccountIDs) {
      await payload.delete({
        collection: 'platform-accounts',
        context: { skipAudit: true },
        id: accountID,
        overrideAccess: true,
      })
    }
    testThreads.length = 0
    testUserIDs.length = 0
    testAccountIDs.length = 0
  })

  afterAll(async () => {
    await payload?.destroy()
  })

  it('persists one Arabic AI reply intent and accepts it without duplicate delivery', async () => {
    const suffix = randomUUID().replaceAll('-', '')
    const digits = randomUUID().replace(/\D/gu, '').padEnd(20, '7')
    const accountExternalId = `12${digits.slice(0, 14)}`
    const senderExternalId = `22${digits.slice(0, 14)}`
    const externalThreadId = `${accountExternalId}:${senderExternalId}`
    testThreads.push(externalThreadId)
    await createPlatformAccount({ accountExternalId, aiAutoReplyEnabled: true })
    const generateReply = vi.fn(async ({ session }: { session: { locale: 'ar' | 'en' } }) => {
      expect(session.locale).toBe('ar')
      return {
        content: 'شكرًا. ما الدولة التي يقع فيها المشروع؟',
        estimatedCostUSD: 0,
        model: 'integration-model',
        promptVersion: 1,
        tokenUsage: { inputTokens: 5, outputTokens: 8, totalTokens: 13 },
      }
    })
    const conversations = new PayloadPlatformConversationPort({
      payload,
      responder: { generateReply },
    })
    const event = {
      accountExternalId,
      content: { messageType: 'text', text: 'أحتاج واجهة لمشروع تجاري جديد.' },
      externalEventId: `message-${suffix}`,
      idempotencyKey: `transport-${suffix}`,
      kind: 'inbound-message' as const,
      occurredAt: '2026-08-14T00:00:00.000Z',
      platform: 'facebook-messenger' as const,
      recipientExternalId: accountExternalId,
      senderExternalId,
    }

    await expect(conversations.writeInboundMessage(event)).resolves.toMatchObject({
      status: 'accepted',
    })
    await expect(
      conversations.writeInboundMessage({ ...event, idempotencyKey: `transport-retry-${suffix}` }),
    ).resolves.toMatchObject({ status: 'duplicate' })
    expect(generateReply).toHaveBeenCalledTimes(1)

    const conversation = await payload.find({
      collection: 'conversations',
      depth: 0,
      limit: 1,
      overrideAccess: true,
      where: { externalThreadId: { equals: externalThreadId } },
    })
    expect(conversation.docs[0]).toMatchObject({
      externalAccountId: accountExternalId,
      externalSenderId: senderExternalId,
      handoffStatus: 'ai_active',
      locale: 'ar',
    })
    const conversationId = conversation.docs[0]?.id
    if (!conversationId) throw new Error('Expected persisted external conversation')
    const messages = await payload.find({
      collection: 'messages',
      depth: 0,
      limit: 10,
      overrideAccess: true,
      sort: 'createdAt',
      where: { conversation: { equals: conversationId } },
    })
    expect(messages.docs).toEqual([
      expect.objectContaining({ author: 'visitor', status: 'sent' }),
      expect.objectContaining({ author: 'ai', status: 'pending' }),
    ])
    await expect(
      payload.count({
        collection: 'conversation-delivery-intents',
        overrideAccess: true,
        where: { conversation: { equals: conversationId } },
      }),
    ).resolves.toEqual({ totalDocs: 1 })

    const queue = new PayloadJobQueue({ payload })
    const job = await queue.claimNext([PLATFORM_CONVERSATION_DELIVERY_JOB_TYPE])
    if (!job) throw new Error('Expected one platform conversation delivery Job')
    const send = vi.fn(async (request) => ({
      deliveryKey: request.deliveryKey,
      platform: request.platform,
      status: 'accepted' as const,
    }))
    const handler = createPlatformConversationDeliveryJobHandler({
      delivery: createPlatformConversationDeliveryService({
        authority: new PayloadPlatformConversationDeliveryAuthority(payload),
        outbound: {
          recoverUnknownOutcome: async (request) => ({
            deliveryKey: request.deliveryKey,
            platform: request.platform,
            status: 'delivery_unknown',
          }),
          send,
        },
      }),
      payload,
    })
    await handler(job, {
      assertLease: () => undefined,
      renewLease: async () => job,
      signal: new AbortController().signal,
    })
    await queue.complete(job)

    expect(send).toHaveBeenCalledTimes(1)
    await expect(
      payload.findByID({ collection: 'messages', id: messages.docs[1]!.id, overrideAccess: true }),
    ).resolves.toMatchObject({
      status: 'sent',
    })
    const accepted = await payload.find({
      collection: 'conversation-delivery-intents',
      limit: 1,
      overrideAccess: true,
      where: { conversation: { equals: conversationId } },
    })
    expect(accepted.docs[0]).toMatchObject({ status: 'accepted' })
    await expect(queue.getByID(job.id)).resolves.toMatchObject({ status: 'succeeded' })
  })

  it('blocks a queued automatic reply when the account is paused before provider I/O', async () => {
    const suffix = randomUUID().replaceAll('-', '')
    const digits = randomUUID().replace(/\D/gu, '').padEnd(20, '7')
    const accountExternalId = `71${digits.slice(0, 14)}`
    const senderExternalId = `81${digits.slice(0, 14)}`
    const externalThreadId = `${accountExternalId}:${senderExternalId}`
    testThreads.push(externalThreadId)
    const account = await createPlatformAccount({
      accountExternalId,
      aiAutoReplyEnabled: true,
    })
    const conversations = new PayloadPlatformConversationPort({
      payload,
      responder: {
        generateReply: async () => ({
          content: 'This reply must be fenced before provider I/O.',
          estimatedCostUSD: 0,
          model: 'integration-model',
          promptVersion: 1,
          tokenUsage: { inputTokens: 2, outputTokens: 3, totalTokens: 5 },
        }),
      },
    })

    await conversations.writeInboundMessage({
      accountExternalId,
      content: { messageType: 'text', text: 'Please share more project information.' },
      externalEventId: `paused-message-${suffix}`,
      idempotencyKey: `paused-transport-${suffix}`,
      kind: 'inbound-message',
      occurredAt: '2026-09-01T00:00:00.000Z',
      platform: 'facebook-messenger',
      recipientExternalId: accountExternalId,
      senderExternalId,
    })
    const conversation = await payload.find({
      collection: 'conversations',
      depth: 0,
      limit: 1,
      overrideAccess: true,
      where: { externalThreadId: { equals: externalThreadId } },
    })
    const conversationId = conversation.docs[0]?.id
    if (!conversationId) throw new Error('Expected persisted external conversation')
    const intent = await persistedIntent(conversationId)
    await payload.update({
      collection: 'platform-accounts',
      context: { skipAudit: true },
      data: { aiAutoReplyEnabled: false },
      id: account.id,
      overrideAccess: true,
    })

    const queue = new PayloadJobQueue({ payload })
    const job = await queue.claimNext([PLATFORM_CONVERSATION_DELIVERY_JOB_TYPE])
    if (!job) throw new Error('Expected one platform conversation delivery Job')
    const send = vi.fn()
    const handler = createPlatformConversationDeliveryJobHandler({
      delivery: createPlatformConversationDeliveryService({
        authority: new PayloadPlatformConversationDeliveryAuthority(payload),
        outbound: {
          recoverUnknownOutcome: vi.fn(),
          send,
        },
      }),
      payload,
    })

    await handler(job, {
      assertLease: () => undefined,
      renewLease: async () => job,
      signal: new AbortController().signal,
    })
    await queue.complete(job)

    expect(send).not.toHaveBeenCalled()
    await expect(
      payload.findByID({ collection: 'messages', id: intent.replyId, overrideAccess: true }),
    ).resolves.toMatchObject({ errorCode: 'ai_auto_reply_paused', status: 'failed' })
    const blocked = await payload.find({
      collection: 'conversation-delivery-intents',
      limit: 1,
      overrideAccess: true,
      where: { conversation: { equals: conversationId } },
    })
    expect(blocked.docs[0]).toMatchObject({
      lastErrorCode: 'ai_auto_reply_paused',
      retryable: false,
      status: 'blocked',
    })
  })

  it('preserves recovery after provider I/O even if the account is paused later', async () => {
    const suffix = randomUUID().replaceAll('-', '')
    const digits = randomUUID().replace(/\D/gu, '').padEnd(20, '7')
    const accountExternalId = `91${digits.slice(0, 14)}`
    const senderExternalId = `92${digits.slice(0, 14)}`
    const externalThreadId = `${accountExternalId}:${senderExternalId}`
    testThreads.push(externalThreadId)
    const account = await createPlatformAccount({ accountExternalId, aiAutoReplyEnabled: true })
    const service = createConversationService({
      repository: new PayloadConversationRepository({
        payload,
        sessionTokenHash: hashVisitorToken(`recovery-${suffix}`),
      }),
      responder: {
        generateReply: async () => ({
          content: 'Provider I/O recovery must remain authoritative.',
          estimatedCostUSD: 0,
          model: 'integration-model',
          promptVersion: 1,
          tokenUsage: { inputTokens: 2, outputTokens: 3, totalTokens: 5 },
        }),
      },
    })
    await service.ingestExternalMessage({
      aiAutoReplyEnabled: true,
      channel: 'facebook',
      externalAccountId: accountExternalId,
      externalMessageId: `recovery-message-${suffix}`,
      externalSenderId: senderExternalId,
      externalThreadId,
      locale: 'en',
      text: 'We need facade panels for a commercial project.',
    })
    const conversation = await payload.find({
      collection: 'conversations',
      depth: 0,
      limit: 1,
      overrideAccess: true,
      where: { externalThreadId: { equals: externalThreadId } },
    })
    const conversationId = conversation.docs[0]?.id
    if (!conversationId) throw new Error('Expected persisted external conversation')
    const intent = await persistedIntent(conversationId)
    const queue = new PayloadJobQueue({ payload })
    const job = await queue.claimNext([PLATFORM_CONVERSATION_DELIVERY_JOB_TYPE])
    if (!job) throw new Error('Expected one platform conversation delivery Job')
    const authority = new PayloadPlatformConversationDeliveryAuthority(payload)
    const firstClaim = await authority.claimDelivery(intent, {
      jobId: job.id,
      leaseExpiresAt: job.leaseExpiresAt,
      ownerToken: job.ownerToken,
    })
    if (firstClaim.status !== 'claimed') throw new Error('Expected initial delivery claim')
    await expect(authority.markProviderIOStarted(firstClaim.claim)).resolves.toEqual({
      status: 'fenced',
    })
    await payload.update({
      collection: 'platform-accounts',
      context: { skipAudit: true },
      data: { aiAutoReplyEnabled: false },
      id: account.id,
      overrideAccess: true,
    })
    await pool().query(
      `UPDATE conversation_delivery_intents
       SET claim_lease_expires_at = now() - interval '1 second'
       WHERE queue_job_id = $1`,
      [job.id],
    )

    const recoveryClaim = await authority.claimDelivery(intent, {
      jobId: job.id,
      leaseExpiresAt: job.leaseExpiresAt,
      ownerToken: job.ownerToken,
    })
    expect(recoveryClaim).toMatchObject({ claim: { mode: 'recover' }, status: 'claimed' })
    if (recoveryClaim.status !== 'claimed') throw new Error('Expected recovery delivery claim')
    await authority.releaseDelivery(recoveryClaim.claim, {
      deliveryKey: intent.transport.deliveryKey,
      platform: intent.transport.platform,
      status: 'delivery_unknown',
    })
    const recovered = await payload.find({
      collection: 'conversation-delivery-intents',
      limit: 1,
      overrideAccess: true,
      where: { conversation: { equals: conversationId } },
    })
    expect(recovered.docs[0]).toMatchObject({
      lastErrorCode: 'delivery_unknown',
      status: 'delivery_unknown',
    })
  })

  it('blocks a handoff transition while provider I/O is fenced', async () => {
    const suffix = randomUUID().replaceAll('-', '')
    const digits = randomUUID().replace(/\D/gu, '').padEnd(20, '7')
    const accountExternalId = `31${digits.slice(0, 14)}`
    const senderExternalId = `41${digits.slice(0, 14)}`
    const externalThreadId = `${accountExternalId}:${senderExternalId}`
    testThreads.push(externalThreadId)
    await createPlatformAccount({ accountExternalId, aiAutoReplyEnabled: true })
    const service = createConversationService({
      leadSink: new PayloadConversationLeadSink(),
      repository: new PayloadConversationRepository({
        payload,
        sessionTokenHash: hashVisitorToken(`visitor-${suffix}`),
      }),
      responder: {
        generateReply: async () => ({
          content: 'Which market is this project for?',
          estimatedCostUSD: 0,
          model: 'integration-model',
          promptVersion: 1,
          tokenUsage: { inputTokens: 2, outputTokens: 4, totalTokens: 6 },
        }),
      },
    })
    const delivered = await service.ingestExternalMessage({
      channel: 'facebook',
      externalAccountId: accountExternalId,
      externalMessageId: `message-${suffix}`,
      externalSenderId: senderExternalId,
      externalThreadId,
      locale: 'en',
      text: 'We need facade materials.',
    })
    const persistedConversation = await payload.find({
      collection: 'conversations',
      depth: 0,
      limit: 1,
      overrideAccess: true,
      where: { externalThreadId: { equals: externalThreadId } },
    })
    const conversationId = persistedConversation.docs[0]?.id
    if (!conversationId) throw new Error('Expected persisted external conversation')
    const intent = await persistedIntent(conversationId)
    const queue = new PayloadJobQueue({ payload })
    const job = await queue.claimNext([PLATFORM_CONVERSATION_DELIVERY_JOB_TYPE])
    if (!job) throw new Error('Expected one platform conversation delivery Job')
    const authority = new PayloadPlatformConversationDeliveryAuthority(payload)
    const claimResult = await authority.claimDelivery(intent, {
      jobId: job.id,
      leaseExpiresAt: job.leaseExpiresAt,
      ownerToken: job.ownerToken,
    })
    if (claimResult.status !== 'claimed') throw new Error('Expected delivery claim')
    const renewedJob = await queue.renew(job)
    expect(Date.parse(renewedJob.leaseExpiresAt)).toBeGreaterThanOrEqual(
      Date.parse(job.leaseExpiresAt),
    )
    await expect(authority.markProviderIOStarted(claimResult.claim)).resolves.toEqual({
      status: 'fenced',
    })

    await expect(
      service.requestHandoff({
        idempotencyKey: `handoff-while-sending-${suffix}`,
        reason: 'operator requested',
        sessionId: delivered.session.id,
        source: 'visitor',
      }),
    ).rejects.toMatchObject({ code: 'conflict', retryable: true })

    await authority.releaseDelivery(claimResult.claim, {
      deliveryKey: intent.transport.deliveryKey,
      platform: intent.transport.platform,
      status: 'delivery_unknown',
    })
    await expect(
      service.requestHandoff({
        idempotencyKey: `handoff-after-release-${suffix}`,
        reason: 'operator requested',
        sessionId: delivered.session.id,
        source: 'visitor',
      }),
    ).resolves.toMatchObject({ handoffStatus: 'handoff_requested' })
  })

  it('queues and delivers an operator reply only after a real platform conversation takeover', async () => {
    const suffix = randomUUID().replaceAll('-', '')
    const digits = randomUUID().replace(/\D/gu, '').padEnd(20, '7')
    const accountExternalId = `51${digits.slice(0, 14)}`
    const senderExternalId = `61${digits.slice(0, 14)}`
    const externalThreadId = `${accountExternalId}:${senderExternalId}`
    testThreads.push(externalThreadId)
    await createPlatformAccount({
      accountExternalId,
      accountKind: 'instagram-professional',
      aiAutoReplyEnabled: false,
    })
    const operator = await payload.create({
      collection: 'users',
      context: { skipAudit: true },
      data: {
        email: `task13-dm-operator-${suffix}@example.invalid`,
        password: 'task13-dm-operator-integration-password',
        role: 'operator',
      },
      overrideAccess: true,
    })
    testUserIDs.push(operator.id)
    const responder = {
      generateReply: async () => ({
        handoff: { reason: 'high_risk_topic', source: 'ai_policy' as const },
      }),
    }
    const visitorService = createConversationService({
      leadSink: new PayloadConversationLeadSink(),
      repository: new PayloadConversationRepository({
        payload,
        sessionTokenHash: hashVisitorToken(`visitor-${suffix}`),
      }),
      responder,
    })
    const inbound = await visitorService.ingestExternalMessage({
      channel: 'instagram',
      externalAccountId: accountExternalId,
      externalMessageId: `message-${suffix}`,
      externalSenderId: senderExternalId,
      externalThreadId,
      locale: 'en',
      text: 'Please connect me with a sales representative.',
    })
    expect(inbound.session.handoffStatus).toBe('handoff_requested')

    const operatorService = createConversationService({
      repository: new PayloadConversationRepository({ actor: operator, payload }),
      responder,
    })
    await expect(
      operatorService.takeOver({
        idempotencyKey: `takeover-${suffix}`,
        sessionId: inbound.session.id,
      }),
    ).resolves.toMatchObject({ handoffStatus: 'human_active' })
    const replied = await operatorService.sendOperatorMessage({
      idempotencyKey: `operator-reply-${suffix}`,
      sessionId: inbound.session.id,
      text: 'Thank you. I have taken over and will help with your project requirements.',
    })
    expect(replied.messages.at(-1)).toMatchObject({ author: 'operator', status: 'pending' })

    const conversation = await payload.find({
      collection: 'conversations',
      depth: 0,
      limit: 1,
      overrideAccess: true,
      where: { externalThreadId: { equals: externalThreadId } },
    })
    const conversationId = conversation.docs[0]?.id
    if (!conversationId) throw new Error('Expected persisted Instagram conversation')
    const intent = await persistedIntent(conversationId)
    const queue = new PayloadJobQueue({ payload })
    const job = await queue.claimNext([PLATFORM_CONVERSATION_DELIVERY_JOB_TYPE])
    if (!job) throw new Error('Expected one operator delivery Job')
    const send = vi.fn(async (request) => ({
      deliveryKey: request.deliveryKey,
      platform: request.platform,
      status: 'accepted' as const,
    }))
    const handler = createPlatformConversationDeliveryJobHandler({
      delivery: createPlatformConversationDeliveryService({
        authority: new PayloadPlatformConversationDeliveryAuthority(payload),
        outbound: {
          recoverUnknownOutcome: async (request) => ({
            deliveryKey: request.deliveryKey,
            platform: request.platform,
            status: 'delivery_unknown' as const,
          }),
          send,
        },
      }),
      payload,
    })
    await handler(job, {
      assertLease: () => undefined,
      renewLease: async () => job,
      signal: new AbortController().signal,
    })
    await queue.complete(job)

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        accountExternalId,
        platform: 'instagram',
        recipientExternalId: senderExternalId,
      }),
    )
    await expect(
      payload.findByID({ collection: 'messages', id: intent.replyId, overrideAccess: true }),
    ).resolves.toMatchObject({ author: 'operator', status: 'sent' })
    await expect(
      operatorService.resolve({
        idempotencyKey: `resolve-${suffix}`,
        sessionId: inbound.session.id,
      }),
    ).resolves.toMatchObject({ handoffStatus: 'resolved' })
  })
})
