import { describe, expect, it } from 'vitest'

import type { PlatformConversationOutboundPort } from '../../../src/modules/platforms/ports'
import {
  createProviderAcceptanceEvidence,
  PLATFORM_CONVERSATION_DELIVERY_BLOCK_REASONS,
  PlatformConversationOutboundOutcomeUnknownError,
  PLATFORM_CONVERSATION_OUTBOUND_RECOVERY_ACTIONS,
  PLATFORM_CONVERSATION_OUTBOUND_ERROR_CODES,
  type PlatformConversationOutboundErrorCode,
  type PlatformConversationDeliveryLeaseFence,
  type PlatformConversationOutboundRecoveryResult,
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

const retrySameDeliveryKey = async (
  input: PlatformConversationOutboundRequest,
): Promise<PlatformConversationOutboundRecoveryResult> => ({
  deliveryKey: input.deliveryKey,
  platform: input.platform,
  status: 'retry_same_delivery_key',
})

describe('phase-one platform conversation outbound contract', () => {
  it('freezes only credential-free outbound error codes', () => {
    expect(PLATFORM_CONVERSATION_OUTBOUND_ERROR_CODES).toEqual([
      'account_not_connected',
      'authorization_required',
      'delivery_busy',
      'delivery_unknown',
      'handoff_required',
      'invalid_request',
      'lease_conflict',
      'message_window_closed',
      'permission_required',
      'platform_blocked',
      'provider_unavailable',
      'rate_limited',
      'stale_revision',
    ])
  })

  it('freezes Job lease evidence and distinguishable delivery claim blocks', () => {
    const leaseFence: PlatformConversationDeliveryLeaseFence = {
      jobId: 40,
      leaseExpiresAt: '2026-07-28T06:00:00.000Z',
      ownerToken: 'worker-40',
    }

    expect(Object.keys(leaseFence).sort()).toEqual(['jobId', 'leaseExpiresAt', 'ownerToken'])
    expect(PLATFORM_CONVERSATION_DELIVERY_BLOCK_REASONS).toEqual([
      'busy',
      'claim_conflict',
      'handoff_required',
      'intent_mismatch',
      'lease_conflict',
      'missing_intent',
      'missing_snapshot',
      'stale_revision',
    ])
  })

  it('freezes a server-only, credential-free acceptance shape', async () => {
    let received: PlatformConversationOutboundRequest | undefined
    const port: PlatformConversationOutboundPort = {
      recoverUnknownOutcome: retrySameDeliveryKey,
      send: async (input) => {
        received = structuredClone(input)
        return {
          deliveryKey: input.deliveryKey,
          platform: input.platform,
          status: 'accepted',
        }
      },
    }

    await expect(port.send(request())).resolves.toEqual({
      deliveryKey: 'conversation-42:reply-7',
      platform: 'facebook-messenger',
      status: 'accepted',
    })
    expect(received).toEqual(request())
    expect(Object.keys(received ?? {}).sort()).toEqual([
      'accountExternalId',
      'deliveryKey',
      'platform',
      'recipientExternalId',
      'text',
    ])
  })

  it('freezes machine-readable, retry-aware blocked outcomes without a sent state', async () => {
    const code: PlatformConversationOutboundErrorCode = 'rate_limited'
    const port: PlatformConversationOutboundPort = {
      recoverUnknownOutcome: retrySameDeliveryKey,
      send: async (input) => ({
        deliveryKey: input.deliveryKey,
        errorCode: code,
        platform: input.platform,
        retryAfterSeconds: 30,
        retryable: true,
        status: 'blocked',
      }),
    }

    await expect(port.send(request({ platform: 'instagram' }))).resolves.toEqual({
      deliveryKey: 'conversation-42:reply-7',
      errorCode: 'rate_limited',
      platform: 'instagram',
      retryAfterSeconds: 30,
      retryable: true,
      status: 'blocked',
    })
  })

  it('freezes recovery actions for a provider-accepted result lost before persistence', async () => {
    expect(PLATFORM_CONVERSATION_OUTBOUND_RECOVERY_ACTIONS).toEqual([
      'delivery_unknown',
      'provider_accepted',
      'retry_same_delivery_key',
    ])

    const port: PlatformConversationOutboundPort = {
      recoverUnknownOutcome: async (
        input,
      ): Promise<PlatformConversationOutboundRecoveryResult> => ({
        deliveryKey: input.deliveryKey,
        platform: input.platform,
        status: 'retry_same_delivery_key',
      }),
      send: async (input) => ({
        deliveryKey: input.deliveryKey,
        platform: input.platform,
        status: 'accepted',
      }),
    }

    await expect(port.recoverUnknownOutcome(request())).resolves.toEqual({
      deliveryKey: 'conversation-42:reply-7',
      platform: 'facebook-messenger',
      status: 'retry_same_delivery_key',
    })

    expect(
      createProviderAcceptanceEvidence({
        deliveryKey: 'conversation-42:reply-7',
        providerReference: '',
      }),
    ).toBeUndefined()
    expect(
      createProviderAcceptanceEvidence({
        deliveryKey: 'conversation-42:reply-7',
        providerReference: null,
      }),
    ).toBeUndefined()
    expect(
      createProviderAcceptanceEvidence({
        deliveryKey: 'conversation-42:reply-7',
        providerReference: 'conversation-42:reply-7',
      }),
    ).toBeUndefined()
    expect(
      createProviderAcceptanceEvidence({
        deliveryKey: 'conversation-42:reply-7',
        providerReference: 'provider\nmessage',
      }),
    ).toBeUndefined()
    expect(
      createProviderAcceptanceEvidence({
        deliveryKey: 'conversation-42:reply-7',
        providerReference: '凭'.repeat(200),
      }),
    ).toBeUndefined()

    const providerReference = createProviderAcceptanceEvidence({
      deliveryKey: 'conversation-42:reply-7',
      providerReference: 'provider-message-opaque-7',
    })
    expect(providerReference).toBe('provider-message-opaque-7')
    if (!providerReference) throw new Error('Fixture provider evidence must be non-empty')

    const providerLookupPort: PlatformConversationOutboundPort = {
      recoverUnknownOutcome: async (
        input,
      ): Promise<PlatformConversationOutboundRecoveryResult> => ({
        deliveryKey: input.deliveryKey,
        platform: input.platform,
        providerReference,
        status: 'provider_accepted',
      }),
      send: async (input) => ({
        deliveryKey: input.deliveryKey,
        platform: input.platform,
        status: 'accepted',
      }),
    }

    await expect(providerLookupPort.recoverUnknownOutcome(request())).resolves.toEqual({
      deliveryKey: 'conversation-42:reply-7',
      platform: 'facebook-messenger',
      providerReference: 'provider-message-opaque-7',
      status: 'provider_accepted',
    })
  })

  it('exposes a stable non-retryable signal after crossing the send boundary', () => {
    const error = new PlatformConversationOutboundOutcomeUnknownError({
      deliveryKey: 'conversation-42:reply-7',
      platform: 'facebook-messenger',
    })

    expect(error).toMatchObject({
      code: 'delivery_unknown',
      deliveryKey: 'conversation-42:reply-7',
      name: 'PlatformConversationOutboundOutcomeUnknownError',
      platform: 'facebook-messenger',
      retryable: false,
    })
    expect(error.message).not.toContain('token')
  })
})
