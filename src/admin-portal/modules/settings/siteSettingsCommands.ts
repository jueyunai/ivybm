import type { Payload, PayloadRequest } from 'payload'
import { sql, type PostgresAdapter } from '@payloadcms/db-postgres'

type JsonInput = Record<string, unknown>

export class SiteSettingsCommandError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'SiteSettingsCommandError'
  }
}

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : {}

const requiredText = (value: unknown, field: string, maximum: number): string => {
  if (typeof value !== 'string') {
    throw new SiteSettingsCommandError(
      'site-settings-validation-failed',
      `A valid ${field} is required.`,
      400,
    )
  }
  const normalized = value.trim()
  if (!normalized || normalized.length > maximum) {
    throw new SiteSettingsCommandError(
      'site-settings-validation-failed',
      `A valid ${field} is required.`,
      400,
    )
  }
  return normalized
}

const optionalText = (value: unknown, field: string, maximum: number): string | null => {
  if (value === undefined || value === null || value === '') return null
  return requiredText(value, field, maximum)
}

const localeData = (input: JsonInput, locale: 'ar' | 'en') => {
  const data = record(input[locale])
  return {
    siteDescription: optionalText(data.siteDescription, `${locale} site description`, 2_000),
    siteName: requiredText(data.siteName, `${locale} site name`, 200),
  }
}

const lockSiteSettings = async (payload: Payload, req: PayloadRequest): Promise<void> => {
  const transactionID = await req.transactionID
  if (!transactionID) {
    throw new SiteSettingsCommandError(
      'site-settings-transaction-required',
      'Site settings updates require a database transaction.',
      500,
    )
  }
  const adapter = payload.db as unknown as PostgresAdapter
  const database = adapter.sessions[transactionID]?.db
  if (!database) {
    throw new SiteSettingsCommandError(
      'site-settings-transaction-unavailable',
      'The site settings transaction is unavailable.',
      500,
    )
  }

  // SiteSettings is a Payload global, so it has no portal target row that can
  // be passed to the generic command lock. A transaction-scoped advisory lock
  // serializes all writers before the revision is read, including when the
  // global row has not been initialized yet.
  await database.execute(sql`SELECT pg_advisory_xact_lock(1876432101, 1)`)
}

const parseInput = (value: unknown) => {
  const input = record(value)
  return {
    ar: localeData(input, 'ar'),
    contact: {
      email: optionalText(record(input.contact).email, 'contact email', 320),
      phone: optionalText(record(input.contact).phone, 'contact phone', 80),
    },
    en: localeData(input, 'en'),
    updatedAt: requiredText(input.updatedAt, 'configuration version', 80),
  }
}

export const updatePortalSiteSettings = async ({
  input,
  payload,
  req,
}: {
  input: unknown
  payload: Payload
  req: PayloadRequest
}) => {
  const parsed = parseInput(input)
  await lockSiteSettings(payload, req)
  const current = await payload.findGlobal({
    depth: 0,
    fallbackLocale: false,
    locale: 'en',
    overrideAccess: false,
    req,
    slug: 'site-settings',
  })

  if (current.updatedAt !== parsed.updatedAt) {
    throw new SiteSettingsCommandError(
      'site-settings-stale',
      'This site setting changed. Reload it before saving.',
      409,
    )
  }

  const currentContact = record(current.contact)
  await payload.updateGlobal({
    data: {
      contact: {
        ...currentContact,
        email: parsed.contact.email,
        phone: parsed.contact.phone,
      },
      siteDescription: parsed.en.siteDescription,
      siteName: parsed.en.siteName,
    } as never,
    locale: 'en',
    overrideAccess: false,
    req,
    slug: 'site-settings',
  })
  const updated = await payload.updateGlobal({
    data: {
      siteDescription: parsed.ar.siteDescription,
      siteName: parsed.ar.siteName,
    } as never,
    locale: 'ar',
    overrideAccess: false,
    req,
    slug: 'site-settings',
  })

  return {
    contact: parsed.contact,
    locales: parsed,
    updatedAt: updated.updatedAt,
  }
}
