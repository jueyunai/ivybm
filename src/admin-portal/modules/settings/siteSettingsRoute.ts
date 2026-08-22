import { createLocalReq, getPayload, type Payload, type PayloadRequest } from 'payload'

import { getRoleUser, resolveRoleAccess } from '@/access/roles'
import { PortalCommandReceiptError } from '@/admin-portal/core/commands/portalCommandReceipts'
import { readLimitedJSONObject } from '@/admin-portal/core/http/readLimitedJSON'
import config from '@/payload.config'

import { SiteSettingsCommandError } from './siteSettingsCommands'

export interface AuthorizedSiteSettingsRequest {
  payload: Payload
  req: PayloadRequest
}

export const authorizeSiteSettingsRequest = async (
  request: Request,
): Promise<AuthorizedSiteSettingsRequest> => {
  if (process.env.ADMIN_PORTAL_ENABLED !== 'true') {
    throw new SiteSettingsCommandError('portal-disabled', 'The Portal is disabled.', 503)
  }
  if (process.env.ADMIN_PORTAL_SETTINGS_ENABLED !== 'true') {
    throw new SiteSettingsCommandError('settings-module-disabled', 'Settings is disabled.', 503)
  }

  const payload = await getPayload({ config })
  const { user } = await payload.auth({ headers: request.headers })
  const actor = getRoleUser(user)
  if (
    !user ||
    !actor ||
    user.collection !== 'users' ||
    resolveRoleAccess({ action: 'update', resource: 'content', user: actor }) !== true
  ) {
    throw new SiteSettingsCommandError(
      'site-settings-forbidden',
      'Site settings access denied.',
      403,
    )
  }

  return { payload, req: await createLocalReq({ user }, payload) }
}

export const readSiteSettingsJSON = (request: Request): Promise<Record<string, unknown>> =>
  readLimitedJSONObject(request, {
    invalid: () =>
      new SiteSettingsCommandError('site-settings-invalid-json', 'A JSON object is required.', 400),
    maximumBytes: 32_000,
    tooLarge: () =>
      new SiteSettingsCommandError('site-settings-request-too-large', 'Request is too large.', 413),
  })

export const siteSettingsJSON = (body: unknown, init: ResponseInit = {}): Response =>
  Response.json(body, { ...init, headers: { 'Cache-Control': 'no-store', ...init.headers } })

export const siteSettingsErrorResponse = (error: unknown): Response => {
  if (error instanceof PortalCommandReceiptError || error instanceof SiteSettingsCommandError) {
    return siteSettingsJSON(
      { error: { code: error.code, message: error.message } },
      { status: error.status },
    )
  }
  const candidate = error as { name?: unknown; status?: unknown }
  if (candidate?.name === 'ValidationError' || candidate?.status === 400) {
    return siteSettingsJSON(
      {
        error: {
          code: 'site-settings-validation-failed',
          message: 'Site settings validation failed.',
        },
      },
      { status: 400 },
    )
  }
  console.error('portal_site_settings_command_failed', {
    error: error instanceof Error ? error.name : typeof error,
  })
  return siteSettingsJSON(
    { error: { code: 'site-settings-command-failed', message: 'Unable to save site settings.' } },
    { status: 500 },
  )
}
