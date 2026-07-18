import { createHmac } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'

import type { PlatformConnector } from '../../../src/modules/platforms/ports'
import {
  ingestSignedWebhook,
  verifyMetaWebhookChallenge,
  verifyMetaWebhookSignature,
  WebhookValidationError,
} from '../../../src/modules/platforms/webhook'
import type { NormalizedPlatformEvent } from '../../../src/modules/platforms/types'
import { FakePlatformEventRepository } from '../../fakes/platformEventRepository'

const now = Date.UTC(2026, 6, 18, 8, 0, 0)

const event = (externalEventId = 'event-1', occurredAt = now): NormalizedPlatformEvent => ({
  accountExternalId: 'account-1',
  content: { messageType: 'text', text: 'fixture message' },
  externalEventId,
  idempotencyKey: `whatsapp:${externalEventId}`,
  kind: 'inbound-message',
  occurredAt: new Date(occurredAt).toISOString(),
  platform: 'whatsapp',
  recipientExternalId: 'account-1',
  senderExternalId: 'sender-1',
})

const connector = (events: NormalizedPlatformEvent[]): PlatformConnector => ({
  normalize: () => events,
  platformFamily: 'meta',
})

const signatureFor = (rawBody: string, secret: string): string =>
  `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`

const allowAll = { consume: async () => true }

describe('platform webhook verification and ingestion', () => {
  it('verifies the raw request bytes and rejects malformed or incorrect signatures', () => {
    const rawBody = JSON.stringify({ fixture: true })
    const secret = 'fixture-app-secret'

    expect(
      verifyMetaWebhookSignature({
        appSecret: secret,
        rawBody,
        signatureHeader: signatureFor(rawBody, secret),
      }),
    ).toBe(true)
    expect(
      verifyMetaWebhookSignature({
        appSecret: secret,
        rawBody: `${rawBody} `,
        signatureHeader: signatureFor(rawBody, secret),
      }),
    ).toBe(false)
    expect(
      verifyMetaWebhookSignature({
        appSecret: secret,
        rawBody,
        signatureHeader: 'sha256=not-hex',
      }),
    ).toBe(false)
  })

  it('validates the Meta subscription challenge without returning the configured token', () => {
    expect(
      verifyMetaWebhookChallenge({
        challenge: 'fixture-challenge',
        expectedVerifyToken: 'fixture-verify-token',
        mode: 'subscribe',
        verifyToken: 'fixture-verify-token',
      }),
    ).toBe('fixture-challenge')

    expect(() =>
      verifyMetaWebhookChallenge({
        challenge: 'fixture-challenge',
        expectedVerifyToken: 'fixture-verify-token',
        mode: 'subscribe',
        verifyToken: 'wrong-token',
      }),
    ).toThrow('Webhook verification challenge is invalid')
  })

  it('rejects invalid signatures before normalizing or enqueueing payloads', async () => {
    const rawBody = JSON.stringify({ object: 'fixture' })
    const repository = new FakePlatformEventRepository()
    const normalize = vi.fn(() => [event()])

    await expect(
      ingestSignedWebhook({
        appSecret: 'fixture-app-secret',
        connector: { normalize, platformFamily: 'meta' },
        nowMs: now,
        rateLimiter: allowAll,
        rateLimitKey: 'fixture-source',
        rawBody,
        repository,
        signatureHeader: 'sha256='.padEnd(71, '0'),
      }),
    ).rejects.toMatchObject({ code: 'invalid_signature' } satisfies Partial<WebhookValidationError>)

    expect(normalize).not.toHaveBeenCalled()
    expect(repository.events.size).toBe(0)
  })

  it('atomically accepts each platform event once through the repository port', async () => {
    const rawBody = JSON.stringify({ object: 'fixture' })
    const secret = 'fixture-app-secret'
    const repository = new FakePlatformEventRepository()
    const input = {
      appSecret: secret,
      connector: connector([event()]),
      nowMs: now,
      rawBody,
      rateLimiter: allowAll,
      rateLimitKey: 'fixture-source',
      repository,
      signatureHeader: signatureFor(rawBody, secret),
    }

    const results = await Promise.all([ingestSignedWebhook(input), ingestSignedWebhook(input)])
    expect(results).toEqual(
      expect.arrayContaining([
        { accepted: 1, duplicates: 0, total: 1 },
        { accepted: 0, duplicates: 1, total: 1 },
      ]),
    )
    expect(repository.events.size).toBe(1)
  })

  it('rejects stale events, invalid JSON, and oversized bodies before enqueueing', async () => {
    const secret = 'fixture-app-secret'
    const repository = new FakePlatformEventRepository()
    const staleBody = JSON.stringify({ object: 'fixture' })

    await expect(
      ingestSignedWebhook({
        appSecret: secret,
        connector: connector([event('stale', now - 601_000)]),
        maxEventAgeMs: 600_000,
        nowMs: now,
        rawBody: staleBody,
        rateLimiter: allowAll,
        rateLimitKey: 'fixture-source',
        repository,
        signatureHeader: signatureFor(staleBody, secret),
      }),
    ).rejects.toMatchObject({ code: 'stale_event' } satisfies Partial<WebhookValidationError>)

    const invalidJSON = '{'
    await expect(
      ingestSignedWebhook({
        appSecret: secret,
        connector: connector([]),
        nowMs: now,
        rawBody: invalidJSON,
        rateLimiter: allowAll,
        rateLimitKey: 'fixture-source',
        repository,
        signatureHeader: signatureFor(invalidJSON, secret),
      }),
    ).rejects.toMatchObject({ code: 'invalid_payload' } satisfies Partial<WebhookValidationError>)

    const oversized = JSON.stringify({ value: 'x'.repeat(64) })
    await expect(
      ingestSignedWebhook({
        appSecret: secret,
        connector: connector([]),
        maxBodyBytes: 16,
        nowMs: now,
        rawBody: oversized,
        rateLimiter: allowAll,
        rateLimitKey: 'fixture-source',
        repository,
        signatureHeader: signatureFor(oversized, secret),
      }),
    ).rejects.toMatchObject({ code: 'payload_too_large' } satisfies Partial<WebhookValidationError>)

    expect(repository.events.size).toBe(0)
  })

  it('normalizes connector failures and rejects inconsistent idempotency keys', async () => {
    const rawBody = JSON.stringify({ object: 'fixture' })
    const secret = 'fixture-app-secret'
    const repository = new FakePlatformEventRepository()
    const base = {
      appSecret: secret,
      nowMs: now,
      rateLimiter: allowAll,
      rateLimitKey: 'fixture-source',
      rawBody,
      repository,
      signatureHeader: signatureFor(rawBody, secret),
    }

    await expect(
      ingestSignedWebhook({
        ...base,
        connector: {
          normalize: () => {
            throw new Error('fixture parser detail')
          },
          platformFamily: 'meta',
        },
      }),
    ).rejects.toMatchObject({
      code: 'invalid_payload',
      message: 'Webhook payload cannot be normalized',
    } satisfies Partial<WebhookValidationError>)

    await expect(
      ingestSignedWebhook({
        ...base,
        connector: connector([{ ...event(), idempotencyKey: 'incorrect-key' }]),
      }),
    ).rejects.toMatchObject({ code: 'invalid_payload' } satisfies Partial<WebhookValidationError>)
    expect(repository.events.size).toBe(0)
  })

  it('rejects rate-limited sources before parsing or enqueueing events', async () => {
    const rawBody = JSON.stringify({ object: 'fixture' })
    const secret = 'fixture-app-secret'
    const repository = new FakePlatformEventRepository()

    await expect(
      ingestSignedWebhook({
        appSecret: secret,
        connector: connector([event()]),
        nowMs: now,
        rateLimiter: { consume: async () => false },
        rateLimitKey: 'limited-source',
        rawBody,
        repository,
        signatureHeader: signatureFor(rawBody, secret),
      }),
    ).rejects.toMatchObject({ code: 'rate_limited' } satisfies Partial<WebhookValidationError>)
    expect(repository.events.size).toBe(0)
  })
})
