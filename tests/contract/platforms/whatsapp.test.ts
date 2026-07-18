import messageFixture from '../../fixtures/platforms/whatsapp-message.json'
import statusFixture from '../../fixtures/platforms/whatsapp-status.json'
import { describe, expect, it } from 'vitest'

import { createWhatsAppConnector } from '../../../src/modules/platforms/whatsapp/connector'

describe('WhatsApp Cloud API webhook contract', () => {
  const connector = createWhatsAppConnector()

  it('normalizes an inbound text message and synthetic contact profile', () => {
    expect(connector.normalize(messageFixture)).toEqual([
      {
        accountExternalId: 'PHONE_NUMBER_FIXTURE_1',
        contactName: 'Fixture Buyer',
        content: {
          messageType: 'text',
          text: 'What information is needed for a quotation?',
        },
        externalEventId: 'wamid.fixture.message.1',
        idempotencyKey: 'whatsapp:wamid.fixture.message.1',
        kind: 'inbound-message',
        occurredAt: '2024-03-09T16:03:20.000Z',
        platform: 'whatsapp',
        recipientExternalId: 'PHONE_NUMBER_FIXTURE_1',
        senderExternalId: '15551112222',
      },
    ])
  })

  it('normalizes delivery callbacks with a transition-specific external event ID', () => {
    expect(connector.normalize(statusFixture)).toEqual([
      {
        accountExternalId: 'PHONE_NUMBER_FIXTURE_1',
        externalEventId: 'wamid.fixture.outbound.1:delivered:1710000300',
        idempotencyKey: 'whatsapp:wamid.fixture.outbound.1:delivered:1710000300',
        kind: 'message-status',
        messageExternalId: 'wamid.fixture.outbound.1',
        occurredAt: '2024-03-09T16:05:00.000Z',
        platform: 'whatsapp',
        recipientExternalId: '15551112222',
        status: 'delivered',
      },
    ])
  })

  it('rejects non-WhatsApp webhook objects', () => {
    expect(() => connector.normalize({ object: 'page', entry: [] })).toThrow(
      'Unsupported WhatsApp webhook object',
    )
  })

  it('rejects changes that do not identify the WhatsApp messaging product', () => {
    const mismatched = structuredClone(messageFixture)
    mismatched.entry[0].changes[0].value.messaging_product = 'not-whatsapp'

    expect(() => connector.normalize(mismatched)).toThrow(
      'WhatsApp webhook messaging_product is invalid',
    )
  })
})
