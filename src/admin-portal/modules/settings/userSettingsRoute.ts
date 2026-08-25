import { createLocalReq, getPayload, type Payload, type PayloadRequest } from 'payload'

import { getRoleUser } from '@/access/roles'
import { PortalCommandReceiptError } from '@/admin-portal/core/commands/portalCommandReceipts'
import { readLimitedJSONObject } from '@/admin-portal/core/http/readLimitedJSON'
import config from '@/payload.config'
import type { User } from '@/payload-types'

import { UserSettingsCommandError } from './userSettingsContracts'

export interface AuthorizedUserSettingsRequest {
  actor: { id: number | string; role: 'admin' | 'operator' | 'sales' }
  payload: Payload
  req: PayloadRequest
  user: { email: string; id: number | string; role: 'admin' | 'operator' | 'sales' }
}

export const isTeamManagementEnabled = (env: Partial<NodeJS.ProcessEnv> = process.env): boolean =>
  env.ADMIN_PORTAL_TEAM_MANAGEMENT_ENABLED === 'true'

const expectedPortalOrigin = (request: Request): string | undefined => {
  const configured = process.env.NEXT_PUBLIC_SERVER_URL?.trim()
  if (configured) {
    try {
      const url = new URL(configured)
      if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password) {
        return url.origin
      }
    } catch {
      // ignore invalid URL configuration
    }
  }
  if (process.env.NODE_ENV !== 'production') {
    try {
      return new URL(request.url).origin
    } catch {
      return undefined
    }
  }
  return undefined
}

export const isSameOriginRequest = (request: Request): boolean => {
  const source = request.headers.get('origin') ?? request.headers.get('referer')
  const expected = expectedPortalOrigin(request)
  if (!source || !expected) return false
  try {
    return new URL(source).origin === expected
  } catch {
    return false
  }
}

export const assertSameOrigin = (request: Request): void => {
  if (!isSameOriginRequest(request)) {
    throw new UserSettingsCommandError('invalid-origin', 'Same-origin request required.', 403)
  }
}

export const authorizeUserSettingsRequest = async (
  request: Request,
  options: { requireAdmin?: boolean } = {},
): Promise<AuthorizedUserSettingsRequest> => {
  if (process.env.ADMIN_PORTAL_ENABLED !== 'true') {
    throw new UserSettingsCommandError('portal-disabled', 'The Portal is disabled.', 503)
  }
  if (process.env.ADMIN_PORTAL_SETTINGS_ENABLED !== 'true') {
    throw new UserSettingsCommandError('settings-module-disabled', 'Settings is disabled.', 503)
  }
  if (options.requireAdmin && !isTeamManagementEnabled()) {
    throw new UserSettingsCommandError(
      'team-management-disabled',
      'Team account management is disabled.',
      503,
    )
  }

  const payload = await getPayload({ config })
  const { user } = await payload.auth({ headers: request.headers })
  const actor = getRoleUser(user)

  if (!user || !actor || user.collection !== 'users' || typeof user.email !== 'string') {
    throw new UserSettingsCommandError(
      'authentication-required',
      'Authentication is required.',
      401,
    )
  }

  if (options.requireAdmin && actor.role !== 'admin') {
    throw new UserSettingsCommandError(
      'admin-required',
      'Administrator permissions are required.',
      403,
    )
  }

  return {
    actor,
    payload,
    req: await createLocalReq({ user: user as User }, payload),
    user: {
      email: user.email,
      id: actor.id,
      role: actor.role,
    },
  }
}

export const readUserSettingsJSON = (request: Request): Promise<Record<string, unknown>> =>
  readLimitedJSONObject(request, {
    invalid: () =>
      new UserSettingsCommandError('invalid-input', 'A JSON object is required.', 400),
    maximumBytes: 32_000,
    tooLarge: () =>
      new UserSettingsCommandError('invalid-input', 'Request payload is too large.', 413),
  })

export const userSettingsJSON = (body: unknown, init: ResponseInit = {}): Response =>
  Response.json(body, { ...init, headers: { 'Cache-Control': 'no-store', ...init.headers } })

export const userSettingsErrorResponse = (error: unknown): Response => {
  if (error instanceof PortalCommandReceiptError || error instanceof UserSettingsCommandError) {
    return userSettingsJSON(
      {
        error: {
          code: error.code,
          message: error.message,
          ...(error instanceof UserSettingsCommandError && error.details
            ? { details: error.details }
            : {}),
        },
      },
      { status: error.status },
    )
  }

  const candidate = error as { message?: string; name?: unknown; status?: unknown }
  if (candidate?.name === 'ValidationError' || candidate?.status === 400) {
    return userSettingsJSON(
      {
        error: {
          code: 'invalid-input',
          message: typeof candidate.message === 'string' ? candidate.message : 'Validation failed.',
        },
      },
      { status: 400 },
    )
  }

  console.error('portal_user_settings_command_failed', {
    error: error instanceof Error ? error.name : typeof error,
  })

  return userSettingsJSON(
    {
      error: {
        code: 'user-settings-command-failed',
        message: 'An unexpected error occurred processing user settings command.',
      },
    },
    { status: 500 },
  )
}
