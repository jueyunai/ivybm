import { NextRequest } from 'next/server'

import { authorizeVisitorSession, CHAT_SESSION_COOKIE } from '@/modules/conversations/auth'
import { chatErrorResponse, readChatJSON, requireString } from '@/modules/conversations/http'
import { createPayloadChatService, getChatPayload } from '@/modules/conversations/runtime'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await params
    const payload = await getChatPayload()
    await authorizeVisitorSession(payload, id, request.cookies.get(CHAT_SESSION_COOKIE)?.value)
    const body = await readChatJSON(request)
    const service = await createPayloadChatService()
    return Response.json(
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
