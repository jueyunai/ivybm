import { createLocalReq, getPayload, type Payload, type PayloadRequest } from 'payload'

import { getRoleUser } from '@/access/roles'
import config from '@/payload.config'
import { PortalCommandReceiptError } from '@/admin-portal/core/commands/portalCommandReceipts'
import { readLimitedJSONObject } from '@/admin-portal/core/http/readLimitedJSON'

import { KnowledgeCommandError } from './knowledgeCommands'

export interface AuthorizedKnowledgeRequest {
  payload: Payload
  req: PayloadRequest
  role: 'admin' | 'operator'
}

export async function authorizeKnowledgeRequest(
  request: Request,
  options: { adminOnly?: boolean } = {},
): Promise<AuthorizedKnowledgeRequest> {
  if (process.env.ADMIN_PORTAL_ENABLED !== 'true') {
    throw new KnowledgeCommandError('portal-disabled', 'The Portal is disabled', 503)
  }
  if (process.env.ADMIN_PORTAL_KNOWLEDGE_ENABLED !== 'true') {
    throw new KnowledgeCommandError(
      'knowledge-module-disabled',
      'The knowledge module is disabled',
      503,
    )
  }
  const payload = await getPayload({ config })
  const { user } = await payload.auth({ headers: request.headers })
  const actor = getRoleUser(user)
  if (!user || !actor || (user as { collection?: string }).collection !== 'users') {
    throw new KnowledgeCommandError('knowledge-unauthenticated', 'Authentication required', 401)
  }
  if (actor.role !== 'admin' && actor.role !== 'operator') {
    throw new KnowledgeCommandError('knowledge-forbidden', 'Knowledge access denied', 403)
  }
  if (options.adminOnly && actor.role !== 'admin') {
    throw new KnowledgeCommandError(
      'knowledge-admin-required',
      'Administrator access required',
      403,
    )
  }
  return {
    payload,
    req: await createLocalReq({ user }, payload),
    role: actor.role,
  }
}

export async function readKnowledgeJSON(request: Request): Promise<Record<string, unknown>> {
  return readLimitedJSONObject(request, {
    invalid: () =>
      new KnowledgeCommandError('knowledge-invalid-json', 'A JSON object is required', 400),
    maximumBytes: 256_000,
    tooLarge: () =>
      new KnowledgeCommandError(
        'knowledge-request-too-large',
        'Knowledge request is too large',
        413,
      ),
  })
}

export function requireKnowledgeID(value: string): number {
  const id = Number.parseInt(value, 10)
  if (!Number.isSafeInteger(id) || id <= 0 || String(id) !== value) {
    throw new KnowledgeCommandError('knowledge-invalid-id', 'A valid document id is required', 400)
  }
  return id
}

export const knowledgeJSON = (body: unknown, init?: ResponseInit): Response =>
  Response.json(body, {
    ...init,
    headers: { 'Cache-Control': 'no-store', ...init?.headers },
  })

export function knowledgeErrorResponse(error: unknown): Response {
  if (error instanceof PortalCommandReceiptError) {
    return knowledgeJSON(
      { error: { code: error.code, message: error.message } },
      { status: error.status },
    )
  }
  if (error instanceof KnowledgeCommandError) {
    return knowledgeJSON(
      { error: { code: error.code, message: error.message } },
      { status: error.status },
    )
  }
  const candidate = error as { code?: unknown; message?: unknown; name?: unknown; status?: unknown }
  if (candidate?.name === 'ValidationError' || candidate?.status === 400) {
    return knowledgeJSON(
      {
        error: {
          code: 'knowledge-validation-failed',
          message: 'Knowledge validation failed',
        },
      },
      { status: 400 },
    )
  }
  const knownAiCodes = new Set([
    'authentication',
    'invalid_request',
    'invalid_response',
    'provider_error',
    'provider_unavailable',
    'rate_limit',
    'timeout',
  ])
  const aiCode =
    typeof candidate?.code === 'string' && knownAiCodes.has(candidate.code) ? candidate.code : ''
  const aiStatus = aiCode === 'rate_limit' ? 429 : aiCode === 'timeout' ? 504 : aiCode ? 503 : 500
  console.error('portal_knowledge_command_failed', {
    error: error instanceof Error ? error.name : typeof error,
  })
  return knowledgeJSON(
    {
      error: {
        code: aiCode ? `knowledge-ai-${aiCode}` : 'knowledge-command-failed',
        message: aiCode
          ? 'AI debug is currently unavailable'
          : 'Unable to complete the knowledge command',
      },
    },
    { status: aiStatus },
  )
}
