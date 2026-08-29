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

  it('normalizes an Instagram messages change wrapper without trusting nested account IDs', () => {
    expect(
      connector.normalize({
        entry: [
          {
            changes: [
              {
                field: 'messages',
                value: {
                  message: { mid: 'm_fixture_instagram_change_1', text: 'Need a quotation.' },
                  recipient: { id: 'IG_ACCOUNT_FIXTURE_1' },
                  sender: { id: 'IG_SENDER_FIXTURE_2' },
                  timestamp: 1_710_000_100_123,
                },
              },
            ],
            id: 'IG_ACCOUNT_FIXTURE_1',
            time: 1_710_000_100_000,
          },
        ],
        object: 'instagram',
      }),
    ).toEqual([
      expect.objectContaining({
        accountExternalId: 'IG_ACCOUNT_FIXTURE_1',
        externalEventId: 'm_fixture_instagram_change_1',
        platform: 'instagram',
        recipientExternalId: 'IG_ACCOUNT_FIXTURE_1',
        senderExternalId: 'IG_SENDER_FIXTURE_2',
      }),
    ])
  })

  it('normalizes an Instagram change wrapper containing a messages array', () => {
    expect(
      connector.normalize({
        entry: [
          {
            changes: [
              {
                field: 'messages',
                value: {
                  messages: [
                    {
                      message: { mid: 'm_fixture_instagram_change_array_1', text: 'Hello.' },
                      recipient: { id: 'IG_ACCOUNT_FIXTURE_1' },
                      sender: { id: 'IG_SENDER_FIXTURE_3' },
                      timestamp: 1_710_000_100_124,
                    },
                  ],
                },
              },
            ],
            id: 'IG_ACCOUNT_FIXTURE_1',
          },
        ],
        object: 'instagram',
      }),
    ).toEqual([
      expect.objectContaining({
        accountExternalId: 'IG_ACCOUNT_FIXTURE_1',
        externalEventId: 'm_fixture_instagram_change_array_1',
        platform: 'instagram',
      }),
    ])
  })

  it('acknowledges the Meta dashboard dummy messages change without creating an event', () => {
    expect(
      connector.normalize({
        entry: [
          {
            changes: [
              {
                field: 'messages',
                value: {
                  message: { mid: 'random_mid', text: 'random_text' },
                  recipient: { id: '23245' },
                  sender: { id: '12334' },
                  timestamp: '1527459824',
                },
              },
            ],
            id: '0',
            time: 1_744_813_777,
          },
        ],
        object: 'instagram',
      }),
    ).toEqual([])
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
    expect(
      connector.normalize({
        object: 'page',
        entry: [
          {
            id: 'PAGE_FIXTURE_1',
            messaging: [
              {
                delivery: { mids: ['outbound-fixture-1'], watermark: 1 },
                recipient: { id: 'PAGE_FIXTURE_1' },
                sender: { id: 'SENDER_FIXTURE_1' },
                timestamp: 1_710_000_000_000,
              },
            ],
          },
        ],
      }),
    ).toEqual([])
  })

  it('acknowledges only explicit delivery/read control callbacks and preserves mixed inbound messages', () => {
    expect(
      connector.normalize({
        object: 'page',
        entry: [
          {
            id: 'PAGE_FIXTURE_1',
            messaging: [
              { delivery: { mids: ['outbound-fixture-1'], watermark: 1 } },
              { read: { watermark: 2 } },
            ],
          },
        ],
      }),
    ).toEqual([])

    expect(
      connector.normalize({
        object: 'page',
        entry: [
          {
            id: 'PAGE_FIXTURE_1',
            messaging: [
              { delivery: { mids: ['outbound-fixture-1'], watermark: 1 } },
              {
                message: {
                  mid: 'mixed-inbound-fixture-1',
                  text: 'Need exterior cladding details.',
                },
                recipient: { id: 'PAGE_FIXTURE_1' },
                sender: { id: 'SENDER_FIXTURE_1' },
                timestamp: 1_710_000_000_123,
              },
            ],
          },
        ],
      }),
    ).toEqual([
      expect.objectContaining({
        externalEventId: 'mixed-inbound-fixture-1',
        idempotencyKey: platformEventKeyV2(
          'facebook-messenger',
          'PAGE_FIXTURE_1',
          'mixed-inbound-fixture-1',
        ),
      }),
    ])
  })

  it('acknowledges Instagram reaction and message-edit callbacks without creating inbound messages', () => {
    expect(
      connector.normalize({
        entry: [
          {
            id: 'IG_ACCOUNT_FIXTURE_1',
            messaging: [
              {
                reaction: { action: 'react', emoji: '👍', mid: 'm_fixture_instagram_1' },
                timestamp: 1_710_000_000_001,
              },
              {
                message_edit: { mid: 'm_fixture_instagram_1', num_edit: 0 },
                timestamp: 1_710_000_000_002,
              },
            ],
          },
        ],
        object: 'instagram',
      }),
    ).toEqual([])
  })

  it('rejects malformed or unsupported messaging envelopes instead of silently acknowledging them', () => {
    const malformedPayloads: unknown[] = [
      { object: 'page', entry: [null] },
      { object: 'page', entry: [{ id: 'PAGE_FIXTURE_1' }] },
      { object: 'page', entry: [{ id: 'PAGE_FIXTURE_1', messaging: [null] }] },
      {
        object: 'page',
        entry: [{ id: 'PAGE_FIXTURE_1', messaging: [{ message: null }] }],
      },
      {
        object: 'page',
        entry: [{ id: 'PAGE_FIXTURE_1', messaging: [{ delivery: null }] }],
      },
      {
        object: 'page',
        entry: [{ id: 'PAGE_FIXTURE_1', messaging: [{ postback: { title: 'Unsupported' } }] }],
      },
    ]

    for (const payload of malformedPayloads) {
      expect(() => connector.normalize(payload)).toThrow()
    }
  })

  it('rejects oversized identifiers and malformed attachments before they enter the durable queue', () => {
    const oversized = structuredClone(metaFixture)
    oversized.entry[0].messaging[0].message.mid = 'm'.repeat(181)
    expect(() => connector.normalize(oversized)).toThrow(
      'Meta message event is missing required identifiers or timestamp',
    )

    const malformedAttachment = structuredClone(instagramFixture)
    const malformedMessage = malformedAttachment.entry[0].messaging[0].message as unknown as Record<
      string,
      unknown
    >
    malformedMessage.attachments = [null]
    delete malformedMessage.text
    expect(() => connector.normalize(malformedAttachment)).toThrow('Meta attachment 0 is invalid')
  })
})
