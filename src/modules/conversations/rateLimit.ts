import { isIP } from 'node:net'

import { createFixedWindowRateLimiter, type RateLimiter } from '@/lib/security/rateLimit'

import { ChatServiceError } from './contracts'

export const chatSessionStartRateLimiter = createFixedWindowRateLimiter({
  limit: 10,
  windowMs: 10 * 60 * 1_000,
})

export const chatVisitorMessageRateLimiter = createFixedWindowRateLimiter({
  limit: 30,
  windowMs: 60 * 1_000,
})

export const getChatClientKey = (request: Request): string => {
  const realIP = request.headers.get('x-real-ip')?.trim()
  if (realIP && isIP(realIP)) return realIP

  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  return forwarded && isIP(forwarded) ? forwarded : 'unknown-client'
}

export const enforceChatRateLimit = (
  request: Request,
  limiter: RateLimiter,
  scope: string,
): void => {
  const result = limiter.consume(`${scope}:${getChatClientKey(request)}`)
  if (!result.allowed) {
    throw new ChatServiceError('rate_limited', 'Too many chat requests', {
      retryAfterSeconds: result.retryAfterSeconds,
      retryable: true,
    })
  }
}
