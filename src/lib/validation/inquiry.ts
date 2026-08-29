export const INQUIRY_LIMITS = {
  attachments: 5,
  company: 160,
  country: 120,
  email: 254,
  idempotencyKey: 64,
  interest: 160,
  message: 5_000,
  name: 120,
  phone: 32,
  sourceURL: 2_048,
  utm: 200,
} as const

export type InquiryLocale = 'ar' | 'en'

export type InquiryAttachmentReference = {
  id: number | string
  ticket: string
}

export type InquiryData = {
  attachments?: InquiryAttachmentReference[]
  company?: string
  country: string
  email: string
  idempotencyKey: string
  interest?: string
  locale: InquiryLocale
  message: string
  name: string
  phone?: string
  sourceURL?: string
  utmCampaign?: string
  utmContent?: string
  utmMedium?: string
  utmSource?: string
  utmTerm?: string
}

export type InquiryField =
  | keyof InquiryData
  | 'website'

export type InquiryValidationCode =
  | 'invalid_email'
  | 'invalid_field'
  | 'invalid_idempotency_key'
  | 'invalid_locale'
  | 'invalid_phone'
  | 'invalid_url'
  | 'required'
  | 'too_long'

export type InquiryValidationResult =
  | { ok: true; spam: true }
  | { data: InquiryData; ok: true; spam: false }
  | { errors: Partial<Record<InquiryField, InquiryValidationCode>>; ok: false }

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const PHONE_INPUT_PATTERN = /^\+?[0-9\s().-]+$/
const PHONE_PATTERN = /^\+?[0-9]{7,20}$/

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const text = (input: Record<string, unknown>, key: string): string => {
  const value = input[key]
  return typeof value === 'string' ? value.trim() : ''
}

const optional = (value: string): string | undefined => value || undefined

const validateLength = (
  errors: Partial<Record<InquiryField, InquiryValidationCode>>,
  field: InquiryField,
  value: string,
  limit: number,
): void => {
  if (value.length > limit) errors[field] = 'too_long'
}

const normalizePhone = (value: string): string => value.replace(/[^+\d]/g, '')

const isSafeHTTPURL = (value: string): boolean => {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

export const validateInquiry = (input: unknown): InquiryValidationResult => {
  if (!isRecord(input)) {
    return {
      errors: {
        country: 'required',
        email: 'required',
        idempotencyKey: 'required',
        locale: 'required',
        message: 'required',
        name: 'required',
      },
      ok: false,
    }
  }

  if (text(input, 'website')) return { ok: true, spam: true }

  const company = text(input, 'company')
  const country = text(input, 'country')
  const email = text(input, 'email').toLowerCase()
  const idempotencyKey = text(input, 'idempotencyKey').toLowerCase()
  const interest = text(input, 'interest')
  const locale = text(input, 'locale')
  const message = text(input, 'message')
  const name = text(input, 'name')
  const rawPhone = text(input, 'phone')
  const phone = normalizePhone(rawPhone)
  const sourceURL = text(input, 'sourceURL')
  const utmCampaign = text(input, 'utmCampaign')
  const utmContent = text(input, 'utmContent')
  const utmMedium = text(input, 'utmMedium')
  const utmSource = text(input, 'utmSource')
  const utmTerm = text(input, 'utmTerm')
  const errors: Partial<Record<InquiryField, InquiryValidationCode>> = {}

  for (const [field, value] of [
    ['country', country],
    ['email', email],
    ['idempotencyKey', idempotencyKey],
    ['locale', locale],
    ['message', message],
    ['name', name],
  ] as const) {
    if (!value) errors[field] = 'required'
  }

  validateLength(errors, 'company', company, INQUIRY_LIMITS.company)
  validateLength(errors, 'country', country, INQUIRY_LIMITS.country)
  validateLength(errors, 'email', email, INQUIRY_LIMITS.email)
  validateLength(errors, 'idempotencyKey', idempotencyKey, INQUIRY_LIMITS.idempotencyKey)
  validateLength(errors, 'interest', interest, INQUIRY_LIMITS.interest)
  validateLength(errors, 'message', message, INQUIRY_LIMITS.message)
  validateLength(errors, 'name', name, INQUIRY_LIMITS.name)
  validateLength(errors, 'phone', rawPhone, INQUIRY_LIMITS.phone)
  validateLength(errors, 'sourceURL', sourceURL, INQUIRY_LIMITS.sourceURL)
  for (const [field, value] of [
    ['utmCampaign', utmCampaign],
    ['utmContent', utmContent],
    ['utmMedium', utmMedium],
    ['utmSource', utmSource],
    ['utmTerm', utmTerm],
  ] as const) {
    validateLength(errors, field, value, INQUIRY_LIMITS.utm)
  }

  if (email && !EMAIL_PATTERN.test(email)) errors.email = 'invalid_email'
  if (idempotencyKey && !UUID_PATTERN.test(idempotencyKey)) {
    errors.idempotencyKey = 'invalid_idempotency_key'
  }
  if (locale && locale !== 'en' && locale !== 'ar') errors.locale = 'invalid_locale'
  if (rawPhone && (!PHONE_INPUT_PATTERN.test(rawPhone) || !PHONE_PATTERN.test(phone))) {
    errors.phone = 'invalid_phone'
  }
  if (sourceURL && !isSafeHTTPURL(sourceURL)) errors.sourceURL = 'invalid_url'

  let attachments: InquiryAttachmentReference[] | undefined
  if ('attachments' in input && input.attachments !== undefined && input.attachments !== null) {
    if (!Array.isArray(input.attachments)) {
      errors.attachments = 'invalid_field'
    } else if (input.attachments.length > INQUIRY_LIMITS.attachments) {
      errors.attachments = 'too_long'
    } else {
      const parsedAttachments: InquiryAttachmentReference[] = []
      let valid = true
      for (const item of input.attachments) {
        if (!item || typeof item !== 'object') {
          valid = false
          break
        }
        const candidate = item as Record<string, unknown>
        const id = candidate.id
        const ticket = typeof candidate.ticket === 'string' ? candidate.ticket.trim() : ''
        const isValidId =
          (typeof id === 'number' && Number.isSafeInteger(id) && id > 0) ||
          (typeof id === 'string' && id.trim().length > 0)
        if (!isValidId || !ticket) {
          valid = false
          break
        }
        parsedAttachments.push({
          id: typeof id === 'number' ? id : id.trim(),
          ticket,
        })
      }
      if (!valid) {
        errors.attachments = 'invalid_field'
      } else {
        attachments = parsedAttachments
      }
    }
  }

  if (Object.keys(errors).length > 0) return { errors, ok: false }

  return {
    data: {
      attachments,
      company: optional(company),
      country,
      email,
      idempotencyKey,
      interest: optional(interest),
      locale: locale as InquiryLocale,
      message,
      name,
      phone: optional(phone),
      sourceURL: optional(sourceURL),
      utmCampaign: optional(utmCampaign),
      utmContent: optional(utmContent),
      utmMedium: optional(utmMedium),
      utmSource: optional(utmSource),
      utmTerm: optional(utmTerm),
    },
    ok: true,
    spam: false,
  }
}
