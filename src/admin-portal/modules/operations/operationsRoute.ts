import { createLocalReq, getPayload, type Payload, type PayloadRequest } from 'payload'

import { getRoleUser } from '@/access/roles'
import type { User } from '@/payload-types'
import config from '@/payload.config'

import { OperationsCommandError } from './operationsCommands'

export interface AuthorizedOperationsRequest {
  payload: Payload
  req: PayloadRequest
  user: User
}

export const authorizeOperationsRequest = async (
  request: Request,
): Promise<AuthorizedOperationsRequest> => {
  if (process.env.ADMIN_PORTAL_ENABLED !== 'true') {
    throw new OperationsCommandError('portal-disabled', 'The Portal is disabled.', 503)
  }
  if (process.env.ADMIN_PORTAL_OPERATIONS_ENABLED !== 'true') {
    throw new OperationsCommandError('operations-module-disabled', 'Operations is disabled.', 503)
  }

  const payload = await getPayload({ config })
  const { user } = await payload.auth({ headers: request.headers })
  const actor = getRoleUser(user)
  if (!user || !actor || user.collection !== 'users') {
    throw new OperationsCommandError('operations-unauthenticated', 'Authentication required.', 401)
  }
  if (actor.role !== 'admin') {
    throw new OperationsCommandError('operations-forbidden', 'Administrator access required.', 403)
  }
  return { payload, req: await createLocalReq({ user }, payload), user: user as User }
}

export const readOperationsJSON = async (request: Request): Promise<Record<string, unknown>> => {
  const text = await request.text()
  if (text.length > 16_000) {
    throw new OperationsCommandError('operations-request-too-large', 'Request is too large.', 413)
  }
  if (!text.trim()) return {}
  try {
    const value = JSON.parse(text) as unknown
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid')
    return value as Record<string, unknown>
  } catch {
    throw new OperationsCommandError('operations-invalid-json', 'A JSON object is required.', 400)
  }
}

export const requireOperationsJobID = (value: string): number => {
  const id = Number.parseInt(value, 10)
  if (!Number.isSafeInteger(id) || id <= 0 || String(id) !== value) {
    throw new OperationsCommandError('operations-invalid-id', 'A valid job id is required.', 400)
  }
  return id
}

export const operationsJSON = (body: unknown, init: ResponseInit = {}): Response =>
  Response.json(body, { ...init, headers: { 'Cache-Control': 'no-store', ...init.headers } })

export const operationsErrorResponse = (error: unknown): Response => {
  if (error instanceof OperationsCommandError) {
    return operationsJSON({ error: { code: error.code, message: error.message } }, { status: error.status })
  }
  console.error('portal_operations_command_failed', {
    error: error instanceof Error ? error.name : typeof error,
  })
  return operationsJSON(
    { error: { code: 'operations-command-failed', message: 'Unable to complete this operation.' } },
    { status: 500 },
  )
}
