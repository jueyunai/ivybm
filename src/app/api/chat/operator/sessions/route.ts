import { NextRequest } from 'next/server'
import type { Where } from 'payload'

import { authenticateOperator } from '@/modules/conversations/auth'
import { type ChatSessionList, ChatServiceError } from '@/modules/conversations/contracts'
import { allowedActionsFor, type ChatSessionViewer } from '@/modules/conversations/handoffState'
import { chatErrorResponse, chatJSONResponse } from '@/modules/conversations/http'
import { getChatPayload } from '@/modules/conversations/runtime'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const relationshipID = (value: number | { id: number } | null | undefined): number | undefined =>
  typeof value === 'number' ? value : value?.id

const positiveInteger = (value: string | null, fallback: number, maximum: number): number => {
  if (value === null) return fallback
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new ChatServiceError('invalid_request', 'Invalid pagination parameter')
  }
  return parsed
}

/**
 * Bounded inbox summaries for the operator UI. Detailed messages are fetched from
 * GET /api/chat/sessions/:id?view=operator after the user selects a row.
 */
export async function GET(request: NextRequest): Promise<Response> {
  try {
    const payload = await getChatPayload()
    const actor = await authenticateOperator(payload, request)
    const url = new URL(request.url)
    const page = positiveInteger(url.searchParams.get('page'), 1, 10_000)
    const limit = positiveInteger(url.searchParams.get('limit'), 20, 100)
    const status = url.searchParams.get('status')
    if (status && !['ai_active', 'handoff_requested', 'human_active', 'resolved'].includes(status)) {
      throw new ChatServiceError('invalid_request', 'Unsupported handoff status')
    }
    const filters: Where[] = []
    if (actor.role === 'sales') filters.push({ assignedTo: { equals: actor.id } })
    if (status) filters.push({ handoffStatus: { equals: status } })
    const result = await payload.find({
      collection: 'conversations',
      depth: 0,
      limit,
      overrideAccess: true,
      page,
      sort: '-lastMessageAt',
      where: filters.length > 0 ? { and: filters } : undefined,
    })
    const viewer: ChatSessionViewer = actor.role === 'sales' ? 'sales' : 'operator'
    const response: ChatSessionList = {
      docs: result.docs.map((conversation) => {
        const assignedTo = relationshipID(conversation.assignedTo)
        return {
          allowedActions: allowedActionsFor(conversation.handoffStatus, viewer),
          ...(assignedTo ? { assignedTo: { id: assignedTo } } : {}),
          channel: conversation.channel,
          handoffStatus: conversation.handoffStatus,
          id: conversation.publicId,
          ...(conversation.lastMessageAt ? { lastMessageAt: conversation.lastMessageAt } : {}),
          locale: conversation.locale,
          requestId: conversation.requestId,
          revision: conversation.revision,
        }
      }),
      page: result.page ?? page,
      totalDocs: result.totalDocs,
      totalPages: result.totalPages,
    }
    return chatJSONResponse(response)
  } catch (error) {
    return chatErrorResponse(error)
  }
}
