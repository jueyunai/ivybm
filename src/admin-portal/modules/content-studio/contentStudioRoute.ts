import { createLocalReq, getPayload, type PayloadRequest } from 'payload'

import { getRoleUser } from '@/access/roles'
import config from '@/payload.config'

import { ContentStudioCommandError, type ContentStudioPayload } from './contentStudioCommands'

export interface AuthorizedContentStudioRequest {
  payload: ContentStudioPayload
  req: PayloadRequest
  role: 'admin' | 'operator'
}

export async function authorizeContentStudioRequest(request: Request): Promise<AuthorizedContentStudioRequest> {
  if (process.env.ADMIN_PORTAL_ENABLED !== 'true') {
    throw new ContentStudioCommandError('portal-disabled', 'The Portal is disabled', 503)
  }
  if (process.env.ADMIN_PORTAL_CONTENT_STUDIO_ENABLED !== 'true') {
    throw new ContentStudioCommandError('content-studio-module-disabled', 'Content Studio is disabled', 503)
  }
  const payload = await getPayload({ config })
  const { user } = await payload.auth({ headers: request.headers })
  const actor = getRoleUser(user)
  if (!user || !actor || (user as { collection?: string }).collection !== 'users') {
    throw new ContentStudioCommandError('content-studio-unauthenticated', 'Authentication required', 401)
  }
  if (actor.role !== 'admin' && actor.role !== 'operator') {
    throw new ContentStudioCommandError('content-studio-forbidden', 'Content Studio access denied', 403)
  }
  return {
    payload: payload as unknown as ContentStudioPayload,
    req: await createLocalReq({ user }, payload),
    role: actor.role,
  }
}

export async function readContentStudioJSON(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text()
  if (text.length > 64_000) {
    throw new ContentStudioCommandError('content-studio-request-too-large', 'Request is too large', 413)
  }
  if (!text.trim()) return {}
  try {
    const value = JSON.parse(text) as unknown
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid object')
    return value as Record<string, unknown>
  } catch {
    throw new ContentStudioCommandError('content-studio-invalid-json', 'A JSON object is required', 400)
  }
}

export const requireContentStudioID = (value: string): number => {
  const id = Number.parseInt(value, 10)
  if (!Number.isSafeInteger(id) || id <= 0 || String(id) !== value) {
    throw new ContentStudioCommandError('content-studio-invalid-id', 'A valid content id is required', 400)
  }
  return id
}

export const contentStudioJSON = (body: unknown, init?: ResponseInit): Response =>
  Response.json(body, { ...init, headers: { 'Cache-Control': 'no-store', ...init?.headers } })

export const contentStudioErrorResponse = (error: unknown): Response => {
  if (error instanceof ContentStudioCommandError) {
    return contentStudioJSON({ error: { code: error.code, message: error.message } }, { status: error.status })
  }
  const candidate = error as { message?: unknown; name?: unknown; status?: unknown }
  if (candidate?.name === 'ValidationError' || candidate?.status === 400) {
    return contentStudioJSON({ error: { code: 'content-studio-validation-failed', message: typeof candidate.message === 'string' ? candidate.message : 'Content validation failed' } }, { status: 400 })
  }
  console.error('portal_content_studio_command_failed', { error: error instanceof Error ? error.name : typeof error })
  return contentStudioJSON({ error: { code: 'content-studio-command-failed', message: 'Unable to complete the content command' } }, { status: 500 })
}
