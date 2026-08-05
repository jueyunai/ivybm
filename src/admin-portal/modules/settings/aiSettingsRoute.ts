import { createLocalReq, getPayload, type Payload, type PayloadRequest } from 'payload'

import { getRoleUser } from '@/access/roles'
import { PortalCommandReceiptError } from '@/admin-portal/core/commands/portalCommandReceipts'
import { readLimitedJSONObject } from '@/admin-portal/core/http/readLimitedJSON'
import { AiCredentialError } from '@/modules/ai/credentials'
import type { User } from '@/payload-types'
import config from '@/payload.config'

import { AiSettingsCommandError } from './aiSettingsCommands'

export interface AuthorizedAiSettingsRequest {
  payload: Payload
  req: PayloadRequest
  user: User
}

export const authorizeAiSettingsRequest = async (
  request: Request,
): Promise<AuthorizedAiSettingsRequest> => {
  if (process.env.ADMIN_PORTAL_ENABLED !== 'true') {
    throw new AiSettingsCommandError('portal-disabled', 'The Portal is disabled.', 503)
  }
  if (process.env.ADMIN_PORTAL_SETTINGS_ENABLED !== 'true') {
    throw new AiSettingsCommandError('settings-module-disabled', 'Settings is disabled.', 503)
  }
  const payload = await getPayload({ config })
  const { user } = await payload.auth({ headers: request.headers })
  const actor = getRoleUser(user)
  if (!user || !actor || user.collection !== 'users') {
    throw new AiSettingsCommandError('ai-settings-unauthenticated', 'Authentication required.', 401)
  }
  if (actor.role !== 'admin') {
    throw new AiSettingsCommandError('ai-settings-forbidden', 'Administrator access required.', 403)
  }
  return { payload, req: await createLocalReq({ user }, payload), user: user as User }
}

export const readAiSettingsJSON = (request: Request): Promise<Record<string, unknown>> =>
  readLimitedJSONObject(request, {
    invalid: () =>
      new AiSettingsCommandError('ai-settings-invalid-json', 'A JSON object is required.', 400),
    maximumBytes: 16_000,
    tooLarge: () =>
      new AiSettingsCommandError('ai-settings-request-too-large', 'Request is too large.', 413),
  })

export const aiSettingsJSON = (body: unknown, init: ResponseInit = {}): Response =>
  Response.json(body, { ...init, headers: { 'Cache-Control': 'no-store', ...init.headers } })

export const aiSettingsErrorResponse = (error: unknown): Response => {
  if (error instanceof PortalCommandReceiptError || error instanceof AiSettingsCommandError) {
    return aiSettingsJSON(
      { error: { code: error.code, message: error.message } },
      { status: error.status },
    )
  }
  if (error instanceof AiCredentialError) {
    return aiSettingsJSON(
      {
        error: {
          code: 'ai-settings-encryption-unavailable',
          message: 'AI credential encryption is not configured.',
        },
      },
      { status: 503 },
    )
  }
  const candidate = error as { name?: unknown; status?: unknown }
  if (candidate?.name === 'ValidationError' || candidate?.status === 400) {
    return aiSettingsJSON(
      { error: { code: 'ai-settings-validation-failed', message: 'AI configuration validation failed.' } },
      { status: 400 },
    )
  }
  console.error('portal_ai_settings_command_failed', {
    error: error instanceof Error ? error.name : typeof error,
  })
  return aiSettingsJSON(
    {
      error: {
        code: 'ai-settings-command-failed',
        message: 'Unable to complete the AI configuration command.',
      },
    },
    { status: 500 },
  )
}
