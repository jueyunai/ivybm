import { describe, expect, it } from 'vitest'

import {
  decryptMetaWebhookReplayBody,
  encryptMetaWebhookReplayBody,
  readMetaWebhookReplayEncryptionKey,
} from '@/modules/platforms/meta/replayCrypto'
import {
  replaySanitizedMetaWebhookFixture,
  sanitizeMetaWebhookReplayFixture,
} from '@/modules/platforms/meta/replayFixture'

const key = Buffer.alloc(32, 4)

describe('Meta webhook encrypted replay fixtures', () => {
  it('encrypts raw bytes with authenticated context and fails closed on tampering', () => {
    const rawBody = Buffer.from('{"object":"instagram","private":"customer message"}')
    const encrypted = encryptMetaWebhookReplayBody({
      body: rawBody,
      context: 'trace-fixture-1',
      key,
    })

    expect(encrypted).not.toContain('customer message')
    expect(
      decryptMetaWebhookReplayBody({
        ciphertext: encrypted,
        context: 'trace-fixture-1',
        key,
      }),
    ).toEqual(rawBody)
    const encryptedParts = encrypted.split(':')
    const encryptedBody = encryptedParts.at(-1)!
    encryptedParts[encryptedParts.length - 1] = `${encryptedBody[0] === 'A' ? 'B' : 'A'}${encryptedBody.slice(1)}`
    expect(() =>
      decryptMetaWebhookReplayBody({
        ciphertext: encryptedParts.join(':'),
        context: 'trace-fixture-1',
        key,
      }),
    ).toThrow('Meta webhook replay payload cannot be decrypted')
    expect(() =>
      decryptMetaWebhookReplayBody({
        ciphertext: encrypted,
        context: 'another-trace',
        key,
      }),
    ).toThrow('Meta webhook replay payload cannot be decrypted')
  })

  it('requires a dedicated 64-hex replay key', () => {
    expect(readMetaWebhookReplayEncryptionKey({ WEBHOOK_REPLAY_ENCRYPTION_KEY: 'a'.repeat(64) }))
      .toEqual(Buffer.alloc(32, 0xaa))
    expect(() => readMetaWebhookReplayEncryptionKey({})).toThrow(
      'WEBHOOK_REPLAY_ENCRYPTION_KEY must be a 64-character hexadecimal key',
    )
  })

  it('exports a locally replayable fixture without customer content or sender identity', () => {
    const source = {
      entry: [
        {
          id: 'IG_ENTRY_BUSINESS_ID',
          messaging: [
            {
              message: {
                attachments: [
                  {
                    payload: {
                      url: 'https://private.example.invalid/customer.jpg?token=secret',
                    },
                    type: 'image',
                  },
                ],
                mid: 'private-provider-message-id',
                text: 'I need 500 square meters next month',
              },
              recipient: { id: 'IG_MESSAGING_BUSINESS_ID' },
              sender: { id: 'PRIVATE_CUSTOMER_ID' },
              timestamp: 1_777_000_000_000,
            },
          ],
        },
      ],
      object: 'instagram',
      access_token: 'must-never-export',
    }

    const fixture = sanitizeMetaWebhookReplayFixture(source)
    const serialized = JSON.stringify(fixture)
    expect(serialized).not.toContain('IG_ENTRY_BUSINESS_ID')
    expect(serialized).not.toContain('IG_MESSAGING_BUSINESS_ID')
    expect(serialized).toContain('ACCOUNT_REDACTED_')
    expect(serialized).not.toContain('PRIVATE_CUSTOMER_ID')
    expect(serialized).not.toContain('500 square meters')
    expect(serialized).not.toContain('private-provider-message-id')
    expect(serialized).not.toContain('private.example.invalid')
    expect(serialized).not.toContain('must-never-export')

    const summary = replaySanitizedMetaWebhookFixture(fixture)
    expect(summary).toMatchObject({ eventCount: 1, platforms: ['instagram'] })
    expect(summary.accountExternalIds).toEqual([
      expect.stringMatching(/^ACCOUNT_REDACTED_[a-f0-9]{16}$/u),
    ])
  })

  it('fingerprints numeric provider IDs while preserving a valid numeric timestamp', () => {
    const source = {
      entry: [
        {
          id: 98_765_432_109,
          messaging: [
            {
              message: { mid: 12_345_678_901, text: 'private message' },
              recipient: { id: 98_765_432_109 },
              sender: { id: 11_111_111_111 },
              timestamp: 1_777_000_000_000,
            },
          ],
        },
      ],
      object: 'instagram',
    }

    const fixture = sanitizeMetaWebhookReplayFixture(source)
    const serialized = JSON.stringify(fixture)
    expect(serialized).not.toContain('98765432109')
    expect(serialized).not.toContain('12345678901')
    expect(serialized).not.toContain('11111111111')
    expect(serialized).toContain('ACCOUNT_REDACTED_')
    expect(serialized).toContain('SENDER_REDACTED_')
    expect(serialized).toContain('m_replay_')
    expect(fixture).toMatchObject({
      entry: [{ messaging: [{ timestamp: 1_777_000_000_000 }] }],
    })
    expect(replaySanitizedMetaWebhookFixture(fixture)).toMatchObject({
      eventCount: 1,
      platforms: ['instagram'],
    })
  })

  it('does not pass through string or object timestamp content', () => {
    const fixture = sanitizeMetaWebhookReplayFixture({
      entry: [
        {
          id: 'account-id',
          messaging: [
            {
              message: { mid: 'message-id', text: 'private message' },
              recipient: { id: 'account-id' },
              sender: { id: 'sender-id' },
              timestamp: { note: 'private timestamp object' },
            },
          ],
          time: 'private timestamp string',
          timestamp: Number.MAX_SAFE_INTEGER,
        },
      ],
      object: 'instagram',
    })
    const serialized = JSON.stringify(fixture)

    expect(serialized).not.toContain('private timestamp object')
    expect(serialized).not.toContain('private timestamp string')
    expect(fixture).toMatchObject({
      entry: [
        {
          messaging: [{ timestamp: { note: '[REDACTED]' } }],
          time: '[REDACTED]',
          timestamp: '[REDACTED]',
        },
      ],
    })
    expect(() => replaySanitizedMetaWebhookFixture(fixture)).toThrow(
      'Meta message event is missing required identifiers or timestamp',
    )
  })
})
