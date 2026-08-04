import { NextRequest } from 'next/server'
import { createLocalReq } from 'payload'

import { authenticateOperator, requireChatPublicID } from '@/modules/conversations/auth'
import { ChatServiceError } from '@/modules/conversations/contracts'
import {
  chatErrorResponse,
  chatJSONResponse,
  readChatJSON,
  requireString,
} from '@/modules/conversations/http'
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
    enforceChatRateLimit(
      request,
      chatOperatorCommandRateLimiter,
      CHAT_RATE_LIMIT_SCOPES.operatorCommand,
    )
    const body = await readChatJSON(request)
    const payload = await getChatPayload()
    const actor = await authenticateOperator(payload, request)
    if (actor.role !== 'admin' && actor.role !== 'operator') {
      throw new ChatServiceError('forbidden', 'Only an operator or administrator can take over')
    }
    const req = await createLocalReq({ user: actor }, payload)
    const service = await createPayloadChatService({ actor, req })
    return chatJSONResponse(
      await service.takeOver({
        idempotencyKey: requireString(body, 'idempotencyKey', 200),
        sessionId: id,
      }),
    )
  } catch (error) {
    return chatErrorResponse(error)
  }
}
