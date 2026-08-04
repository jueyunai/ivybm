import { NextRequest } from 'next/server'

import { POST as sendOperatorMessage } from '@/app/api/chat/sessions/[id]/operator-messages/route'
import {
  authorizePortalConversationRequest,
  portalConversationErrorResponse,
} from '@/admin-portal/modules/conversations/conversationRoute'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    await authorizePortalConversationRequest(request)
    return sendOperatorMessage(request, { params })
  } catch (error) {
    return portalConversationErrorResponse(error)
  }
}
