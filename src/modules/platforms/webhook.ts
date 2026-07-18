import { createHmac, timingSafeEqual } from 'node:crypto'

import type { PlatformConnector, PlatformEventRepository, WebhookRateLimiter } from './ports'
import { platformEventKey } from './types'

export type WebhookValidationCode =
  | 'invalid_challenge'
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

type IngestSignedWebhookInput = VerifyMetaSignatureInput & {
  connector: PlatformConnector
  maxBodyBytes?: number
  maxEventAgeMs?: number
  nowMs?: number
  rateLimiter: WebhookRateLimiter
  rateLimitKey: string
  repository: PlatformEventRepository
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

const rawBodyBytes = (rawBody: string | Uint8Array): Uint8Array =>
  typeof rawBody === 'string' ? Buffer.from(rawBody) : rawBody

const safeStringEqual = (left: string, right: string): boolean => {
  const leftBytes = Buffer.from(left)
  const rightBytes = Buffer.from(right)
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes)
}

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

const parsePayload = (rawBody: string | Uint8Array): unknown => {
  try {
    return JSON.parse(Buffer.from(rawBodyBytes(rawBody)).toString('utf8'))
  } catch (error) {
    throw new WebhookValidationError('invalid_payload', 'Webhook payload must be valid JSON', {
      cause: error,
    })
  }
}

const assertFreshEvent = (occurredAt: string, nowMs: number, maxEventAgeMs: number): void => {
  const eventTimestamp = Date.parse(occurredAt)
  if (!Number.isFinite(eventTimestamp) || Math.abs(nowMs - eventTimestamp) > maxEventAgeMs) {
    throw new WebhookValidationError(
      'stale_event',
      'Webhook event timestamp is outside the accepted window',
    )
  }
}

export const ingestSignedWebhook = async ({
  appSecret,
  connector,
  maxBodyBytes = 1_000_000,
  maxEventAgeMs = 10 * 60 * 1_000,
  nowMs = Date.now(),
  rawBody,
  rateLimiter,
  rateLimitKey,
  repository,
  signatureHeader,
}: IngestSignedWebhookInput): Promise<WebhookIngestionResult> => {
  const bytes = rawBodyBytes(rawBody)
  if (bytes.byteLength > maxBodyBytes) {
    throw new WebhookValidationError('payload_too_large', 'Webhook payload exceeds the size limit')
  }
  if (!rateLimitKey.trim() || !(await rateLimiter.consume(rateLimitKey))) {
    throw new WebhookValidationError('rate_limited', 'Webhook source is rate limited')
  }
  if (!verifyMetaWebhookSignature({ appSecret, rawBody: bytes, signatureHeader })) {
    throw new WebhookValidationError('invalid_signature', 'Webhook signature is invalid')
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
    assertFreshEvent(event.occurredAt, nowMs, maxEventAgeMs)
    if (event.idempotencyKey !== platformEventKey(event.platform, event.externalEventId)) {
      throw new WebhookValidationError(
        'invalid_payload',
        'Webhook event idempotency key is invalid',
      )
    }
  }

  let accepted = 0
  let duplicates = 0
  for (const event of events) {
    const result = await repository.enqueue(event)
    if (result === 'accepted') accepted += 1
    else duplicates += 1
  }

  return { accepted, duplicates, total: events.length }
}
