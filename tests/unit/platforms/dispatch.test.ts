import { describe, expect, it, vi } from 'vitest'

import { dispatchPlatformEvent } from '../../../src/modules/platforms/dispatch'
import type {
  NormalizedInboundMessage,
  NormalizedMessageStatus,
} from '../../../src/modules/platforms/types'

const inbound: NormalizedInboundMessage = {
  accountExternalId: 'account-1',
  content: { messageType: 'text', text: 'fixture' },
  externalEventId: 'message-1',
  idempotencyKey: 'facebook-messenger:message-1',
  kind: 'inbound-message',
  occurredAt: '2026-07-21T08:00:00.000Z',
  platform: 'facebook-messenger',
  recipientExternalId: 'account-1',
  senderExternalId: 'sender-1',
}

const messageStatus: NormalizedMessageStatus = {
  accountExternalId: 'account-1',
  externalEventId: 'outbound-1:delivered:1',
  idempotencyKey: 'instagram:outbound-1:delivered:1',
  kind: 'message-status',
  messageExternalId: 'outbound-1',
  occurredAt: '2026-07-21T08:00:00.000Z',
  platform: 'instagram',
  recipientExternalId: 'recipient-1',
  status: 'delivered',
}

describe('normalized platform event dispatch', () => {
  it('routes inbound messages only to the conversation port', async () => {
    const conversations = {
      writeInboundMessage: vi.fn(async () => ({
        idempotencyKey: inbound.idempotencyKey,
        status: 'accepted' as const,
      })),
    }
    const messageStatuses = {
      writeMessageStatus: vi.fn(async () => ({
        idempotencyKey: messageStatus.idempotencyKey,
        status: 'accepted' as const,
      })),
    }

    await expect(dispatchPlatformEvent(inbound, { conversations, messageStatuses })).resolves.toEqual({
      idempotencyKey: inbound.idempotencyKey,
      status: 'accepted',
    })

    expect(conversations.writeInboundMessage).toHaveBeenCalledWith(inbound)
    expect(messageStatuses.writeMessageStatus).not.toHaveBeenCalled()
  })

  it('routes message delivery callbacks only to the message-status port', async () => {
    const conversations = {
      writeInboundMessage: vi.fn(async () => ({
        idempotencyKey: inbound.idempotencyKey,
        status: 'accepted' as const,
      })),
    }
    const messageStatuses = {
      writeMessageStatus: vi.fn(async () => ({
        idempotencyKey: messageStatus.idempotencyKey,
        status: 'accepted' as const,
      })),
    }

    await expect(dispatchPlatformEvent(messageStatus, { conversations, messageStatuses })).resolves.toEqual({
      idempotencyKey: messageStatus.idempotencyKey,
      status: 'accepted',
    })

    expect(messageStatuses.writeMessageStatus).toHaveBeenCalledWith(messageStatus)
    expect(conversations.writeInboundMessage).not.toHaveBeenCalled()
  })

  it('requires downstream writers to report duplicate suppression through the delivery result', async () => {
    const seen = new Set<string>()
    const conversations = {
      writeInboundMessage: vi.fn(async (message: NormalizedInboundMessage) => {
        const status = seen.has(message.idempotencyKey) ? 'duplicate' : 'accepted'
        seen.add(message.idempotencyKey)
        return { idempotencyKey: message.idempotencyKey, status } as const
      }),
    }
    const messageStatuses = {
      writeMessageStatus: vi.fn(async (status: NormalizedMessageStatus) => ({
        idempotencyKey: status.idempotencyKey,
        status: 'accepted' as const,
      })),
    }

    await expect(
      Promise.all([
        dispatchPlatformEvent(inbound, { conversations, messageStatuses }),
        dispatchPlatformEvent(inbound, { conversations, messageStatuses }),
      ]),
    ).resolves.toEqual(
      expect.arrayContaining([
        { idempotencyKey: inbound.idempotencyKey, status: 'accepted' },
        { idempotencyKey: inbound.idempotencyKey, status: 'duplicate' },
      ]),
    )
    expect(conversations.writeInboundMessage).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: inbound.idempotencyKey }),
    )
  })
})
