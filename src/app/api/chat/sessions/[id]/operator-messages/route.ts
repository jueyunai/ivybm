import { NextRequest } from 'next/server'

import {
  authenticateOperator,
  authorizeOperatorConversation,
  requireChatPublicID,
} from '@/modules/conversations/auth'
import { chatErrorResponse, chatJSONResponse, readChatJSON, requireString } from '@/modules/conversations/http'
import {
  CHAT_RATE_LIMIT_SCOPES,
  chatOperatorCommandRateLimiter,
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
    enforceChatRateLimit(request, chatOperatorCommandRateLimiter, CHAT_RATE_LIMIT_SCOPES.operatorCommand)
    const body = await readChatJSON(request)
    const payload = await getChatPayload()
    const actor = await authenticateOperator(payload, request)
    await authorizeOperatorConversation(payload, id, actor)
    const service = await createPayloadChatService({ actor })
    return chatJSONResponse(
      await service.sendOperatorMessage({
        idempotencyKey: requireString(body, 'idempotencyKey', 200),
        sessionId: id,
        text: requireString(body, 'text'),
      }),
    )
  } catch (error) {
    return chatErrorResponse(error)
  }
}
