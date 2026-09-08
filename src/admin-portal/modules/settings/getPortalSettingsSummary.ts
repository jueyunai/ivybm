import type { Payload, PayloadRequest } from 'payload'

import { resolveRoleAccess } from '@/access/roles'
import type { PortalUser } from '@/admin-portal/core/auth/types'

export interface PortalSettingsSummary {
  canUpdate: boolean
  siteDescription: string | null
  siteName: string
}

export interface PortalSiteSettingsEditor {
  contact: {
    email: string | null
    phone: string | null
  }
  locales: {
    ar: { siteDescription: string | null; siteName: string }
    en: { siteDescription: string | null; siteName: string }
  }
  updatedAt: string
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
    canUpdate: resolveRoleAccess({ action: 'update', resource: 'content', user }) === true,
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

const selectLocaleSettings = (settings: unknown) => {
  const record = toRecord(settings)
  const optional = (value: unknown): string | null =>
    typeof value === 'string' && value.trim() ? value.trim() : null
  const required = (value: unknown): string => optional(value) ?? 'IVYBM'

  return {
    siteDescription: optional(record.siteDescription),
    siteName: required(record.siteName),
  }
}

export const getPortalSiteSettingsEditor = async ({
  payload,
  req,
}: {
  payload: Payload
  req: PayloadRequest
}): Promise<PortalSiteSettingsEditor> => {
  // Shallow copy req here is explicitly scoped to isolate top-level in-place mutations
  // (such as req.locale and req.fallbackLocale set by Payload's createLocalReq) during
  // parallel read-only global queries. This is safe for depth=0 scalar reads without transactions.
  const [english, arabic] = await Promise.all([
    payload.findGlobal({
      depth: 0,
      fallbackLocale: false,
      locale: 'en',
      overrideAccess: false,
      req: { ...req } as PayloadRequest,
      select: { contact: true, siteDescription: true, siteName: true, updatedAt: true },
      slug: 'site-settings',
    }),
    payload.findGlobal({
      depth: 0,
      fallbackLocale: false,
      locale: 'ar',
      overrideAccess: false,
      req: { ...req } as PayloadRequest,
      select: { contact: true, siteDescription: true, siteName: true, updatedAt: true },
      slug: 'site-settings',
    }),
  ])

  const enRecord = toRecord(english)
  const contact = toRecord(enRecord.contact)
  const optional = (value: unknown): string | null =>
    typeof value === 'string' && value.trim() ? value.trim() : null

  return {
    contact: {
      email: optional(contact.email),
      phone: optional(contact.phone),
    },
    locales: {
      ar: selectLocaleSettings(arabic),
      en: selectLocaleSettings(english),
    },
    updatedAt: optional(enRecord.updatedAt) ?? '',
  }
}
