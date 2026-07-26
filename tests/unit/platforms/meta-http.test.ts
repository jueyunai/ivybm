import { createHmac } from 'node:crypto'

import { describe, expect, it, vi } from 'vitest'

import { createMetaWebhookHandlers } from '@/modules/platforms/meta/http'
import { createMetaConnector } from '@/modules/platforms/meta/connector'
import type { PlatformConnector, WebhookRateLimiter } from '@/modules/platforms/ports'
import { platformEventKeyV2, type NormalizedInboundMessage } from '@/modules/platforms/types'

import { FakePlatformEventRepository } from '../../fakes/platformEventRepository'

const now = Date.UTC(2026, 6, 22, 8, 0, 0)
const appSecret = 'fixture-meta-app-secret'
const verifyToken = 'fixture-meta-verify-token'
const allowAllAccounts = { assertCanReceive: async () => undefined }

const inboundEvent = (
  externalEventId = 'meta-http-event-1',
  {
    accountExternalId = 'page-fixture-1',
    occurredAt = now,
  }: { accountExternalId?: string; occurredAt?: number } = {},
): NormalizedInboundMessage => ({
  accountExternalId,
  content: { messageType: 'text', text: 'Fixture inbound message.' },
  externalEventId,
  idempotencyKey: platformEventKeyV2('facebook-messenger', accountExternalId, externalEventId),
  kind: 'inbound-message',
  occurredAt: new Date(occurredAt).toISOString(),
  platform: 'facebook-messenger',
  recipientExternalId: accountExternalId,
  senderExternalId: 'sender-fixture-1',
})

const signatureFor = (rawBody: string): string =>
  `sha256=${createHmac('sha256', appSecret).update(rawBody).digest('hex')}`

const createConnector = (event = inboundEvent()): PlatformConnector => ({
  normalize: () => [event],
  platformFamily: 'meta',
})

const createHandlers = ({
  accountAuthorizer = allowAllAccounts,
  allowedAccountExternalIds = ['page-fixture-1'],
  appSecret: configuredAppSecret = appSecret,
  connector = createConnector(),
  maxBodyBytes,
  rateLimiter = { consume: async () => true } satisfies WebhookRateLimiter,
  repository = new FakePlatformEventRepository(),
  verifyToken: configuredVerifyToken = verifyToken,
}: {
  accountAuthorizer?: { assertCanReceive: (event: NormalizedInboundMessage) => Promise<void> }
  allowedAccountExternalIds?: readonly string[]
  appSecret?: string
  connector?: PlatformConnector
  maxBodyBytes?: number
  rateLimiter?: WebhookRateLimiter
  repository?: FakePlatformEventRepository
  verifyToken?: string
} = {}) => ({
  handlers: createMetaWebhookHandlers({
    accountAuthorizer,
    allowedAccountExternalIds,
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
    const response = await handlers.GET(
      new Request(
        'https://ivybm.example.invalid/api/webhooks/meta?hub.mode=subscribe&hub.verify_token=fixture-meta-verify-token&hub.challenge=fixture-challenge',
      ),
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('content-type')).toContain('text/plain')
    await expect(response.text()).resolves.toBe('fixture-challenge')

    const invalid = await handlers.GET(
      new Request(
        'https://ivybm.example.invalid/api/webhooks/meta?hub.mode=subscribe&hub.verify_token=wrong-token&hub.challenge=fixture-challenge',
      ),
    )
    expect(invalid.status).toBe(403)
    await expect(invalid.json()).resolves.toEqual({ error: { code: 'invalid_challenge' } })

    const unconfigured = createHandlers({ appSecret: '', verifyToken: '' })
    const unavailable = await unconfigured.handlers.GET(
      new Request(
        'https://ivybm.example.invalid/api/webhooks/meta?hub.mode=subscribe&hub.verify_token=fixture-meta-verify-token&hub.challenge=fixture-challenge',
      ),
    )
    expect(unavailable.status).toBe(503)
    await expect(unavailable.json()).resolves.toEqual({ error: { code: 'service_unavailable' } })
  })

  it('verifies raw bytes and atomically reports accepted then duplicate Meta delivery', async () => {
    const { handlers, repository } = createHandlers()
    const rawBody = JSON.stringify({ object: 'page', fixture: 'meta-http' })
    const createRequest = () =>
      new Request('https://ivybm.example.invalid/api/webhooks/meta', {
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

  it('rejects an account blocked by PlatformAccounts before durable enqueue', async () => {
    const assertCanReceive = vi.fn(async () => {
      throw new Error('Platform messaging account is blocked')
    })
    const { handlers, repository } = createHandlers({
      accountAuthorizer: { assertCanReceive },
    })
    const rawBody = JSON.stringify({ object: 'page', fixture: 'blocked-account' })

    const response = await handlers.POST(
      new Request('https://ivybm.example.invalid/api/webhooks/meta', {
        body: rawBody,
        headers: {
          'content-type': 'application/json',
          'x-hub-signature-256': signatureFor(rawBody),
        },
        method: 'POST',
      }),
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: { code: 'unauthorized_account' } })
    expect(assertCanReceive).toHaveBeenCalledTimes(1)
    expect(repository.events.size).toBe(0)
  })

  it('rejects invalid signatures, rate-limited sources and oversized streams without enqueueing', async () => {
    const rawBody = JSON.stringify({ object: 'page', fixture: 'invalid' })
    const invalidSignature = createHandlers()
    const invalid = await invalidSignature.handlers.POST(
      new Request('https://ivybm.example.invalid/api/webhooks/meta', {
        body: rawBody,
        headers: { 'content-type': 'application/json', 'x-hub-signature-256': 'sha256=bad' },
        method: 'POST',
      }),
    )
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
    const rateLimited = await limited.handlers.POST(
      new Request('https://ivybm.example.invalid/api/webhooks/meta', {
        body: rawBody,
        headers: {
          'content-type': 'application/json',
          'x-hub-signature-256': signatureFor(rawBody),
        },
        method: 'POST',
      }),
    )
    expect(rateLimited.status).toBe(429)
    expect(rateLimited.headers.get('retry-after')).toBe('60')
    await expect(rateLimited.json()).resolves.toEqual({ error: { code: 'rate_limited' } })
    expect(consumedKey).toBe('meta-webhook:facebook-messenger:page-fixture-1')

    const oversized = createHandlers({ maxBodyBytes: 8 })
    const tooLarge = await oversized.handlers.POST(
      new Request('https://ivybm.example.invalid/api/webhooks/meta', {
        body: rawBody,
        headers: {
          'content-length': String(Buffer.byteLength(rawBody)),
          'content-type': 'application/json',
          'x-hub-signature-256': signatureFor(rawBody),
        },
        method: 'POST',
      }),
    )
    expect(tooLarge.status).toBe(413)
    await expect(tooLarge.json()).resolves.toEqual({ error: { code: 'payload_too_large' } })
    expect(oversized.repository.events.size).toBe(0)
  })

  it('rejects a malformed batch without partial persistence and acknowledges explicit control callbacks', async () => {
    const consume = vi.fn(async () => true)
    const { handlers, repository } = createHandlers({
      connector: createMetaConnector(),
      rateLimiter: { consume },
    })
    const malformedBody = JSON.stringify({
      entry: [
        {
          id: 'page-fixture-1',
          messaging: [
            {
              message: { mid: 'valid-before-malformed', text: 'This event must not persist.' },
              recipient: { id: 'page-fixture-1' },
              sender: { id: 'sender-fixture-1' },
              timestamp: now,
            },
            { message: null },
          ],
        },
      ],
      object: 'page',
    })

    const malformed = await handlers.POST(
      new Request('https://ivybm.example.invalid/api/webhooks/meta', {
        body: malformedBody,
        headers: {
          'content-type': 'application/json',
          'x-hub-signature-256': signatureFor(malformedBody),
        },
        method: 'POST',
      }),
    )
    expect(malformed.status).toBe(400)
    await expect(malformed.json()).resolves.toEqual({ error: { code: 'invalid_payload' } })
    expect(consume).not.toHaveBeenCalled()
    expect(repository.events.size).toBe(0)

    const controlBody = JSON.stringify({
      entry: [
        {
          id: 'page-fixture-1',
          messaging: [{ delivery: { mids: ['outbound-fixture-1'], watermark: 1 } }],
        },
      ],
      object: 'page',
    })
    const control = await handlers.POST(
      new Request('https://ivybm.example.invalid/api/webhooks/meta', {
        body: controlBody,
        headers: {
          'content-type': 'application/json',
          'x-hub-signature-256': signatureFor(controlBody),
        },
        method: 'POST',
      }),
    )
    expect(control.status).toBe(200)
    await expect(control.json()).resolves.toEqual({ accepted: 0, duplicates: 0, total: 0 })
    expect(consume).not.toHaveBeenCalled()
    expect(repository.events.size).toBe(0)
  })

  it('does not initialize Payload for rejected requests', async () => {
    const rawBody = JSON.stringify({ object: 'page', fixture: 'rejected-before-payload' })
    const payloadProvider = vi.fn(async () => {
      throw new Error('Payload must not initialize for rejected webhooks')
    })
    const invalidSignature = createMetaWebhookHandlers({
      allowedAccountExternalIds: ['page-fixture-1'],
      appSecret,
      connector: createConnector(),
      now: () => now,
      payloadProvider,
      rateLimiter: { consume: async () => true },
      verifyToken,
    })

    await expect(
      invalidSignature.POST(
        new Request('https://ivybm.example.invalid/api/webhooks/meta', {
          body: rawBody,
          headers: { 'content-type': 'application/json', 'x-hub-signature-256': 'sha256=bad' },
          method: 'POST',
        }),
      ),
    ).resolves.toMatchObject({ status: 401 })
    expect(payloadProvider).not.toHaveBeenCalled()

    const rateLimited = createMetaWebhookHandlers({
      allowedAccountExternalIds: ['page-fixture-1'],
      appSecret,
      connector: createConnector(),
      now: () => now,
      payloadProvider,
      rateLimiter: { consume: async () => false },
      verifyToken,
    })
    await expect(
      rateLimited.POST(
        new Request('https://ivybm.example.invalid/api/webhooks/meta', {
          body: rawBody,
          headers: {
            'content-type': 'application/json',
            'x-hub-signature-256': signatureFor(rawBody),
          },
          method: 'POST',
        }),
      ),
    ).resolves.toMatchObject({ status: 429 })
    expect(payloadProvider).not.toHaveBeenCalled()

    const malformed = createMetaWebhookHandlers({
      allowedAccountExternalIds: ['page-fixture-1'],
      appSecret,
      connector: createMetaConnector(),
      now: () => now,
      payloadProvider,
      rateLimiter: { consume: async () => true },
      verifyToken,
    })
    const malformedBody = JSON.stringify({
      entry: [{ id: 'page-fixture-1', messaging: [{ message: null }] }],
      object: 'page',
    })
    await expect(
      malformed.POST(
        new Request('https://ivybm.example.invalid/api/webhooks/meta', {
          body: malformedBody,
          headers: {
            'content-type': 'application/json',
            'x-hub-signature-256': signatureFor(malformedBody),
          },
          method: 'POST',
        }),
      ),
    ).resolves.toMatchObject({ status: 400 })
    expect(payloadProvider).not.toHaveBeenCalled()
  })

  it('redacts unexpected persistence failures', async () => {
    const rawBody = JSON.stringify({ object: 'page', fixture: 'persistence-failure' })
    const handlers = createMetaWebhookHandlers({
      accountAuthorizer: allowAllAccounts,
      allowedAccountExternalIds: ['page-fixture-1'],
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

    const response = await handlers.POST(
      new Request('https://ivybm.example.invalid/api/webhooks/meta', {
        body: rawBody,
        headers: {
          'content-type': 'application/json',
          'x-hub-signature-256': signatureFor(rawBody),
        },
        method: 'POST',
      }),
    )

    expect(response.status).toBe(503)
    const body = await response.text()
    expect(JSON.parse(body)).toEqual({ error: { code: 'service_unavailable' } })
    expect(body).not.toContain('postgres://')
    expect(body).not.toContain('secret')
  })

  it('accepts a Meta retry after the documented delivery window and keeps it idempotent', async () => {
    const delayed = 36 * 60 * 60 * 1_000
    const event = inboundEvent('meta-http-delayed-retry', { occurredAt: now - delayed })
    const { handlers, repository } = createHandlers({ connector: createConnector(event) })
    const rawBody = JSON.stringify({ object: 'page', fixture: 'delayed-retry' })
    const request = () =>
      new Request('https://ivybm.example.invalid/api/webhooks/meta', {
        body: rawBody,
        headers: {
          'content-type': 'application/json',
          'x-hub-signature-256': signatureFor(rawBody),
        },
        method: 'POST',
      })

    await expect(handlers.POST(request())).resolves.toMatchObject({ status: 200 })
    await expect(handlers.POST(request())).resolves.toMatchObject({ status: 200 })
    expect(repository.events.size).toBe(1)
  })

  it('fails closed without an account allowlist and rejects a signed unapproved account before Payload initializes', async () => {
    const rawBody = JSON.stringify({ object: 'page', fixture: 'account-allowlist' })
    const payloadProvider = vi.fn(async () => {
      throw new Error('Payload must not initialize for an unapproved Meta account')
    })
    const unconfigured = createMetaWebhookHandlers({
      allowedAccountExternalIds: [],
      appSecret,
      connector: createConnector(),
      now: () => now,
      payloadProvider,
      rateLimiter: { consume: async () => true },
      verifyToken,
    })
    const unauthorized = createMetaWebhookHandlers({
      allowedAccountExternalIds: ['another-page'],
      appSecret,
      connector: createConnector(),
      now: () => now,
      payloadProvider,
      rateLimiter: { consume: async () => true },
      verifyToken,
    })
    const request = () =>
      new Request('https://ivybm.example.invalid/api/webhooks/meta', {
        body: rawBody,
        headers: {
          'content-type': 'application/json',
          'x-hub-signature-256': signatureFor(rawBody),
        },
        method: 'POST',
      })

    await expect(unconfigured.POST(request())).resolves.toMatchObject({ status: 503 })
    const response = await unauthorized.POST(request())
    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: { code: 'unauthorized_account' } })
    expect(payloadProvider).not.toHaveBeenCalled()
  })
})
