import { createHmac } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'

import type { PlatformConnector, WebhookVerifier } from '../../../src/modules/platforms/ports'
import {
  createMetaWebhookVerifier,
  ingestSignedWebhook,
  verifyMetaWebhookChallenge,
  verifyMetaWebhookSignature,
  WebhookValidationError,
} from '../../../src/modules/platforms/webhook'
import {
  platformEventKey,
  platformEventKeyV2,
  type NormalizedInboundMessage,
  type NormalizedPlatformEvent,
} from '../../../src/modules/platforms/types'
import { FakePlatformEventRepository } from '../../fakes/platformEventRepository'

const now = Date.UTC(2026, 6, 21, 8, 0, 0)
const secret = 'fixture-app-secret'

const event = (
  externalEventId = 'event-1',
  occurredAt = now,
  text = 'fixture message',
  accountExternalId = 'account-1',
): NormalizedInboundMessage => ({
  accountExternalId,
  content: { messageType: 'text', text },
  externalEventId,
  idempotencyKey: platformEventKeyV2('facebook-messenger', accountExternalId, externalEventId),
  kind: 'inbound-message',
  occurredAt: new Date(occurredAt).toISOString(),
  platform: 'facebook-messenger',
  recipientExternalId: accountExternalId,
  senderExternalId: `sender-${accountExternalId}`,
})

const accountScopedEvent = (
  accountExternalId: string,
  externalEventId: string,
  text: string,
): NormalizedInboundMessage => ({
  ...event(externalEventId, now, text, accountExternalId),
})

const connector = (events: NormalizedPlatformEvent[]): PlatformConnector => ({
  normalize: () => events,
  platformFamily: 'meta',
})

const signatureFor = (rawBody: string | Uint8Array, appSecret = secret): string =>
  `sha256=${createHmac('sha256', appSecret).update(rawBody).digest('hex')}`

const allowAll = { consume: async () => true }

const signedInput = (
  rawBody: string,
  repository: FakePlatformEventRepository,
  events: NormalizedPlatformEvent[] = [event()],
) => ({
  connector: connector(events),
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'x-hub-signature-256': signatureFor(rawBody),
  },
  nowMs: now,
  rateLimiter: allowAll,
  rateLimitKey: 'fixture-source',
  rawBody: Buffer.from(rawBody),
  repository,
  verifier: createMetaWebhookVerifier(secret),
})

describe('platform webhook verification and ingestion', () => {
  it('verifies the exact raw request bytes for strings and byte arrays', () => {
    const rawBody = JSON.stringify({ fixture: true })
    const bytes = Buffer.from(rawBody)

    expect(
      verifyMetaWebhookSignature({
        appSecret: secret,
        rawBody,
        signatureHeader: signatureFor(rawBody),
      }),
    ).toBe(true)
    expect(
      verifyMetaWebhookSignature({
        appSecret: secret,
        rawBody: bytes,
        signatureHeader: signatureFor(bytes),
      }),
    ).toBe(true)
    expect(
      verifyMetaWebhookSignature({
        appSecret: secret,
        rawBody: `${rawBody} `,
        signatureHeader: signatureFor(rawBody),
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

  it('uses a platform verifier port and rejects invalid signatures before normalization', async () => {
    const rawBody = JSON.stringify({ object: 'fixture' })
    const repository = new FakePlatformEventRepository()
    const normalize = vi.fn(() => [event()])
    const verify = vi.fn(() => false)
    const consume = vi.fn(async () => true)
    const verifier: WebhookVerifier = { verify }
    const headers = {
      'content-type': 'application/json',
      'x-hub-signature-256': signatureFor(rawBody),
    }

    await expect(
      ingestSignedWebhook({
        connector: { normalize, platformFamily: 'meta' },
        headers,
        nowMs: now,
        rateLimiter: { consume },
        rateLimitKey: 'fixture-source',
        rawBody: Buffer.from(rawBody),
        repository,
        verifier,
      }),
    ).rejects.toMatchObject({ code: 'invalid_signature' } satisfies Partial<WebhookValidationError>)

    expect(verify).toHaveBeenCalledWith({
      headers,
      rawBody: Buffer.from(rawBody),
    })
    expect(consume).not.toHaveBeenCalled()
    expect(normalize).not.toHaveBeenCalled()
    expect(repository.events.size).toBe(0)
  })

  it('accepts exact duplicates once under concurrent delivery', async () => {
    const rawBody = JSON.stringify({ object: 'fixture', version: 1 })
    const repository = new FakePlatformEventRepository()
    const input = signedInput(rawBody, repository)

    const results = await Promise.all([ingestSignedWebhook(input), ingestSignedWebhook(input)])
    expect(results).toEqual(
      expect.arrayContaining([
        { accepted: 1, duplicates: 0, total: 1 },
        { accepted: 0, duplicates: 1, total: 1 },
      ]),
    )
    expect(repository.events.size).toBe(1)
  })

  it('accepts the same provider message ID for different authenticated accounts', async () => {
    const rawBody = JSON.stringify({ object: 'fixture', accounts: ['one', 'two'] })
    const repository = new FakePlatformEventRepository()
    const first = accountScopedEvent('account-1', 'shared-provider-message', 'First account message')
    const second = accountScopedEvent('account-2', 'shared-provider-message', 'Second account message')

    await expect(
      ingestSignedWebhook(signedInput(rawBody, repository, [first, second])),
    ).resolves.toEqual({ accepted: 2, duplicates: 0, total: 2 })

    expect([...repository.events.keys()]).toEqual(expect.arrayContaining([
      first.idempotencyKey,
      second.idempotencyKey,
    ]))
    expect(repository.events.size).toBe(2)
  })

  it('rejects a legacy key at fresh webhook ingress before it can create a cross-account collision', async () => {
    const rawBody = JSON.stringify({ object: 'fixture', legacy: true })
    const repository = new FakePlatformEventRepository()
    const legacy = {
      ...event('legacy-provider-message'),
      idempotencyKey: platformEventKey('facebook-messenger', 'legacy-provider-message'),
    }

    await expect(
      ingestSignedWebhook(signedInput(rawBody, repository, [legacy])),
    ).rejects.toMatchObject({ code: 'invalid_payload' } satisfies Partial<WebhookValidationError>)
    expect(repository.events.size).toBe(0)
  })

  it('allows raw-envelope changes but rejects semantic changes for the same event key', async () => {
    const repository = new FakePlatformEventRepository()
    const firstBody = JSON.stringify({ object: 'fixture', text: 'first' })
    const duplicateBody = JSON.stringify({ object: 'fixture', retryEnvelope: true })
    const secondBody = JSON.stringify({ object: 'fixture', text: 'changed' })

    await expect(
      ingestSignedWebhook(signedInput(firstBody, repository, [event('event-1', now, 'first')])),
    ).resolves.toEqual({ accepted: 1, duplicates: 0, total: 1 })

    await expect(
      ingestSignedWebhook(signedInput(duplicateBody, repository, [event('event-1', now, 'first')])),
    ).resolves.toEqual({ accepted: 0, duplicates: 1, total: 1 })

    await expect(
      ingestSignedWebhook(
        signedInput(secondBody, repository, [
          event('event-2', now, 'must not be partially stored'),
          event('event-1', now, 'changed'),
        ]),
      ),
    ).rejects.toMatchObject({
      code: 'idempotency_conflict',
      message: 'Webhook event conflicts with an existing idempotency key',
    } satisfies Partial<WebhookValidationError>)

    expect(repository.events.get(event('event-1', now, 'first').idempotencyKey)?.event).toMatchObject({
      content: { text: 'first' },
    })
    expect(repository.events.has('facebook-messenger:event-2')).toBe(false)
  })

  it('accepts a valid empty event batch without repository side effects', async () => {
    const rawBody = JSON.stringify({ object: 'fixture', echoOnly: true })
    const repository = new FakePlatformEventRepository()

    await expect(ingestSignedWebhook(signedInput(rawBody, repository, []))).resolves.toEqual({
      accepted: 0,
      duplicates: 0,
      total: 0,
    })
    expect(repository.events.size).toBe(0)
  })

  it('rejects invalid content types before verifying or parsing payloads', async () => {
    const rawBody = JSON.stringify({ object: 'fixture' })
    const repository = new FakePlatformEventRepository()
    const verify = vi.fn(() => true)

    await expect(
      ingestSignedWebhook({
        ...signedInput(rawBody, repository),
        headers: {
          'content-type': 'text/plain',
          'x-hub-signature-256': signatureFor(rawBody),
        },
        verifier: { verify },
      }),
    ).rejects.toMatchObject({
      code: 'invalid_content_type',
    } satisfies Partial<WebhookValidationError>)

    expect(verify).not.toHaveBeenCalled()
    expect(repository.events.size).toBe(0)
  })

  it('rejects stale and future events outside their accepted windows', async () => {
    const rawBody = JSON.stringify({ object: 'fixture' })
    const repository = new FakePlatformEventRepository()

    await expect(
      ingestSignedWebhook({
        ...signedInput(rawBody, repository, [event('stale', now - 601_000)]),
        maxEventAgeMs: 600_000,
      }),
    ).rejects.toMatchObject({ code: 'stale_event' } satisfies Partial<WebhookValidationError>)

    await expect(
      ingestSignedWebhook({
        ...signedInput(rawBody, repository, [event('future', now + 61_000)]),
        maxFutureSkewMs: 60_000,
      }),
    ).rejects.toMatchObject({ code: 'future_event' } satisfies Partial<WebhookValidationError>)

    expect(repository.events.size).toBe(0)
  })

  it('recovers a delayed Meta retry inside the 36-hour delivery window without duplicate jobs', async () => {
    const rawBody = JSON.stringify({ object: 'fixture', delayedRetry: true })
    const repository = new FakePlatformEventRepository()
    let persistenceAvailable = false
    const flakyRepository = {
      enqueueBatch: async (...args: Parameters<FakePlatformEventRepository['enqueueBatch']>) => {
        if (!persistenceAvailable) throw new Error('temporary database outage')
        return repository.enqueueBatch(...args)
      },
    }
    const initialAttempt = {
      ...signedInput(rawBody, repository, [event('delayed-retry', now)]),
      maxEventAgeMs: 48 * 60 * 60 * 1_000,
      nowMs: now,
      repository: flakyRepository,
    }

    await expect(ingestSignedWebhook(initialAttempt)).rejects.toThrow('temporary database outage')
    persistenceAvailable = true
    const delayedRetry = { ...initialAttempt, nowMs: now + 36 * 60 * 60 * 1_000 }
    await expect(ingestSignedWebhook(delayedRetry)).resolves.toEqual({ accepted: 1, duplicates: 0, total: 1 })
    await expect(ingestSignedWebhook(delayedRetry)).resolves.toEqual({ accepted: 0, duplicates: 1, total: 1 })
    expect(repository.events.size).toBe(1)
  })

  it('rejects invalid JSON and oversized bodies before enqueueing', async () => {
    const repository = new FakePlatformEventRepository()
    const invalidJSON = '{'

    await expect(
      ingestSignedWebhook(signedInput(invalidJSON, repository, [])),
    ).rejects.toMatchObject({ code: 'invalid_payload' } satisfies Partial<WebhookValidationError>)

    const oversized = JSON.stringify({ value: 'x'.repeat(64) })
    await expect(
      ingestSignedWebhook({
        ...signedInput(oversized, repository, []),
        maxBodyBytes: 16,
      }),
    ).rejects.toMatchObject({ code: 'payload_too_large' } satisfies Partial<WebhookValidationError>)

    expect(repository.events.size).toBe(0)
  })

  it('normalizes connector failures and rejects inconsistent idempotency keys', async () => {
    const rawBody = JSON.stringify({ object: 'fixture' })
    const repository = new FakePlatformEventRepository()
    const base = signedInput(rawBody, repository)

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

    await expect(
      ingestSignedWebhook({
        ...base,
        connector: connector([{ ...event(), externalEventId: '', idempotencyKey: '' }]),
      }),
    ).rejects.toMatchObject({ code: 'invalid_payload' } satisfies Partial<WebhookValidationError>)
    expect(repository.events.size).toBe(0)
  })

  it('rejects rate-limited events before enqueueing', async () => {
    const rawBody = JSON.stringify({ object: 'fixture' })
    const repository = new FakePlatformEventRepository()

    await expect(
      ingestSignedWebhook({
        ...signedInput(rawBody, repository),
        rateLimiter: { consume: async () => false },
        rateLimitKey: 'limited-source',
      }),
    ).rejects.toMatchObject({ code: 'rate_limited' } satisfies Partial<WebhookValidationError>)
    expect(repository.events.size).toBe(0)
  })

  it('uses independent rate-limit keys for each authenticated Meta account', async () => {
    const rawBody = JSON.stringify({ object: 'fixture', accounts: true })
    const repository = new FakePlatformEventRepository()
    const consumedKeys: string[] = []
    const first = event('account-one')
    const second = event('account-two', now, 'fixture message', 'account-2')

    await expect(
      ingestSignedWebhook({
        ...signedInput(rawBody, repository, [first, second]),
        rateLimiter: {
          consume: async (key) => {
            consumedKeys.push(key)
            return true
          },
        },
        rateLimitKeyForEvent: (normalizedEvent) =>
          `meta-webhook:${normalizedEvent.platform}:${normalizedEvent.accountExternalId}`,
      }),
    ).resolves.toEqual({ accepted: 2, duplicates: 0, total: 2 })

    expect(consumedKeys).toEqual([
      'meta-webhook:facebook-messenger:account-1',
      'meta-webhook:facebook-messenger:account-2',
    ])
  })

  it('resolves a lazy repository exactly once only after a valid event is accepted', async () => {
    const rawBody = JSON.stringify({ object: 'fixture', lazy: true })
    const repository = new FakePlatformEventRepository()
    const repositoryFactory = vi.fn(async () => repository)

    await expect(
      ingestSignedWebhook({
        ...signedInput(rawBody, repository),
        repository: repositoryFactory,
      }),
    ).resolves.toEqual({ accepted: 1, duplicates: 0, total: 1 })

    expect(repositoryFactory).toHaveBeenCalledTimes(1)
    expect(repository.events.size).toBe(1)
  })

  it('does not resolve a lazy repository for stale normalized events', async () => {
    const rawBody = JSON.stringify({ object: 'fixture', stale: true })
    const repository = new FakePlatformEventRepository()
    const repositoryFactory = vi.fn(async () => repository)

    await expect(
      ingestSignedWebhook({
        ...signedInput(rawBody, repository, [event('stale-lazy', now - 601_000)]),
        repository: repositoryFactory,
      }),
    ).rejects.toMatchObject({ code: 'stale_event' } satisfies Partial<WebhookValidationError>)

    expect(repositoryFactory).not.toHaveBeenCalled()
    expect(repository.events.size).toBe(0)
  })
})
