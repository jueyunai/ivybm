import type { Payload, PayloadRequest } from 'payload'

import { resolveRoleAccess } from '@/access/roles'
import type { PortalUser } from '@/admin-portal/core/auth/types'

export interface PortalSettingsSummary {
  canUpdate: boolean
  siteDescription: string | null
  siteName: string
}

const toRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : {}

const optionalText = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null

export const selectPortalSettingsSummary = (
  settings: unknown,
  user: PortalUser,
): PortalSettingsSummary => {
  const record = toRecord(settings)

  return {
    canUpdate:
      resolveRoleAccess({ action: 'update', resource: 'content', user }) === true,
    siteDescription: optionalText(record.siteDescription),
    siteName: optionalText(record.siteName) ?? 'IVYBM',
  }
}

export const getPortalSettingsSummary = async ({
  payload,
  req,
  user,
}: {
  payload: Payload
  req: PayloadRequest
  user: PortalUser
}): Promise<PortalSettingsSummary> => {
  const settings = await payload.findGlobal({
    depth: 0,
    overrideAccess: false,
    req,
    select: {
      siteDescription: true,
      siteName: true,
    },
    slug: 'site-settings',
  })

  return selectPortalSettingsSummary(settings, user)
}
