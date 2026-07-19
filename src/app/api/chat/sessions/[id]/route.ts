import { NextRequest } from 'next/server'

import { authorizeVisitorSession, CHAT_SESSION_COOKIE } from '@/modules/conversations/auth'
import { chatErrorResponse } from '@/modules/conversations/http'
import { createPayloadChatService, getChatPayload } from '@/modules/conversations/runtime'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await params
    const payload = await getChatPayload()
    await authorizeVisitorSession(payload, id, request.cookies.get(CHAT_SESSION_COOKIE)?.value)
    const service = await createPayloadChatService()
    return Response.json(await service.getSession(id))
  } catch (error) {
    return chatErrorResponse(error)
  }
}
