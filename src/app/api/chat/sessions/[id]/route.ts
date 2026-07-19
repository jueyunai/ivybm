import { NextRequest } from 'next/server'

import {
  authenticateOperator,
  authorizeOperatorConversation,
  authorizeVisitorSession,
  CHAT_SESSION_COOKIE,
  requireChatPublicID,
} from '@/modules/conversations/auth'
import { ChatServiceError } from '@/modules/conversations/contracts'
import { chatErrorResponse, chatJSONResponse } from '@/modules/conversations/http'
import { createPayloadChatService, getChatPayload } from '@/modules/conversations/runtime'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id: rawID } = await params
    const id = requireChatPublicID(rawID)
    const payload = await getChatPayload()
    const view = new URL(request.url).searchParams.get('view')
    if (view && view !== 'operator') {
      throw new ChatServiceError('invalid_request', 'Unsupported chat session view')
    }
    if (view !== 'operator') {
      const visitorToken = request.cookies.get(CHAT_SESSION_COOKIE)?.value
      await authorizeVisitorSession(payload, id, visitorToken)
      const service = await createPayloadChatService()
      return chatJSONResponse(await service.getSession(id))
    }
    const actor = await authenticateOperator(payload, request)
    await authorizeOperatorConversation(payload, id, actor)
    const service = await createPayloadChatService({ actor })
    return chatJSONResponse(await service.getSession(id))
  } catch (error) {
    return chatErrorResponse(error)
  }
}
