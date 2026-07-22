import { createHash, randomUUID } from 'node:crypto'

import type { PostgresAdapter } from '@payloadcms/db-postgres'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { getPayload, type Payload } from 'payload'

import config from '@/payload.config'
import { PayloadJobQueue } from '@/modules/jobs/claim'
import {
  createPlatformEventJobHandler,
  PLATFORM_EVENT_JOB_TYPE,
} from '@/modules/platforms/eventJobs'
import { PayloadMetaConversationPort } from '@/modules/platforms/payloadConversationPort'
import { PayloadPlatformEventRepository } from '@/modules/platforms/payloadEventRepository'
import type { PersistedPlatformEvent } from '@/modules/platforms/ports'
import type { NormalizedInboundMessage } from '@/modules/platforms/types'

let payload: Payload
const testKeys: string[] = []
const testThreads: string[] = []

const pool = (): PostgresAdapter['pool'] => (payload.db as unknown as PostgresAdapter).pool

const digest = (value: string): string => createHash('sha256').update(value).digest('hex')

type PersistedInboundEvent = Omit<PersistedPlatformEvent, 'event'> & {
  event: NormalizedInboundMessage
}

const createInboundEvent = (
  suffix: string,
  text = 'Please share available facade finishes.',
): PersistedInboundEvent => {
  const event: NormalizedInboundMessage = {
    accountExternalId: `page-${suffix}`,
    content: { messageType: 'text', text },
    externalEventId: `message-${suffix}`,
    idempotencyKey: `facebook-messenger:message-${suffix}`,
    kind: 'inbound-message',
    occurredAt: '2026-07-22T00:00:00.000Z',
    platform: 'facebook-messenger',
    recipientExternalId: `page-${suffix}`,
    senderExternalId: `sender-${suffix}`,
  }
  const persisted: PersistedInboundEvent = {
    event,
    eventDigest: digest(JSON.stringify(event)),
    rawPayloadDigest: digest(`raw-${suffix}`),
  }
  testKeys.push(event.idempotencyKey)
  testThreads.push(`${event.accountExternalId}:${event.senderExternalId}`)
  return persisted
}

describe.sequential('Task 13 durable inbound platform event delivery', () => {
  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required')
    payload = await getPayload({ config, disableOnInit: true, key: 'task13-platform-inbound' })
  })

  afterEach(async () => {
    if (testKeys.length === 0 && testThreads.length === 0) return

    const conversations = await payload.find({
      collection: 'conversations',
      depth: 0,
      limit: 100,
      overrideAccess: true,
      where: { externalThreadId: { in: testThreads } },
    })
    const conversationIDs = conversations.docs.map(({ id }) => id)
    const visitorIDs = conversations.docs.map(({ visitorSession }) =>
      typeof visitorSession === 'number' ? visitorSession : visitorSession.id,
    )
    const jobs = await pool().query<{ id: number }>(
      `SELECT id FROM jobs WHERE type = $1 AND idempotency_key = ANY($2::text[])`,
      [PLATFORM_EVENT_JOB_TYPE, testKeys],
    )
    const documentIDs = [...conversationIDs, ...visitorIDs, ...jobs.rows.map(({ id }) => id)].map(String)

    if (conversationIDs.length > 0) {
      await pool().query('DELETE FROM conversation_commands WHERE conversation_id = ANY($1::int[])', [conversationIDs])
      await pool().query('DELETE FROM conversations WHERE id = ANY($1::int[])', [conversationIDs])
    }
    if (visitorIDs.length > 0) {
      await pool().query('DELETE FROM visitor_sessions WHERE id = ANY($1::int[])', [visitorIDs])
    }
    if (jobs.rows.length > 0) {
      await pool().query('DELETE FROM jobs WHERE id = ANY($1::int[])', [jobs.rows.map(({ id }) => id)])
    }
    if (documentIDs.length > 0) {
      await pool().query(
        `DELETE FROM audit_logs
         WHERE (
           resource IN ('conversations', 'handoffs', 'jobs', 'messages', 'visitor-sessions')
           OR resource LIKE 'conversation.handoff.%'
         )
           AND document_id = ANY($1::text[])`,
        [documentIDs],
      )
    }
    testKeys.length = 0
    testThreads.length = 0
  })

  afterAll(async () => {
    await payload?.destroy()
  })

  it('atomically rejects a semantic conflict without retaining earlier batch writes', async () => {
    const repository = new PayloadPlatformEventRepository({ payload })
    const suffix = randomUUID()
    const first = createInboundEvent(`${suffix}-first`, 'First payload')
    const second = createInboundEvent(`${suffix}-second`, 'Must roll back')
    const conflicting: PersistedPlatformEvent = {
      ...first,
      event: { ...first.event, content: { messageType: 'text', text: 'Changed semantic payload' } },
      eventDigest: digest(`changed-${suffix}`),
    }

    await expect(Promise.all([
      repository.enqueueBatch([first]),
      repository.enqueueBatch([first]),
    ])).resolves.toEqual(expect.arrayContaining([
      [{ idempotencyKey: first.event.idempotencyKey, status: 'accepted' }],
      [{ idempotencyKey: first.event.idempotencyKey, status: 'duplicate' }],
    ]))
    await expect(repository.enqueueBatch([
      { ...first, rawPayloadDigest: digest(`raw-retry-${suffix}`) },
    ])).resolves.toEqual([
      { idempotencyKey: first.event.idempotencyKey, status: 'duplicate' },
    ])
    await expect(repository.enqueueBatch([second, conflicting])).resolves.toEqual([
      { idempotencyKey: first.event.idempotencyKey, status: 'conflict' },
    ])

    const rows = await pool().query<{ idempotency_key: string }>(
      `SELECT idempotency_key FROM jobs
       WHERE type = $1 AND idempotency_key = ANY($2::text[])
       ORDER BY idempotency_key`,
      [PLATFORM_EVENT_JOB_TYPE, [first.event.idempotencyKey, second.event.idempotencyKey]],
    )
    expect(rows.rows).toEqual([{ idempotency_key: first.event.idempotencyKey }])
  })

  it('delivers a queued Meta event once to the authoritative conversation service', async () => {
    const repository = new PayloadPlatformEventRepository({ payload })
    const persisted = createInboundEvent(randomUUID())
    const queue = new PayloadJobQueue({ payload })
    const conversations = new PayloadMetaConversationPort({ payload })
    const handler = createPlatformEventJobHandler({ conversations })

    await expect(repository.enqueueBatch([persisted])).resolves.toEqual([
      { idempotencyKey: persisted.event.idempotencyKey, status: 'accepted' },
    ])
    const job = await queue.claimNext()
    if (!job) throw new Error('Expected the queued platform event to be claimable')

    await handler(job, {
      assertLease: () => undefined,
      renewLease: async () => job,
      signal: new AbortController().signal,
    })

    const conversation = await payload.find({
      collection: 'conversations',
      depth: 0,
      limit: 1,
      overrideAccess: true,
      where: { externalThreadId: { equals: `${persisted.event.accountExternalId}:${persisted.event.senderExternalId}` } },
    })
    expect(conversation.docs[0]).toMatchObject({
      channel: 'facebook',
      handoffStatus: 'handoff_requested',
    })
    const messages = await payload.find({
      collection: 'messages',
      depth: 0,
      limit: 10,
      overrideAccess: true,
      where: { conversation: { equals: conversation.docs[0]?.id } },
    })
    expect(messages.docs).toEqual([
      expect.objectContaining({
        author: 'visitor',
        content: persisted.event.content.text,
        externalMessageId: persisted.event.externalEventId,
        idempotencyKey: `platform-message:${persisted.event.idempotencyKey}`,
      }),
    ])

    // Model a worker dying after the conversation transaction committed but before the
    // Job row could be marked succeeded. A later delivery must be a no-op.
    await expect(conversations.writeInboundMessage(persisted.event)).resolves.toEqual({
      idempotencyKey: persisted.event.idempotencyKey,
      status: 'duplicate',
    })
    await expect(payload.count({
      collection: 'messages',
      overrideAccess: true,
      where: { conversation: { equals: conversation.docs[0]?.id } },
    })).resolves.toEqual({ totalDocs: 1 })
    await expect(payload.count({
      collection: 'audit-logs',
      overrideAccess: true,
      where: {
        and: [
          { documentId: { equals: String(conversation.docs[0]?.id) } },
          { resource: { equals: 'conversation.handoff.handoff_requested' } },
        ],
      },
    })).resolves.toEqual({ totalDocs: 1 })
    await queue.complete(job)
    await expect(queue.getByID(job.id)).resolves.toMatchObject({ status: 'succeeded' })
  })

  it('persists a distinct follow-up from the same Meta sender after handoff is requested', async () => {
    const repository = new PayloadPlatformEventRepository({ payload })
    const first = createInboundEvent(randomUUID(), 'First customer message.')
    const followUpEvent: NormalizedInboundMessage = {
      ...first.event,
      content: { messageType: 'text', text: 'Second customer message before an operator responds.' },
      externalEventId: `${first.event.externalEventId}-follow-up`,
      idempotencyKey: `${first.event.idempotencyKey}-follow-up`,
    }
    const followUp: PersistedInboundEvent = {
      event: followUpEvent,
      eventDigest: digest(JSON.stringify(followUpEvent)),
      rawPayloadDigest: digest(`raw-${followUpEvent.externalEventId}`),
    }
    testKeys.push(followUp.event.idempotencyKey)
    const queue = new PayloadJobQueue({ payload })
    const conversations = new PayloadMetaConversationPort({ payload })
    const handler = createPlatformEventJobHandler({ conversations })

    await expect(repository.enqueueBatch([first])).resolves.toEqual([
      { idempotencyKey: first.event.idempotencyKey, status: 'accepted' },
    ])
    const firstJob = await queue.claimNext()
    if (!firstJob) throw new Error('Expected the first platform event to be claimable')
    await handler(firstJob, {
      assertLease: () => undefined,
      renewLease: async () => firstJob,
      signal: new AbortController().signal,
    })
    await queue.complete(firstJob)

    await expect(repository.enqueueBatch([followUp])).resolves.toEqual([
      { idempotencyKey: followUp.event.idempotencyKey, status: 'accepted' },
    ])
    const followUpJob = await queue.claimNext()
    if (!followUpJob) throw new Error('Expected the follow-up platform event to be claimable')
    await expect(handler(followUpJob, {
      assertLease: () => undefined,
      renewLease: async () => followUpJob,
      signal: new AbortController().signal,
    })).resolves.toBeUndefined()
    await queue.complete(followUpJob)

    const conversation = await payload.find({
      collection: 'conversations',
      depth: 0,
      limit: 1,
      overrideAccess: true,
      where: { externalThreadId: { equals: `${first.event.accountExternalId}:${first.event.senderExternalId}` } },
    })
    expect(conversation.docs[0]).toMatchObject({ handoffStatus: 'handoff_requested' })
    const messages = await payload.find({
      collection: 'messages',
      depth: 0,
      limit: 10,
      overrideAccess: true,
      where: { conversation: { equals: conversation.docs[0]?.id } },
    })
    expect(messages.docs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        externalMessageId: first.event.externalEventId,
        idempotencyKey: `platform-message:${first.event.idempotencyKey}`,
      }),
      expect.objectContaining({
        externalMessageId: followUp.event.externalEventId,
        idempotencyKey: `platform-message:${followUp.event.idempotencyKey}`,
      }),
    ]))
    expect(messages.docs).toHaveLength(2)
    await expect(queue.getByID(followUpJob.id)).resolves.toMatchObject({ status: 'succeeded' })
  })

  it('recovers an unacknowledged committed delivery after the worker lease expires', async () => {
    const repository = new PayloadPlatformEventRepository({ payload })
    const persisted = createInboundEvent(randomUUID())
    let now = new Date('2099-01-01T00:00:00.000Z')
    const clock = () => now
    const firstQueue = new PayloadJobQueue({ clock, leaseMs: 1_000, payload })
    const reclaimedQueue = new PayloadJobQueue({ clock, leaseMs: 1_000, payload })
    const conversations = new PayloadMetaConversationPort({ payload })
    const handler = createPlatformEventJobHandler({ conversations })

    await expect(repository.enqueueBatch([persisted])).resolves.toEqual([
      { idempotencyKey: persisted.event.idempotencyKey, status: 'accepted' },
    ])
    const firstAttempt = await firstQueue.claimNext()
    if (!firstAttempt) throw new Error('Expected the queued platform event to be claimable')

    // The business transaction commits, then the worker is terminated before it can ACK the Job.
    await handler(firstAttempt, {
      assertLease: () => undefined,
      renewLease: async () => firstAttempt,
      signal: new AbortController().signal,
    })

    now = new Date(now.getTime() + 1_001)
    const reclaimedAttempt = await reclaimedQueue.claimNext()
    if (!reclaimedAttempt) throw new Error('Expected the expired platform event lease to be reclaimed')
    expect(reclaimedAttempt).toMatchObject({ attempts: 2, id: firstAttempt.id })

    await handler(reclaimedAttempt, {
      assertLease: () => undefined,
      renewLease: async () => reclaimedAttempt,
      signal: new AbortController().signal,
    })
    await reclaimedQueue.complete(reclaimedAttempt)

    const conversation = await payload.find({
      collection: 'conversations',
      depth: 0,
      limit: 1,
      overrideAccess: true,
      where: { externalThreadId: { equals: `${persisted.event.accountExternalId}:${persisted.event.senderExternalId}` } },
    })
    await expect(payload.count({
      collection: 'messages',
      overrideAccess: true,
      where: { conversation: { equals: conversation.docs[0]?.id } },
    })).resolves.toEqual({ totalDocs: 1 })
    await expect(reclaimedQueue.getByID(reclaimedAttempt.id)).resolves.toMatchObject({
      attempts: 2,
      status: 'succeeded',
    })
  })
})
