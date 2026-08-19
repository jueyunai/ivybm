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

const selectSiteSettingsEditor = (settings: unknown): PortalSiteSettingsEditor => {
  const record = toRecord(settings)
  const contact = toRecord(record.contact)
  const optional = (value: unknown): string | null =>
    typeof value === 'string' && value.trim() ? value.trim() : null
  const required = (value: unknown): string => optional(value) ?? 'IVYBM'

  return {
    contact: {
      email: optional(contact.email),
      phone: optional(contact.phone),
    },
    locales: {
      ar: {
        siteDescription: optional(record.siteDescription),
        siteName: required(record.siteName),
      },
      en: {
        siteDescription: optional(record.siteDescription),
        siteName: required(record.siteName),
      },
    },
    updatedAt: optional(record.updatedAt) ?? '',
  }
}

export const getPortalSiteSettingsEditor = async ({
  payload,
  req,
}: {
  payload: Payload
  req: PayloadRequest
}): Promise<PortalSiteSettingsEditor> => {
  const [english, arabic] = await Promise.all(
    (['en', 'ar'] as const).map((locale) =>
      payload.findGlobal({
        depth: 0,
        fallbackLocale: false,
        locale,
        overrideAccess: false,
        req,
        select: { contact: true, siteDescription: true, siteName: true, updatedAt: true },
        slug: 'site-settings',
      }),
    ),
  )
  const en = selectSiteSettingsEditor(english)
  const ar = selectSiteSettingsEditor(arabic)
  return {
    contact: en.contact,
    locales: { ar: ar.locales.ar, en: en.locales.en },
    updatedAt: en.updatedAt,
  }
}
