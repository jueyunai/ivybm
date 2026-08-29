import { isIP } from 'node:net'
import { NextResponse } from 'next/server'
import { getPayload, type Payload } from 'payload'

import config from '@/payload.config'
import { inquiryAttachmentRateLimiter, type RateLimiter } from '@/lib/security/rateLimit'
import {
  LEAD_ATTACHMENT_MAX_BYTES,
  LEAD_ATTACHMENT_MAX_FILES,
  LEAD_ATTACHMENT_MAX_TOTAL_BYTES,
  LEAD_ATTACHMENT_STAGING_TTL_MS,
  attachmentBytesMatch,
  attachmentExtension,
  attachmentMimeMatchesExtension,
  isAllowedAttachmentName,
} from '@/modules/lead-attachments/files'
import { hashUploadTicket, issueUploadTicket, verifyUploadTicket } from '@/modules/lead-attachments/tokens'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const MAX_UPLOAD_REQUEST_BYTES = LEAD_ATTACHMENT_MAX_BYTES + 1_048_576

type PayloadProvider = () => Promise<Payload>

const defaultPayloadProvider: PayloadProvider = () =>
  getPayload({ config, disableOnInit: true, key: 'public-attachments' })

const getClientKey = (request: Request): string => {
  const realIP = request.headers.get('x-real-ip')?.trim()
  if (realIP && isIP(realIP)) return realIP

  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  return forwarded && isIP(forwarded) ? forwarded : 'unknown-client'
}

export const createAttachmentUploadHandler = ({
  limiter = inquiryAttachmentRateLimiter,
  payloadProvider = defaultPayloadProvider,
}: {
  limiter?: RateLimiter
  payloadProvider?: PayloadProvider
} = {}) =>
  async function attachmentUploadHandler(request: Request): Promise<Response> {
    const limit = limiter.consume(getClientKey(request))
    if (!limit.allowed) {
      return NextResponse.json(
        {
          code: 'rate_limited',
          message: 'Too many attachment upload requests. Please try again later.',
          ok: false,
          retryAfterSeconds: limit.retryAfterSeconds,
        },
        {
          headers: { 'retry-after': String(limit.retryAfterSeconds) },
          status: 429,
        },
      )
    }

    const contentLength = Number.parseInt(request.headers.get('content-length') ?? '0', 10)
    if (Number.isFinite(contentLength) && contentLength > MAX_UPLOAD_REQUEST_BYTES) {
      return NextResponse.json(
        {
          code: 'file_too_large',
          message: 'Each attachment must be 50 MB or smaller.',
          ok: false,
        },
        { status: 400 },
      )
    }

    let formData: FormData
    try {
      formData = await request.formData()
    } catch {
      return NextResponse.json(
        { code: 'invalid_body', message: 'Multipart form data is required.', ok: false },
        { status: 400 },
      )
    }

    const rawTicket = formData.get('ticket')

    let ticket: string
    if (typeof rawTicket === 'string' && rawTicket.trim().length > 0) {
      ticket = rawTicket.trim()
      const verified = verifyUploadTicket(ticket)
      if (!verified) {
        return NextResponse.json(
          { code: 'invalid_ticket', message: 'Upload ticket is invalid or expired.', ok: false },
          { status: 401 },
        )
      }
    } else {
      ticket = issueUploadTicket()
    }

    const file = formData.get('file') as null | {
      arrayBuffer?: () => Promise<ArrayBuffer>
      name?: string
      size?: number
      type?: string
    }

    if (!file || typeof file.arrayBuffer !== 'function' || typeof file.name !== 'string') {
      return NextResponse.json(
        { code: 'missing_file', message: 'A valid file is required.', ok: false },
        { status: 400 },
      )
    }

    const filename = file.name
    const size = typeof file.size === 'number' ? file.size : 0
    const mimeType = file.type || 'application/octet-stream'

    if (!Number.isSafeInteger(size) || size <= 0 || size > LEAD_ATTACHMENT_MAX_BYTES) {
      return NextResponse.json(
        {
          code: 'file_too_large',
          message: 'Each attachment must be 50 MB or smaller.',
          ok: false,
        },
        { status: 400 },
      )
    }

    if (!isAllowedAttachmentName(filename)) {
      return NextResponse.json(
        {
          code: 'invalid_filename',
          message: 'The attachment file type or name is not allowed.',
          ok: false,
        },
        { status: 400 },
      )
    }

    const extension = attachmentExtension(filename)
    if (!attachmentMimeMatchesExtension(mimeType, extension)) {
      return NextResponse.json(
        {
          code: 'invalid_mime_type',
          message: 'The attachment MIME type does not match the file extension.',
          ok: false,
        },
        { status: 400 },
      )
    }

    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    if (!attachmentBytesMatch(buffer, extension)) {
      return NextResponse.json(
        {
          code: 'invalid_file_bytes',
          message: 'The attachment file contents do not match the expected format.',
          ok: false,
        },
        { status: 400 },
      )
    }

    const ticketHash = hashUploadTicket(ticket)

    try {
      const payload = await payloadProvider()
      const existing = await payload.find({
        collection: 'lead-attachments',
        depth: 0,
        limit: 10,
        overrideAccess: true,
        where: {
          and: [
            { ticketHash: { equals: ticketHash } },
            { status: { equals: 'pending' } },
          ],
        },
      })

      if (existing.docs.length >= LEAD_ATTACHMENT_MAX_FILES) {
        return NextResponse.json(
          {
            code: 'too_many_attachments',
            message: `A maximum of ${LEAD_ATTACHMENT_MAX_FILES} attachments are allowed per inquiry.`,
            ok: false,
          },
          { status: 400 },
        )
      }

      const existingBytes = existing.docs.reduce(
        (sum, doc) => sum + (typeof doc.byteSize === 'number' ? doc.byteSize : 0),
        0,
      )

      if (existingBytes + size > LEAD_ATTACHMENT_MAX_TOTAL_BYTES) {
        return NextResponse.json(
          {
            code: 'total_size_exceeded',
            message: 'Total attachment size for this inquiry must not exceed 200 MB.',
            ok: false,
          },
          { status: 400 },
        )
      }

      const created = await payload.create({
        collection: 'lead-attachments',
        data: {
          byteSize: size,
          expiresAt: new Date(Date.now() + LEAD_ATTACHMENT_STAGING_TTL_MS).toISOString(),
          mimeType,
          status: 'pending',
          ticketHash,
        },
        file: {
          data: buffer,
          mimetype: mimeType,
          name: filename,
          size,
        },
        overrideAccess: true,
      })

      return NextResponse.json(
        {
          attachment: {
            byteSize: created.byteSize,
            filename: created.filename,
            id: created.id,
            mimeType: created.mimeType,
          },
          ok: true,
          ticket,
        },
        { status: 201 },
      )
    } catch (error) {
      console.error('attachment_upload_failed', {
        error: error instanceof Error ? error.message : String(error),
      })
      return NextResponse.json(
        {
          code: 'service_unavailable',
          message: 'Unable to process attachment upload at this time.',
          ok: false,
        },
        { status: 503 },
      )
    }
  }

export const POST = createAttachmentUploadHandler()
