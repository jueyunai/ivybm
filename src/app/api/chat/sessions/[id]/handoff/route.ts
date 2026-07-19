import { NextRequest } from 'next/server'

import {
  authorizeVisitorSession,
  CHAT_SESSION_COOKIE,
  requireChatPublicID,
} from '@/modules/conversations/auth'
import { chatErrorResponse, chatJSONResponse, readChatJSON, requireString } from '@/modules/conversations/http'
import {
  CHAT_RATE_LIMIT_SCOPES,
  chatVisitorHandoffRateLimiter,
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
    enforceChatRateLimit(request, chatVisitorHandoffRateLimiter, CHAT_RATE_LIMIT_SCOPES.visitorHandoff)
    const body = await readChatJSON(request)
    const payload = await getChatPayload()
    await authorizeVisitorSession(payload, id, request.cookies.get(CHAT_SESSION_COOKIE)?.value)
    const service = await createPayloadChatService()
    return chatJSONResponse(
      await service.requestHandoff({
        idempotencyKey: requireString(body, 'idempotencyKey', 200),
        reason: requireString(body, 'reason', 2_000),
        sessionId: id,
        source: 'visitor',
      }),
    )
  } catch (error) {
    return chatErrorResponse(error)
  }
}
