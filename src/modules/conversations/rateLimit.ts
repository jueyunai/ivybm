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

export const chatVisitorHandoffRateLimiter = createFixedWindowRateLimiter({
  limit: 6,
  windowMs: 60 * 1_000,
})

export const chatOperatorCommandRateLimiter = createFixedWindowRateLimiter({
  limit: 60,
  windowMs: 60 * 1_000,
})

// Keep these scopes independent of route parameters. A session ID is attacker
// controlled before authorization and would both multiply AI capacity and churn
// the in-process limiter's bounded key map.
export const CHAT_RATE_LIMIT_SCOPES = {
  operatorCommand: 'operator-command',
  sessionStart: 'session-start',
  visitorHandoff: 'visitor-handoff',
  visitorMessage: 'visitor-message',
} as const

export const getChatClientKey = (request: Request): string => {
  // Next's Request API intentionally does not expose the peer socket address. Only trust
  // proxy supplied addresses when deployment has made the app loopback-only and the proxy
  // overwrites incoming client-IP headers.
  if (process.env.TRUST_PROXY_HEADERS !== 'true') return 'untrusted-proxy-client'
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
