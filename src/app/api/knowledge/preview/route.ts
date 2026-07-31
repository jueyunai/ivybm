import { NextRequest, NextResponse } from 'next/server'
import { getPayload, type Payload } from 'payload'

import { createFixedWindowRateLimiter } from '@/lib/security/rateLimit'
import { previewKnowledgeAnswer } from '@/modules/knowledge/preview'
import config from '@/payload.config'
import type { User } from '@/payload-types'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const noStore = { 'cache-control': 'no-store' }
const previewRateLimiter = createFixedWindowRateLimiter({
  limit: 30,
  windowMs: 10 * 60 * 1_000,
})

const errorResponse = (status: number, code: string): Response =>
  NextResponse.json({ error: { code } }, { headers: noStore, status })

const parseInput = async (
  request: NextRequest,
): Promise<{ locale: 'ar' | 'en'; query: string } | null> => {
  const contentLength = Number(request.headers.get('content-length') || 0)
  if (Number.isFinite(contentLength) && contentLength > 8_192) return null
  const raw = await request.text()
  if (Buffer.byteLength(raw, 'utf8') > 8_192) return null

  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return null
  }
  if (!value || typeof value !== 'object') return null
  const candidate = value as { locale?: unknown; query?: unknown }
  const query = typeof candidate.query === 'string' ? candidate.query.trim() : ''
  if ((candidate.locale !== 'en' && candidate.locale !== 'ar') || !query || query.length > 2_000) {
    return null
  }
  return { locale: candidate.locale, query }
}

export async function POST(request: NextRequest): Promise<Response> {
  let payload: Payload | undefined
  try {
    payload = await getPayload({ config })
    const authenticated = await payload.auth({ headers: request.headers })
    if (!authenticated.user || authenticated.user.collection !== 'users') {
      return errorResponse(401, 'authentication_required')
    }
    const actor = authenticated.user as User
    if (actor.role !== 'admin' && actor.role !== 'operator') {
      return errorResponse(403, 'forbidden')
    }
    const input = await parseInput(request)
    if (!input) return errorResponse(400, 'invalid_request')

    const rate = previewRateLimiter.consume(`knowledge-preview:${String(actor.id)}`)
    if (!rate.allowed) {
      const response = errorResponse(429, 'knowledge_preview_rate_limited')
      response.headers.set('Retry-After', String(rate.retryAfterSeconds))
      return response
    }

    const result = await previewKnowledgeAnswer({ ...input, payload })
    return NextResponse.json(result, { headers: noStore, status: 200 })
  } catch {
    payload?.logger.error('Knowledge preview endpoint unavailable')
    return errorResponse(503, 'knowledge_preview_unavailable')
  }
}
