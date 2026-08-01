import { getPayload } from 'payload'

import { getRoleUser } from '@/access/roles'
import config from '@/payload.config'

export class PortalConversationRouteError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'PortalConversationRouteError'
  }
}

export async function authorizePortalConversationRequest(request: Request): Promise<void> {
  if (process.env.ADMIN_PORTAL_ENABLED !== 'true') {
    throw new PortalConversationRouteError('portal-disabled', 'The Portal is disabled', 503)
  }
  if (process.env.ADMIN_PORTAL_CONVERSATIONS_ENABLED !== 'true') {
    throw new PortalConversationRouteError(
      'conversations-module-disabled',
      'The conversations module is disabled',
      503,
    )
  }

  const payload = await getPayload({ config })
  const { user } = await payload.auth({ headers: request.headers })
  const actor = getRoleUser(user)
  if (!user || !actor || (user as { collection?: string }).collection !== 'users') {
    throw new PortalConversationRouteError('authentication-required', 'Authentication required', 401)
  }
}

export function portalConversationErrorResponse(error: unknown): Response {
  if (error instanceof PortalConversationRouteError) {
    return Response.json(
      { error: { code: error.code, message: error.message, retryable: false } },
      { headers: { 'Cache-Control': 'no-store' }, status: error.status },
    )
  }

  console.error('portal_conversation_route_failed', {
    error: error instanceof Error ? error.name : typeof error,
  })
  return Response.json(
    {
      error: {
        code: 'conversation-unavailable',
        message: 'The conversation service is currently unavailable',
        retryable: true,
      },
    },
    { headers: { 'Cache-Control': 'no-store' }, status: 503 },
  )
}
