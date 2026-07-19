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
    if (actor.role === 'sales') {
      const conversations = await payload.find({
        collection: 'conversations',
        depth: 0,
        limit: 1,
        overrideAccess: true,
        where: { publicId: { equals: id } },
      })
      const assigned = conversations.docs[0]?.assignedTo
      const assignedID = typeof assigned === 'number' ? assigned : assigned?.id
      if (assignedID !== actor.id) {
        throw new ChatServiceError('forbidden', 'Sales users may resolve only assigned conversations')
      }
    }
    const body = await readChatJSON(request)
    const service = await createPayloadChatService({ actor })
    return Response.json(
      await service.resolve({
        idempotencyKey: requireString(body, 'idempotencyKey', 200),
        sessionId: id,
      }),
    )
  } catch (error) {
    return chatErrorResponse(error)
  }
}
