import { describe, expect, it, vi } from 'vitest'

import type { PlatformMessagingAccountAuthorizer } from '@/modules/platforms/payloadMessagingAccountAuthorizer'
import {
  deliverVerifiedSocialInbound,
  type VerifiedSocialConversationPort,
} from '@/modules/platforms/socialContactDelivery'
import type { NormalizedInboundMessage } from '@/modules/platforms/types'

const inbound = (idempotencyKey = 'meta:event:v2:fixture'): NormalizedInboundMessage => ({
  accountExternalId: '129472283584550',
  content: { messageType: 'text', text: 'We need facade panels.' },
  externalEventId: 'mid-fixture-1',
  idempotencyKey,
  kind: 'inbound-message',
  occurredAt: '2026-08-12T00:00:00.000Z',
  platform: 'facebook-messenger',
  recipientExternalId: '129472283584550',
  senderExternalId: '122294474450066102',
})

describe('verified social inbound delivery', () => {
  it('authorizes before delivering one credential-free contact source', async () => {
    const assertCanReceive = vi.fn().mockResolvedValue(undefined)
    const writeVerifiedInboundMessage = vi.fn().mockResolvedValue({
      idempotencyKey: 'meta:event:v2:fixture',
      status: 'accepted',
    })

    await expect(
      deliverVerifiedSocialInbound({
        accountAuthorizer: { assertCanReceive },
        destination: { writeVerifiedInboundMessage },
        installationNamespace: 'ivybm-production',
        message: inbound(),
      }),
    ).resolves.toEqual({ idempotencyKey: 'meta:event:v2:fixture', status: 'accepted' })

    expect(assertCanReceive).toHaveBeenCalledWith({
      accountExternalId: '129472283584550',
      platform: 'facebook-messenger',
    })
    expect(assertCanReceive.mock.invocationCallOrder[0]).toBeLessThan(
      writeVerifiedInboundMessage.mock.invocationCallOrder[0]!,
    )

    const delivery = writeVerifiedInboundMessage.mock.calls[0]![0]
    expect(Object.isFrozen(delivery)).toBe(true)
    expect(Object.isFrozen(delivery.message)).toBe(true)
    expect(Object.isFrozen(delivery.message.content)).toBe(true)
    expect(Object.isFrozen(delivery.contactSource)).toBe(true)
    expect(delivery.message.idempotencyKey).toBe('meta:event:v2:fixture')
    expect(delivery.contactSource).toMatchObject({
      accountExternalId: '129472283584550',
      identityKey: expect.stringMatching(/^social-contact:v2:facebook-messenger:[a-f0-9]{64}$/),
      kind: 'verified-social-session',
      platform: 'facebook-messenger',
      senderExternalId: '122294474450066102',
    })
    expect(JSON.stringify(delivery)).not.toMatch(/access[_-]?token|secret/i)
  })

  it('does not call the destination when current account authorization is denied', async () => {
    const denied = new Error('account disabled')
    const accountAuthorizer: PlatformMessagingAccountAuthorizer = {
      assertCanReceive: vi.fn().mockRejectedValue(denied),
    }
    const destination: VerifiedSocialConversationPort = {
      writeVerifiedInboundMessage: vi.fn(),
    }

    await expect(
      deliverVerifiedSocialInbound({
        accountAuthorizer,
        destination,
        installationNamespace: 'ivybm-production',
        message: inbound(),
      }),
    ).rejects.toBe(denied)
    expect(destination.writeVerifiedInboundMessage).not.toHaveBeenCalled()
  })

  it('preserves transport idempotency while keeping contact identity stable', async () => {
    const seen = new Map<string, string>()
    const destination: VerifiedSocialConversationPort = {
      async writeVerifiedInboundMessage({ contactSource, message }) {
        const previousIdentity = seen.get(message.idempotencyKey)
        if (previousIdentity) {
          expect(previousIdentity).toBe(contactSource.identityKey)
          return { idempotencyKey: message.idempotencyKey, status: 'duplicate' }
        }
        seen.set(message.idempotencyKey, contactSource.identityKey)
        return { idempotencyKey: message.idempotencyKey, status: 'accepted' }
      },
    }
    const accountAuthorizer: PlatformMessagingAccountAuthorizer = {
      assertCanReceive: vi.fn().mockResolvedValue(undefined),
    }

    const first = await deliverVerifiedSocialInbound({
      accountAuthorizer,
      destination,
      installationNamespace: 'ivybm-production',
      message: inbound(),
    })
    const duplicate = await deliverVerifiedSocialInbound({
      accountAuthorizer,
      destination,
      installationNamespace: 'ivybm-production',
      message: inbound(),
    })

    expect(first.status).toBe('accepted')
    expect(duplicate.status).toBe('duplicate')
    expect(seen).toHaveLength(1)
    expect(accountAuthorizer.assertCanReceive).toHaveBeenCalledTimes(2)
  })
})
