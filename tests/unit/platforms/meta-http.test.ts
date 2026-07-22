import { createHmac } from 'node:crypto'

import { describe, expect, it, vi } from 'vitest'

import { createMetaWebhookHandlers } from '@/modules/platforms/meta/http'
import type {
  PlatformConnector,
  WebhookRateLimiter,
} from '@/modules/platforms/ports'
import type { NormalizedInboundMessage } from '@/modules/platforms/types'

import { FakePlatformEventRepository } from '../../fakes/platformEventRepository'

const now = Date.UTC(2026, 6, 22, 8, 0, 0)
const appSecret = 'fixture-meta-app-secret'
const verifyToken = 'fixture-meta-verify-token'

const inboundEvent = (externalEventId = 'meta-http-event-1'): NormalizedInboundMessage => ({
  accountExternalId: 'page-fixture-1',
  content: { messageType: 'text', text: 'Fixture inbound message.' },
  externalEventId,
  idempotencyKey: `facebook-messenger:${externalEventId}`,
  kind: 'inbound-message',
  occurredAt: new Date(now).toISOString(),
  platform: 'facebook-messenger',
  recipientExternalId: 'page-fixture-1',
  senderExternalId: 'sender-fixture-1',
})

const signatureFor = (rawBody: string): string =>
  `sha256=${createHmac('sha256', appSecret).update(rawBody).digest('hex')}`

const createConnector = (event = inboundEvent()): PlatformConnector => ({
  normalize: () => [event],
  platformFamily: 'meta',
})

const createHandlers = ({
  appSecret: configuredAppSecret = appSecret,
  connector = createConnector(),
  maxBodyBytes,
  rateLimiter = { consume: async () => true } satisfies WebhookRateLimiter,
  repository = new FakePlatformEventRepository(),
  verifyToken: configuredVerifyToken = verifyToken,
}: {
  appSecret?: string
  connector?: PlatformConnector
  maxBodyBytes?: number
  rateLimiter?: WebhookRateLimiter
  repository?: FakePlatformEventRepository
  verifyToken?: string
} = {}) => ({
  handlers: createMetaWebhookHandlers({
    appSecret: configuredAppSecret,
    connector,
    maxBodyBytes,
    now: () => now,
    rateLimiter,
    repository,
    verifyToken: configuredVerifyToken,
  }),
  repository,
})

describe('Meta webhook HTTP handlers', () => {
  it('returns only a valid subscription challenge and fails closed without configuration', async () => {
    const { handlers } = createHandlers()
    const response = await handlers.GET(new Request(
      'https://ivybm.example.invalid/api/webhooks/meta?hub.mode=subscribe&hub.verify_token=fixture-meta-verify-token&hub.challenge=fixture-challenge',
    ))

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('content-type')).toContain('text/plain')
    await expect(response.text()).resolves.toBe('fixture-challenge')

    const invalid = await handlers.GET(new Request(
      'https://ivybm.example.invalid/api/webhooks/meta?hub.mode=subscribe&hub.verify_token=wrong-token&hub.challenge=fixture-challenge',
    ))
    expect(invalid.status).toBe(403)
    await expect(invalid.json()).resolves.toEqual({ error: { code: 'invalid_challenge' } })

    const unconfigured = createHandlers({ appSecret: '', verifyToken: '' })
    const unavailable = await unconfigured.handlers.GET(new Request(
      'https://ivybm.example.invalid/api/webhooks/meta?hub.mode=subscribe&hub.verify_token=fixture-meta-verify-token&hub.challenge=fixture-challenge',
    ))
    expect(unavailable.status).toBe(503)
    await expect(unavailable.json()).resolves.toEqual({ error: { code: 'service_unavailable' } })
  })

  it('verifies raw bytes and atomically reports accepted then duplicate Meta delivery', async () => {
    const { handlers, repository } = createHandlers()
    const rawBody = JSON.stringify({ object: 'page', fixture: 'meta-http' })
    const createRequest = () => new Request('https://ivybm.example.invalid/api/webhooks/meta', {
      body: rawBody,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'x-hub-signature-256': signatureFor(rawBody),
      },
      method: 'POST',
    })

    const accepted = await handlers.POST(createRequest())
    expect(accepted.status).toBe(200)
    expect(accepted.headers.get('cache-control')).toBe('no-store')
    await expect(accepted.json()).resolves.toEqual({ accepted: 1, duplicates: 0, total: 1 })

    const duplicate = await handlers.POST(createRequest())
    expect(duplicate.status).toBe(200)
    await expect(duplicate.json()).resolves.toEqual({ accepted: 0, duplicates: 1, total: 1 })
    expect(repository.events.size).toBe(1)
  })

  it('rejects invalid signatures, rate-limited sources and oversized streams without enqueueing', async () => {
    const rawBody = JSON.stringify({ object: 'page', fixture: 'invalid' })
    const invalidSignature = createHandlers()
    const invalid = await invalidSignature.handlers.POST(new Request(
      'https://ivybm.example.invalid/api/webhooks/meta',
      {
        body: rawBody,
        headers: { 'content-type': 'application/json', 'x-hub-signature-256': 'sha256=bad' },
        method: 'POST',
      },
    ))
    expect(invalid.status).toBe(401)
    await expect(invalid.json()).resolves.toEqual({ error: { code: 'invalid_signature' } })
    expect(invalidSignature.repository.events.size).toBe(0)

    let consumedKey: string | undefined
    const limited = createHandlers({
      rateLimiter: {
        consume: async (key) => {
          consumedKey = key
          return false
        },
      },
    })
    const rateLimited = await limited.handlers.POST(new Request(
      'https://ivybm.example.invalid/api/webhooks/meta',
      {
        body: rawBody,
        headers: {
          'content-type': 'application/json',
          'x-hub-signature-256': signatureFor(rawBody),
        },
        method: 'POST',
      },
    ))
    expect(rateLimited.status).toBe(429)
    expect(rateLimited.headers.get('retry-after')).toBe('60')
    await expect(rateLimited.json()).resolves.toEqual({ error: { code: 'rate_limited' } })
    expect(consumedKey).toBe('meta-webhook')

    const oversized = createHandlers({ maxBodyBytes: 8 })
    const tooLarge = await oversized.handlers.POST(new Request(
      'https://ivybm.example.invalid/api/webhooks/meta',
      {
        body: rawBody,
        headers: {
          'content-length': String(Buffer.byteLength(rawBody)),
          'content-type': 'application/json',
          'x-hub-signature-256': signatureFor(rawBody),
        },
        method: 'POST',
      },
    ))
    expect(tooLarge.status).toBe(413)
    await expect(tooLarge.json()).resolves.toEqual({ error: { code: 'payload_too_large' } })
    expect(oversized.repository.events.size).toBe(0)
  })

  it('does not initialize Payload for rejected requests', async () => {
    const rawBody = JSON.stringify({ object: 'page', fixture: 'rejected-before-payload' })
    const payloadProvider = vi.fn(async () => {
      throw new Error('Payload must not initialize for rejected webhooks')
    })
    const invalidSignature = createMetaWebhookHandlers({
      appSecret,
      connector: createConnector(),
      now: () => now,
      payloadProvider,
      rateLimiter: { consume: async () => true },
      verifyToken,
    })

    await expect(invalidSignature.POST(new Request('https://ivybm.example.invalid/api/webhooks/meta', {
      body: rawBody,
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': 'sha256=bad' },
      method: 'POST',
    }))).resolves.toMatchObject({ status: 401 })
    expect(payloadProvider).not.toHaveBeenCalled()

    const rateLimited = createMetaWebhookHandlers({
      appSecret,
      connector: createConnector(),
      now: () => now,
      payloadProvider,
      rateLimiter: { consume: async () => false },
      verifyToken,
    })
    await expect(rateLimited.POST(new Request('https://ivybm.example.invalid/api/webhooks/meta', {
      body: rawBody,
      headers: {
        'content-type': 'application/json',
        'x-hub-signature-256': signatureFor(rawBody),
      },
      method: 'POST',
    }))).resolves.toMatchObject({ status: 429 })
    expect(payloadProvider).not.toHaveBeenCalled()
  })

  it('redacts unexpected persistence failures', async () => {
    const rawBody = JSON.stringify({ object: 'page', fixture: 'persistence-failure' })
    const handlers = createMetaWebhookHandlers({
      appSecret,
      connector: createConnector(),
      now: () => now,
      rateLimiter: { consume: async () => true },
      repository: {
        enqueueBatch: async () => {
          throw new Error('postgres://user:secret@internal.example.invalid/ivybm')
        },
      },
      verifyToken,
    })

    const response = await handlers.POST(new Request('https://ivybm.example.invalid/api/webhooks/meta', {
      body: rawBody,
      headers: {
        'content-type': 'application/json',
        'x-hub-signature-256': signatureFor(rawBody),
      },
      method: 'POST',
    }))

    expect(response.status).toBe(503)
    const body = await response.text()
    expect(JSON.parse(body)).toEqual({ error: { code: 'service_unavailable' } })
    expect(body).not.toContain('postgres://')
    expect(body).not.toContain('secret')
  })
})
