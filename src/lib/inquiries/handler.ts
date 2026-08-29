import { randomUUID } from 'node:crypto'
import { isIP } from 'node:net'
import { getPayload, type Payload } from 'payload'

import config from '@/payload.config'
import { LEAD_ATTACHMENT_RETENTION_MS } from '@/modules/lead-attachments/files'
import { hashUploadTicket, verifyUploadTicket } from '@/modules/lead-attachments/tokens'

import { inquiryRateLimiter, type RateLimiter } from '../security/rateLimit'
import {
  type InquiryAttachmentReference,
  type InquiryData,
  type InquiryLocale,
  type InquiryValidationCode,
  validateInquiry,
} from '../validation/inquiry'

const MAX_BODY_BYTES = 32 * 1_024
const WEBSITE_SOURCE_KEY = 'website-contact'

type PayloadProvider = () => Promise<Payload>

type InquiryHandlerDependencies = {
  limiter?: RateLimiter
  payloadProvider?: PayloadProvider
  uuid?: () => string
}

type InquiryErrorCode =
  | 'invalid_body'
  | 'payload_too_large'
  | 'rate_limited'
  | 'service_unavailable'
  | 'validation_failed'

type ErrorResponse = {
  code: InquiryErrorCode
  errors?: Partial<Record<keyof InquiryData | 'website', InquiryValidationCode>>
  ok: false
  requestId: string
  retryAfterSeconds?: number
}

const defaultPayloadProvider: PayloadProvider = () =>
  getPayload({ config, disableOnInit: true, key: 'public-inquiries' })

const noStoreHeaders = {
  'cache-control': 'no-store',
}

class PayloadTooLargeError extends Error {}

const escapeHTML = (value: string): string =>
  value.replace(/[&<>'"]/g, (character) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;',
    }
    return entities[character]
  })

const getClientKey = (request: Request): string => {
  const realIP = request.headers.get('x-real-ip')?.trim()
  if (realIP && isIP(realIP)) return realIP

  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  return forwarded && isIP(forwarded) ? forwarded : 'unknown-client'
}

const expectsJSON = (request: Request): boolean =>
  request.headers.get('accept')?.includes('application/json') === true ||
  request.headers.get('content-type')?.includes('application/json') === true

const requestLocale = (request: Request, input?: unknown): InquiryLocale => {
  if (input && typeof input === 'object' && 'locale' in input && input.locale === 'ar') return 'ar'
  if (input && typeof input === 'object' && 'locale' in input && input.locale === 'en') return 'en'

  const referer = request.headers.get('referer')
  if (referer) {
    try {
      if (new URL(referer).pathname.startsWith('/ar/')) return 'ar'
    } catch {
      // Ignore malformed client headers and use the default locale.
    }
  }
  return 'en'
}

const resultCopy = (locale: InquiryLocale) =>
  locale === 'ar'
    ? {
        back: 'العودة إلى صفحة الاتصال',
        errorCode: 'رمز الخطأ',
        error: 'تعذر إرسال الاستفسار',
        received: 'تم استلام الاستفسار',
        reference: 'الرقم المرجعي',
        retry: 'يرجى المحاولة مرة أخرى لاحقًا.',
      }
    : {
        back: 'Return to contact page',
        errorCode: 'Error code',
        error: 'Inquiry could not be submitted',
        received: 'Inquiry received',
        reference: 'Reference',
        retry: 'Please review the form or try again later.',
      }

const htmlResponse = ({
  code,
  headers = {},
  locale,
  ok,
  requestId,
  status,
}: {
  code?: InquiryErrorCode
  headers?: Record<string, string>
  locale: InquiryLocale
  ok: boolean
  requestId: string
  status: number
}): Response => {
  const copy = resultCopy(locale)
  const direction = locale === 'ar' ? 'rtl' : 'ltr'
  const title = ok ? copy.received : copy.error
  const detail = ok
    ? `<p>${escapeHTML(copy.reference)}: <strong>${escapeHTML(requestId)}</strong></p>`
    : `<p>${escapeHTML(copy.retry)}</p><p>${escapeHTML(copy.errorCode)}: <strong>${escapeHTML(code || 'unknown')}</strong></p><p>${escapeHTML(copy.reference)}: <strong>${escapeHTML(requestId)}</strong></p>`

  return new Response(
    `<!doctype html><html lang="${locale}" dir="${direction}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHTML(title)}</title></head><body><main><h1>${escapeHTML(title)}</h1>${detail}<p><a href="/${locale}/contact">${escapeHTML(copy.back)}</a></p></main></body></html>`,
    {
      headers: { ...noStoreHeaders, ...headers, 'content-type': 'text/html; charset=utf-8' },
      status,
    },
  )
}

const errorResponse = (
  request: Request,
  locale: InquiryLocale,
  body: ErrorResponse,
  status: number,
  headers: Record<string, string> = {},
): Response => {
  if (!expectsJSON(request)) {
    return htmlResponse({
      code: body.code,
      headers,
      locale,
      ok: false,
      requestId: body.requestId,
      status,
    })
  }

  return Response.json(body, {
    headers: { ...noStoreHeaders, ...headers },
    status,
  })
}

const successResponse = (
  request: Request,
  locale: InquiryLocale,
  requestId: string,
  { duplicate = false, status = 201 }: { duplicate?: boolean; status?: number } = {},
): Response => {
  if (!expectsJSON(request)) return htmlResponse({ locale, ok: true, requestId, status: 200 })

  return Response.json(
    { duplicate, ok: true, requestId },
    { headers: noStoreHeaders, status },
  )
}

const readBody = async (request: Request): Promise<Uint8Array> => {
  const contentLength = Number(request.headers.get('content-length') || 0)
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    throw new PayloadTooLargeError('payload_too_large')
  }

  if (!request.body) return new Uint8Array()

  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let received = 0

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    received += value.byteLength
    if (received > MAX_BODY_BYTES) {
      await reader.cancel()
      throw new PayloadTooLargeError('payload_too_large')
    }
    chunks.push(value)
  }

  const body = new Uint8Array(received)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return body
}

const parseBody = async (request: Request): Promise<Record<string, unknown>> => {
  const contentType = request.headers.get('content-type') || ''
  const bytes = await readBody(request)

  if (contentType.includes('application/json')) {
    const body = JSON.parse(new TextDecoder().decode(bytes)) as unknown
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('invalid_body')
    return body as Record<string, unknown>
  }

  const bufferedRequest = new Request(request.url, {
    body: bytes,
    headers: { 'content-type': contentType },
    method: 'POST',
  })
  const formData = await bufferedRequest.formData()
  return Object.fromEntries(
    [...formData.entries()].map(([key, value]) => [key, typeof value === 'string' ? value : '']),
  )
}

const enrichAttribution = (
  input: Record<string, unknown>,
  request: Request,
): Record<string, unknown> => {
  const result = { ...input }
  const fallbackURL = request.headers.get('referer') || ''
  if (!result.sourceURL && fallbackURL) result.sourceURL = fallbackURL

  const value = typeof result.sourceURL === 'string' ? result.sourceURL : ''
  try {
    const url = new URL(value)
    const mappings = {
      utmCampaign: 'utm_campaign',
      utmContent: 'utm_content',
      utmMedium: 'utm_medium',
      utmSource: 'utm_source',
      utmTerm: 'utm_term',
    } as const
    for (const [field, parameter] of Object.entries(mappings)) {
      if (!result[field]) result[field] = url.searchParams.get(parameter) || ''
    }
  } catch {
    // Validation will report an invalid explicit URL; an absent URL remains optional.
  }

  return result
}

const findExistingLead = async (payload: Payload, idempotencyKey: string) => {
  const existing = await payload.find({
    collection: 'leads',
    depth: 0,
    limit: 1,
    overrideAccess: true,
    where: { idempotencyKey: { equals: idempotencyKey } },
  })
  return existing.docs[0]
}

const ensureWebsiteSource = async (payload: Payload) => {
  const findSource = async () =>
    (
      await payload.find({
        collection: 'lead-sources',
        depth: 0,
        limit: 1,
        overrideAccess: true,
        where: { key: { equals: WEBSITE_SOURCE_KEY } },
      })
    ).docs[0]

  const existing = await findSource()
  if (existing) return existing

  try {
    return await payload.create({
      collection: 'lead-sources',
      data: {
        channel: 'website',
        description: 'Public website contact and quote request form.',
        isActive: true,
        key: WEBSITE_SOURCE_KEY,
        name: 'Website Contact Form',
      },
      overrideAccess: true,
    })
  } catch (error) {
    const raced = await findSource()
    if (raced) return raced
    throw error
  }
}

const associateLeadAttachments = async (
  payload: Payload,
  leadId: number | string,
  attachments: InquiryAttachmentReference[],
): Promise<void> => {
  let hasAssociatedDrawings = false
  for (const item of attachments) {
    const verified = verifyUploadTicket(item.ticket)
    if (!verified) {
      // Invalid/expired token: tolerance semantics - do not fail lead creation
      continue
    }
    const ticketHash = hashUploadTicket(item.ticket)
    try {
      const found = await payload.find({
        collection: 'lead-attachments',
        depth: 0,
        limit: 1,
        overrideAccess: true,
        where: {
          and: [
            { id: { equals: item.id } },
            { ticketHash: { equals: ticketHash } },
          ],
        },
      })
      const doc = found.docs[0]
      if (doc && doc.status === 'pending') {
        await payload.update({
          collection: 'lead-attachments',
          id: doc.id,
          data: {
            associatedAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + LEAD_ATTACHMENT_RETENTION_MS).toISOString(),
            lead: typeof leadId === "number" ? leadId : Number(leadId),
            status: 'associated',
          },
          overrideAccess: true,
        })
        hasAssociatedDrawings = true
      } else if (doc && doc.status !== 'associated') {
        await payload.update({
          collection: 'lead-attachments',
          id: doc.id,
          data: {
            status: 'missing',
          },
          overrideAccess: true,
        })
      }
    } catch (error) {
      // Association error should never block lead creation
      console.error('lead_attachment_association_failed', {
        attachmentId: item.id,
        error: error instanceof Error ? error.message : String(error),
        leadId,
      })
    }
  }

  if (hasAssociatedDrawings) {
    try {
      await payload.update({
        collection: 'leads',
        id: leadId,
        data: {
          hasDrawings: true,
        },
        overrideAccess: true,
      })
    } catch {
      // Non-blocking update
    }
  }
}

const createLead = async (payload: Payload, data: InquiryData, requestId: string) => {
  const source = await ensureWebsiteSource(payload)

  const lead = await payload.create({
    collection: 'leads',
    data: {
      company: data.company,
      country: data.country,
      email: data.email,
      idempotencyKey: data.idempotencyKey,
      interest: data.interest,
      locale: data.locale,
      message: data.message,
      name: data.name,
      phone: data.phone,
      intentLevel: 'unscored',
      requestId,
      source: source.id,
      sourceURL: data.sourceURL,
      status: 'new',
      utm: {
        campaign: data.utmCampaign,
        content: data.utmContent,
        medium: data.utmMedium,
        source: data.utmSource,
        term: data.utmTerm,
      },
    },
    overrideAccess: true,
  })

  if (data.attachments && data.attachments.length > 0) {
    await associateLeadAttachments(payload, lead.id, data.attachments)
  }

  return lead
}

export const createInquiryHandler = ({
  limiter = inquiryRateLimiter,
  payloadProvider = defaultPayloadProvider,
  uuid = randomUUID,
}: InquiryHandlerDependencies = {}) =>
  async function inquiryHandler(request: Request): Promise<Response> {
    const requestId = uuid()
    const fallbackLocale = requestLocale(request)
    const contentLength = Number(request.headers.get('content-length') || 0)
    if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
      return errorResponse(
        request,
        fallbackLocale,
        { code: 'payload_too_large', ok: false, requestId },
        413,
      )
    }

    const limit = limiter.consume(getClientKey(request))
    if (!limit.allowed) {
      return errorResponse(
        request,
        fallbackLocale,
        {
          code: 'rate_limited',
          ok: false,
          requestId,
          retryAfterSeconds: limit.retryAfterSeconds,
        },
        429,
        { 'retry-after': String(limit.retryAfterSeconds) },
      )
    }

    let input: Record<string, unknown>
    try {
      input = enrichAttribution(await parseBody(request), request)
    } catch (error) {
      if (error instanceof PayloadTooLargeError) {
        return errorResponse(
          request,
          fallbackLocale,
          { code: 'payload_too_large', ok: false, requestId },
          413,
        )
      }
      return errorResponse(
        request,
        fallbackLocale,
        { code: 'invalid_body', ok: false, requestId },
        400,
      )
    }

    const locale = requestLocale(request, input)
    const validation = validateInquiry(input)
    if (!validation.ok) {
      return errorResponse(
        request,
        locale,
        {
          code: 'validation_failed',
          errors: validation.errors,
          ok: false,
          requestId,
        },
        400,
      )
    }
    if (validation.spam) return successResponse(request, locale, requestId, { status: 202 })

    try {
      const payload = await payloadProvider()
      const existing = await findExistingLead(payload, validation.data.idempotencyKey)
      if (existing) {
        if (validation.data.attachments && validation.data.attachments.length > 0) {
          await associateLeadAttachments(payload, existing.id, validation.data.attachments)
        }
        return successResponse(request, locale, existing.requestId, { duplicate: true, status: 200 })
      }

      try {
        const lead = await createLead(payload, validation.data, requestId)
        return successResponse(request, locale, lead.requestId)
      } catch (error) {
        const raced = await findExistingLead(payload, validation.data.idempotencyKey)
        if (raced) {
          if (validation.data.attachments && validation.data.attachments.length > 0) {
            await associateLeadAttachments(payload, raced.id, validation.data.attachments)
          }
          return successResponse(request, locale, raced.requestId, { duplicate: true, status: 200 })
        }
        throw error
      }
    } catch {
      return errorResponse(
        request,
        locale,
        { code: 'service_unavailable', ok: false, requestId },
        503,
      )
    }
  }
