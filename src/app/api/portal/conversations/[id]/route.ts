import { NextRequest } from 'next/server'

import { GET as getOperatorSession } from '@/app/api/chat/sessions/[id]/route'
import {
  authorizePortalConversationRequest,
  portalConversationErrorResponse,
} from '@/admin-portal/modules/conversations/conversationRoute'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    await authorizePortalConversationRequest(request)
    return getOperatorSession(request, { params })
  } catch (error) {
    return portalConversationErrorResponse(error)
  }
}
