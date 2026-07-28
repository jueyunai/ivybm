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
import type {
  PlatformConversationDeliveryAuthorityPort,
  PlatformConversationOutboundPort,
} from '@/modules/platforms/ports'
import {
  createProviderAcceptanceEvidence,
  type PlatformConversationDeliveryIntent,
  type PlatformConversationDeliveryLeaseFence,
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
  jobId: 40,
  replyId: 'reply-7',
  transport: transport(),
  ...overrides,
})

const LEASE_EXPIRES_AT = new Date(Date.now() + 60 * 60 * 1000).toISOString()

const deliveryLease = (
  overrides: Partial<PlatformConversationDeliveryLeaseFence> = {},
): PlatformConversationDeliveryLeaseFence => ({
  jobId: 40,
  leaseExpiresAt: LEASE_EXPIRES_AT,
  ownerToken: 'worker-40',
  ...overrides,
})

const authorityFor = (
  handoffStatus: 'ai_active' | 'handoff_requested' | 'human_active' | 'resolved' = 'ai_active',
  revision = 7,
) =>
  createFakePlatformConversationDeliveryAuthority({
    initialIntents: [deliveryIntent()],
    initialJobLeases: [deliveryLease()],
    initialSnapshots: [{ conversationId: 42, handoffStatus, revision }],
  })

const claimFor = async (
  authority: PlatformConversationDeliveryAuthorityPort,
  intent = deliveryIntent(),
  leaseFence = deliveryLease(),
) => {
  const result = await authority.claimDelivery(intent, leaseFence)
  if (result.status === 'blocked') throw new Error(`Fixture claim blocked: ${result.reason}`)
  return result.claim
}

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

    await expect(service.deliver(deliveryIntent(), deliveryLease())).resolves.toMatchObject({
      status: 'accepted',
    })
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

      await expect(service.deliver(deliveryIntent(), deliveryLease())).resolves.toEqual({
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

    await expect(service.deliver(queuedBeforeTakeover, deliveryLease())).resolves.toMatchObject({
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
      createPlatformConversationDeliveryService({ authority, outbound }).deliver(
        deliveryIntent(),
        deliveryLease(),
      ),
    ).resolves.toMatchObject({ errorCode: 'stale_revision', status: 'blocked' })
    expect(send).not.toHaveBeenCalled()
  })

  it('keeps an active delivery claim retryable instead of misclassifying it as handoff', async () => {
    const authority = authorityFor()
    const activeClaim = await claimFor(authority)
    const outbound = createFakePlatformConversationOutboundPort()
    const send = vi.spyOn(outbound, 'send')

    await expect(
      createPlatformConversationDeliveryService({ authority, outbound }).deliver(
        deliveryIntent(),
        deliveryLease(),
      ),
    ).resolves.toEqual({
      deliveryKey: 'conversation-42:reply-7',
      errorCode: 'delivery_busy',
      platform: 'facebook-messenger',
      retryable: true,
      status: 'blocked',
    })
    expect(send).not.toHaveBeenCalled()
    await authority.releaseDelivery(activeClaim)
  })

  it.each([
    ['missing snapshot', [], [deliveryIntent()]],
    [
      'missing intent',
      [{ conversationId: 42, handoffStatus: 'ai_active' as const, revision: 7 }],
      [],
    ],
  ])('maps %s authority state to invalid_request', async (_description, snapshots, intents) => {
    const authority = createFakePlatformConversationDeliveryAuthority({
      initialIntents: intents,
      initialJobLeases: [deliveryLease()],
      initialSnapshots: snapshots,
    })
    const outbound = createFakePlatformConversationOutboundPort()
    const send = vi.spyOn(outbound, 'send')

    await expect(
      createPlatformConversationDeliveryService({ authority, outbound }).deliver(
        deliveryIntent(),
        deliveryLease(),
      ),
    ).resolves.toMatchObject({ errorCode: 'invalid_request', retryable: false, status: 'blocked' })
    expect(send).not.toHaveBeenCalled()
  })

  it('rejects a worker that no longer owns the current Job lease at provider-I/O mark', async () => {
    const baseAuthority = authorityFor()
    const replacementLease = deliveryLease({ ownerToken: 'worker-41' })
    const authority: PlatformConversationDeliveryAuthorityPort = {
      claimDelivery: async (intent, leaseFence) => {
        const result = await baseAuthority.claimDelivery(intent, leaseFence)
        if (result.status === 'claimed') baseAuthority.setJobLease(replacementLease)
        return result
      },
      markProviderIOStarted: baseAuthority.markProviderIOStarted,
      releaseDelivery: baseAuthority.releaseDelivery,
    }
    const outbound = createFakePlatformConversationOutboundPort()
    const send = vi.spyOn(outbound, 'send')

    await expect(
      createPlatformConversationDeliveryService({ authority, outbound }).deliver(
        deliveryIntent(),
        deliveryLease(),
      ),
    ).resolves.toEqual({
      deliveryKey: 'conversation-42:reply-7',
      errorCode: 'lease_conflict',
      platform: 'facebook-messenger',
      retryable: true,
      status: 'blocked',
    })
    expect(send).not.toHaveBeenCalled()

    const reclaimed = await claimFor(baseAuthority, deliveryIntent(), replacementLease)
    expect(reclaimed.mode).toBe('send')
    await baseAuthority.releaseDelivery(reclaimed)
  })

  it('keeps a claim valid when the same Job owner normally extends its heartbeat lease', async () => {
    const authority = authorityFor()
    const claim = await claimFor(authority)
    const renewedLease = deliveryLease({
      leaseExpiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
    })

    authority.setJobLease(renewedLease)

    await expect(authority.markProviderIOStarted(claim)).resolves.toEqual({ status: 'fenced' })
    await expect(
      authority.releaseDelivery(claim, {
        deliveryKey: claim.intent.transport.deliveryKey,
        platform: claim.intent.transport.platform,
        status: 'accepted',
      }),
    ).resolves.toBeUndefined()
    const nextClaim = await claimFor(authority, deliveryIntent(), renewedLease)
    expect(nextClaim.mode).toBe('send')
    await authority.releaseDelivery(nextClaim)
  })

  it('reclaims a started claim under a replacement owner into recover mode without manual cleanup', async () => {
    const authority = authorityFor()
    const oldClaim = await claimFor(authority)
    await expect(authority.markProviderIOStarted(oldClaim)).resolves.toEqual({ status: 'fenced' })
    const replacementLease = deliveryLease({ ownerToken: 'worker-41' })
    authority.setJobLease(replacementLease)
    const outbound = createFakePlatformConversationOutboundPort()
    const recover = vi.spyOn(outbound, 'recoverUnknownOutcome')
    const send = vi.spyOn(outbound, 'send')

    await expect(
      createPlatformConversationDeliveryService({ authority, outbound }).deliver(
        deliveryIntent(),
        replacementLease,
      ),
    ).resolves.toMatchObject({ status: 'delivery_unknown' })
    expect(recover).toHaveBeenCalledTimes(1)
    expect(send).not.toHaveBeenCalled()
    await expect(authority.releaseDelivery(oldClaim)).rejects.toThrow('no longer active')
  })

  it('reclaims a naturally expired unstarted claim for a new owner without manual cleanup', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2030-01-01T00:00:00.000Z'))
    try {
      const expiringLease = deliveryLease({
        leaseExpiresAt: '2030-01-01T00:00:01.000Z',
        ownerToken: 'worker-old',
      })
      const authority = createFakePlatformConversationDeliveryAuthority({
        initialIntents: [deliveryIntent()],
        initialJobLeases: [expiringLease],
        initialSnapshots: [{ conversationId: 42, handoffStatus: 'ai_active', revision: 7 }],
      })
      await claimFor(authority, deliveryIntent(), expiringLease)
      vi.setSystemTime(new Date('2030-01-01T00:00:02.000Z'))
      const replacementLease = deliveryLease({
        leaseExpiresAt: '2030-01-01T01:00:00.000Z',
        ownerToken: 'worker-new',
      })
      authority.setJobLease(replacementLease)

      const reclaimed = await claimFor(authority, deliveryIntent(), replacementLease)
      expect(reclaimed.mode).toBe('send')
      await authority.releaseDelivery(reclaimed)
    } finally {
      vi.useRealTimers()
    }
  })

  it('rejects a valid lease belonging to a different Job than the delivery intent', async () => {
    const unrelatedLease = deliveryLease({ jobId: 41, ownerToken: 'worker-41' })
    const authority = createFakePlatformConversationDeliveryAuthority({
      initialIntents: [deliveryIntent()],
      initialJobLeases: [deliveryLease(), unrelatedLease],
      initialSnapshots: [{ conversationId: 42, handoffStatus: 'ai_active', revision: 7 }],
    })
    const outbound = createFakePlatformConversationOutboundPort()
    const send = vi.spyOn(outbound, 'send')

    await expect(
      createPlatformConversationDeliveryService({ authority, outbound }).deliver(
        deliveryIntent(),
        unrelatedLease,
      ),
    ).resolves.toMatchObject({ errorCode: 'invalid_request', status: 'blocked' })
    expect(send).not.toHaveBeenCalled()
  })

  it('does not allow an existing delivery identity to be rebound to another Job', () => {
    const authority = authorityFor()

    expect(() => authority.registerDeliveryIntent(deliveryIntent({ jobId: 41 }))).toThrow(
      'delivery intent identity is already registered',
    )
  })

  it('releases a claimed authority fence that does not match the requested Job lease', async () => {
    const baseAuthority = authorityFor()
    const otherLease = deliveryLease({ ownerToken: 'worker-other' })
    baseAuthority.setJobLease(otherLease)
    const authority: PlatformConversationDeliveryAuthorityPort = {
      claimDelivery: (intent) => baseAuthority.claimDelivery(intent, otherLease),
      markProviderIOStarted: baseAuthority.markProviderIOStarted,
      releaseDelivery: baseAuthority.releaseDelivery,
    }
    const outbound = createFakePlatformConversationOutboundPort()
    const send = vi.spyOn(outbound, 'send')

    await expect(
      createPlatformConversationDeliveryService({ authority, outbound }).deliver(
        deliveryIntent(),
        deliveryLease(),
      ),
    ).resolves.toMatchObject({ errorCode: 'invalid_request', status: 'blocked' })
    expect(send).not.toHaveBeenCalled()

    const nextClaim = await claimFor(baseAuthority, deliveryIntent(), otherLease)
    expect(nextClaim.mode).toBe('send')
    await baseAuthority.releaseDelivery(nextClaim)
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
    }).deliver(deliveryIntent(), deliveryLease())
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
      claimDelivery: async (
        intent: PlatformConversationDeliveryIntent,
        leaseFence: PlatformConversationDeliveryLeaseFence,
      ) => {
        markClaimStarted()
        await claimMayContinue
        return authority.claimDelivery(intent, leaseFence)
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
    }).deliver(mutableIntent, deliveryLease())
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
      createPlatformConversationDeliveryService({ authority, outbound }).deliver(
        deliveryIntent(),
        deliveryLease(),
      ),
    ).resolves.toEqual({
      deliveryKey: 'conversation-42:reply-7',
      platform: 'facebook-messenger',
      status: 'delivery_unknown',
    })
    expect(send).toHaveBeenCalledTimes(1)
    expect(recover).toHaveBeenCalledTimes(1)

    await expect(
      createPlatformConversationDeliveryService({ authority, outbound }).deliver(
        deliveryIntent(),
        deliveryLease(),
      ),
    ).resolves.toEqual({
      deliveryKey: 'conversation-42:reply-7',
      platform: 'facebook-messenger',
      status: 'delivery_unknown',
    })
    expect(send).toHaveBeenCalledTimes(1)
    expect(recover).toHaveBeenCalledTimes(2)

    await expect(
      createPlatformConversationDeliveryService({ authority, outbound }).deliver(
        deliveryIntent(),
        deliveryLease(),
      ),
    ).resolves.toEqual({
      deliveryKey: 'conversation-42:reply-7',
      platform: 'facebook-messenger',
      status: 'delivery_unknown',
    })
    expect(send).toHaveBeenCalledTimes(1)
    expect(recover).toHaveBeenCalledTimes(3)
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
      createPlatformConversationDeliveryService({ authority, outbound }).deliver(
        deliveryIntent(),
        deliveryLease(),
      ),
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
      createPlatformConversationDeliveryService({ authority, outbound }).deliver(
        deliveryIntent(),
        deliveryLease(),
      ),
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
      createPlatformConversationDeliveryService({ authority, outbound }).deliver(
        deliveryIntent(),
        deliveryLease(),
      ),
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
      createPlatformConversationDeliveryService({ authority, outbound }).deliver(
        deliveryIntent(),
        deliveryLease(),
      ),
    ).resolves.toEqual({
      deliveryKey: 'conversation-42:reply-7',
      platform: 'facebook-messenger',
      status: 'delivery_unknown',
    })
  })

  it.each([
    ['a recovery-only provider_accepted status', { status: 'provider_accepted' }],
    ['a recovery-only delivery_unknown status', { status: 'delivery_unknown' }],
    ['a recovery-only retry_same_delivery_key status', { status: 'retry_same_delivery_key' }],
    ['an unknown status', { status: 'invented_status' }],
    [
      'delivery_unknown as a confirmed blocked error',
      { errorCode: 'delivery_unknown', retryable: false, status: 'blocked' },
    ],
    ['a blocked result without retryable', { errorCode: 'rate_limited', status: 'blocked' }],
    [
      'retryAfterSeconds on a non-retryable block',
      {
        errorCode: 'permission_required',
        retryAfterSeconds: 30,
        retryable: false,
        status: 'blocked',
      },
    ],
    [
      'a non-positive retryAfterSeconds',
      { errorCode: 'rate_limited', retryAfterSeconds: 0, retryable: true, status: 'blocked' },
    ],
    [
      'variant fields on an accepted result',
      { errorCode: 'rate_limited', retryable: true, status: 'accepted' },
    ],
    ['an extra provider field', { providerReference: 'provider-message-1', status: 'accepted' }],
    ['a non-object result', null],
    ['an array result', []],
  ])('fails closed when a normal adapter returns %s', async (_description, malformedResult) => {
    const authority = authorityFor()
    const outbound: PlatformConversationOutboundPort = {
      recoverUnknownOutcome: vi.fn(async (input) => ({
        deliveryKey: input.deliveryKey,
        platform: input.platform,
        status: 'delivery_unknown' as const,
      })),
      send: vi.fn(async () =>
        malformedResult && typeof malformedResult === 'object' && !Array.isArray(malformedResult)
          ? ({
              deliveryKey: 'conversation-42:reply-7',
              platform: 'facebook-messenger',
              ...malformedResult,
            } as never)
          : (malformedResult as never),
      ),
    }

    await expect(
      createPlatformConversationDeliveryService({ authority, outbound }).deliver(
        deliveryIntent(),
        deliveryLease(),
      ),
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
      deliveryLease(),
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
      createPlatformConversationDeliveryService({ authority, outbound }).deliver(
        deliveryIntent(),
        deliveryLease(),
      ),
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
      createPlatformConversationDeliveryService({ authority, outbound }).deliver(
        deliveryIntent(),
        deliveryLease(),
      ),
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
    const abandonedClaim = await claimFor(authority)
    await expect(authority.markProviderIOStarted(abandonedClaim)).resolves.toEqual({
      status: 'fenced',
    })
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
          const outcome = await delivery.deliver(deliveryIntent(), deliveryLease())
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

  it.each([
    ['a human takeover', { conversationId: 42, handoffStatus: 'human_active' as const, revision: 8 }],
    ['a newer AI revision', { conversationId: 42, handoffStatus: 'ai_active' as const, revision: 8 }],
  ])(
    'fences a same-key recovery retry after %s',
    async (_description, changedSnapshot) => {
      const authority = authorityFor()
      const abandonedClaim = await claimFor(authority)
      await expect(authority.markProviderIOStarted(abandonedClaim)).resolves.toEqual({
        status: 'fenced',
      })
      expect(authority.expireDeliveryClaim(42)).toBe(true)
      expect(authority.setDeliverySnapshot(changedSnapshot)).toBe(true)

      const send = vi.fn(async (input: PlatformConversationOutboundRequest) => ({
        deliveryKey: input.deliveryKey,
        platform: input.platform,
        status: 'accepted' as const,
      }))
      const outbound: PlatformConversationOutboundPort = {
        recoverUnknownOutcome: vi.fn(async (input) => ({
          deliveryKey: input.deliveryKey,
          platform: input.platform,
          status: 'retry_same_delivery_key' as const,
        })),
        send,
      }

      await expect(
        createPlatformConversationDeliveryService({ authority, outbound }).deliver(
          deliveryIntent(),
          deliveryLease(),
        ),
      ).resolves.toEqual({
        deliveryKey: 'conversation-42:reply-7',
        platform: 'facebook-messenger',
        status: 'delivery_unknown',
      })
      expect(send).not.toHaveBeenCalled()
    },
  )

  it('does not let a changed payload inherit another intent recovery fence', async () => {
    const authority = authorityFor()
    const abandonedClaim = await claimFor(authority)
    await expect(authority.markProviderIOStarted(abandonedClaim)).resolves.toEqual({
      status: 'fenced',
    })
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
      createPlatformConversationDeliveryService({ authority, outbound }).deliver(
        changedIntent,
        deliveryLease(),
      ),
    ).resolves.toMatchObject({ errorCode: 'invalid_request', status: 'blocked' })
    expect(send).not.toHaveBeenCalled()
  })

  it('performs exactly one fenced same-key retry when recovery proves provider idempotency', async () => {
    const authority = authorityFor()
    const providerState = createFakePlatformConversationOutboundProviderState({
      recoveryMode: 'provider_idempotency_key',
    })
    const outbound = createFakePlatformConversationOutboundPort({ providerState })
    const send = vi.spyOn(outbound, 'send')
    const abandonedClaim = await claimFor(authority)
    await expect(authority.markProviderIOStarted(abandonedClaim)).resolves.toEqual({
      status: 'fenced',
    })
    outbound.loseAcceptedResultNext({ platform: 'facebook-messenger' })
    await expect(outbound.send(transport())).rejects.toBeInstanceOf(
      PlatformConversationOutboundOutcomeUnknownError,
    )
    expect(authority.expireDeliveryClaim(42)).toBe(true)

    await expect(
      createPlatformConversationDeliveryService({ authority, outbound }).deliver(
        deliveryIntent(),
        deliveryLease(),
      ),
    ).resolves.toEqual({
      deliveryKey: 'conversation-42:reply-7',
      platform: 'facebook-messenger',
      status: 'duplicate',
    })
    expect(send).toHaveBeenCalledTimes(2)

    const nextClaim = await claimFor(authority)
    expect(nextClaim.mode).toBe('send')
    await authority.releaseDelivery(nextClaim)
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
      createPlatformConversationDeliveryService({ authority, outbound }).deliver(
        deliveryIntent(),
        deliveryLease(),
      ),
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
      createPlatformConversationDeliveryService({ authority, outbound }).deliver(
        deliveryIntent(),
        deliveryLease(),
      ),
    ).resolves.toMatchObject({ status: 'delivery_unknown' })
  })

  it('rejects extra fields on a same-key recovery action without resending', async () => {
    const authority = authorityFor()
    const send = vi
      .fn()
      .mockRejectedValueOnce(
        new PlatformConversationOutboundOutcomeUnknownError({
          deliveryKey: 'conversation-42:reply-7',
          platform: 'facebook-messenger',
        }),
      )
      .mockResolvedValue({
        deliveryKey: 'conversation-42:reply-7',
        platform: 'facebook-messenger',
        status: 'accepted',
      })
    const outbound: PlatformConversationOutboundPort = {
      recoverUnknownOutcome: vi.fn(async (input) =>
        ({
          deliveryKey: input.deliveryKey,
          extra: 'not part of the recovery union',
          platform: input.platform,
          status: 'retry_same_delivery_key',
        }) as never,
      ),
      send,
    }

    await expect(
      createPlatformConversationDeliveryService({ authority, outbound }).deliver(
        deliveryIntent(),
        deliveryLease(),
      ),
    ).resolves.toEqual({
      deliveryKey: 'conversation-42:reply-7',
      platform: 'facebook-messenger',
      status: 'delivery_unknown',
    })
    expect(send).toHaveBeenCalledTimes(1)
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
          const outcome = await delivery.deliver(deliveryIntent(), deliveryLease())
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
