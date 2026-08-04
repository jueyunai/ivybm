import { Buffer } from 'node:buffer'

import { createLocalReq, getPayload, type Payload, type PayloadRequest } from 'payload'

import { getRoleUser } from '@/access/roles'
import { MEDIA_PDF_MAX_BYTES } from '@/collections/Media'
import config from '@/payload.config'
import { PortalCommandReceiptError } from '@/admin-portal/core/commands/portalCommandReceipts'
import { readLimitedJSONObject } from '@/admin-portal/core/http/readLimitedJSON'

import { MediaCommandError, type PortalMediaFile } from './mediaCommands'

const MAX_MEDIA_UPLOAD_REQUEST_BYTES = MEDIA_PDF_MAX_BYTES + 1_048_576

const readRequestBodyWithinLimit = async (
  request: Request,
  maximumBytes: number,
): Promise<Buffer> => {
  if (!request.body) return Buffer.alloc(0)
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (value.byteLength > maximumBytes - total) {
        await reader.cancel('request body exceeds media upload limit').catch(() => undefined)
        throw new MediaCommandError('media-request-too-large', 'Media upload is too large', 413)
      }
      total += value.byteLength
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  return Buffer.concat(
    chunks.map((chunk) => Buffer.from(chunk)),
    total,
  )
}

export interface AuthorizedMediaRequest {
  payload: Payload
  req: PayloadRequest
}

export async function authorizeMediaRequest(request: Request): Promise<AuthorizedMediaRequest> {
  if (process.env.ADMIN_PORTAL_ENABLED !== 'true') {
    throw new MediaCommandError('portal-disabled', 'The Portal is disabled', 503)
  }
  if (process.env.ADMIN_PORTAL_MEDIA_ENABLED !== 'true') {
    throw new MediaCommandError('media-module-disabled', 'The media module is disabled', 503)
  }

  const payload = await getPayload({ config })
  const { user } = await payload.auth({ headers: request.headers })
  const actor = getRoleUser(user)
  if (!user || !actor || (user as { collection?: string }).collection !== 'users') {
    throw new MediaCommandError('media-unauthenticated', 'Authentication required', 401)
  }
  if (actor.role !== 'admin' && actor.role !== 'operator') {
    throw new MediaCommandError('media-forbidden', 'Media access denied', 403)
  }

  return {
    payload,
    req: await createLocalReq({ user }, payload),
  }
}

export async function readMediaJSON(request: Request): Promise<Record<string, unknown>> {
  return readLimitedJSONObject(request, {
    invalid: () => new MediaCommandError('media-invalid-json', 'A JSON object is required', 400),
    maximumBytes: 16_000,
    tooLarge: () =>
      new MediaCommandError('media-request-too-large', 'Media request is too large', 413),
  })
}

export async function readMediaUpload(request: Request): Promise<{
  file: PortalMediaFile
  input: Record<string, unknown>
}> {
  const contentLength = Number.parseInt(request.headers.get('content-length') ?? '0', 10)
  if (Number.isFinite(contentLength) && contentLength > MAX_MEDIA_UPLOAD_REQUEST_BYTES) {
    throw new MediaCommandError('media-request-too-large', 'Media upload is too large', 413)
  }

  let form: FormData
  try {
    const body = await readRequestBodyWithinLimit(request, MAX_MEDIA_UPLOAD_REQUEST_BYTES)
    const headers = new Headers(request.headers)
    headers.delete('content-length')
    headers.delete('transfer-encoding')
    form = await new Request(request.url, {
      body,
      headers,
      method: request.method,
    }).formData()
  } catch (error) {
    if (error instanceof MediaCommandError) throw error
    throw new MediaCommandError('media-invalid-form', 'A multipart upload is required', 400)
  }
  const candidate = form.get('file') as null | {
    arrayBuffer?: () => Promise<ArrayBuffer>
    name?: string
    size?: number
    type?: string
  }
  if (!candidate || typeof candidate.arrayBuffer !== 'function') {
    throw new MediaCommandError('media-file-required', 'A media file is required', 400)
  }
  const data = Buffer.from(await candidate.arrayBuffer())
  return {
    file: {
      data,
      mimetype: candidate.type ?? '',
      name: candidate.name ?? '',
      size: candidate.size ?? data.length,
    },
    input: {
      alt: form.get('alt'),
      isPublic: form.get('isPublic'),
      source: form.get('source'),
    },
  }
}

export function requireMediaID(value: string): number {
  const id = Number.parseInt(value, 10)
  if (!Number.isSafeInteger(id) || id <= 0 || String(id) !== value) {
    throw new MediaCommandError('media-invalid-id', 'A valid media id is required', 400)
  }
  return id
}

export const mediaJSON = (body: unknown, init?: ResponseInit): Response =>
  Response.json(body, {
    ...init,
    headers: {
      'Cache-Control': 'no-store',
      ...init?.headers,
    },
  })

export function mediaErrorResponse(error: unknown): Response {
  if (error instanceof PortalCommandReceiptError) {
    return mediaJSON(
      { error: { code: error.code, message: error.message } },
      { status: error.status },
    )
  }
  if (error instanceof MediaCommandError) {
    return mediaJSON(
      { error: { code: error.code, message: error.message } },
      { status: error.status },
    )
  }
  const candidate = error as { message?: unknown; name?: unknown; status?: unknown }
  if (candidate?.name === 'ValidationError' || candidate?.status === 400) {
    return mediaJSON(
      {
        error: {
          code: 'media-validation-failed',
          message: 'Media validation failed',
        },
      },
      { status: 400 },
    )
  }
  console.error('portal_media_command_failed', {
    error: error instanceof Error ? error.name : typeof error,
  })
  return mediaJSON(
    { error: { code: 'media-command-failed', message: 'Unable to complete the media command' } },
    { status: 500 },
  )
}
