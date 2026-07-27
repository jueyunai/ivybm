import { describe, expect, it, vi } from 'vitest'

import {
  createFakePlatformConversationOutboundPort,
  createFakePlatformConversationOutboundProviderState,
} from '../../../src/modules/platforms/fakeConversationOutboundPort'
import {
  PlatformConversationOutboundOutcomeUnknownError,
  type PlatformConversationOutboundRequest,
} from '../../../src/modules/platforms/types'

const request = (
  overrides: Partial<PlatformConversationOutboundRequest> = {},
): PlatformConversationOutboundRequest => ({
  accountExternalId: 'PAGE_FIXTURE_1',
  deliveryKey: 'conversation-42:reply-7',
  platform: 'facebook-messenger',
  recipientExternalId: 'SENDER_FIXTURE_1',
  text: 'Thank you. Which finish and approximate quantity do you need?',
  ...overrides,
})

describe('fake platform conversation outbound port', () => {
  it('accepts an AI-active request without network I/O and returns a duplicate for the same delivery key', async () => {
    const port = createFakePlatformConversationOutboundPort()
    const fetchSpy = vi.fn(async () => {
      throw new Error('network access is forbidden in the fake')
    })
    vi.stubGlobal('fetch', fetchSpy)

    try {
      const [first, duplicate] = await Promise.all([port.send(request()), port.send(request())])

      expect(first).toEqual({
        deliveryKey: 'conversation-42:reply-7',
        platform: 'facebook-messenger',
        status: 'accepted',
      })
      expect(duplicate).toEqual({
        deliveryKey: 'conversation-42:reply-7',
        platform: 'facebook-messenger',
        status: 'duplicate',
      })
      expect(fetchSpy).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('rejects a conflicting payload for a previously accepted delivery key', async () => {
    const port = createFakePlatformConversationOutboundPort()
    await port.send(request())

    await expect(
      port.send(request({ text: 'Changed reply must not be sent twice.' })),
    ).resolves.toEqual({
      deliveryKey: 'conversation-42:reply-7',
      errorCode: 'invalid_request',
      platform: 'facebook-messenger',
      retryable: false,
      status: 'blocked',
    })
  })

  it('keeps send idempotency isolated across adversarial account and delivery keys', async () => {
    const port = createFakePlatformConversationOutboundPort()
    const accountBoundary = request({
      accountExternalId: 'acct\u0000delivery',
      deliveryKey: 'key',
      recipientExternalId: 'RECIPIENT_A',
      text: 'Reply for account boundary A.',
    })
    const deliveryBoundary = request({
      accountExternalId: 'acct',
      deliveryKey: 'delivery\u0000key',
      recipientExternalId: 'RECIPIENT_B',
      text: 'Reply for account boundary B.',
    })

    await expect(port.send(accountBoundary)).resolves.toMatchObject({ status: 'accepted' })
    await expect(port.send(deliveryBoundary)).resolves.toMatchObject({ status: 'accepted' })
    await expect(port.send(accountBoundary)).resolves.toMatchObject({ status: 'duplicate' })
    await expect(port.send(deliveryBoundary)).resolves.toMatchObject({ status: 'duplicate' })
  })

  it('copies accepted input and returned inspection snapshots', async () => {
    const port = createFakePlatformConversationOutboundPort()
    const input = request({ deliveryKey: 'clone-safety-1' })
    await port.send(input)
    const mutableInput = input as { text: string }
    mutableInput.text = 'Caller mutation must not alter the fake state.'

    const stored = port.getAcceptedRequest({
      accountExternalId: input.accountExternalId,
      deliveryKey: input.deliveryKey,
      platform: input.platform,
    })
    expect(stored?.text).toBe('Thank you. Which finish and approximate quantity do you need?')
    if (stored) {
      const mutableStored = stored as { text: string }
      mutableStored.text = 'Returned mutation must not alter the fake state either.'
    }

    expect(
      port.getAcceptedRequest({
        accountExternalId: input.accountExternalId,
        deliveryKey: input.deliveryKey,
        platform: input.platform,
      })?.text,
    ).toBe('Thank you. Which finish and approximate quantity do you need?')
  })

  it('does not expose another account through an adversarial inspection key', async () => {
    const port = createFakePlatformConversationOutboundPort()
    const accountBoundary = request({
      accountExternalId: 'acct\u0000delivery',
      deliveryKey: 'key',
      recipientExternalId: 'RECIPIENT_A',
      text: 'Private reply A.',
    })
    const collidingInspectionKey = {
      accountExternalId: 'acct',
      deliveryKey: 'delivery\u0000key',
      platform: 'facebook-messenger' as const,
    }

    await port.send(accountBoundary)
    expect(port.getAcceptedRequest(collidingInspectionKey)).toBeUndefined()

    await port.send(
      request({
        ...collidingInspectionKey,
        recipientExternalId: 'RECIPIENT_B',
        text: 'Private reply B.',
      }),
    )
    expect(
      port.getAcceptedRequest({
        accountExternalId: accountBoundary.accountExternalId,
        deliveryKey: accountBoundary.deliveryKey,
        platform: accountBoundary.platform,
      }),
    ).toEqual(accountBoundary)
    expect(port.getAcceptedRequest(collidingInspectionKey)).toMatchObject({
      accountExternalId: 'acct',
      deliveryKey: 'delivery\u0000key',
      text: 'Private reply B.',
    })
  })

  it('fails closed for oversized text before consuming a queued failure', async () => {
    const port = createFakePlatformConversationOutboundPort()
    port.failNextSend({
      errorCode: 'provider_unavailable',
      platform: 'facebook-messenger',
      retryable: true,
    })

    await expect(
      port.send(request({ deliveryKey: 'oversized-text-1', text: 'x'.repeat(5_001) })),
    ).resolves.toEqual({
      deliveryKey: 'oversized-text-1',
      errorCode: 'invalid_request',
      platform: 'facebook-messenger',
      retryable: false,
      status: 'blocked',
    })
    await expect(port.send(request({ deliveryKey: 'queued-failure-survives-1' }))).resolves.toEqual(
      {
        deliveryKey: 'queued-failure-survives-1',
        errorCode: 'provider_unavailable',
        platform: 'facebook-messenger',
        retryable: true,
        status: 'blocked',
      },
    )
  })

  it('models retryable rate limiting and preserves platform isolation', async () => {
    const port = createFakePlatformConversationOutboundPort()
    port.failNextSend({
      errorCode: 'rate_limited',
      platform: 'instagram',
      retryAfterSeconds: 45,
      retryable: true,
    })

    await expect(port.send(request({ platform: 'instagram' }))).resolves.toEqual({
      deliveryKey: 'conversation-42:reply-7',
      errorCode: 'rate_limited',
      platform: 'instagram',
      retryAfterSeconds: 45,
      retryable: true,
      status: 'blocked',
    })
    await expect(port.send(request({ deliveryKey: 'facebook-isolated-1' }))).resolves.toMatchObject(
      {
        platform: 'facebook-messenger',
        status: 'accepted',
      },
    )
  })

  it('fails closed for malformed runtime input and unsupported messaging platforms', async () => {
    const port = createFakePlatformConversationOutboundPort()

    await expect(port.send(request({ platform: 'linkedin' as never }))).rejects.toThrow(
      'Fake messaging platform is unsupported',
    )
    await expect(port.send(request({ deliveryKey: '   ' }))).resolves.toMatchObject({
      errorCode: 'invalid_request',
      retryable: false,
      status: 'blocked',
    })
    await expect(port.send(null as never)).rejects.toThrow(
      'Fake conversation outbound request must be an object',
    )
    expect(() =>
      port.failNextSend({
        errorCode: 'provider_unavailable',
        platform: 'linkedin' as never,
        retryable: true,
      }),
    ).toThrow('Fake messaging platform is unsupported')
  })

  it('rejects malformed fake failure controls before they can affect a later send', async () => {
    const port = createFakePlatformConversationOutboundPort()

    expect(() => port.failNextSend(null as never)).toThrow(
      'Fake conversation outbound failure must be an object',
    )
    expect(() =>
      port.failNextSend({
        errorCode: 'invented_error' as never,
        platform: 'facebook-messenger',
        retryable: true,
      }),
    ).toThrow('Fake conversation outbound error code is unsupported')
    expect(() =>
      port.failNextSend({
        errorCode: 'rate_limited',
        platform: 'facebook-messenger',
        retryAfterSeconds: 0.5,
        retryable: true,
      }),
    ).toThrow('Fake conversation outbound failure retryAfterSeconds must be a positive integer')
    expect(() =>
      port.failNextSend({
        errorCode: 'permission_required',
        platform: 'facebook-messenger',
        retryAfterSeconds: 30,
        retryable: false,
      }),
    ).toThrow('Fake conversation outbound failure retryAfterSeconds requires a retryable failure')
    expect(() =>
      createFakePlatformConversationOutboundProviderState({
        recoveryMode: 'invented-recovery' as never,
      }),
    ).toThrow('Fake conversation outbound recovery mode is unsupported')

    port.failNextSend({
      errorCode: 'permission_required',
      platform: 'facebook-messenger',
      retryable: false,
    })
    await expect(port.send(request({ deliveryKey: 'terminal-failure-1' }))).resolves.toEqual({
      deliveryKey: 'terminal-failure-1',
      errorCode: 'permission_required',
      platform: 'facebook-messenger',
      retryable: false,
      status: 'blocked',
    })

    await expect(
      port.send(request({ deliveryKey: 'unpoisoned-after-invalid-failure-1' })),
    ).resolves.toMatchObject({
      status: 'accepted',
    })
  })

  it('recovers a provider acceptance lost with the worker by reusing the same delivery key', async () => {
    const providerState = createFakePlatformConversationOutboundProviderState({
      recoveryMode: 'provider_idempotency_key',
    })
    const firstWorker = createFakePlatformConversationOutboundPort({ providerState })
    firstWorker.loseAcceptedResultNext({ platform: 'facebook-messenger' })

    await expect(
      firstWorker.send(request({ deliveryKey: 'lost-result-idempotency-1' })),
    ).rejects.toMatchObject({
      code: 'delivery_unknown',
      deliveryKey: 'lost-result-idempotency-1',
      platform: 'facebook-messenger',
      retryable: false,
    })

    const reclaimedWorker = createFakePlatformConversationOutboundPort({ providerState })
    await expect(
      reclaimedWorker.recoverUnknownOutcome(request({ deliveryKey: 'lost-result-idempotency-1' })),
    ).resolves.toEqual({
      deliveryKey: 'lost-result-idempotency-1',
      platform: 'facebook-messenger',
      status: 'retry_same_delivery_key',
    })
    await expect(
      reclaimedWorker.send(request({ deliveryKey: 'lost-result-idempotency-1' })),
    ).resolves.toEqual({
      deliveryKey: 'lost-result-idempotency-1',
      platform: 'facebook-messenger',
      status: 'duplicate',
    })
  })

  it('defaults an unknown Meta result to manual compensation instead of blind retry', async () => {
    const providerState = createFakePlatformConversationOutboundProviderState()
    const firstWorker = createFakePlatformConversationOutboundPort({ providerState })
    firstWorker.loseAcceptedResultNext({ platform: 'facebook-messenger' })

    await expect(
      firstWorker.send(request({ deliveryKey: 'meta-default-unknown-1' })),
    ).rejects.toBeInstanceOf(PlatformConversationOutboundOutcomeUnknownError)
    await expect(
      createFakePlatformConversationOutboundPort({ providerState }).recoverUnknownOutcome(
        request({ deliveryKey: 'meta-default-unknown-1' }),
      ),
    ).resolves.toEqual({
      deliveryKey: 'meta-default-unknown-1',
      platform: 'facebook-messenger',
      status: 'delivery_unknown',
    })
  })

  it('uses provider lookup evidence or stops at delivery_unknown instead of blind resend', async () => {
    const lookupState = createFakePlatformConversationOutboundProviderState({
      recoveryMode: 'provider_delivery_lookup',
    })
    const lookupWorker = createFakePlatformConversationOutboundPort({ providerState: lookupState })
    lookupWorker.loseAcceptedResultNext({ platform: 'instagram' })
    await expect(
      lookupWorker.send(request({ deliveryKey: 'lost-result-lookup-1', platform: 'instagram' })),
    ).rejects.toBeInstanceOf(PlatformConversationOutboundOutcomeUnknownError)

    await expect(
      createFakePlatformConversationOutboundPort({
        providerState: lookupState,
      }).recoverUnknownOutcome(
        request({ deliveryKey: 'lost-result-lookup-1', platform: 'instagram' }),
      ),
    ).resolves.toEqual({
      deliveryKey: 'lost-result-lookup-1',
      platform: 'instagram',
      providerReference: 'fake-provider-message-1',
      status: 'provider_accepted',
    })

    const lookupWithoutEvidenceState = createFakePlatformConversationOutboundProviderState({
      recoveryMode: 'provider_delivery_lookup',
    })
    const lookupWithoutEvidenceWorker = createFakePlatformConversationOutboundPort({
      providerState: lookupWithoutEvidenceState,
    })
    lookupWithoutEvidenceWorker.loseAcceptedResultNext({ platform: 'instagram' })
    await expect(
      lookupWithoutEvidenceWorker.send(
        request({ deliveryKey: 'missing-lookup-evidence-1', platform: 'instagram' }),
      ),
    ).rejects.toBeInstanceOf(PlatformConversationOutboundOutcomeUnknownError)
    for (const key of lookupWithoutEvidenceState.providerReferences.keys()) {
      lookupWithoutEvidenceState.providerReferences.set(key, 'missing-lookup-evidence-1')
    }

    await expect(
      createFakePlatformConversationOutboundPort({
        providerState: lookupWithoutEvidenceState,
      }).recoverUnknownOutcome(
        request({ deliveryKey: 'missing-lookup-evidence-1', platform: 'instagram' }),
      ),
    ).resolves.toEqual({
      deliveryKey: 'missing-lookup-evidence-1',
      platform: 'instagram',
      status: 'delivery_unknown',
    })

    const unknownState = createFakePlatformConversationOutboundProviderState({
      recoveryMode: 'manual_compensation',
    })
    const unknownWorker = createFakePlatformConversationOutboundPort({
      providerState: unknownState,
    })
    unknownWorker.loseAcceptedResultNext({ platform: 'tiktok' })
    await expect(
      unknownWorker.send(request({ deliveryKey: 'lost-result-unknown-1', platform: 'tiktok' })),
    ).rejects.toBeInstanceOf(PlatformConversationOutboundOutcomeUnknownError)

    await expect(
      createFakePlatformConversationOutboundPort({
        providerState: unknownState,
      }).recoverUnknownOutcome(
        request({ deliveryKey: 'lost-result-unknown-1', platform: 'tiktok' }),
      ),
    ).resolves.toEqual({
      deliveryKey: 'lost-result-unknown-1',
      platform: 'tiktok',
      status: 'delivery_unknown',
    })
  })

  it('does not treat a changed payload as recoverable under an existing delivery key', async () => {
    const providerState = createFakePlatformConversationOutboundProviderState()
    const firstWorker = createFakePlatformConversationOutboundPort({ providerState })
    await firstWorker.send(request({ deliveryKey: 'recovery-conflict-1' }))

    await expect(
      createFakePlatformConversationOutboundPort({ providerState }).recoverUnknownOutcome(
        request({
          deliveryKey: 'recovery-conflict-1',
          text: 'Changed reply must not be recovered.',
        }),
      ),
    ).resolves.toEqual({
      deliveryKey: 'recovery-conflict-1',
      platform: 'facebook-messenger',
      status: 'delivery_unknown',
    })
  })

  it('keeps provider lookup recovery isolated across adversarial account and delivery keys', async () => {
    const providerState = createFakePlatformConversationOutboundProviderState({
      recoveryMode: 'provider_delivery_lookup',
    })
    const sender = createFakePlatformConversationOutboundPort({ providerState })
    const accountBoundary = request({
      accountExternalId: 'acct\u0000delivery',
      deliveryKey: 'key',
      recipientExternalId: 'RECIPIENT_A',
      text: 'Recovery reply A.',
    })
    const deliveryBoundary = request({
      accountExternalId: 'acct',
      deliveryKey: 'delivery\u0000key',
      recipientExternalId: 'RECIPIENT_B',
      text: 'Recovery reply B.',
    })
    sender.loseAcceptedResultNext({ platform: 'facebook-messenger' })
    sender.loseAcceptedResultNext({ platform: 'facebook-messenger' })

    await expect(sender.send(accountBoundary)).rejects.toBeInstanceOf(
      PlatformConversationOutboundOutcomeUnknownError,
    )
    await expect(sender.send(deliveryBoundary)).rejects.toBeInstanceOf(
      PlatformConversationOutboundOutcomeUnknownError,
    )

    const recovery = createFakePlatformConversationOutboundPort({ providerState })
    const recoveredA = await recovery.recoverUnknownOutcome(accountBoundary)
    const recoveredB = await recovery.recoverUnknownOutcome(deliveryBoundary)
    expect(recoveredA).toMatchObject({ status: 'provider_accepted' })
    expect(recoveredB).toMatchObject({ status: 'provider_accepted' })
    expect(recoveredA).not.toEqual(recoveredB)
    if (recoveredA.status !== 'provider_accepted' || recoveredB.status !== 'provider_accepted') {
      throw new Error('Both adversarial fixtures must recover with provider evidence')
    }
    expect(recoveredA.providerReference).not.toBe(recoveredB.providerReference)
  })
})
