import { createHmac } from 'node:crypto'

import { describe, expect, it, vi } from 'vitest'

import {
  createMetaWebhookHandlers,
  type MetaWebhookFailureRecorder,
  type MetaWebhookLogEvent,
} from '@/modules/platforms/meta/http'
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

const signatureFor = (rawBody: string, secret = appSecret): string =>
  `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`

const createConnector = (event = inboundEvent()): PlatformConnector => ({
  normalize: () => [event],
  platformFamily: 'meta',
})

const createHandlers = ({
  accountAuthorizer = allowAllAccounts,
  allowedAccountExternalIds = ['page-fixture-1'],
  appSecret: configuredAppSecret = appSecret,
  connector = createConnector(),
  diagnosticSink,
  failureRecorder,
  instagramAppSecret,
  logSink,
  maxBodyBytes,
  rateLimiter = { consume: async () => true } satisfies WebhookRateLimiter,
  repository = new FakePlatformEventRepository(),
  verifyToken: configuredVerifyToken = verifyToken,
}: {
  accountAuthorizer?: { assertCanReceive: (event: NormalizedInboundMessage) => Promise<void> }
  allowedAccountExternalIds?: readonly string[]
  appSecret?: string
  connector?: PlatformConnector
  diagnosticSink?: (diagnostic: unknown) => void
  failureRecorder?: MetaWebhookFailureRecorder
  instagramAppSecret?: string
  logSink?: (event: MetaWebhookLogEvent) => void
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
    diagnosticSink,
    failureRecorder,
    instagramAppSecret,
    logSink,
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

  it('logs every verified callback and records a replay artifact for downstream rejection', async () => {
    const failureRecorder: MetaWebhookFailureRecorder = {
      record: vi.fn(async () => ({ recordId: 42, status: 'recorded' as const })),
    }
    const logSink = vi.fn<(event: MetaWebhookLogEvent) => void>()
    const { handlers } = createHandlers({
      allowedAccountExternalIds: ['another-page'],
      failureRecorder,
      logSink,
    })
    const rawBody = JSON.stringify({
      object: 'page',
      privateText: 'must-not-enter-ordinary-logs',
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

    expect(response.status).toBe(403)
    expect(failureRecorder.record).toHaveBeenCalledWith(
      expect.objectContaining({
        body: new Uint8Array(Buffer.from(rawBody)),
        contentType: 'application/json',
        errorCode: 'unauthorized_account',
        providerObject: 'page',
        traceId: expect.any(String),
      }),
    )
    expect(logSink).toHaveBeenCalledWith(
      expect.objectContaining({
        bodyBytes: Buffer.byteLength(rawBody),
        bodySha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        errorCode: 'unauthorized_account',
        outcome: 'rejected',
        providerObject: 'page',
        replayRecordId: 42,
        traceId: expect.any(String),
      }),
    )
    expect(JSON.stringify(logSink.mock.calls)).not.toContain('must-not-enter-ordinary-logs')
  })

  it('never records or logs unverified callback bodies', async () => {
    const failureRecorder: MetaWebhookFailureRecorder = {
      record: vi.fn(async () => ({ recordId: 1, status: 'recorded' as const })),
    }
    const logSink = vi.fn<(event: MetaWebhookLogEvent) => void>()
    const { handlers } = createHandlers({ failureRecorder, logSink })
    const rawBody = JSON.stringify({ privateText: 'untrusted-attacker-body', object: 'page' })
    const response = await handlers.POST(
      new Request('https://ivybm.example.invalid/api/webhooks/meta', {
        body: rawBody,
        headers: {
          'content-type': 'application/json',
          'x-hub-signature-256': 'sha256=invalid',
        },
        method: 'POST',
      }),
    )

    expect(response.status).toBe(401)
    expect(failureRecorder.record).not.toHaveBeenCalled()
    expect(logSink).not.toHaveBeenCalled()
  })

  it('keeps the original response when replay persistence fails', async () => {
    const failureRecorder: MetaWebhookFailureRecorder = {
      record: vi.fn(async () => {
        throw new Error('postgres://secret-replay-database')
      }),
    }
    const logSink = vi.fn<(event: MetaWebhookLogEvent) => void>()
    const { handlers } = createHandlers({
      allowedAccountExternalIds: ['another-page'],
      failureRecorder,
      logSink,
    })
    const rawBody = JSON.stringify({ object: 'page', privateText: 'must-remain-encrypted' })
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
    expect(logSink).toHaveBeenCalledWith(
      expect.objectContaining({
        errorCode: 'unauthorized_account',
        outcome: 'rejected',
        replayRecordStatus: 'failed',
      }),
    )
    expect(JSON.stringify(logSink.mock.calls)).not.toContain('postgres://')
    expect(JSON.stringify(logSink.mock.calls)).not.toContain('must-remain-encrypted')
  })

  it('does not hold the Meta response open while replay storage is unavailable', async () => {
    const failureRecorder: MetaWebhookFailureRecorder = {
      record: vi.fn(
        () => new Promise<never>(() => undefined),
      ),
    }
    const logSink = vi.fn<(event: MetaWebhookLogEvent) => void>()
    const { handlers } = createHandlers({
      allowedAccountExternalIds: ['another-page'],
      failureRecorder,
      logSink,
    })
    const rawBody = JSON.stringify({ object: 'page', privateText: 'bounded persistence test' })
    const startedAt = Date.now()
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
    expect(Date.now() - startedAt).toBeLessThan(1_000)
    expect(logSink).toHaveBeenCalledWith(
      expect.objectContaining({ replayRecordStatus: 'pending', outcome: 'rejected' }),
    )
  })

  it('isolates ordinary structured-log failures from Webhook acknowledgement', async () => {
    const { handlers } = createHandlers({
      logSink: () => {
        throw new Error('log transport unavailable')
      },
    })
    const rawBody = JSON.stringify({ object: 'page', fixture: 'log-sink-failure' })
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

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ accepted: 1, duplicates: 0, total: 1 })
  })

  it('selects the Instagram App Secret for Instagram webhook signatures', async () => {
    const instagramSecret = 'fixture-instagram-app-secret'
    const { handlers } = createHandlers({ instagramAppSecret: instagramSecret })
    const rawBody = JSON.stringify({ object: 'instagram', fixture: 'instagram-http' })
    const request = (secret: string) =>
      new Request('https://ivybm.example.invalid/api/webhooks/meta', {
        body: rawBody,
        headers: {
          'content-type': 'application/json',
          'x-hub-signature-256': signatureFor(rawBody, secret),
        },
        method: 'POST',
      })

    const wrongSecret = await handlers.POST(request(appSecret))
    expect(wrongSecret.status).toBe(401)
    await expect(wrongSecret.json()).resolves.toEqual({ error: { code: 'invalid_signature' } })

    const accepted = await handlers.POST(request(instagramSecret))
    expect(accepted.status).toBe(200)
    await expect(accepted.json()).resolves.toEqual({ accepted: 1, duplicates: 0, total: 1 })
  })

  it('authorizes an Instagram message by its recipient account when entry.id is an alias', async () => {
    const instagramSecret = 'fixture-instagram-app-secret'
    const assertCanReceive = vi.fn(async () => undefined)
    const repository = new FakePlatformEventRepository()
    const { handlers } = createHandlers({
      accountAuthorizer: { assertCanReceive },
      allowedAccountExternalIds: ['ig-account-fixture-1'],
      connector: createMetaConnector(),
      instagramAppSecret: instagramSecret,
      repository,
    })
    const rawBody = JSON.stringify({
      entry: [
        {
          id: 'ig-entry-alias-fixture-1',
          messaging: [
            {
              message: { mid: 'm_fixture_instagram_recipient_boundary_http', text: 'Hello.' },
              recipient: { id: 'ig-account-fixture-1' },
              sender: { id: 'ig-sender-fixture-1' },
              timestamp: String(now),
            },
          ],
        },
      ],
      object: 'instagram',
    })

    const response = await handlers.POST(
      new Request('https://ivybm.example.invalid/api/webhooks/meta', {
        body: rawBody,
        headers: {
          'content-type': 'application/json',
          'x-hub-signature-256': signatureFor(rawBody, instagramSecret),
        },
        method: 'POST',
      }),
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ accepted: 1, duplicates: 0, total: 1 })
    expect(assertCanReceive).toHaveBeenCalledWith(expect.objectContaining({
      accountExternalId: 'ig-account-fixture-1',
      platform: 'instagram',
    }))
    expect(repository.events.size).toBe(1)
  })

  it('rejects an Instagram message when its messaging identity is absent from PlatformAccounts', async () => {
    const instagramSecret = 'fixture-instagram-app-secret'
    const assertCanReceive = vi.fn(async () => {
      throw new Error('messaging identity is not configured')
    })
    const repository = new FakePlatformEventRepository()
    const { handlers } = createHandlers({
      accountAuthorizer: { assertCanReceive },
      allowedAccountExternalIds: ['ig-account-fixture-1'],
      connector: createMetaConnector(),
      instagramAppSecret: instagramSecret,
      repository,
    })
    const rawBody = JSON.stringify({
      entry: [
        {
          id: 'ig-account-fixture-1',
          messaging: [
            {
              message: { mid: 'm_fixture_instagram_recipient_not_allowlisted', text: 'Hello.' },
              recipient: { id: 'ig-account-other' },
              sender: { id: 'ig-sender-fixture-2' },
              timestamp: String(now),
            },
          ],
        },
      ],
      object: 'instagram',
    })

    const response = await handlers.POST(
      new Request('https://ivybm.example.invalid/api/webhooks/meta', {
        body: rawBody,
        headers: {
          'content-type': 'application/json',
          'x-hub-signature-256': signatureFor(rawBody, instagramSecret),
        },
        method: 'POST',
      }),
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: { code: 'unauthorized_account' } })
    expect(assertCanReceive).toHaveBeenCalledWith(
      expect.objectContaining({
        accountExternalId: 'ig-account-other',
        platform: 'instagram',
      }),
    )
    expect(repository.events.size).toBe(0)
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

  it('logs only bounded payload structure for invalid payloads', async () => {
    const diagnosticSink = vi.fn()
    const { handlers } = createHandlers({
      connector: createMetaConnector(),
      diagnosticSink,
      instagramAppSecret: 'fixture-instagram-app-secret',
    })
    const rawBody = JSON.stringify({
      entry: [
        {
          changes: [{
            field: 'messages',
            value: {
              access_token: 'must-not-be-logged-token',
              attachment: { url: 'https://private.example.invalid/secret.jpg' },
              recipient: { id: 'must-not-be-logged-recipient' },
              secretText: 'must-not-be-logged',
              sender: { id: 'must-not-be-logged-sender' },
            },
          }],
          id: 'sensitive-account-id',
        },
      ],
      object: 'instagram',
    })
    const response = await handlers.POST(
      new Request('https://ivybm.example.invalid/api/webhooks/meta', {
        body: rawBody,
        headers: {
          'content-type': 'application/json',
          'x-hub-signature-256': signatureFor(rawBody, 'fixture-instagram-app-secret'),
        },
        method: 'POST',
      }),
    )

    expect(response.status).toBe(400)
    expect(diagnosticSink).toHaveBeenCalledWith({
      code: 'invalid_payload',
      entries: [
        {
          changeFields: ['messages'],
          hasChanges: true,
          hasMessaging: false,
          messagingKinds: [],
        },
      ],
      entryCount: 1,
      object: 'instagram',
    })
    expect(JSON.stringify(diagnosticSink.mock.calls)).not.toContain('must-not-be-logged')
    expect(JSON.stringify(diagnosticSink.mock.calls)).not.toContain('sensitive-account-id')
    expect(JSON.stringify(diagnosticSink.mock.calls)).not.toContain('private.example.invalid')
  })

  it('rejects unknown Instagram change fields with a sanitized structural diagnostic', async () => {
    const diagnosticSink = vi.fn()
    const { handlers, repository } = createHandlers({
      connector: createMetaConnector(),
      diagnosticSink,
      instagramAppSecret: 'fixture-instagram-app-secret',
    })
    const rawBody = JSON.stringify({
      entry: [
        {
          changes: [{ field: 'mesages', value: { secret: 'must-not-be-logged' } }],
          id: 'sensitive-account-id',
        },
      ],
      object: 'instagram',
    })
    const response = await handlers.POST(
      new Request('https://ivybm.example.invalid/api/webhooks/meta', {
        body: rawBody,
        headers: {
          'content-type': 'application/json',
          'x-hub-signature-256': signatureFor(rawBody, 'fixture-instagram-app-secret'),
        },
        method: 'POST',
      }),
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: { code: 'invalid_payload' } })
    expect(repository.events.size).toBe(0)
    expect(diagnosticSink).toHaveBeenCalledWith({
      code: 'invalid_payload',
      entries: [
        {
          changeFields: ['unknown'],
          hasChanges: true,
          hasMessaging: false,
          messagingKinds: [],
        },
      ],
      entryCount: 1,
      object: 'instagram',
    })
    expect(JSON.stringify(diagnosticSink.mock.calls)).not.toContain('must-not-be-logged')
    expect(JSON.stringify(diagnosticSink.mock.calls)).not.toContain('sensitive-account-id')
  })

  it('isolates diagnostic sink failures from the webhook response', async () => {
    const { handlers } = createHandlers({
      connector: createMetaConnector(),
      diagnosticSink: () => {
        throw new Error('diagnostic sink unavailable')
      },
      instagramAppSecret: 'fixture-instagram-app-secret',
    })
    const rawBody = JSON.stringify({
      entry: [{ changes: [{ field: 'messages', value: {} }], id: 'account-fixture-1' }],
      object: 'instagram',
    })

    const response = await handlers.POST(
      new Request('https://ivybm.example.invalid/api/webhooks/meta', {
        body: rawBody,
        headers: {
          'content-type': 'application/json',
          'x-hub-signature-256': signatureFor(rawBody, 'fixture-instagram-app-secret'),
        },
        method: 'POST',
      }),
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: { code: 'invalid_payload' } })
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
