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
    const conversations = await payload.find({
      collection: 'conversations',
      depth: 0,
      limit: 1,
      overrideAccess: true,
      where: { publicId: { equals: id } },
    })
    const conversation = conversations.docs[0]
    if (!conversation) throw new ChatServiceError('not_found', 'Chat session not found')
    const assigned = conversation.assignedTo
    const assignedID = typeof assigned === 'number' ? assigned : assigned?.id
    if (actor.role === 'sales' && assignedID !== actor.id) {
      throw new ChatServiceError('forbidden', 'Sales users may reply only to assigned conversations')
    }
    const body = await readChatJSON(request)
    const service = await createPayloadChatService({ actor })
    return Response.json(
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
