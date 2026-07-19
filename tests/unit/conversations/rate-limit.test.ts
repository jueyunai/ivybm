import { afterEach, describe, expect, it } from 'vitest'

import { createFixedWindowRateLimiter } from '@/lib/security/rateLimit'
import { ChatServiceError } from '@/modules/conversations/contracts'
import { chatErrorResponse } from '@/modules/conversations/http'
import {
  CHAT_RATE_LIMIT_SCOPES,
  enforceChatRateLimit,
  getChatClientKey,
} from '@/modules/conversations/rateLimit'

describe('chat rate limiting', () => {
  const originalTrustProxyHeaders = process.env.TRUST_PROXY_HEADERS

  afterEach(() => {
    if (originalTrustProxyHeaders === undefined) delete process.env.TRUST_PROXY_HEADERS
    else process.env.TRUST_PROXY_HEADERS = originalTrustProxyHeaders
  })

  it('uses only validated reverse-proxy client addresses', () => {
    process.env.TRUST_PROXY_HEADERS = 'true'
    expect(getChatClientKey(new Request('http://localhost', {
      headers: { 'x-real-ip': '198.51.100.10' },
    }))).toBe('198.51.100.10')
    expect(getChatClientKey(new Request('http://localhost', {
      headers: { 'x-forwarded-for': '203.0.113.8, 10.0.0.1' },
    }))).toBe('203.0.113.8')
    expect(getChatClientKey(new Request('http://localhost', {
      headers: { 'x-real-ip': 'forged-client' },
    }))).toBe('unknown-client')
  })

  it('does not trust client-controlled proxy headers until deployment opts in', () => {
    delete process.env.TRUST_PROXY_HEADERS
    expect(getChatClientKey(new Request('http://localhost', {
      headers: { 'x-real-ip': '198.51.100.10' },
    }))).toBe('untrusted-proxy-client')
  })

  it('uses a fixed visitor-message scope so new session IDs cannot multiply a client budget', () => {
    expect(CHAT_RATE_LIMIT_SCOPES.visitorMessage).toBe('visitor-message')
    expect(CHAT_RATE_LIMIT_SCOPES.visitorMessage).not.toContain('session')
  })

  it('returns a stable 429 response with Retry-After', async () => {
    const limiter = createFixedWindowRateLimiter({ limit: 1, windowMs: 5_000 })
    const request = new Request('http://localhost', {
      headers: { 'x-real-ip': '198.51.100.20' },
    })
    enforceChatRateLimit(request, limiter, 'start')

    let error: unknown
    try {
      enforceChatRateLimit(request, limiter, 'start')
    } catch (caught) {
      error = caught
    }
    expect(error).toMatchObject({ code: 'rate_limited' } satisfies Partial<ChatServiceError>)

    const response = chatErrorResponse(error)
    expect(response.status).toBe(429)
    expect(response.headers.get('retry-after')).toBe('5')
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'rate_limited', retryAfterSeconds: 5, retryable: true },
    })
  })

  it('maps a blocked AI reply to a client-actionable handoff conflict', async () => {
    const response = chatErrorResponse(new ChatServiceError(
      'handoff_required',
      'AI replies are disabled for this conversation',
    ))
    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'handoff_required', retryable: false },
    })
  })
})
