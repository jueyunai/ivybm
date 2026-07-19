import { describe, expect, it } from 'vitest'

import { createFixedWindowRateLimiter } from '@/lib/security/rateLimit'
import { ChatServiceError } from '@/modules/conversations/contracts'
import { chatErrorResponse } from '@/modules/conversations/http'
import {
  enforceChatRateLimit,
  getChatClientKey,
} from '@/modules/conversations/rateLimit'

describe('chat rate limiting', () => {
  it('uses only validated reverse-proxy client addresses', () => {
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
})
