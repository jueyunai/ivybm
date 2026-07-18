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
  idempotencyKey: 'whatsapp:message-1',
  kind: 'inbound-message',
  occurredAt: '2026-07-18T08:00:00.000Z',
  platform: 'whatsapp',
  recipientExternalId: 'account-1',
  senderExternalId: 'sender-1',
}

const messageStatus: NormalizedMessageStatus = {
  accountExternalId: 'account-1',
  externalEventId: 'outbound-1:delivered:1',
  idempotencyKey: 'whatsapp:outbound-1:delivered:1',
  kind: 'message-status',
  messageExternalId: 'outbound-1',
  occurredAt: '2026-07-18T08:00:00.000Z',
  platform: 'whatsapp',
  recipientExternalId: 'recipient-1',
  status: 'delivered',
}

describe('normalized platform event dispatch', () => {
  it('routes inbound messages only to the conversation port', async () => {
    const conversations = { writeInboundMessage: vi.fn(async () => undefined) }
    const messageStatuses = { writeMessageStatus: vi.fn(async () => undefined) }

    await dispatchPlatformEvent(inbound, { conversations, messageStatuses })

    expect(conversations.writeInboundMessage).toHaveBeenCalledWith(inbound)
    expect(messageStatuses.writeMessageStatus).not.toHaveBeenCalled()
  })

  it('routes message delivery callbacks only to the message-status port', async () => {
    const conversations = { writeInboundMessage: vi.fn(async () => undefined) }
    const messageStatuses = { writeMessageStatus: vi.fn(async () => undefined) }

    await dispatchPlatformEvent(messageStatus, { conversations, messageStatuses })

    expect(messageStatuses.writeMessageStatus).toHaveBeenCalledWith(messageStatus)
    expect(conversations.writeInboundMessage).not.toHaveBeenCalled()
  })
})
