import { describe, expect, it } from 'vitest'

import type { PlatformConversationOutboundPort } from '../../../src/modules/platforms/ports'
import {
  PLATFORM_CONVERSATION_OUTBOUND_ERROR_CODES,
  type PlatformConversationOutboundErrorCode,
  type PlatformConversationOutboundRequest,
} from '../../../src/modules/platforms/types'

const request = (
  overrides: Partial<PlatformConversationOutboundRequest> = {},
): PlatformConversationOutboundRequest => ({
  accountExternalId: 'PAGE_FIXTURE_1',
  deliveryKey: 'conversation-42:reply-7',
  externalThreadId: 'PAGE_FIXTURE_1:SENDER_FIXTURE_1',
  handoffStatus: 'ai_active',
  platform: 'facebook-messenger',
  recipientExternalId: 'SENDER_FIXTURE_1',
  text: 'Thank you. Which finish and approximate quantity do you need?',
  ...overrides,
})

describe('phase-one platform conversation outbound contract', () => {
  it('freezes only credential-free outbound error codes', () => {
    expect(PLATFORM_CONVERSATION_OUTBOUND_ERROR_CODES).toEqual([
      'account_not_connected',
      'authorization_required',
      'handoff_required',
      'invalid_request',
      'message_window_closed',
      'permission_required',
      'platform_blocked',
      'provider_unavailable',
      'rate_limited',
      'unknown',
    ])
  })

  it('freezes a server-only, credential-free acceptance shape', async () => {
    let received: PlatformConversationOutboundRequest | undefined
    const port: PlatformConversationOutboundPort = {
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
  })

  it('freezes machine-readable, retry-aware blocked outcomes without a sent state', async () => {
    const code: PlatformConversationOutboundErrorCode = 'rate_limited'
    const port: PlatformConversationOutboundPort = {
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
})
