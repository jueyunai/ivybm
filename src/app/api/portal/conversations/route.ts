import { NextRequest } from 'next/server'

import { GET as listOperatorSessions } from '@/app/api/chat/operator/sessions/route'
import {
  authorizePortalConversationRequest,
  portalConversationErrorResponse,
} from '@/admin-portal/modules/conversations/conversationRoute'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: NextRequest): Promise<Response> {
  try {
    await authorizePortalConversationRequest(request)
    return listOperatorSessions(request)
  } catch (error) {
    return portalConversationErrorResponse(error)
  }
}
