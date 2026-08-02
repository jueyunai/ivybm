import { createLocalReq, getPayload, type Payload, type PayloadRequest } from 'payload'

import { getRoleUser, type UserRole } from '@/access/roles'
import config from '@/payload.config'
import { PortalCommandReceiptError } from '@/admin-portal/core/commands/portalCommandReceipts'

import { LeadCommandError } from './leadCommands'

export type AuthorizedLeadRequest = {
  payload: Payload
  req: PayloadRequest
  role: UserRole
}

export const authorizeLeadRequest = async (request: Request): Promise<AuthorizedLeadRequest> => {
  if (process.env.ADMIN_PORTAL_ENABLED !== 'true') {
    throw new LeadCommandError('portal-disabled', 'The Portal is disabled', 503)
  }
  if (process.env.ADMIN_PORTAL_LEADS_ENABLED !== 'true') {
    throw new LeadCommandError('leads-module-disabled', 'The leads module is disabled', 503)
  }
  const payload = await getPayload({ config })
  const { user } = await payload.auth({ headers: request.headers })
  const actor = getRoleUser(user)
  if (!user || !actor || (user as { collection?: string }).collection !== 'users') {
    throw new LeadCommandError('leads-unauthenticated', 'Authentication required', 401)
  }
  return { payload, req: await createLocalReq({ user }, payload), role: actor.role }
}

export const readLeadJSON = async (request: Request): Promise<Record<string, unknown>> => {
  const text = await request.text()
  if (text.length > 128_000)
    throw new LeadCommandError('leads-request-too-large', 'Request is too large', 413)
  if (!text.trim()) return {}
  try {
    const value = JSON.parse(text) as unknown
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid')
    return value as Record<string, unknown>
  } catch {
    throw new LeadCommandError('leads-invalid-json', 'A JSON object is required', 400)
  }
}

export const requireLeadID = (value: string): number => {
  const id = Number.parseInt(value, 10)
  if (!Number.isSafeInteger(id) || id <= 0 || String(id) !== value) {
    throw new LeadCommandError('leads-invalid-id', 'A valid lead id is required', 400)
  }
  return id
}

export const leadJSON = (body: unknown, init: ResponseInit = {}): Response =>
  Response.json(body, { ...init, headers: { 'Cache-Control': 'no-store', ...init.headers } })

export const leadErrorResponse = (error: unknown): Response => {
  if (error instanceof PortalCommandReceiptError) {
    return leadJSON(
      { error: { code: error.code, message: error.message } },
      { status: error.status },
    )
  }
  if (error instanceof LeadCommandError) {
    return leadJSON(
      { error: { code: error.code, message: error.message } },
      { status: error.status },
    )
  }
  const candidate = error as { message?: unknown; name?: unknown; status?: unknown }
  if (candidate?.name === 'ValidationError' || candidate?.status === 400) {
    return leadJSON(
      { error: { code: 'leads-validation-failed', message: 'Lead validation failed' } },
      { status: 400 },
    )
  }
  console.error('portal_lead_command_failed', {
    error: error instanceof Error ? error.name : typeof error,
  })
  return leadJSON(
    { error: { code: 'leads-command-failed', message: 'Unable to complete the lead command' } },
    { status: 500 },
  )
}
