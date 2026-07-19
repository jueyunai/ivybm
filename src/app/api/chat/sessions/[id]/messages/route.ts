import { NextRequest } from 'next/server'

import {
  authorizeVisitorSession,
  CHAT_SESSION_COOKIE,
  requireChatPublicID,
} from '@/modules/conversations/auth'
import { chatErrorResponse, chatJSONResponse, readChatJSON, requireString } from '@/modules/conversations/http'
import {
  CHAT_RATE_LIMIT_SCOPES,
  chatVisitorMessageRateLimiter,
  enforceChatRateLimit,
} from '@/modules/conversations/rateLimit'
import { createPayloadChatService, getChatPayload } from '@/modules/conversations/runtime'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id: rawID } = await params
    const id = requireChatPublicID(rawID)
    enforceChatRateLimit(request, chatVisitorMessageRateLimiter, CHAT_RATE_LIMIT_SCOPES.visitorMessage)
    // Read the bounded stream before any database-backed authorization so an
    // unauthenticated chunked request cannot bypass the application body limit.
    const body = await readChatJSON(request)
    const payload = await getChatPayload()
    await authorizeVisitorSession(payload, id, request.cookies.get(CHAT_SESSION_COOKIE)?.value)
    const service = await createPayloadChatService()
    return chatJSONResponse(
      await service.sendMessage({
        idempotencyKey: requireString(body, 'idempotencyKey', 200),
        sessionId: id,
        text: requireString(body, 'text'),
      }),
    )
  } catch (error) {
    return chatErrorResponse(error)
  }
}
