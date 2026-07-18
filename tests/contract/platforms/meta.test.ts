import instagramFixture from '../../fixtures/platforms/instagram-message.json'
import metaFixture from '../../fixtures/platforms/meta-message.json'
import { describe, expect, it } from 'vitest'

import { createMetaConnector } from '../../../src/modules/platforms/meta/connector'

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
        idempotencyKey: 'facebook-messenger:m_fixture_meta_1',
        kind: 'inbound-message',
        occurredAt: '2024-03-09T16:00:00.123Z',
        platform: 'facebook-messenger',
        recipientExternalId: 'PAGE_FIXTURE_1',
        senderExternalId: 'SENDER_FIXTURE_1',
      },
    ])
  })

  it('normalizes Instagram attachments without fetching their URL', () => {
    const events = connector.normalize(instagramFixture)

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
        idempotencyKey: 'instagram:m_fixture_instagram_1',
        kind: 'inbound-message',
        occurredAt: '2024-03-09T16:01:40.123Z',
        platform: 'instagram',
        recipientExternalId: 'IG_ACCOUNT_FIXTURE_1',
        senderExternalId: 'IG_SENDER_FIXTURE_1',
      },
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
})
