import { NextRequest } from 'next/server'

import { authorizeVisitorSession, CHAT_SESSION_COOKIE } from '@/modules/conversations/auth'
import { chatErrorResponse, readChatJSON, requireString } from '@/modules/conversations/http'
import {
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
    const { id } = await params
    enforceChatRateLimit(request, chatVisitorMessageRateLimiter, `message:${id}`)
    const payload = await getChatPayload()
    await authorizeVisitorSession(payload, id, request.cookies.get(CHAT_SESSION_COOKIE)?.value)
    const body = await readChatJSON(request)
    const service = await createPayloadChatService()
    return Response.json(
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
