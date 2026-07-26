import { createHmac, timingSafeEqual } from 'node:crypto'

import type { WebhookVerifier } from '../ports'

export type TikTokWebhookVerificationOptions = {
  maxAgeSeconds?: number
  maxFutureSkewSeconds?: number
  nowSeconds?: () => number
}

export type VerifyTikTokWebhookSignatureInput = {
  clientSecret: string
  maxAgeSeconds?: number
  maxFutureSkewSeconds?: number
  nowSeconds?: number
  rawBody: string | Uint8Array
  signatureHeader?: string
}

const DEFAULT_MAX_AGE_SECONDS = 5 * 60
const DEFAULT_MAX_FUTURE_SKEW_SECONDS = 60
const MAX_SIGNATURE_HEADER_LENGTH = 256
const UNIX_TIMESTAMP_PATTERN = /^[0-9]{1,12}$/
const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/i

type ParsedTikTokSignature = {
  signature: Buffer
  timestamp: string
  timestampSeconds: number
}

const nonNegativeInteger = (value: number): boolean => Number.isSafeInteger(value) && value >= 0

const parseTikTokSignatureHeader = (
  signatureHeader: string | undefined,
): ParsedTikTokSignature | undefined => {
  if (
    !signatureHeader ||
    Buffer.byteLength(signatureHeader, 'utf8') > MAX_SIGNATURE_HEADER_LENGTH
  ) {
    return undefined
  }

  let timestamp: string | undefined
  let signatureHex: string | undefined
  for (const rawPart of signatureHeader.split(',')) {
    const part = rawPart.trim()
    const separator = part.indexOf('=')
    if (separator <= 0 || separator !== part.lastIndexOf('=')) return undefined

    const key = part.slice(0, separator).trim()
    const value = part.slice(separator + 1).trim()
    if (key === 't') {
      if (timestamp !== undefined) return undefined
      timestamp = value
    } else if (key === 's') {
      if (signatureHex !== undefined) return undefined
      signatureHex = value
    } else {
      return undefined
    }
  }

  if (
    !timestamp ||
    !signatureHex ||
    !UNIX_TIMESTAMP_PATTERN.test(timestamp) ||
    !SHA256_HEX_PATTERN.test(signatureHex)
  ) {
    return undefined
  }

  const timestampSeconds = Number(timestamp)
  if (!Number.isSafeInteger(timestampSeconds) || timestampSeconds <= 0) return undefined

  return {
    signature: Buffer.from(signatureHex, 'hex'),
    timestamp,
    timestampSeconds,
  }
}

const rawBodyBytes = (rawBody: string | Uint8Array): Uint8Array => Buffer.from(rawBody)

const headerValue = (
  headers: Readonly<Record<string, string | undefined>>,
  name: string,
): string | undefined => {
  const normalizedName = name.toLowerCase()
  let matched = false
  let matchedValue: string | undefined
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== normalizedName) continue
    if (matched) return undefined
    matched = true
    matchedValue = value
  }
  return matchedValue
}

/**
 * Verify TikTok's documented `TikTok-Signature` over the exact raw body:
 * HMAC-SHA256(client_secret, `${timestamp}.${rawBody}`). The timestamp is
 * checked only after the MAC succeeds, so malformed or forged requests do not
 * gain a distinguishable freshness path.
 * Reference: https://developers.tiktok.com/doc/webhooks-verification/
 *
 * This is intentionally only the reusable ingress security seam. TikTok's
 * public developer documentation still does not expose the phase-one Business
 * DM event schema, so this module does not invent a connector, fixture, route,
 * or claim that TikTok messaging is available.
 */
export const verifyTikTokWebhookSignature = ({
  clientSecret,
  maxAgeSeconds = DEFAULT_MAX_AGE_SECONDS,
  maxFutureSkewSeconds = DEFAULT_MAX_FUTURE_SKEW_SECONDS,
  nowSeconds = Math.floor(Date.now() / 1_000),
  rawBody,
  signatureHeader,
}: VerifyTikTokWebhookSignatureInput): boolean => {
  if (
    !clientSecret.trim() ||
    !nonNegativeInteger(maxAgeSeconds) ||
    !nonNegativeInteger(maxFutureSkewSeconds) ||
    !Number.isSafeInteger(nowSeconds) ||
    nowSeconds <= 0
  ) {
    return false
  }

  const parsed = parseTikTokSignatureHeader(signatureHeader)
  if (!parsed) return false

  const expected = createHmac('sha256', clientSecret)
    .update(parsed.timestamp)
    .update('.')
    .update(rawBodyBytes(rawBody))
    .digest()
  if (parsed.signature.length !== expected.length || !timingSafeEqual(parsed.signature, expected)) {
    return false
  }

  if (parsed.timestampSeconds > nowSeconds + maxFutureSkewSeconds) return false
  if (nowSeconds - parsed.timestampSeconds > maxAgeSeconds) return false
  return true
}

export const createTikTokWebhookVerifier = (
  clientSecret: string,
  {
    maxAgeSeconds = DEFAULT_MAX_AGE_SECONDS,
    maxFutureSkewSeconds = DEFAULT_MAX_FUTURE_SKEW_SECONDS,
    nowSeconds = () => Math.floor(Date.now() / 1_000),
  }: TikTokWebhookVerificationOptions = {},
): WebhookVerifier => ({
  verify: ({ headers, rawBody }) =>
    verifyTikTokWebhookSignature({
      clientSecret,
      maxAgeSeconds,
      maxFutureSkewSeconds,
      nowSeconds: nowSeconds(),
      rawBody,
      signatureHeader: headerValue(headers, 'tiktok-signature'),
    }),
})
