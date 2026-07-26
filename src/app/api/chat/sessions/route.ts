import { NextRequest, NextResponse } from 'next/server'

import {
  CHAT_LOCALES,
  ChatServiceError,
  type ChatLocale,
} from '@/modules/conversations/contracts'
import {
  authorizeVisitorSession,
  CHAT_SESSION_COOKIE,
  CHAT_SESSION_TTL_SECONDS,
  createVisitorToken,
  hashVisitorToken,
} from '@/modules/conversations/auth'
import { chatErrorResponse, readChatJSON, requireString } from '@/modules/conversations/http'
import {
  CHAT_RATE_LIMIT_SCOPES,
  chatSessionStartRateLimiter,
  enforceChatRateLimit,
} from '@/modules/conversations/rateLimit'
import { createPayloadChatService, getChatPayload } from '@/modules/conversations/runtime'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(request: NextRequest): Promise<Response> {
  try {
    enforceChatRateLimit(request, chatSessionStartRateLimiter, CHAT_RATE_LIMIT_SCOPES.sessionStart)
    const body = await readChatJSON(request)
    const channel = requireString(body, 'channel', 30)
    const locale = requireString(body, 'locale', 5)
    // This browser endpoint owns only first-party website conversations. Social channels
    // enter through authenticated connector adapters, never caller-controlled JSON.
    if (channel !== 'website') {
      throw new ChatServiceError('invalid_request', 'Only the website chat channel is public')
    }
    if (!CHAT_LOCALES.some((value) => value === locale)) {
      throw new ChatServiceError('invalid_request', 'Unsupported chat locale')
    }
    const idempotencyKey = requireString(body, 'idempotencyKey', 200)
    const issuedToken = createVisitorToken()
    const service = await createPayloadChatService({ sessionTokenHash: hashVisitorToken(issuedToken) })
    const session = await service.startSession({
      channel: 'website',
      idempotencyKey,
      locale: locale as ChatLocale,
      sourceURL: typeof body.sourceURL === 'string' ? body.sourceURL.slice(0, 2_048) : undefined,
    })
    // A duplicate start is resumable only by the browser that already owns its random cookie.
    // Never derive a replacement credential from the caller-controlled idempotency key.
    let token = issuedToken
    try {
      await authorizeVisitorSession(await getChatPayload(), String(session.id), issuedToken)
    } catch {
      const existingToken = request.cookies.get(CHAT_SESSION_COOKIE)?.value
      if (!existingToken) {
        throw new ChatServiceError('forbidden', 'An existing chat session belongs to another browser')
      }
      await authorizeVisitorSession(await getChatPayload(), String(session.id), existingToken)
      token = existingToken
    }
    const response = NextResponse.json(session, { status: 201 })
    response.cookies.set(CHAT_SESSION_COOKIE, token, {
      httpOnly: true,
      maxAge: CHAT_SESSION_TTL_SECONDS,
      path: '/api/chat',
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
    })
    response.headers.set('Cache-Control', 'private, no-store')
    return response
  } catch (error) {
    return chatErrorResponse(error)
  }
}
