import { describe, expect, it, vi } from 'vitest'

import type { ClaimedJob, JobQueue, JobRecord } from '@/modules/jobs/contracts'
import { JobWorker } from '@/modules/jobs/worker'
import { createPlatformConversationDeliveryService } from '@/modules/platforms/conversationDelivery'
import { PlatformConversationOutboundOutcomeUnknownError } from '@/modules/platforms/conversationOutboundResult'
import { createFakePlatformConversationDeliveryAuthority } from '@/modules/platforms/fakeConversationDeliveryAuthority'
import {
  createFakePlatformConversationOutboundPort,
  createFakePlatformConversationOutboundProviderState,
} from '@/modules/platforms/fakeConversationOutboundPort'
import type { PlatformConversationOutboundPort } from '@/modules/platforms/ports'
import {
  createProviderAcceptanceEvidence,
  type PlatformConversationDeliveryIntent,
  type PlatformConversationOutboundRequest,
  type PlatformConversationOutboundResult,
} from '@/modules/platforms/types'

const transport = (
  overrides: Partial<PlatformConversationOutboundRequest> = {},
): PlatformConversationOutboundRequest => ({
  accountExternalId: 'PAGE_FIXTURE_1',
  deliveryKey: 'conversation-42:reply-7',
  platform: 'facebook-messenger',
  recipientExternalId: 'SENDER_FIXTURE_1',
  text: 'Thank you. Which finish and approximate quantity do you need?',
  ...overrides,
})

const deliveryIntent = (
  overrides: Partial<PlatformConversationDeliveryIntent> = {},
): PlatformConversationDeliveryIntent => ({
  conversationId: 42,
  expectedRevision: 7,
  replyId: 'reply-7',
  transport: transport(),
  ...overrides,
})

const authorityFor = (
  handoffStatus: 'ai_active' | 'handoff_requested' | 'human_active' | 'resolved' = 'ai_active',
  revision = 7,
) =>
  createFakePlatformConversationDeliveryAuthority({
    initialIntents: [deliveryIntent()],
    initialSnapshots: [{ conversationId: 42, handoffStatus, revision }],
  })

const claimedJob = (): ClaimedJob => ({
  attempts: 1,
  completedAt: null,
  createdAt: '2026-07-27T00:00:00.000Z',
  deadAt: null,
  id: 40,
  idempotencyKey: 'conversation-42:reply-7',
  lastError: null,
  leaseExpiresAt: '2026-07-27T00:02:00.000Z',
  manualRetryCount: 0,
  maxAttempts: 5,
  nextRunAt: '2026-07-27T00:00:00.000Z',
  ownerToken: 'worker-40',
  payload: {},
  status: 'processing',
  type: 'platform.conversation.reply.test',
  updatedAt: '2026-07-27T00:00:00.000Z',
})

const queueFor = (job: ClaimedJob): JobQueue => ({
  claimNext: vi.fn().mockResolvedValue(job),
  complete: vi
    .fn()
    .mockResolvedValue({ ...job, ownerToken: null, status: 'succeeded' } as JobRecord),
  fail: vi.fn().mockResolvedValue({ ...job, ownerToken: null, status: 'failed' } as JobRecord),
  renew: vi.fn().mockResolvedValue(job),
})

describe('platform conversation delivery service', () => {
  it('claims the authoritative intent before passing only transport fields to the adapter', async () => {
    const authority = authorityFor()
    const outbound = createFakePlatformConversationOutboundPort()
    const send = vi.spyOn(outbound, 'send')
    const service = createPlatformConversationDeliveryService({ authority, outbound })

    await expect(service.deliver(deliveryIntent())).resolves.toMatchObject({ status: 'accepted' })
    expect(send).toHaveBeenCalledWith(transport())
    expect(Object.keys(send.mock.calls[0]?.[0] ?? {}).sort()).toEqual([
      'accountExternalId',
      'deliveryKey',
      'platform',
      'recipientExternalId',
      'text',
    ])
  })

  it.each(['handoff_requested', 'human_active', 'resolved'] as const)(
    'suppresses transport while the authoritative state is %s',
    async (handoffStatus) => {
      const authority = authorityFor(handoffStatus)
      const outbound = createFakePlatformConversationOutboundPort()
      const send = vi.spyOn(outbound, 'send')
      const service = createPlatformConversationDeliveryService({ authority, outbound })

      await expect(service.deliver(deliveryIntent())).resolves.toEqual({
        deliveryKey: 'conversation-42:reply-7',
        errorCode: 'handoff_required',
        platform: 'facebook-messenger',
        retryable: false,
        status: 'blocked',
      })
      expect(send).not.toHaveBeenCalled()
      expect(
        outbound.getAcceptedRequest({
          accountExternalId: 'PAGE_FIXTURE_1',
          deliveryKey: 'conversation-42:reply-7',
          platform: 'facebook-messenger',
        }),
      ).toBeUndefined()
    },
  )

  it('fences an intent created before a concurrent human takeover changes the revision', async () => {
    const authority = authorityFor()
    const outbound = createFakePlatformConversationOutboundPort()
    const service = createPlatformConversationDeliveryService({ authority, outbound })
    const queuedBeforeTakeover = deliveryIntent()

    authority.setDeliverySnapshot({ conversationId: 42, handoffStatus: 'human_active', revision: 8 })

    await expect(service.deliver(queuedBeforeTakeover)).resolves.toMatchObject({
      errorCode: 'handoff_required',
      status: 'blocked',
    })
    expect(
      outbound.getAcceptedRequest({
        accountExternalId: queuedBeforeTakeover.transport.accountExternalId,
        deliveryKey: queuedBeforeTakeover.transport.deliveryKey,
        platform: queuedBeforeTakeover.transport.platform,
      }),
    ).toBeUndefined()
  })

  it('fails closed on a stale revision even if the conversation is still AI-active', async () => {
    const authority = authorityFor('ai_active', 8)
    const outbound = createFakePlatformConversationOutboundPort()
    const send = vi.spyOn(outbound, 'send')

    await expect(
      createPlatformConversationDeliveryService({ authority, outbound }).deliver(deliveryIntent()),
    ).resolves.toMatchObject({ errorCode: 'handoff_required', status: 'blocked' })
    expect(send).not.toHaveBeenCalled()
  })

  it('serializes human takeover against an in-flight transport claim', async () => {
    const authority = authorityFor()
    let resolveSend!: (result: PlatformConversationOutboundResult) => void
    let markSendStarted!: () => void
    const sendStarted = new Promise<void>((resolve) => {
      markSendStarted = resolve
    })
    const sendResult = new Promise<PlatformConversationOutboundResult>((resolve) => {
      resolveSend = resolve
    })
    const outbound: PlatformConversationOutboundPort = {
      recoverUnknownOutcome: vi.fn(async (input) => ({
        deliveryKey: input.deliveryKey,
        platform: input.platform,
        status: 'delivery_unknown' as const,
      })),
      send: vi.fn(async () => {
        markSendStarted()
        return sendResult
      }),
    }
    const pendingDelivery = createPlatformConversationDeliveryService({
      authority,
      outbound,
    }).deliver(deliveryIntent())
    await sendStarted

    expect(
      authority.setDeliverySnapshot({
        conversationId: 42,
        handoffStatus: 'human_active',
        revision: 8,
      }),
    ).toBe(false)
    expect(authority.getDeliverySnapshot(42)).toMatchObject({
      handoffStatus: 'ai_active',
      revision: 7,
    })

    resolveSend({
      deliveryKey: 'conversation-42:reply-7',
      platform: 'facebook-messenger',
      status: 'accepted',
    })
    await expect(pendingDelivery).resolves.toMatchObject({ status: 'accepted' })
    expect(
      authority.setDeliverySnapshot({
        conversationId: 42,
        handoffStatus: 'human_active',
        revision: 8,
      }),
    ).toBe(true)
  })

  it('uses a defensive intent snapshot while the authority claim is pending', async () => {
    const authority = authorityFor()
    let continueClaim!: () => void
    let markClaimStarted!: () => void
    const claimStarted = new Promise<void>((resolve) => {
      markClaimStarted = resolve
    })
    const claimMayContinue = new Promise<void>((resolve) => {
      continueClaim = resolve
    })
    const delayedAuthority = {
      claimDelivery: async (intent: PlatformConversationDeliveryIntent) => {
        markClaimStarted()
        await claimMayContinue
        return authority.claimDelivery(intent)
      },
      markProviderIOStarted: authority.markProviderIOStarted,
      releaseDelivery: authority.releaseDelivery,
    }
    const outbound = createFakePlatformConversationOutboundPort()
    const send = vi.spyOn(outbound, 'send')
    const mutableIntent = structuredClone(deliveryIntent())
    const pendingDelivery = createPlatformConversationDeliveryService({
      authority: delayedAuthority,
      outbound,
    }).deliver(mutableIntent)
    await claimStarted

    const mutableTransport = mutableIntent.transport as { text: string }
    mutableTransport.text = 'Mutated after delivery started.'
    continueClaim()

    await expect(pendingDelivery).resolves.toMatchObject({ status: 'accepted' })
    expect(send).toHaveBeenCalledWith(transport())
  })

  it('reconciles the public unknown-result signal without blind resending', async () => {
    const authority = authorityFor()
    const providerState = createFakePlatformConversationOutboundProviderState()
    const outbound = createFakePlatformConversationOutboundPort({ providerState })
    const recover = vi.spyOn(outbound, 'recoverUnknownOutcome')
    const send = vi.spyOn(outbound, 'send')
    outbound.loseAcceptedResultNext({ platform: 'facebook-messenger' })

    await expect(
      createPlatformConversationDeliveryService({ authority, outbound }).deliver(deliveryIntent()),
    ).resolves.toEqual({
      deliveryKey: 'conversation-42:reply-7',
      platform: 'facebook-messenger',
      status: 'delivery_unknown',
    })
    expect(send).toHaveBeenCalledTimes(1)
    expect(recover).toHaveBeenCalledTimes(1)
  })

  it('fails closed to delivery_unknown when reconciliation itself is unavailable', async () => {
    const authority = authorityFor()
    const outbound: PlatformConversationOutboundPort = {
      recoverUnknownOutcome: vi.fn().mockRejectedValue(new Error('lookup temporarily unavailable')),
      send: vi.fn().mockRejectedValue(
        new PlatformConversationOutboundOutcomeUnknownError({
          deliveryKey: 'conversation-42:reply-7',
          platform: 'facebook-messenger',
        }),
      ),
    }

    await expect(
      createPlatformConversationDeliveryService({ authority, outbound }).deliver(deliveryIntent()),
    ).resolves.toEqual({
      deliveryKey: 'conversation-42:reply-7',
      platform: 'facebook-messenger',
      status: 'delivery_unknown',
    })
  })

  it('does not reconcile an unknown-result signal for a different delivery identity', async () => {
    const authority = authorityFor()
    const recoverUnknownOutcome = vi.fn(async (input: PlatformConversationOutboundRequest) => ({
      deliveryKey: input.deliveryKey,
      platform: input.platform,
      status: 'delivery_unknown' as const,
    }))
    const outbound: PlatformConversationOutboundPort = {
      recoverUnknownOutcome,
      send: vi.fn().mockRejectedValue(
        new PlatformConversationOutboundOutcomeUnknownError({
          deliveryKey: 'another-conversation:reply-99',
          platform: 'facebook-messenger',
        }),
      ),
    }

    await expect(
      createPlatformConversationDeliveryService({ authority, outbound }).deliver(deliveryIntent()),
    ).resolves.toEqual({
      deliveryKey: 'conversation-42:reply-7',
      platform: 'facebook-messenger',
      status: 'delivery_unknown',
    })
    expect(recoverUnknownOutcome).not.toHaveBeenCalled()
  })

  it('does not attribute provider recovery evidence to a different delivery identity', async () => {
    const authority = authorityFor()
    const providerReference = createProviderAcceptanceEvidence({
      deliveryKey: 'another-conversation:reply-99',
      providerReference: 'provider-message-opaque-99',
    })
    if (!providerReference) throw new Error('Fixture provider evidence must be non-empty')
    const outbound: PlatformConversationOutboundPort = {
      recoverUnknownOutcome: vi.fn(async () => ({
        deliveryKey: 'another-conversation:reply-99',
        platform: 'facebook-messenger' as const,
        providerReference,
        status: 'provider_accepted' as const,
      })),
      send: vi.fn().mockRejectedValue(
        new PlatformConversationOutboundOutcomeUnknownError({
          deliveryKey: 'conversation-42:reply-7',
          platform: 'facebook-messenger',
        }),
      ),
    }

    await expect(
      createPlatformConversationDeliveryService({ authority, outbound }).deliver(deliveryIntent()),
    ).resolves.toEqual({
      deliveryKey: 'conversation-42:reply-7',
      platform: 'facebook-messenger',
      status: 'delivery_unknown',
    })
  })

  it('fails closed when a normal adapter result belongs to another delivery identity', async () => {
    const authority = authorityFor()
    const outbound: PlatformConversationOutboundPort = {
      recoverUnknownOutcome: vi.fn(async (input) => ({
        deliveryKey: input.deliveryKey,
        platform: input.platform,
        status: 'delivery_unknown' as const,
      })),
      send: vi.fn(async () => ({
        deliveryKey: 'another-conversation:reply-99',
        platform: 'facebook-messenger' as const,
        status: 'accepted' as const,
      })),
    }

    await expect(
      createPlatformConversationDeliveryService({ authority, outbound }).deliver(deliveryIntent()),
    ).resolves.toEqual({
      deliveryKey: 'conversation-42:reply-7',
      platform: 'facebook-messenger',
      status: 'delivery_unknown',
    })
  })

  it('fails closed without exposing unexpected adapter exceptions to a Job', async () => {
    const authority = authorityFor()
    const outbound: PlatformConversationOutboundPort = {
      recoverUnknownOutcome: vi.fn(async (input) => ({
        deliveryKey: input.deliveryKey,
        platform: input.platform,
        status: 'delivery_unknown' as const,
      })),
      send: vi
        .fn()
        .mockRejectedValue(
          new Error('Authorization: Bearer SECRET_TOKEN provider_body=PRIVATE_RESPONSE'),
        ),
    }

    const outcome = await createPlatformConversationDeliveryService({ authority, outbound }).deliver(
      deliveryIntent(),
    )
    expect(outcome).toEqual({
      deliveryKey: 'conversation-42:reply-7',
      platform: 'facebook-messenger',
      status: 'delivery_unknown',
    })
    const serialized = JSON.stringify(outcome)
    expect(serialized).not.toContain('SECRET_TOKEN')
    expect(serialized).not.toContain('PRIVATE_RESPONSE')
    expect(serialized).not.toContain('Authorization')
  })

  it('preserves a confirmed rate limit when claim release fails', async () => {
    const baseAuthority = authorityFor()
    const authority = {
      claimDelivery: baseAuthority.claimDelivery,
      markProviderIOStarted: baseAuthority.markProviderIOStarted,
      releaseDelivery: vi.fn().mockRejectedValue(new Error('claim persistence unavailable')),
    }
    const outbound = createFakePlatformConversationOutboundPort()
    outbound.failNextSend({
      errorCode: 'rate_limited',
      platform: 'facebook-messenger',
      retryAfterSeconds: 60,
      retryable: true,
    })

    await expect(
      createPlatformConversationDeliveryService({ authority, outbound }).deliver(deliveryIntent()),
    ).resolves.toEqual({
      deliveryKey: 'conversation-42:reply-7',
      errorCode: 'rate_limited',
      platform: 'facebook-messenger',
      retryAfterSeconds: 60,
      retryable: true,
      status: 'blocked',
    })
  })

  it('downgrades accepted to delivery_unknown when the claim cannot be released', async () => {
    const baseAuthority = authorityFor()
    const authority = {
      claimDelivery: baseAuthority.claimDelivery,
      markProviderIOStarted: baseAuthority.markProviderIOStarted,
      releaseDelivery: vi.fn().mockRejectedValue(new Error('claim persistence unavailable')),
    }
    const outbound = createFakePlatformConversationOutboundPort()

    await expect(
      createPlatformConversationDeliveryService({ authority, outbound }).deliver(deliveryIntent()),
    ).resolves.toEqual({
      deliveryKey: 'conversation-42:reply-7',
      platform: 'facebook-messenger',
      status: 'delivery_unknown',
    })
  })

  it('reclaims an expired started claim through recovery without a second send', async () => {
    const authority = authorityFor()
    const outbound = createFakePlatformConversationOutboundPort()
    const send = vi.spyOn(outbound, 'send')
    const abandonedClaim = await authority.claimDelivery(deliveryIntent())
    if (!abandonedClaim) throw new Error('Fixture delivery claim must be available')
    await expect(authority.markProviderIOStarted(abandonedClaim)).resolves.toBe(true)
    outbound.loseAcceptedResultNext({ platform: 'facebook-messenger' })
    await expect(outbound.send(transport())).rejects.toBeInstanceOf(
      PlatformConversationOutboundOutcomeUnknownError,
    )
    expect(authority.expireDeliveryClaim(42)).toBe(true)
    expect(
      authority.setDeliverySnapshot({
        conversationId: 42,
        handoffStatus: 'human_active',
        revision: 8,
      }),
    ).toBe(true)

    const delivery = createPlatformConversationDeliveryService({ authority, outbound })
    const job = claimedJob()
    const queue = queueFor(job)
    const worker = new JobWorker({
      handlers: {
        'platform.conversation.reply.test': async () => {
          const outcome = await delivery.deliver(deliveryIntent())
          expect(outcome.status).toBe('delivery_unknown')
        },
      },
      queue,
    })

    await expect(worker.runOnce()).resolves.toBe('succeeded')
    expect(send).toHaveBeenCalledTimes(1)
    expect(queue.complete).toHaveBeenCalledTimes(1)
    expect(queue.fail).not.toHaveBeenCalled()
  })

  it('does not let a changed payload inherit another intent recovery fence', async () => {
    const authority = authorityFor()
    const abandonedClaim = await authority.claimDelivery(deliveryIntent())
    if (!abandonedClaim) throw new Error('Fixture delivery claim must be available')
    await expect(authority.markProviderIOStarted(abandonedClaim)).resolves.toBe(true)
    expect(authority.expireDeliveryClaim(42)).toBe(true)
    const changedIntent = deliveryIntent({
      expectedRevision: 8,
      transport: transport({ text: 'Changed text must not inherit the old recovery fence.' }),
    })

    expect(() => authority.registerDeliveryIntent(changedIntent)).toThrow(
      'delivery intent identity is already registered',
    )
    expect(
      authority.setDeliverySnapshot({
        conversationId: 42,
        handoffStatus: 'human_active',
        revision: 8,
      }),
    ).toBe(true)
    const outbound = createFakePlatformConversationOutboundPort()
    const send = vi.spyOn(outbound, 'send')

    await expect(
      createPlatformConversationDeliveryService({ authority, outbound }).deliver(changedIntent),
    ).resolves.toMatchObject({ errorCode: 'handoff_required', status: 'blocked' })
    expect(send).not.toHaveBeenCalled()
  })

  it('performs exactly one fenced same-key retry when recovery proves provider idempotency', async () => {
    const authority = authorityFor()
    const providerState = createFakePlatformConversationOutboundProviderState({
      recoveryMode: 'provider_idempotency_key',
    })
    const outbound = createFakePlatformConversationOutboundPort({ providerState })
    const send = vi.spyOn(outbound, 'send')
    const abandonedClaim = await authority.claimDelivery(deliveryIntent())
    if (!abandonedClaim) throw new Error('Fixture delivery claim must be available')
    await expect(authority.markProviderIOStarted(abandonedClaim)).resolves.toBe(true)
    outbound.loseAcceptedResultNext({ platform: 'facebook-messenger' })
    await expect(outbound.send(transport())).rejects.toBeInstanceOf(
      PlatformConversationOutboundOutcomeUnknownError,
    )
    expect(authority.expireDeliveryClaim(42)).toBe(true)

    await expect(
      createPlatformConversationDeliveryService({ authority, outbound }).deliver(deliveryIntent()),
    ).resolves.toEqual({
      deliveryKey: 'conversation-42:reply-7',
      platform: 'facebook-messenger',
      status: 'duplicate',
    })
    expect(send).toHaveBeenCalledTimes(2)

    const nextClaim = await authority.claimDelivery(deliveryIntent())
    expect(nextClaim?.mode).toBe('send')
    if (nextClaim) await authority.releaseDelivery(nextClaim)
  })

  it.each([
    '',
    'conversation-42:reply-7',
    'provider\nmessage',
    'x'.repeat(513),
    '凭'.repeat(200),
  ])('rejects malformed provider acceptance evidence %j at runtime', async (providerReference) => {
    const authority = authorityFor()
    const outbound: PlatformConversationOutboundPort = {
      recoverUnknownOutcome: vi.fn(async (input) =>
        ({
          deliveryKey: input.deliveryKey,
          platform: input.platform,
          providerReference,
          status: 'provider_accepted',
        }) as never,
      ),
      send: vi.fn().mockRejectedValue(
        new PlatformConversationOutboundOutcomeUnknownError({
          deliveryKey: 'conversation-42:reply-7',
          platform: 'facebook-messenger',
        }),
      ),
    }

    await expect(
      createPlatformConversationDeliveryService({ authority, outbound }).deliver(deliveryIntent()),
    ).resolves.toEqual({
      deliveryKey: 'conversation-42:reply-7',
      platform: 'facebook-messenger',
      status: 'delivery_unknown',
    })
  })

  it('rejects an unknown recovery status at runtime', async () => {
    const authority = authorityFor()
    const outbound: PlatformConversationOutboundPort = {
      recoverUnknownOutcome: vi.fn(async (input) =>
        ({
          deliveryKey: input.deliveryKey,
          platform: input.platform,
          status: 'invented_status',
        }) as never,
      ),
      send: vi.fn().mockRejectedValue(
        new PlatformConversationOutboundOutcomeUnknownError({
          deliveryKey: 'conversation-42:reply-7',
          platform: 'facebook-messenger',
        }),
      ),
    }

    await expect(
      createPlatformConversationDeliveryService({ authority, outbound }).deliver(deliveryIntent()),
    ).resolves.toMatchObject({ status: 'delivery_unknown' })
  })

  it('lets Task 10 complete an unknown-result handler without queue.fail retrying the send', async () => {
    const authority = authorityFor()
    const outbound = createFakePlatformConversationOutboundPort()
    outbound.loseAcceptedResultNext({ platform: 'facebook-messenger' })
    const delivery = createPlatformConversationDeliveryService({ authority, outbound })
    const job = claimedJob()
    const queue = queueFor(job)
    const worker = new JobWorker({
      handlers: {
        'platform.conversation.reply.test': async () => {
          const outcome = await delivery.deliver(deliveryIntent())
          expect(outcome.status).toBe('delivery_unknown')
        },
      },
      queue,
    })

    await expect(worker.runOnce()).resolves.toBe('succeeded')
    expect(queue.complete).toHaveBeenCalledTimes(1)
    expect(queue.fail).not.toHaveBeenCalled()
  })
})
