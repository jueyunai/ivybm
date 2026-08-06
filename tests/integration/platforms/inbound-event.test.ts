import { createHash, randomUUID } from 'node:crypto'

import type { MigrateDownArgs, PostgresAdapter } from '@payloadcms/db-postgres'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { createLocalReq, getPayload, initTransaction, killTransaction, type Payload } from 'payload'

import config from '@/payload.config'
import { down as removeTikTokChannel } from '@/migrations/20260725_051208_task13_tiktok_channel'
import { PayloadJobQueue } from '@/modules/jobs/claim'
import {
  createPlatformEventJobHandler,
  PLATFORM_EVENT_JOB_TYPE,
} from '@/modules/platforms/eventJobs'
import { externalMessagePersistenceKey } from '@/modules/conversations/externalDeliveryIdentity'
import { PayloadPlatformConversationPort } from '@/modules/platforms/payloadConversationPort'
import { PayloadPlatformMessagingAccountAuthorizer } from '@/modules/platforms/payloadMessagingAccountAuthorizer'
import { PayloadPlatformEventRepository } from '@/modules/platforms/payloadEventRepository'
import type { PersistedPlatformEvent } from '@/modules/platforms/ports'
import {
  platformEventKey,
  platformEventKeyV2,
  type MessagingPlatform,
  type NormalizedInboundMessage,
} from '@/modules/platforms/types'

let payload: Payload
const allowAllAccounts = { assertCanReceive: async () => undefined }
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
  platform: MessagingPlatform = 'facebook-messenger',
): PersistedInboundEvent => {
  const accountExternalId = `account-${suffix}`
  const event: NormalizedInboundMessage = {
    accountExternalId,
    content: { messageType: 'text', text },
    externalEventId: `message-${suffix}`,
    idempotencyKey: platformEventKeyV2(platform, accountExternalId, `message-${suffix}`),
    kind: 'inbound-message',
    occurredAt: '2026-07-22T00:00:00.000Z',
    platform,
    recipientExternalId: accountExternalId,
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

const createLegacyInboundEvent = (
  suffix: string,
  text = 'Pre-upgrade fixture message.',
): PersistedInboundEvent => {
  const persisted = createInboundEvent(suffix, text)
  const legacyKey = platformEventKey(persisted.event.platform, persisted.event.externalEventId)
  persisted.event.idempotencyKey = legacyKey
  persisted.eventDigest = digest(JSON.stringify(persisted.event))
  testKeys[testKeys.length - 1] = legacyKey
  return persisted
}

const createAccountScopedInboundEvent = ({
  accountExternalId,
  externalEventId,
  senderExternalId,
  text,
}: {
  accountExternalId: string
  externalEventId: string
  senderExternalId: string
  text: string
}): PersistedInboundEvent => {
  const event: NormalizedInboundMessage = {
    accountExternalId,
    content: { messageType: 'text', text },
    externalEventId,
    idempotencyKey: platformEventKeyV2('facebook-messenger', accountExternalId, externalEventId),
    kind: 'inbound-message',
    occurredAt: '2026-07-22T00:00:00.000Z',
    platform: 'facebook-messenger',
    recipientExternalId: accountExternalId,
    senderExternalId,
  }
  const persisted: PersistedInboundEvent = {
    event,
    eventDigest: digest(JSON.stringify(event)),
    rawPayloadDigest: digest(`raw-${accountExternalId}-${externalEventId}`),
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
    const documentIDs = [...conversationIDs, ...visitorIDs, ...jobs.rows.map(({ id }) => id)].map(
      String,
    )

    if (conversationIDs.length > 0) {
      await pool().query(
        'DELETE FROM conversation_commands WHERE conversation_id = ANY($1::int[])',
        [conversationIDs],
      )
      await pool().query('DELETE FROM conversations WHERE id = ANY($1::int[])', [conversationIDs])
    }
    if (visitorIDs.length > 0) {
      await pool().query('DELETE FROM visitor_sessions WHERE id = ANY($1::int[])', [visitorIDs])
    }
    if (jobs.rows.length > 0) {
      await pool().query('DELETE FROM jobs WHERE id = ANY($1::int[])', [
        jobs.rows.map(({ id }) => id),
      ])
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

    await expect(
      Promise.all([repository.enqueueBatch([first]), repository.enqueueBatch([first])]),
    ).resolves.toEqual(
      expect.arrayContaining([
        [{ idempotencyKey: first.event.idempotencyKey, status: 'accepted' }],
        [{ idempotencyKey: first.event.idempotencyKey, status: 'duplicate' }],
      ]),
    )
    await expect(
      repository.enqueueBatch([{ ...first, rawPayloadDigest: digest(`raw-retry-${suffix}`) }]),
    ).resolves.toEqual([{ idempotencyKey: first.event.idempotencyKey, status: 'duplicate' }])
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

  it('rejects a legacy key when it is presented as a new event to the durable queue', async () => {
    const repository = new PayloadPlatformEventRepository({ payload })
    const legacy = createLegacyInboundEvent(randomUUID())

    await expect(repository.enqueueBatch([legacy])).rejects.toThrow(
      'Platform event idempotency key is invalid',
    )
  })

  it('delivers a queued Meta event once to the authoritative conversation service', async () => {
    const repository = new PayloadPlatformEventRepository({ payload })
    const persisted = createInboundEvent(randomUUID())
    const queue = new PayloadJobQueue({ payload })
    const conversations = new PayloadPlatformConversationPort({ payload })
    const handler = createPlatformEventJobHandler({
      accountAuthorizer: allowAllAccounts,
      conversations,
    })

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
      where: {
        externalThreadId: {
          equals: `${persisted.event.accountExternalId}:${persisted.event.senderExternalId}`,
        },
      },
    })
    expect(conversation.docs[0]).toMatchObject({
      channel: 'facebook',
      handoffStatus: 'handoff_requested',
    })
    const visitorSessionID =
      typeof conversation.docs[0]?.visitorSession === 'number'
        ? conversation.docs[0]?.visitorSession
        : conversation.docs[0]?.visitorSession?.id
    const visitor = visitorSessionID
      ? await payload.findByID({
          collection: 'visitor-sessions',
          id: visitorSessionID,
          overrideAccess: true,
        })
      : undefined
    expect(visitor).toMatchObject({
      idempotencyKey: `platform-session:${persisted.event.platform}:${digest(
        `${persisted.event.platform}\u0000${persisted.event.accountExternalId}\u0000${persisted.event.senderExternalId}`,
      )}`,
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
        idempotencyKey: externalMessagePersistenceKey(
          'facebook',
          persisted.event.accountExternalId,
          persisted.event.externalEventId,
        ),
      }),
    ])

    // Model a worker dying after the conversation transaction committed but before the
    // Job row could be marked succeeded. A later delivery must be a no-op.
    await expect(conversations.writeInboundMessage(persisted.event)).resolves.toEqual({
      idempotencyKey: persisted.event.idempotencyKey,
      status: 'duplicate',
    })
    await expect(
      payload.count({
        collection: 'messages',
        overrideAccess: true,
        where: { conversation: { equals: conversation.docs[0]?.id } },
      }),
    ).resolves.toEqual({ totalDocs: 1 })
    // A connector or queue may rotate its transport receipt key while retrying the
    // same authenticated platform message. The conversation service must derive
    // its own durable identity from the external message and thread instead.
    const changedTransportKey = `${persisted.event.idempotencyKey}:transport-retry`
    await expect(
      conversations.writeInboundMessage({
        ...persisted.event,
        idempotencyKey: changedTransportKey,
      }),
    ).resolves.toEqual({ idempotencyKey: changedTransportKey, status: 'duplicate' })
    await expect(
      payload.count({
        collection: 'messages',
        overrideAccess: true,
        where: { conversation: { equals: conversation.docs[0]?.id } },
      }),
    ).resolves.toEqual({ totalDocs: 1 })
    await expect(
      payload.count({
        collection: 'audit-logs',
        overrideAccess: true,
        where: {
          and: [
            { documentId: { equals: String(conversation.docs[0]?.id) } },
            { resource: { equals: 'conversation.handoff.handoff_requested' } },
          ],
        },
      }),
    ).resolves.toEqual({ totalDocs: 1 })
    await queue.complete(job)
    await expect(queue.getByID(job.id)).resolves.toMatchObject({ status: 'succeeded' })
  })

  it('runs a pre-upgrade v1 Job through the current worker without opening v1 ingress', async () => {
    const persisted = createLegacyInboundEvent(randomUUID())
    const now = new Date('2026-07-22T00:00:00.000Z').toISOString()
    await pool().query(
      `INSERT INTO jobs (
        type, idempotency_key, payload, status, attempts, max_attempts, next_run_at,
        manual_retry_count, updated_at, created_at
      ) VALUES ($1, $2, $3::jsonb, 'pending', 0, 5, $4, 0, $4, $4)`,
      [PLATFORM_EVENT_JOB_TYPE, persisted.event.idempotencyKey, JSON.stringify(persisted), now],
    )
    const queue = new PayloadJobQueue({ payload })
    const conversations = new PayloadPlatformConversationPort({ payload })
    const handler = createPlatformEventJobHandler({
      accountAuthorizer: allowAllAccounts,
      conversations,
    })
    const job = await queue.claimNext()
    if (!job) throw new Error('Expected the pre-upgrade Job to be claimable')

    await handler(job, {
      assertLease: () => undefined,
      renewLease: async () => job,
      signal: new AbortController().signal,
    })
    await queue.complete(job)

    const conversation = await payload.find({
      collection: 'conversations',
      depth: 0,
      limit: 1,
      overrideAccess: true,
      where: {
        externalThreadId: {
          equals: `${persisted.event.accountExternalId}:${persisted.event.senderExternalId}`,
        },
      },
    })
    expect(conversation.docs[0]).toMatchObject({ channel: 'facebook' })
    await expect(
      payload.count({
        collection: 'messages',
        overrideAccess: true,
        where: { conversation: { equals: conversation.docs[0]?.id } },
      }),
    ).resolves.toEqual({ totalDocs: 1 })
    await expect(queue.getByID(job.id)).resolves.toMatchObject({ status: 'succeeded' })
  })

  it('rejects an account disabled after the event is claimed but before dispatch', async () => {
    const persisted = createInboundEvent(randomUUID())
    const repository = new PayloadPlatformEventRepository({ payload })
    const queue = new PayloadJobQueue({ payload })
    const originalEncryptionKey = process.env.PLATFORM_CREDENTIAL_ENCRYPTION_KEY
    process.env.PLATFORM_CREDENTIAL_ENCRYPTION_KEY = 'b'.repeat(64)
    let accountID: number | string | undefined
    let dispatched = false
    const handler = createPlatformEventJobHandler({
      accountAuthorizer: new PayloadPlatformMessagingAccountAuthorizer({ payload }),
      conversations: {
        writeInboundMessage: async () => {
          dispatched = true
          return { idempotencyKey: persisted.event.idempotencyKey, status: 'accepted' }
        },
      },
    })

    try {
      const account = await payload.create({
        collection: 'platform-accounts',
        context: { skipAudit: true },
        data: {
          accountKind: 'facebook-page',
          authorizationRevision: 0,
          authorization: {
            accessToken: `worker-state-change-token-${randomUUID()}`,
            accessTokenConfigured: false,
            appId: null,
            clearAccessToken: false,
            clearRefreshToken: false,
            expiresAt: null,
            refreshToken: null,
            refreshTokenConfigured: false,
            scopes: [],
            state: 'connected',
          },
          capabilities: { messagingInbound: 'pending', publishing: 'not_started' },
          connectionKey: null,
          externalAccountId: persisted.event.accountExternalId,
          name: `Worker state-change Page ${randomUUID()}`,
          notes: null,
          platformFamily: 'meta',
        },
        overrideAccess: true,
      })
      accountID = account.id
      await repository.enqueueBatch([persisted])
      const job = await queue.claimNext()
      if (!job) throw new Error('Expected the connected-account event to be claimable')
      await payload.update({
        collection: 'platform-accounts',
        context: { skipAudit: true },
        data: { authorization: { state: 'disabled' } },
        id: account.id,
        overrideAccess: true,
      })

      await expect(
        handler(job, {
          assertLease: () => undefined,
          renewLease: async () => job,
          signal: new AbortController().signal,
        }),
      ).rejects.toMatchObject({ code: 'account_blocked' })
      expect(dispatched).toBe(false)
    } finally {
      if (accountID !== undefined) {
        await payload.delete({
          collection: 'platform-accounts',
          context: { skipAudit: true },
          id: accountID,
          overrideAccess: true,
        })
      }
      if (originalEncryptionKey === undefined) {
        delete process.env.PLATFORM_CREDENTIAL_ENCRYPTION_KEY
      } else {
        process.env.PLATFORM_CREDENTIAL_ENCRYPTION_KEY = originalEncryptionKey
      }
    }
  })

  it('delivers same-ID messages from different Meta accounts without cross-account deduplication', async () => {
    const repository = new PayloadPlatformEventRepository({ payload })
    const sharedMessageID = `shared-provider-message-${randomUUID()}`
    const first = createAccountScopedInboundEvent({
      accountExternalId: `account-a-${randomUUID()}`,
      externalEventId: sharedMessageID,
      senderExternalId: 'sender-shared',
      text: 'First account message.',
    })
    const second = createAccountScopedInboundEvent({
      accountExternalId: `account-b-${randomUUID()}`,
      externalEventId: sharedMessageID,
      senderExternalId: 'sender-shared',
      text: 'Second account message.',
    })
    const queue = new PayloadJobQueue({ payload })
    const conversations = new PayloadPlatformConversationPort({ payload })
    const handler = createPlatformEventJobHandler({
      accountAuthorizer: allowAllAccounts,
      conversations,
    })

    await expect(
      Promise.all([repository.enqueueBatch([first]), repository.enqueueBatch([second])]),
    ).resolves.toEqual(
      expect.arrayContaining([
        [{ idempotencyKey: first.event.idempotencyKey, status: 'accepted' }],
        [{ idempotencyKey: second.event.idempotencyKey, status: 'accepted' }],
      ]),
    )

    const firstJob = await queue.claimNext()
    const secondJob = await queue.claimNext()
    if (!firstJob || !secondJob)
      throw new Error('Expected both account-scoped events to be claimable')
    for (const job of [firstJob, secondJob]) {
      await handler(job, {
        assertLease: () => undefined,
        renewLease: async () => job,
        signal: new AbortController().signal,
      })
      await queue.complete(job)
    }

    const persistedConversations = await payload.find({
      collection: 'conversations',
      depth: 0,
      limit: 10,
      overrideAccess: true,
      where: { externalThreadId: { in: testThreads } },
    })
    expect(persistedConversations.docs).toHaveLength(2)

    for (const conversation of persistedConversations.docs) {
      const messages = await payload.find({
        collection: 'messages',
        depth: 0,
        limit: 10,
        overrideAccess: true,
        where: { conversation: { equals: conversation.id } },
      })
      expect(messages.docs).toHaveLength(1)
      expect(messages.docs[0]).toMatchObject({ externalMessageId: sharedMessageID })
    }
  })

  it('persists an already-normalized TikTok event through the same durable path', async () => {
    // This exercises only the internal channel and Job contract. It does not
    // manufacture a TikTok webhook fixture or claim that its DM API is available.
    const repository = new PayloadPlatformEventRepository({ payload })
    const persisted = createInboundEvent(
      randomUUID(),
      'Please share facade panel samples for our project.',
      'tiktok',
    )
    const queue = new PayloadJobQueue({ payload })
    const conversations = new PayloadPlatformConversationPort({
      allowTikTokNormalizedDelivery: true,
      payload,
    })
    const handler = createPlatformEventJobHandler({
      accountAuthorizer: allowAllAccounts,
      conversations,
    })

    await expect(repository.enqueueBatch([persisted])).resolves.toEqual([
      { idempotencyKey: persisted.event.idempotencyKey, status: 'accepted' },
    ])
    const job = await queue.claimNext()
    if (!job) throw new Error('Expected the TikTok platform event to be claimable')

    await handler(job, {
      assertLease: () => undefined,
      renewLease: async () => job,
      signal: new AbortController().signal,
    })
    await queue.complete(job)

    const conversation = await payload.find({
      collection: 'conversations',
      depth: 0,
      limit: 1,
      overrideAccess: true,
      where: {
        externalThreadId: {
          equals: `${persisted.event.accountExternalId}:${persisted.event.senderExternalId}`,
        },
      },
    })
    expect(conversation.docs[0]).toMatchObject({
      channel: 'tiktok',
      handoffStatus: 'handoff_requested',
    })
    await expect(
      payload.count({
        collection: 'messages',
        overrideAccess: true,
        where: { conversation: { equals: conversation.docs[0]?.id } },
      }),
    ).resolves.toEqual({ totalDocs: 1 })
  })

  it('fails closed for TikTok delivery unless a future reviewed connector explicitly enables it', async () => {
    const persisted = createInboundEvent(
      randomUUID(),
      'This must not enter a TikTok conversation through the default worker path.',
      'tiktok',
    )
    const conversations = new PayloadPlatformConversationPort({ payload })

    await expect(conversations.writeInboundMessage(persisted.event)).rejects.toThrow(
      'TikTok normalized delivery is not enabled',
    )
  })

  it('refuses a TikTok channel schema downgrade while TikTok conversations exist', async () => {
    const persisted = createInboundEvent(
      randomUUID(),
      'The migration must preserve this TikTok conversation.',
      'tiktok',
    )
    const conversations = new PayloadPlatformConversationPort({
      allowTikTokNormalizedDelivery: true,
      payload,
    })
    await conversations.writeInboundMessage(persisted.event)

    const request = await createLocalReq({}, payload)
    await initTransaction(request)
    const transactionID = await request.transactionID
    const transaction = transactionID
      ? (payload.db as unknown as PostgresAdapter).sessions[String(transactionID)]?.db
      : undefined
    if (!transaction) throw new Error('Expected an isolated migration transaction')

    try {
      await expect(
        removeTikTokChannel({
          db: transaction as MigrateDownArgs['db'],
          payload,
          req: request,
        }),
      ).rejects.toThrow('Cannot roll back Task 13 TikTok channel migration')
    } finally {
      await killTransaction(request)
    }

    // The failed downgrade must roll back entirely: the current application can
    // still read the durable conversation and its message after the refusal.
    await expect(
      payload.count({
        collection: 'conversations',
        overrideAccess: true,
        where: {
          externalThreadId: {
            equals: `${persisted.event.accountExternalId}:${persisted.event.senderExternalId}`,
          },
        },
      }),
    ).resolves.toEqual({ totalDocs: 1 })
  })

  it('refuses a TikTok channel schema downgrade while a TikTok Job remains actionable', async () => {
    const repository = new PayloadPlatformEventRepository({ payload })
    const persisted = createInboundEvent(
      randomUUID(),
      'The migration must preserve this pending TikTok delivery.',
      'tiktok',
    )
    await repository.enqueueBatch([persisted])

    const attemptDown = async (): Promise<void> => {
      const request = await createLocalReq({}, payload)
      await initTransaction(request)
      const transactionID = await request.transactionID
      const transaction = transactionID
        ? (payload.db as unknown as PostgresAdapter).sessions[String(transactionID)]?.db
        : undefined
      if (!transaction) throw new Error('Expected an isolated migration transaction')
      try {
        await removeTikTokChannel({
          db: transaction as MigrateDownArgs['db'],
          payload,
          req: request,
        })
      } finally {
        await killTransaction(request)
      }
    }

    for (const status of ['pending', 'processing', 'failed', 'dead']) {
      await pool().query('UPDATE jobs SET status = $1 WHERE type = $2 AND idempotency_key = $3', [
        status,
        PLATFORM_EVENT_JOB_TYPE,
        persisted.event.idempotencyKey,
      ])
      await expect(attemptDown()).rejects.toThrow(
        'TikTok sessions, conversations, or actionable Jobs exist',
      )
    }

    await pool().query('UPDATE jobs SET status = $1 WHERE type = $2 AND idempotency_key = $3', [
      'succeeded',
      PLATFORM_EVENT_JOB_TYPE,
      persisted.event.idempotencyKey,
    ])
    await expect(attemptDown()).resolves.toBeUndefined()
  })

  it('persists a distinct follow-up from the same Meta sender after handoff is requested', async () => {
    const repository = new PayloadPlatformEventRepository({ payload })
    const first = createInboundEvent(randomUUID(), 'First customer message.')
    const followUpExternalEventID = `${first.event.externalEventId}-follow-up`
    const followUpEvent: NormalizedInboundMessage = {
      ...first.event,
      content: {
        messageType: 'text',
        text: 'Second customer message before an operator responds.',
      },
      externalEventId: followUpExternalEventID,
      idempotencyKey: platformEventKeyV2(
        first.event.platform,
        first.event.accountExternalId,
        followUpExternalEventID,
      ),
    }
    const followUp: PersistedInboundEvent = {
      event: followUpEvent,
      eventDigest: digest(JSON.stringify(followUpEvent)),
      rawPayloadDigest: digest(`raw-${followUpEvent.externalEventId}`),
    }
    testKeys.push(followUp.event.idempotencyKey)
    const queue = new PayloadJobQueue({ payload })
    const conversations = new PayloadPlatformConversationPort({ payload })
    const handler = createPlatformEventJobHandler({
      accountAuthorizer: allowAllAccounts,
      conversations,
    })

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
    await expect(
      handler(followUpJob, {
        assertLease: () => undefined,
        renewLease: async () => followUpJob,
        signal: new AbortController().signal,
      }),
    ).resolves.toBeUndefined()
    await queue.complete(followUpJob)

    const conversation = await payload.find({
      collection: 'conversations',
      depth: 0,
      limit: 1,
      overrideAccess: true,
      where: {
        externalThreadId: {
          equals: `${first.event.accountExternalId}:${first.event.senderExternalId}`,
        },
      },
    })
    expect(conversation.docs[0]).toMatchObject({ handoffStatus: 'handoff_requested' })
    const messages = await payload.find({
      collection: 'messages',
      depth: 0,
      limit: 10,
      overrideAccess: true,
      where: { conversation: { equals: conversation.docs[0]?.id } },
    })
    expect(messages.docs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          externalMessageId: first.event.externalEventId,
          idempotencyKey: externalMessagePersistenceKey(
            'facebook',
            first.event.accountExternalId,
            first.event.externalEventId,
          ),
        }),
        expect.objectContaining({
          externalMessageId: followUp.event.externalEventId,
          idempotencyKey: externalMessagePersistenceKey(
            'facebook',
            followUp.event.accountExternalId,
            followUp.event.externalEventId,
          ),
        }),
      ]),
    )
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
    const conversations = new PayloadPlatformConversationPort({ payload })
    const handler = createPlatformEventJobHandler({
      accountAuthorizer: allowAllAccounts,
      conversations,
    })

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
    if (!reclaimedAttempt)
      throw new Error('Expected the expired platform event lease to be reclaimed')
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
      where: {
        externalThreadId: {
          equals: `${persisted.event.accountExternalId}:${persisted.event.senderExternalId}`,
        },
      },
    })
    await expect(
      payload.count({
        collection: 'messages',
        overrideAccess: true,
        where: { conversation: { equals: conversation.docs[0]?.id } },
      }),
    ).resolves.toEqual({ totalDocs: 1 })
    await expect(reclaimedQueue.getByID(reclaimedAttempt.id)).resolves.toMatchObject({
      attempts: 2,
      status: 'succeeded',
    })
  })
})
