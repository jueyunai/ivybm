import { createHash, createHmac, timingSafeEqual } from 'node:crypto'

import type {
  PlatformConnector,
  PlatformEventRepository,
  WebhookRateLimiter,
  WebhookVerifier,
} from './ports'
import { platformEventKey } from './types'

export type WebhookValidationCode =
  | 'future_event'
  | 'idempotency_conflict'
  | 'invalid_challenge'
  | 'invalid_content_type'
  | 'invalid_payload'
  | 'invalid_signature'
  | 'payload_too_large'
  | 'rate_limited'
  | 'stale_event'

export class WebhookValidationError extends Error {
  readonly code: WebhookValidationCode

  constructor(code: WebhookValidationCode, message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'WebhookValidationError'
    this.code = code
  }
}

type VerifyMetaSignatureInput = {
  appSecret: string
  rawBody: string | Uint8Array
  signatureHeader?: string
}

type PlatformEventRepositorySource =
  | PlatformEventRepository
  | (() => PlatformEventRepository | Promise<PlatformEventRepository>)

type IngestSignedWebhookInput = {
  connector: PlatformConnector
  headers: Readonly<Record<string, string | undefined>>
  maxBodyBytes?: number
  maxEventAgeMs?: number
  maxFutureSkewMs?: number
  nowMs?: number
  rateLimiter: WebhookRateLimiter
  rateLimitKey: string
  rawBody: Uint8Array
  repository: PlatformEventRepositorySource
  verifier: WebhookVerifier
}

type VerifyMetaChallengeInput = {
  challenge?: string
  expectedVerifyToken: string
  mode?: string
  verifyToken?: string
}

export type WebhookIngestionResult = {
  accepted: number
  duplicates: number
  total: number
}

const rawBodyBytes = (rawBody: string | Uint8Array): Uint8Array => Buffer.from(rawBody)

const safeStringEqual = (left: string, right: string): boolean => {
  const leftBytes = Buffer.from(left)
  const rightBytes = Buffer.from(right)
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes)
}

const headerValue = (
  headers: Readonly<Record<string, string | undefined>>,
  name: string,
): string | undefined => {
  const normalizedName = name.toLowerCase()
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === normalizedName) return value
  }
  return undefined
}

const isJsonContentType = (headers: Readonly<Record<string, string | undefined>>): boolean =>
  headerValue(headers, 'content-type')?.split(';', 1)[0]?.trim().toLowerCase() ===
  'application/json'

export const verifyMetaWebhookChallenge = ({
  challenge,
  expectedVerifyToken,
  mode,
  verifyToken,
}: VerifyMetaChallengeInput): string => {
  if (
    mode !== 'subscribe' ||
    !challenge ||
    !expectedVerifyToken ||
    !verifyToken ||
    !safeStringEqual(verifyToken, expectedVerifyToken)
  ) {
    throw new WebhookValidationError(
      'invalid_challenge',
      'Webhook verification challenge is invalid',
    )
  }

  return challenge
}

export const verifyMetaWebhookSignature = ({
  appSecret,
  rawBody,
  signatureHeader,
}: VerifyMetaSignatureInput): boolean => {
  if (!appSecret || !signatureHeader?.startsWith('sha256=')) return false

  const suppliedHex = signatureHeader.slice('sha256='.length)
  if (!/^[a-f0-9]{64}$/i.test(suppliedHex)) return false

  const expected = createHmac('sha256', appSecret).update(rawBodyBytes(rawBody)).digest()
  const supplied = Buffer.from(suppliedHex, 'hex')

  return supplied.length === expected.length && timingSafeEqual(supplied, expected)
}

export const createMetaWebhookVerifier = (appSecret: string): WebhookVerifier => ({
  verify: ({ headers, rawBody }) =>
    verifyMetaWebhookSignature({
      appSecret,
      rawBody,
      signatureHeader: headerValue(headers, 'x-hub-signature-256'),
    }),
})

const parsePayload = (rawBody: string | Uint8Array): unknown => {
  try {
    return JSON.parse(Buffer.from(rawBodyBytes(rawBody)).toString('utf8'))
  } catch (error) {
    throw new WebhookValidationError('invalid_payload', 'Webhook payload must be valid JSON', {
      cause: error,
    })
  }
}

const assertFreshEvent = (
  occurredAt: string,
  nowMs: number,
  maxEventAgeMs: number,
  maxFutureSkewMs: number,
): void => {
  const eventTimestamp = Date.parse(occurredAt)
  if (!Number.isFinite(eventTimestamp)) {
    throw new WebhookValidationError('stale_event', 'Webhook event timestamp is invalid')
  }
  if (eventTimestamp > nowMs + maxFutureSkewMs) {
    throw new WebhookValidationError(
      'future_event',
      'Webhook event timestamp is later than the accepted clock skew',
    )
  }
  if (nowMs - eventTimestamp > maxEventAgeMs) {
    throw new WebhookValidationError(
      'stale_event',
      'Webhook event timestamp is outside the accepted window',
    )
  }
}

const sha256 = (value: string | Uint8Array): string =>
  createHash('sha256').update(value).digest('hex')

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (!value || typeof value !== 'object') return value

  const record = value as Record<string, unknown>
  return Object.fromEntries(
    Object.keys(record)
      .sort()
      .map((key) => [key, canonicalize(record[key])]),
  )
}

const eventDigest = (event: unknown): string => sha256(JSON.stringify(canonicalize(event)))

const resolveRepository = async (
  source: PlatformEventRepositorySource,
): Promise<PlatformEventRepository> =>
  typeof source === 'function' ? source() : source

export const ingestSignedWebhook = async ({
  connector,
  headers,
  maxBodyBytes = 1_000_000,
  maxEventAgeMs = 10 * 60 * 1_000,
  maxFutureSkewMs = 60_000,
  nowMs = Date.now(),
  rawBody,
  rateLimiter,
  rateLimitKey,
  repository,
  verifier,
}: IngestSignedWebhookInput): Promise<WebhookIngestionResult> => {
  const bytes = rawBodyBytes(rawBody)
  if (bytes.byteLength > maxBodyBytes) {
    throw new WebhookValidationError('payload_too_large', 'Webhook payload exceeds the size limit')
  }
  if (!isJsonContentType(headers)) {
    throw new WebhookValidationError(
      'invalid_content_type',
      'Webhook content type must be application/json',
    )
  }
  let signatureIsValid = false
  try {
    signatureIsValid = await verifier.verify({ headers, rawBody: bytes })
  } catch {
    signatureIsValid = false
  }
  if (!signatureIsValid) {
    throw new WebhookValidationError('invalid_signature', 'Webhook signature is invalid')
  }
  if (!rateLimitKey.trim() || !(await rateLimiter.consume(rateLimitKey))) {
    throw new WebhookValidationError('rate_limited', 'Webhook source is rate limited')
  }

  let events
  try {
    events = connector.normalize(parsePayload(bytes))
  } catch (error) {
    if (error instanceof WebhookValidationError) throw error
    throw new WebhookValidationError('invalid_payload', 'Webhook payload cannot be normalized', {
      cause: error,
    })
  }
  for (const event of events) {
    assertFreshEvent(event.occurredAt, nowMs, maxEventAgeMs, maxFutureSkewMs)
    let expectedKey: string
    try {
      expectedKey = platformEventKey(event.platform, event.externalEventId)
    } catch (error) {
      throw new WebhookValidationError('invalid_payload', 'Webhook event identifiers are invalid', {
        cause: error,
      })
    }
    if (event.idempotencyKey !== expectedKey) {
      throw new WebhookValidationError(
        'invalid_payload',
        'Webhook event idempotency key is invalid',
      )
    }
  }

  const rawPayloadDigest = sha256(bytes)
  // Do not initialize Payload / acquire a database connection for requests that
  // fail the cheap ingress checks above. The repository is intentionally lazy.
  const results = await (await resolveRepository(repository)).enqueueBatch(
    events.map((event) => ({
      event,
      eventDigest: eventDigest(event),
      rawPayloadDigest,
    })),
  )
  if (results.some((result) => result.status === 'conflict')) {
    throw new WebhookValidationError(
      'idempotency_conflict',
      'Webhook event conflicts with an existing idempotency key',
    )
  }

  const accepted = results.filter((result) => result.status === 'accepted').length
  const duplicates = results.filter((result) => result.status === 'duplicate').length
  return { accepted, duplicates, total: events.length }
}
