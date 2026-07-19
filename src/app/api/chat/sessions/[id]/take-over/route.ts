import { NextRequest } from 'next/server'

import { authenticateOperator } from '@/modules/conversations/auth'
import { ChatServiceError } from '@/modules/conversations/contracts'
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
    const actor = await authenticateOperator(payload, request)
    if (actor.role !== 'admin' && actor.role !== 'operator') {
      throw new ChatServiceError('forbidden', 'Only an operator or administrator can take over')
    }
    const body = await readChatJSON(request)
    const service = await createPayloadChatService({ actor })
    return Response.json(
      await service.takeOver({
        idempotencyKey: requireString(body, 'idempotencyKey', 200),
        sessionId: id,
      }),
    )
  } catch (error) {
    return chatErrorResponse(error)
  }
}
