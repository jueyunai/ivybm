import { NextRequest, NextResponse } from 'next/server'

import {
  CHAT_CHANNELS,
  CHAT_LOCALES,
  ChatServiceError,
  type ChatChannel,
  type ChatLocale,
} from '@/modules/conversations/contracts'
import { CHAT_SESSION_COOKIE, createVisitorToken, hashVisitorToken } from '@/modules/conversations/auth'
import { chatErrorResponse, readChatJSON, requireString } from '@/modules/conversations/http'
import {
  chatSessionStartRateLimiter,
  enforceChatRateLimit,
} from '@/modules/conversations/rateLimit'
import { createPayloadChatService } from '@/modules/conversations/runtime'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(request: NextRequest): Promise<Response> {
  try {
    enforceChatRateLimit(request, chatSessionStartRateLimiter, 'start')
    const body = await readChatJSON(request)
    const channel = requireString(body, 'channel', 30)
    const locale = requireString(body, 'locale', 5)
    if (!CHAT_CHANNELS.some((value) => value === channel)) {
      throw new ChatServiceError('invalid_request', 'Unsupported chat channel')
    }
    if (!CHAT_LOCALES.some((value) => value === locale)) {
      throw new ChatServiceError('invalid_request', 'Unsupported chat locale')
    }
    const idempotencyKey = requireString(body, 'idempotencyKey', 200)
    const token = createVisitorToken(idempotencyKey)
    const service = await createPayloadChatService({ sessionTokenHash: hashVisitorToken(token) })
    const session = await service.startSession({
      channel: channel as ChatChannel,
      idempotencyKey,
      locale: locale as ChatLocale,
      sourceURL: typeof body.sourceURL === 'string' ? body.sourceURL.slice(0, 2_048) : undefined,
    })
    const response = NextResponse.json(session, { status: 201 })
    response.cookies.set(CHAT_SESSION_COOKIE, token, {
      httpOnly: true,
      maxAge: 7 * 24 * 60 * 60,
      path: '/api/chat',
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
    })
    return response
  } catch (error) {
    return chatErrorResponse(error)
  }
}
