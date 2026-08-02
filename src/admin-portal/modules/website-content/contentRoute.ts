import { createLocalReq, getPayload, type Payload, type PayloadRequest } from 'payload'

import { getRoleUser } from '@/access/roles'
import config from '@/payload.config'
import { PortalCommandReceiptError } from '@/admin-portal/core/commands/portalCommandReceipts'

import { ContentCommandError } from './contentCommands'

export interface AuthorizedContentRequest {
  payload: Payload
  req: PayloadRequest
}

export async function authorizeContentRequest(request: Request): Promise<AuthorizedContentRequest> {
  if (process.env.ADMIN_PORTAL_ENABLED !== 'true') {
    throw new ContentCommandError('portal-disabled', 'The Portal is disabled', 503)
  }
  if (process.env.ADMIN_PORTAL_WEBSITE_CONTENT_ENABLED !== 'true') {
    throw new ContentCommandError('content-module-disabled', 'Website content is disabled', 503)
  }

  const payload = await getPayload({ config })
  const { user } = await payload.auth({ headers: request.headers })
  const actor = getRoleUser(user)
  if (!user || !actor || (user as { collection?: string }).collection !== 'users') {
    throw new ContentCommandError('content-unauthenticated', 'Authentication required', 401)
  }
  if (actor.role !== 'admin' && actor.role !== 'operator') {
    throw new ContentCommandError('content-forbidden', 'Website content access denied', 403)
  }
  const req = await createLocalReq({ user }, payload)
  return { payload, req }
}

export async function readContentJSON(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text()
  if (text.length > 128_000) {
    throw new ContentCommandError('content-request-too-large', 'Content request is too large', 413)
  }
  if (!text.trim()) return {}
  try {
    const value = JSON.parse(text) as unknown
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new Error('invalid object')
    return value as Record<string, unknown>
  } catch {
    throw new ContentCommandError('content-invalid-json', 'A JSON object is required', 400)
  }
}

export function requireContentID(value: string): number {
  const id = Number.parseInt(value, 10)
  if (!Number.isSafeInteger(id) || id <= 0 || String(id) !== value) {
    throw new ContentCommandError('content-invalid-id', 'A valid content id is required', 400)
  }
  return id
}

export const contentJSON = (body: unknown, init?: ResponseInit): Response =>
  Response.json(body, {
    ...init,
    headers: {
      'Cache-Control': 'no-store',
      ...init?.headers,
    },
  })

export function contentErrorResponse(error: unknown): Response {
  if (error instanceof PortalCommandReceiptError) {
    return contentJSON(
      { error: { code: error.code, message: error.message } },
      { status: error.status },
    )
  }
  if (error instanceof ContentCommandError) {
    return contentJSON(
      { error: { code: error.code, message: error.message } },
      { status: error.status },
    )
  }
  const candidate = error as { message?: unknown; name?: unknown; status?: unknown }
  const isValidation = candidate?.name === 'ValidationError' || candidate?.status === 400
  if (isValidation) {
    return contentJSON(
      {
        error: {
          code: 'content-validation-failed',
          message: 'Content validation failed',
        },
      },
      { status: 400 },
    )
  }

  console.error('portal_content_command_failed', {
    error: error instanceof Error ? error.name : typeof error,
  })
  return contentJSON(
    {
      error: { code: 'content-command-failed', message: 'Unable to complete the content command' },
    },
    { status: 500 },
  )
}
