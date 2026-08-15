import { describe, expect, it, vi } from 'vitest'
import type { Payload } from 'payload'

import {
  JobLeaseLostError,
  type ClaimedJob,
  type JobExecution,
  type JobQueue,
} from '@/modules/jobs/contracts'
import { JobWorker } from '@/modules/jobs/worker'
import { PlatformConversationDeliveryPersistenceError } from '@/modules/platforms/conversationDelivery'
import {
  createPlatformConversationDeliveryJobHandler,
  PLATFORM_CONVERSATION_DELIVERY_JOB_TYPE,
} from '@/modules/platforms/conversationDeliveryJobs'
import type { PlatformConversationDeliveryService } from '@/modules/platforms/ports'

const deliveryKey = `conversation-delivery:v1:facebook-messenger:${'a'.repeat(64)}`

const claimedJob = (): ClaimedJob => ({
  attempts: 1,
  completedAt: null,
  createdAt: '2026-08-14T00:00:00.000Z',
  deadAt: null,
  id: 71,
  idempotencyKey: deliveryKey,
  lastError: null,
  leaseExpiresAt: '2099-08-14T00:02:00.000Z',
  manualRetryCount: 0,
  maxAttempts: 5,
  nextRunAt: null,
  ownerToken: 'worker-owner',
  payload: { deliveryKey },
  status: 'processing',
  type: PLATFORM_CONVERSATION_DELIVERY_JOB_TYPE,
  updatedAt: '2026-08-14T00:00:00.000Z',
})

const execution = (): JobExecution => ({
  assertLease: vi.fn(),
  renewLease: async () => claimedJob(),
  signal: new AbortController().signal,
})

const payloadWithIntent = (): Payload =>
  ({
    find: vi.fn(async () => ({
      docs: [
        {
          accountExternalId: '129472283584550',
          conversation: 41,
          deliveryKey,
          expectedRevision: 3,
          platform: 'facebook-messenger',
          queueJob: 71,
          recipientExternalId: '122294474450066102',
          replyMessage: 61,
          text: 'Thanks. Which country is your project in?',
        },
      ],
    })),
  }) as unknown as Payload

describe('platform conversation delivery Job handler', () => {
  it('loads the authority-owned intent and completes accepted delivery', async () => {
    const deliver = vi.fn(async () => ({
      deliveryKey,
      platform: 'facebook-messenger' as const,
      status: 'accepted' as const,
    }))
    const handler = createPlatformConversationDeliveryJobHandler({
      delivery: { deliver } satisfies PlatformConversationDeliveryService,
      payload: payloadWithIntent(),
    })
    const job = claimedJob()
    const lease = execution()

    await expect(handler(job, lease)).resolves.toBeUndefined()
    expect(deliver).toHaveBeenCalledWith(
      {
        conversationId: 41,
        expectedRevision: 3,
        jobId: 71,
        replyId: 61,
        transport: {
          accountExternalId: '129472283584550',
          deliveryKey,
          platform: 'facebook-messenger',
          recipientExternalId: '122294474450066102',
          text: 'Thanks. Which country is your project in?',
        },
      },
      {
        jobId: 71,
        leaseExpiresAt: job.leaseExpiresAt,
        ownerToken: job.ownerToken,
      },
    )
    expect(lease.assertLease).toHaveBeenCalledTimes(3)
  })

  it('fails the Job only for a confirmed retryable block', async () => {
    const handler = createPlatformConversationDeliveryJobHandler({
      delivery: {
        deliver: async () => ({
          deliveryKey,
          errorCode: 'rate_limited',
          platform: 'facebook-messenger',
          retryAfterSeconds: 30,
          retryable: true,
          status: 'blocked',
        }),
      },
      payload: payloadWithIntent(),
    })

    await expect(handler(claimedJob(), execution())).rejects.toThrow(
      'Platform conversation delivery is retryable: rate_limited',
    )
  })

  it.each([
    {
      deliveryKey,
      errorCode: 'permission_required' as const,
      platform: 'facebook-messenger' as const,
      retryable: false as const,
      status: 'blocked' as const,
    },
    {
      deliveryKey,
      platform: 'facebook-messenger' as const,
      status: 'delivery_unknown' as const,
    },
  ])('completes a terminal $status result without blind retry', async (outcome) => {
    const handler = createPlatformConversationDeliveryJobHandler({
      delivery: { deliver: async () => outcome },
      payload: payloadWithIntent(),
    })

    await expect(handler(claimedJob(), execution())).resolves.toBeUndefined()
  })

  it('rejects a Job whose stable key cannot resolve one exact intent', async () => {
    const payload = {
      find: vi.fn(async () => ({ docs: [] })),
    } as unknown as Payload
    const delivery: PlatformConversationDeliveryService = {
      deliver: vi.fn(),
    }
    const handler = createPlatformConversationDeliveryJobHandler({ delivery, payload })

    await expect(handler(claimedJob(), execution())).rejects.toThrow(
      'Platform conversation delivery intent is missing or ambiguous',
    )
    expect(delivery.deliver).not.toHaveBeenCalled()
  })

  it('leaves the Job lease for recovery when a provider outcome was not persisted', async () => {
    const handler = createPlatformConversationDeliveryJobHandler({
      delivery: {
        deliver: vi.fn().mockRejectedValue(
          new PlatformConversationDeliveryPersistenceError({
            deliveryKey,
            platform: 'facebook-messenger',
            status: 'accepted',
          }),
        ),
      },
      payload: payloadWithIntent(),
    })

    await expect(handler(claimedJob(), execution())).rejects.toBeInstanceOf(JobLeaseLostError)
  })

  it('does not complete or queue.fail the leased Job when persistence needs recovery', async () => {
    const job = claimedJob()
    const handler = createPlatformConversationDeliveryJobHandler({
      delivery: {
        deliver: vi.fn().mockRejectedValue(
          new PlatformConversationDeliveryPersistenceError({
            deliveryKey,
            platform: 'facebook-messenger',
            status: 'accepted',
          }),
        ),
      },
      payload: payloadWithIntent(),
    })
    const queue: JobQueue = {
      claimNext: vi.fn().mockResolvedValueOnce(job),
      complete: vi.fn(),
      fail: vi.fn(),
      renew: vi.fn(),
    }
    const worker = new JobWorker({
      handlers: { [PLATFORM_CONVERSATION_DELIVERY_JOB_TYPE]: handler },
      queue,
    })

    await expect(worker.runOnce()).resolves.toBe('failed')
    expect(queue.complete).not.toHaveBeenCalled()
    expect(queue.fail).not.toHaveBeenCalled()
  })
})
