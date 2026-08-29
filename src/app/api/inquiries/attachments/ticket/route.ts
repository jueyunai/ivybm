import { isIP } from 'node:net'
import { NextResponse } from 'next/server'

import { inquiryAttachmentRateLimiter, type RateLimiter } from '@/lib/security/rateLimit'
import { issueUploadTicket, uploadTicketTTL } from '@/modules/lead-attachments/tokens'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const getClientKey = (request: Request): string => {
  const realIP = request.headers.get('x-real-ip')?.trim()
  if (realIP && isIP(realIP)) return realIP

  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  return forwarded && isIP(forwarded) ? forwarded : 'unknown-client'
}

export const createAttachmentTicketHandler = ({
  limiter = inquiryAttachmentRateLimiter,
}: { limiter?: RateLimiter } = {}) =>
  async function attachmentTicketHandler(request: Request): Promise<Response> {
    const limit = limiter.consume(getClientKey(request))
    if (!limit.allowed) {
      return NextResponse.json(
        {
          code: 'rate_limited',
          message: 'Too many attachment ticket requests. Please try again later.',
          ok: false,
          retryAfterSeconds: limit.retryAfterSeconds,
        },
        {
          headers: { 'retry-after': String(limit.retryAfterSeconds) },
          status: 429,
        },
      )
    }

    const now = Date.now()
    const ticket = issueUploadTicket(now)
    return NextResponse.json({
      expiresAt: new Date(now + uploadTicketTTL).toISOString(),
      ok: true,
      ticket,
    })
  }

export const POST = createAttachmentTicketHandler()
