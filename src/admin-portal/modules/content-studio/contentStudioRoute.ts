import { createLocalReq, getPayload, type Payload, type PayloadRequest } from 'payload'

import { getRoleUser } from '@/access/roles'
import config from '@/payload.config'
import { PortalCommandReceiptError } from '@/admin-portal/core/commands/portalCommandReceipts'
import { readLimitedJSONObject } from '@/admin-portal/core/http/readLimitedJSON'

import { ContentStudioCommandError, type ContentStudioPayload } from './contentStudioCommands'

export interface AuthorizedContentStudioRequest {
  payload: Payload & ContentStudioPayload
  req: PayloadRequest
  role: 'admin' | 'operator'
}

export async function authorizeContentStudioRequest(
  request: Request,
): Promise<AuthorizedContentStudioRequest> {
  if (process.env.ADMIN_PORTAL_ENABLED !== 'true') {
    throw new ContentStudioCommandError('portal-disabled', 'The Portal is disabled', 503)
  }
  if (process.env.ADMIN_PORTAL_CONTENT_STUDIO_ENABLED !== 'true') {
    throw new ContentStudioCommandError(
      'content-studio-module-disabled',
      'Content Studio is disabled',
      503,
    )
  }
  const payload = await getPayload({ config })
  const { user } = await payload.auth({ headers: request.headers })
  const actor = getRoleUser(user)
  if (!user || !actor || (user as { collection?: string }).collection !== 'users') {
    throw new ContentStudioCommandError(
      'content-studio-unauthenticated',
      'Authentication required',
      401,
    )
  }
  if (actor.role !== 'admin' && actor.role !== 'operator') {
    throw new ContentStudioCommandError(
      'content-studio-forbidden',
      'Content Studio access denied',
      403,
    )
  }
  return {
    payload: payload as Payload & ContentStudioPayload,
    req: await createLocalReq({ user }, payload),
    role: actor.role,
  }
}

export async function readContentStudioJSON(request: Request): Promise<Record<string, unknown>> {
  return readLimitedJSONObject(request, {
    invalid: () => new ContentStudioCommandError(
      'content-studio-invalid-json',
      'A JSON object is required',
      400,
    ),
    maximumBytes: 64_000,
    tooLarge: () => new ContentStudioCommandError(
      'content-studio-request-too-large',
      'Request is too large',
      413,
    ),
  })
}

export const requireContentStudioID = (value: string): number => {
  const id = Number.parseInt(value, 10)
  if (!Number.isSafeInteger(id) || id <= 0 || String(id) !== value) {
    throw new ContentStudioCommandError(
      'content-studio-invalid-id',
      'A valid content id is required',
      400,
    )
  }
  return id
}

export const contentStudioJSON = (body: unknown, init?: ResponseInit): Response =>
  Response.json(body, { ...init, headers: { 'Cache-Control': 'no-store', ...init?.headers } })

export const contentStudioErrorResponse = (error: unknown): Response => {
  if (error instanceof PortalCommandReceiptError) {
    return contentStudioJSON(
      { error: { code: error.code, message: error.message } },
      { status: error.status },
    )
  }
  if (error instanceof ContentStudioCommandError) {
    return contentStudioJSON(
      { error: { code: error.code, message: error.message } },
      { status: error.status },
    )
  }
  const candidate = error as { message?: unknown; name?: unknown; status?: unknown }
  if (candidate?.name === 'ValidationError' || candidate?.status === 400) {
    return contentStudioJSON(
      { error: { code: 'content-studio-validation-failed', message: 'Content validation failed' } },
      { status: 400 },
    )
  }
  console.error('portal_content_studio_command_failed', {
    error: error instanceof Error ? error.name : typeof error,
  })
  return contentStudioJSON(
    {
      error: {
        code: 'content-studio-command-failed',
        message: 'Unable to complete the content command',
      },
    },
    { status: 500 },
  )
}
