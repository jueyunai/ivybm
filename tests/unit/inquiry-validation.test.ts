import { afterEach, describe, expect, it, vi } from 'vitest'

import { createIdempotencyKey } from '@/lib/inquiries/idempotency'
import { createFixedWindowRateLimiter } from '@/lib/security/rateLimit'
import { validateInquiry } from '@/lib/validation/inquiry'

const validInquiry = {
  company: '  Acme Facades  ',
  country: ' United Arab Emirates ',
  email: ' BUYER@EXAMPLE.COM ',
  idempotencyKey: '2dcfd680-64e6-4f63-961a-16eec41f60d2',
  interest: ' Double-Curved Aluminum Panel ',
  locale: 'en',
  message: '  Please quote 1,200 square metres.  ',
  name: '  Buyer Name  ',
  phone: ' +971 (50) 123-4567 ',
  sourceURL: 'https://example.com/en/contact?utm_source=google',
  utmCampaign: ' facade-launch ',
  utmContent: ' hero-cta ',
  utmMedium: ' cpc ',
  utmSource: ' google ',
  utmTerm: ' curved panel ',
  website: '',
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('inquiry idempotency keys', () => {
  it('creates a valid UUID v4 when randomUUID is unavailable', () => {
    vi.stubGlobal('crypto', {
      getRandomValues: (bytes: Uint8Array) => {
        bytes.fill(0xab)
        return bytes
      },
    })

    expect(createIdempotencyKey()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    )
  })
})

describe('inquiry validation', () => {
  it('normalizes a valid business inquiry', () => {
    const result = validateInquiry(validInquiry)

    expect(result).toEqual({
      data: {
        company: 'Acme Facades',
        country: 'United Arab Emirates',
        email: 'buyer@example.com',
        idempotencyKey: validInquiry.idempotencyKey,
        interest: 'Double-Curved Aluminum Panel',
        locale: 'en',
        message: 'Please quote 1,200 square metres.',
        name: 'Buyer Name',
        phone: '+971501234567',
        sourceURL: validInquiry.sourceURL,
        utmCampaign: 'facade-launch',
        utmContent: 'hero-cta',
        utmMedium: 'cpc',
        utmSource: 'google',
        utmTerm: 'curved panel',
      },
      ok: true,
      spam: false,
    })
  })

  it('reports required fields and invalid contact details without throwing', () => {
    const result = validateInquiry({
      country: '',
      email: 'not-an-email',
      idempotencyKey: 'not-a-uuid',
      locale: 'fr',
      message: '',
      name: '',
      phone: 'telephone',
      sourceURL: 'javascript:alert(1)',
    })

    expect(result.ok).toBe(false)
    if (result.ok) return

    expect(result.errors).toMatchObject({
      country: 'required',
      email: 'invalid_email',
      idempotencyKey: 'invalid_idempotency_key',
      locale: 'invalid_locale',
      message: 'required',
      name: 'required',
      phone: 'invalid_phone',
      sourceURL: 'invalid_url',
    })
  })

  it('canonicalizes UUID casing and rejects letters hidden inside phone input', () => {
    const canonical = validateInquiry({
      ...validInquiry,
      idempotencyKey: validInquiry.idempotencyKey.toUpperCase(),
      phone: '',
    })

    expect(canonical).toMatchObject({
      data: { idempotencyKey: validInquiry.idempotencyKey },
      ok: true,
    })

    const invalidPhone = validateInquiry({
      ...validInquiry,
      phone: 'call +971501234567',
    })
    expect(invalidPhone).toMatchObject({ errors: { phone: 'invalid_phone' }, ok: false })
  })

  it('rejects oversized fields and ignores unrecognized properties', () => {
    const result = validateInquiry({
      ...validInquiry,
      company: 'x'.repeat(161),
      internalNotes: 'must never cross the public boundary',
      message: 'x'.repeat(5001),
    })

    expect(result.ok).toBe(false)
    if (result.ok) return

    expect(result.errors).toMatchObject({ company: 'too_long', message: 'too_long' })
    expect(result.errors).not.toHaveProperty('internalNotes')
  })

  it('marks a filled honeypot as spam without accepting its business data', () => {
    const result = validateInquiry({ ...validInquiry, website: 'https://spam.example' })

    expect(result).toEqual({ ok: true, spam: true })
  })
})

describe('fixed-window rate limiter', () => {
  it('limits each key independently and resets after the window', () => {
    let now = 1_000
    const limiter = createFixedWindowRateLimiter({ limit: 2, now: () => now, windowMs: 1_000 })

    expect(limiter.consume('198.51.100.1')).toMatchObject({ allowed: true, remaining: 1 })
    expect(limiter.consume('198.51.100.1')).toMatchObject({ allowed: true, remaining: 0 })
    expect(limiter.consume('198.51.100.1')).toEqual({
      allowed: false,
      remaining: 0,
      retryAfterSeconds: 1,
    })
    expect(limiter.consume('198.51.100.2')).toMatchObject({ allowed: true, remaining: 1 })

    now = 2_001
    expect(limiter.consume('198.51.100.1')).toMatchObject({ allowed: true, remaining: 1 })
  })

  it('bounds the number of retained client windows', () => {
    const limiter = createFixedWindowRateLimiter({ limit: 1, maxKeys: 2, windowMs: 10_000 })

    expect(limiter.consume('198.51.100.1')).toMatchObject({ allowed: true })
    expect(limiter.consume('198.51.100.2')).toMatchObject({ allowed: true })
    expect(limiter.consume('198.51.100.3')).toMatchObject({ allowed: true })
    expect(limiter.consume('198.51.100.1')).toMatchObject({ allowed: true })
  })
})
