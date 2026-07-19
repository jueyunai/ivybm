import { describe, expect, it } from 'vitest'

import {
  createVisitorToken,
  hashVisitorToken,
  isVisitorSessionActive,
  requireChatPublicID,
  visitorSessionExpiresAt,
} from '@/modules/conversations/auth'

describe('visitor session credentials', () => {
  it('uses independent high-entropy secrets rather than caller-controlled idempotency input', () => {
    const first = createVisitorToken()
    const second = createVisitorToken()

    expect(first).not.toBe(second)
    expect(first).toHaveLength(43)
    expect(hashVisitorToken(first)).toMatch(/^[a-f0-9]{64}$/)
  })

  it('accepts only unexpired server-side visitor credentials', () => {
    const issuedAt = new Date('2026-07-19T00:00:00.000Z')
    const expiresAt = visitorSessionExpiresAt(issuedAt)

    expect(isVisitorSessionActive(expiresAt, issuedAt.getTime())).toBe(true)
    expect(isVisitorSessionActive(expiresAt, Date.parse(expiresAt))).toBe(false)
    expect(isVisitorSessionActive(undefined, issuedAt.getTime())).toBe(false)
  })

  it('rejects path identifiers before they can create unbounded limiter keys or database lookups', () => {
    expect(requireChatPublicID('session_123-abc')).toBe('session_123-abc')
    expect(() => requireChatPublicID('')).toThrow('Chat session identifier is invalid')
    expect(() => requireChatPublicID('../other-session')).toThrow('Chat session identifier is invalid')
    expect(() => requireChatPublicID('x'.repeat(201))).toThrow('Chat session identifier is invalid')
  })
})
