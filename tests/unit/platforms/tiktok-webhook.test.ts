import { createHmac } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'

import {
  createTikTokWebhookVerifier,
  verifyTikTokWebhookSignature,
} from '../../../src/modules/platforms/tiktok/webhook'

const clientSecret = 'fixture-tiktok-client-secret'
const nowSeconds = 1_753_600_000

const signatureFor = (
  rawBody: string | Uint8Array,
  timestamp = nowSeconds,
  secret = clientSecret,
): string => {
  const signature = createHmac('sha256', secret)
    .update(String(timestamp))
    .update('.')
    .update(rawBody)
    .digest('hex')
  return `t=${timestamp},s=${signature}`
}

describe('TikTok webhook signature verification', () => {
  it('verifies the official timestamp-dot-raw-body HMAC shape', () => {
    const rawBody = JSON.stringify({ event: 'fixture', text: 'مرحبا' })

    expect(
      verifyTikTokWebhookSignature({
        clientSecret,
        nowSeconds,
        rawBody,
        signatureHeader: signatureFor(rawBody),
      }),
    ).toBe(true)
  })

  it('verifies the exact bytes without parsing or reserializing JSON', () => {
    const canonical = Buffer.from('{"a":1,"b":2}')
    const reordered = Buffer.from('{"b":2,"a":1}')

    expect(
      verifyTikTokWebhookSignature({
        clientSecret,
        nowSeconds,
        rawBody: canonical,
        signatureHeader: signatureFor(canonical),
      }),
    ).toBe(true)
    expect(
      verifyTikTokWebhookSignature({
        clientSecret,
        nowSeconds,
        rawBody: reordered,
        signatureHeader: signatureFor(canonical),
      }),
    ).toBe(false)
  })

  it('accepts either documented field order and case-insensitive header names', async () => {
    const rawBody = Buffer.from('{"fixture":true}')
    const signatureHeader = signatureFor(rawBody)
    const [timestamp, signature] = signatureHeader.split(',')
    const verifier = createTikTokWebhookVerifier(clientSecret, {
      nowSeconds: () => nowSeconds,
    })

    expect(
      await verifier.verify({
        headers: { 'TIKTOK-SIGNATURE': `${signature},${timestamp}` },
        rawBody,
      }),
    ).toBe(true)
  })

  it('rejects unknown signature fields and case-variant duplicate headers', async () => {
    const rawBody = Buffer.from('{"fixture":true}')
    const signatureHeader = signatureFor(rawBody)
    const verifier = createTikTokWebhookVerifier(clientSecret, {
      nowSeconds: () => nowSeconds,
    })

    expect(
      verifyTikTokWebhookSignature({
        clientSecret,
        nowSeconds,
        rawBody,
        signatureHeader: `${signatureHeader},v=1`,
      }),
    ).toBe(false)
    expect(
      await verifier.verify({
        headers: {
          'TikTok-Signature': signatureHeader,
          'tiktok-signature': signatureHeader,
        },
        rawBody,
      }),
    ).toBe(false)
  })

  it('rejects tampering, the wrong secret, and malformed signature headers', () => {
    const rawBody = '{"fixture":true}'
    const valid = signatureFor(rawBody)
    const malformed = [
      undefined,
      '',
      't=1',
      's=' + 'a'.repeat(64),
      `t=${nowSeconds},s=not-hex`,
      `t=${nowSeconds},s=${'a'.repeat(63)}`,
      `t=${nowSeconds},t=${nowSeconds},s=${'a'.repeat(64)}`,
      `t=${nowSeconds},s=${'a'.repeat(64)},s=${'b'.repeat(64)}`,
      `t=${nowSeconds}=extra,s=${'a'.repeat(64)}`,
      'x'.repeat(257),
    ]

    expect(
      verifyTikTokWebhookSignature({
        clientSecret,
        nowSeconds,
        rawBody: `${rawBody} `,
        signatureHeader: valid,
      }),
    ).toBe(false)
    expect(
      verifyTikTokWebhookSignature({
        clientSecret: 'wrong-secret',
        nowSeconds,
        rawBody,
        signatureHeader: valid,
      }),
    ).toBe(false)
    for (const signatureHeader of malformed) {
      expect(
        verifyTikTokWebhookSignature({
          clientSecret,
          nowSeconds,
          rawBody,
          signatureHeader,
        }),
      ).toBe(false)
    }
  })

  it('rejects replayed and excessively future-dated requests after a valid MAC', () => {
    const rawBody = '{"fixture":true}'
    const oldestAccepted = nowSeconds - 300
    const newestAccepted = nowSeconds + 60

    for (const timestamp of [oldestAccepted, nowSeconds, newestAccepted]) {
      expect(
        verifyTikTokWebhookSignature({
          clientSecret,
          nowSeconds,
          rawBody,
          signatureHeader: signatureFor(rawBody, timestamp),
        }),
      ).toBe(true)
    }
    for (const timestamp of [oldestAccepted - 1, newestAccepted + 1]) {
      expect(
        verifyTikTokWebhookSignature({
          clientSecret,
          nowSeconds,
          rawBody,
          signatureHeader: signatureFor(rawBody, timestamp),
        }),
      ).toBe(false)
    }
  })

  it('fails closed for missing configuration or invalid tolerance values', () => {
    const rawBody = '{"fixture":true}'
    const signatureHeader = signatureFor(rawBody)

    for (const input of [
      { clientSecret: '' },
      { clientSecret: '   ' },
      { clientSecret, maxAgeSeconds: -1 },
      { clientSecret, maxAgeSeconds: 1.5 },
      { clientSecret, maxFutureSkewSeconds: -1 },
      { clientSecret, nowSeconds: Number.NaN },
      { clientSecret, nowSeconds: 0 },
    ]) {
      expect(
        verifyTikTokWebhookSignature({
          nowSeconds,
          rawBody,
          signatureHeader,
          ...input,
        }),
      ).toBe(false)
    }
  })

  it('does not call fetch or expose the configured secret in its result', async () => {
    const rawBody = Buffer.from('{"fixture":true}')
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    try {
      const verifier = createTikTokWebhookVerifier(clientSecret, {
        nowSeconds: () => nowSeconds,
      })
      const result = await verifier.verify({
        headers: { 'TikTok-Signature': signatureFor(rawBody) },
        rawBody,
      })
      expect(result).toBe(true)
      expect(String(result)).not.toContain(clientSecret)
      expect(fetchSpy).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
