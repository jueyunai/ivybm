import { createHmac } from 'node:crypto'

import { describe, expect, it, vi } from 'vitest'

import { createPlatformEventJobHandler } from '@/modules/platforms/eventJobs'
import type { ClaimedJob } from '@/modules/jobs/contracts'
import { createMetaConnector } from '@/modules/platforms/meta/connector'
import {
  createVerifiedSocialConversationMessagePort,
  type VerifiedSocialConversationPort,
} from '@/modules/platforms/socialContactDelivery'
import { createMetaWebhookVerifier, ingestSignedWebhook } from '@/modules/platforms/webhook'
import metaMessage from '../../fixtures/platforms/meta-message.json'
import { FakePlatformEventRepository } from '../../fakes/platformEventRepository'

const secret = 'fixture-app-secret'
const rawBody = JSON.stringify(metaMessage)
const signature = `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`

const ingestFixture = (repository: FakePlatformEventRepository) =>
  ingestSignedWebhook({
    connector: createMetaConnector(),
    headers: {
      'content-type': 'application/json',
      'x-hub-signature-256': signature,
    },
    nowMs: Date.parse('2024-03-09T16:00:00.123Z'),
    rateLimiter: { consume: async () => true },
    rateLimitKey: 'meta-fixture',
    rawBody: Buffer.from(rawBody),
    repository,
    verifier: createMetaWebhookVerifier(secret),
  })

const queuedFixture = async () => {
  const repository = new FakePlatformEventRepository()
  await ingestFixture(repository)
  return [...repository.events.values()][0]!
}

const claimedJob = (payload: Record<string, unknown>, idempotencyKey: string): ClaimedJob => ({
  attempts: 1,
  completedAt: null,
  createdAt: '2024-03-09T16:00:00.123Z',
  deadAt: null,
  id: 1,
  idempotencyKey,
  lastError: null,
  leaseExpiresAt: '2024-03-09T16:02:00.123Z',
  manualRetryCount: 0,
  maxAttempts: 5,
  nextRunAt: '2024-03-09T16:00:00.123Z',
  ownerToken: 'worker-fixture-token',
  payload,
  status: 'processing',
  type: 'platform.event.dispatch',
  updatedAt: '2024-03-09T16:00:00.123Z',
})

describe('Meta fixture to verified social contact flow', () => {
  it('preserves signature, normalization, Job validation, authorization, and contact identity', async () => {
    const repository = new FakePlatformEventRepository()

    await expect(ingestFixture(repository)).resolves.toEqual({
      accepted: 1,
      duplicates: 0,
      total: 1,
    })
    await expect(ingestFixture(repository)).resolves.toEqual({
      accepted: 0,
      duplicates: 1,
      total: 1,
    })

    const queued = [...repository.events.values()][0]!
    expect(repository.events).toHaveLength(1)
    expect(queued.event).toMatchObject({
      content: {
        messageType: 'text',
        text: 'Please share the available facade finishes.',
      },
      externalEventId: 'm_fixture_meta_1',
      occurredAt: '2024-03-09T16:00:00.123Z',
    })
    expect(JSON.stringify(queued.event)).not.toContain('m_fixture_echo_1')
    const assertCanReceive = vi.fn().mockResolvedValue(undefined)
    const writeVerifiedInboundMessage = vi.fn(async ({ message }) => ({
      idempotencyKey: message.idempotencyKey,
      status: 'accepted' as const,
    }))
    const destination: VerifiedSocialConversationPort = { writeVerifiedInboundMessage }
    const accountAuthorizer = { assertCanReceive }
    const handler = createPlatformEventJobHandler({
      accountAuthorizer,
      conversations: createVerifiedSocialConversationMessagePort({
        accountAuthorizer,
        destination,
        installationNamespace: 'ivybm-production',
      }),
    })
    const job = claimedJob(
      {
        event: queued.event,
        eventDigest: queued.eventDigest,
        rawPayloadDigest: queued.rawPayloadDigest,
      },
      queued.event.idempotencyKey,
    )

    await handler(job, {
      assertLease: () => undefined,
      renewLease: async () => job,
      signal: new AbortController().signal,
    })

    expect(assertCanReceive).toHaveBeenCalledTimes(2)
    expect(assertCanReceive).toHaveBeenNthCalledWith(1, queued.event)
    expect(assertCanReceive).toHaveBeenNthCalledWith(2, {
      accountExternalId: 'PAGE_FIXTURE_1',
      platform: 'facebook-messenger',
    })
    expect(writeVerifiedInboundMessage).toHaveBeenCalledOnce()
    const delivery = writeVerifiedInboundMessage.mock.calls[0]![0]
    expect(delivery.message).toMatchObject({
      accountExternalId: 'PAGE_FIXTURE_1',
      externalEventId: 'm_fixture_meta_1',
      platform: 'facebook-messenger',
      recipientExternalId: 'PAGE_FIXTURE_1',
      senderExternalId: 'SENDER_FIXTURE_1',
    })
    expect(delivery.contactSource).toMatchObject({
      accountExternalId: 'PAGE_FIXTURE_1',
      identityKey: expect.stringMatching(/^social-contact:v2:facebook-messenger:[a-f0-9]{64}$/),
      kind: 'verified-social-session',
      senderExternalId: 'SENDER_FIXTURE_1',
    })
  })

  it('does not deliver when authorization is revoked between Job validation and the write', async () => {
    const queued = await queuedFixture()
    const revoked = new Error('account disabled')
    const assertCanReceive = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(revoked)
    const writeVerifiedInboundMessage = vi.fn()
    const accountAuthorizer = { assertCanReceive }
    const handler = createPlatformEventJobHandler({
      accountAuthorizer,
      conversations: createVerifiedSocialConversationMessagePort({
        accountAuthorizer,
        destination: { writeVerifiedInboundMessage },
        installationNamespace: 'ivybm-production',
      }),
    })
    const job = claimedJob(
      {
        event: queued.event,
        eventDigest: queued.eventDigest,
        rawPayloadDigest: queued.rawPayloadDigest,
      },
      queued.event.idempotencyKey,
    )

    await expect(
      handler(job, {
        assertLease: () => undefined,
        renewLease: async () => job,
        signal: new AbortController().signal,
      }),
    ).rejects.toBe(revoked)
    expect(assertCanReceive).toHaveBeenCalledTimes(2)
    expect(writeVerifiedInboundMessage).not.toHaveBeenCalled()
  })
})
