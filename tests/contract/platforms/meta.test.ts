import instagramFixture from '../../fixtures/platforms/instagram-message.json'
import metaFixture from '../../fixtures/platforms/meta-message.json'
import { describe, expect, it } from 'vitest'

import { createMetaConnector } from '../../../src/modules/platforms/meta/connector'
import { platformEventKeyV2 } from '../../../src/modules/platforms/types'

describe('Meta messaging webhook contract', () => {
  const connector = createMetaConnector()

  it('normalizes a Messenger text message and ignores outbound echoes', () => {
    expect(connector.normalize(metaFixture)).toEqual([
      {
        accountExternalId: 'PAGE_FIXTURE_1',
        content: {
          messageType: 'text',
          text: 'Please share the available facade finishes.',
        },
        externalEventId: 'm_fixture_meta_1',
        idempotencyKey: platformEventKeyV2(
          'facebook-messenger',
          'PAGE_FIXTURE_1',
          'm_fixture_meta_1',
        ),
        kind: 'inbound-message',
        occurredAt: '2024-03-09T16:00:00.123Z',
        platform: 'facebook-messenger',
        recipientExternalId: 'PAGE_FIXTURE_1',
        senderExternalId: 'SENDER_FIXTURE_1',
      },
    ])
  })

  it('normalizes Instagram attachments without retaining provider URL query credentials', () => {
    const fixture = structuredClone(instagramFixture)
    fixture.entry[0].messaging[0].message.attachments[0].payload.url =
      'https://example.invalid/fixture-image.jpg?signature=provider-secret#fragment'

    const events = connector.normalize(fixture)

    expect(events).toEqual([
      {
        accountExternalId: 'IG_ACCOUNT_FIXTURE_1',
        content: {
          attachments: [
            {
              type: 'image',
              url: 'https://example.invalid/fixture-image.jpg',
            },
          ],
          messageType: 'image',
        },
        externalEventId: 'm_fixture_instagram_1',
        idempotencyKey: platformEventKeyV2(
          'instagram',
          'IG_ACCOUNT_FIXTURE_1',
          'm_fixture_instagram_1',
        ),
        kind: 'inbound-message',
        occurredAt: '2024-03-09T16:01:40.123Z',
        platform: 'instagram',
        recipientExternalId: 'IG_ACCOUNT_FIXTURE_1',
        senderExternalId: 'IG_SENDER_FIXTURE_1',
      },
    ])
  })

  it('does not collapse the same provider message ID across two Meta accounts', () => {
    const sharedMessageID = 'm_fixture_shared_across_accounts'
    const events = connector.normalize({
      entry: [
        {
          id: 'PAGE_FIXTURE_A',
          messaging: [{
            message: { mid: sharedMessageID, text: 'First account message.' },
            recipient: { id: 'PAGE_FIXTURE_A' },
            sender: { id: 'SENDER_FIXTURE_A' },
            timestamp: 1_710_000_000_000,
          }],
        },
        {
          id: 'PAGE_FIXTURE_B',
          messaging: [{
            message: { mid: sharedMessageID, text: 'Second account message.' },
            recipient: { id: 'PAGE_FIXTURE_B' },
            sender: { id: 'SENDER_FIXTURE_B' },
            timestamp: 1_710_000_000_001,
          }],
        },
      ],
      object: 'page',
    })

    expect(events.map(({ idempotencyKey }) => idempotencyKey)).toEqual([
      platformEventKeyV2('facebook-messenger', 'PAGE_FIXTURE_A', sharedMessageID),
      platformEventKeyV2('facebook-messenger', 'PAGE_FIXTURE_B', sharedMessageID),
    ])
  })

  it('rejects payloads from unsupported Meta webhook objects', () => {
    expect(() => connector.normalize({ object: 'user', entry: [] })).toThrow(
      'Unsupported Meta webhook object',
    )
  })

  it('rejects message recipients that do not match the subscribed account', () => {
    const mismatched = structuredClone(metaFixture)
    mismatched.entry[0].messaging[0].recipient.id = 'DIFFERENT_PAGE'

    expect(() => connector.normalize(mismatched)).toThrow(
      'Meta message recipient does not match the webhook account',
    )
  })

  it('ignores delivery callbacks until a durable message-status adapter is implemented', () => {
    expect(connector.normalize({
      object: 'page',
      entry: [{
        id: 'PAGE_FIXTURE_1',
        messaging: [{
          delivery: { mids: ['outbound-fixture-1'], watermark: 1 },
          recipient: { id: 'PAGE_FIXTURE_1' },
          sender: { id: 'SENDER_FIXTURE_1' },
          timestamp: 1_710_000_000_000,
        }],
      }],
    })).toEqual([])
  })

  it('rejects oversized identifiers and malformed attachments before they enter the durable queue', () => {
    const oversized = structuredClone(metaFixture)
    oversized.entry[0].messaging[0].message.mid = 'm'.repeat(181)
    expect(() => connector.normalize(oversized)).toThrow(
      'Meta message event is missing required identifiers or timestamp',
    )

    const malformedAttachment = structuredClone(instagramFixture)
    const malformedMessage = malformedAttachment.entry[0].messaging[0].message as unknown as Record<string, unknown>
    malformedMessage.attachments = [null]
    delete malformedMessage.text
    expect(() => connector.normalize(malformedAttachment)).toThrow('Meta attachment 0 is invalid')
  })
})
