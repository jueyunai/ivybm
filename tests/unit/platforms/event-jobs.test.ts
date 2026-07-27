import { createHash } from 'node:crypto'

import { describe, expect, it, vi } from 'vitest'

import {
  createPlatformEventJobHandler,
  parsePlatformEventJobPayload,
  PlatformEventJobPayloadError,
} from '@/modules/platforms/eventJobs'
import { JobLeaseLostError, type ClaimedJob } from '@/modules/jobs/contracts'
import { platformEventKeyV2 } from '@/modules/platforms/types'

const digest = (value: string): string => createHash('sha256').update(value).digest('hex')
const allowAllAccounts = { assertCanReceive: async () => undefined }

const payload = (overrides: Record<string, unknown> = {}) => ({
  event: {
    accountExternalId: 'page-fixture-1',
    content: { messageType: 'text', text: 'Please share available facade finishes.' },
    externalEventId: 'message-fixture-1',
    idempotencyKey: 'facebook-messenger:message-fixture-1',
    kind: 'inbound-message',
    occurredAt: '2026-07-22T00:00:00.000Z',
    platform: 'facebook-messenger',
    recipientExternalId: 'page-fixture-1',
    senderExternalId: 'sender-fixture-1',
  },
  eventDigest: digest('event-fixture-1'),
  rawPayloadDigest: digest('raw-fixture-1'),
  ...overrides,
})

const claimedJob = (jobPayload: Record<string, unknown>): ClaimedJob => ({
  attempts: 1,
  completedAt: null,
  createdAt: '2026-07-22T00:00:00.000Z',
  deadAt: null,
  id: 1,
  idempotencyKey: 'facebook-messenger:message-fixture-1',
  lastError: null,
  leaseExpiresAt: '2026-07-22T00:02:00.000Z',
  manualRetryCount: 0,
  maxAttempts: 5,
  nextRunAt: '2026-07-22T00:00:00.000Z',
  ownerToken: 'worker-fixture-token',
  payload: jobPayload,
  status: 'processing',
  type: 'platform.event.dispatch',
  updatedAt: '2026-07-22T00:00:00.000Z',
})

describe('platform event job payload validation', () => {
  it('accepts legacy queued events and new account-scoped event identities', () => {
    const legacy = payload()
    const accountScoped = payload({
      event: {
        ...(legacy.event as Record<string, unknown>),
        idempotencyKey: platformEventKeyV2(
          'facebook-messenger',
          'page-fixture-1',
          'message-fixture-1',
        ),
      },
    })

    expect(parsePlatformEventJobPayload(legacy).event).toMatchObject({
      idempotencyKey: 'facebook-messenger:message-fixture-1',
    })
    expect(parsePlatformEventJobPayload(accountScoped).event).toMatchObject({
      idempotencyKey: platformEventKeyV2(
        'facebook-messenger',
        'page-fixture-1',
        'message-fixture-1',
      ),
    })
  })

  it('rejects malformed attachment elements before dispatching a durable event', async () => {
    const malformed = payload({
      event: {
        ...(payload().event as Record<string, unknown>),
        content: { attachments: [null], messageType: 'image' },
      },
    })
    const writeInboundMessage = vi.fn(async () => ({
      idempotencyKey: 'facebook-messenger:message-fixture-1',
      status: 'accepted' as const,
    }))
    const handler = createPlatformEventJobHandler({
      accountAuthorizer: allowAllAccounts,
      conversations: { writeInboundMessage },
    })

    await expect(
      handler(claimedJob(malformed), {
        assertLease: () => undefined,
        renewLease: async () => claimedJob(malformed),
        signal: new AbortController().signal,
      }),
    ).rejects.toBeInstanceOf(PlatformEventJobPayloadError)
    expect(writeInboundMessage).not.toHaveBeenCalled()
  })

  it('rejects a Meta event whose recipient does not match the subscribed account', () => {
    const mismatched = payload({
      event: {
        ...(payload().event as Record<string, unknown>),
        recipientExternalId: 'another-page',
      },
    })

    expect(() => parsePlatformEventJobPayload(mismatched)).toThrow(
      'Meta recipient does not match the subscribed account',
    )
  })

  it('accepts a bounded attachment array without retaining URL query credentials', () => {
    const valid = payload({
      event: {
        ...(payload().event as Record<string, unknown>),
        content: {
          attachments: [
            {
              type: 'image',
              url: 'https://example.invalid/fixture.jpg?signature=provider-secret#fragment',
            },
          ],
          messageType: 'image',
        },
      },
    })

    expect(parsePlatformEventJobPayload(valid).event).toMatchObject({
      content: { attachments: [{ type: 'image', url: 'https://example.invalid/fixture.jpg' }] },
      kind: 'inbound-message',
    })
  })

  it('validates and preserves bounded message-status errors for a future status adapter', () => {
    const statusPayload = payload({
      event: {
        accountExternalId: 'page-fixture-1',
        errors: [{ code: 'temporary', message: 'Retry later', title: 'Provider unavailable' }],
        externalEventId: 'status-fixture-1',
        idempotencyKey: 'facebook-messenger:status-fixture-1',
        kind: 'message-status',
        messageExternalId: 'outbound-fixture-1',
        occurredAt: '2026-07-22T00:00:00.000Z',
        platform: 'facebook-messenger',
        recipientExternalId: 'page-fixture-1',
        status: 'failed',
      },
    })

    expect(parsePlatformEventJobPayload(statusPayload).event).toEqual(
      expect.objectContaining({
        errors: [{ code: 'temporary', message: 'Retry later', title: 'Provider unavailable' }],
        kind: 'message-status',
        status: 'failed',
      }),
    )
  })

  it('fences a completed downstream write when the Job lease is lost before acknowledgement', async () => {
    const writeInboundMessage = vi.fn(async () => ({
      idempotencyKey: 'facebook-messenger:message-fixture-1',
      status: 'accepted' as const,
    }))
    const handler = createPlatformEventJobHandler({
      accountAuthorizer: allowAllAccounts,
      conversations: { writeInboundMessage },
    })
    let assertions = 0

    await expect(
      handler(claimedJob(payload()), {
        assertLease: () => {
          assertions += 1
          if (assertions === 3) throw new JobLeaseLostError('fixture lease reclaimed')
        },
        renewLease: async () => claimedJob(payload()),
        signal: new AbortController().signal,
      }),
    ).rejects.toBeInstanceOf(JobLeaseLostError)
    expect(writeInboundMessage).toHaveBeenCalledTimes(1)
  })

  it('rechecks platform account access before dispatching a claimed event', async () => {
    const writeInboundMessage = vi.fn(async () => ({
      idempotencyKey: 'facebook-messenger:message-fixture-1',
      status: 'accepted' as const,
    }))
    const assertCanReceive = vi.fn(async () => {
      throw new Error('Platform messaging account is disabled')
    })
    const handler = createPlatformEventJobHandler({
      accountAuthorizer: { assertCanReceive },
      conversations: { writeInboundMessage },
    })
    const job = claimedJob(payload())

    await expect(
      handler(job, {
        assertLease: () => undefined,
        renewLease: async () => job,
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow('Platform messaging account is disabled')
    expect(assertCanReceive).toHaveBeenCalledWith(
      expect.objectContaining({
        accountExternalId: 'page-fixture-1',
        platform: 'facebook-messenger',
      }),
    )
    expect(writeInboundMessage).not.toHaveBeenCalled()
  })
})
