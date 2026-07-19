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
  { params }: { params: Promise<{ id: string; messageId: string }> },
): Promise<Response> {
  try {
    const { id: rawID, messageId: rawMessageID } = await params
    const id = requireChatPublicID(rawID)
    const messageId = requireChatPublicID(rawMessageID)
    enforceChatRateLimit(request, chatVisitorMessageRateLimiter, CHAT_RATE_LIMIT_SCOPES.visitorMessage)
    const body = await readChatJSON(request)
    const payload = await getChatPayload()
    await authorizeVisitorSession(payload, id, request.cookies.get(CHAT_SESSION_COOKIE)?.value)
    const service = await createPayloadChatService()
    return chatJSONResponse(
      await service.retryMessage({
        idempotencyKey: requireString(body, 'idempotencyKey', 200),
        messageId,
        sessionId: id,
      }),
    )
  } catch (error) {
    return chatErrorResponse(error)
  }
}
