import path from 'node:path'

import type { Payload, PayloadRequest } from 'payload'

import { MEDIA_IMAGE_MAX_BYTES, MEDIA_MIME_TYPES, MEDIA_PDF_MAX_BYTES } from '@/collections/Media'

type LooseRecord = Record<string, unknown>

export interface MediaCommandPayload {
  count?: (args: LooseRecord) => Promise<{ totalDocs: number }>
  create?: (args: LooseRecord) => Promise<LooseRecord>
  delete?: (args: LooseRecord) => Promise<LooseRecord>
  findByID?: (args: LooseRecord) => Promise<LooseRecord>
  findGlobal?: (args: LooseRecord) => Promise<LooseRecord>
  update?: (args: LooseRecord) => Promise<LooseRecord>
}

type MediaCommandPayloadLike = MediaCommandPayload | Payload

export interface PortalMediaFile {
  data: Buffer
  mimetype: string
  name: string
  size: number
}

export interface ParsedMediaMetadata {
  alt: string
  isPublic: boolean
  source: string
  updatedAt: null | string
}

export interface MediaCommandResult {
  alt: string
  filename: string
  id: number | string
  isPublic: boolean
  mimeType: null | string
  source: string
  updatedAt: string
}

export class MediaCommandError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'MediaCommandError'
  }
}

const asRecord = (value: unknown): LooseRecord =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as LooseRecord) : {}

const stringValue = (
  input: LooseRecord,
  key: string,
  { max, required = false }: { max: number; required?: boolean },
): string => {
  const raw = input[key]
  if (raw === undefined || raw === null || typeof raw !== 'string') {
    if (required) throw new MediaCommandError('media-invalid-input', `${key} is required`, 400)
    return ''
  }
  const value = raw.trim()
  if (required && !value) {
    throw new MediaCommandError('media-invalid-input', `${key} is required`, 400)
  }
  if (value.length > max) {
    throw new MediaCommandError('media-invalid-input', `${key} is too long`, 400)
  }
  return value
}

const booleanValue = (input: LooseRecord, key: string): boolean => {
  const raw = input[key]
  if (raw === true || raw === 'true' || raw === 1 || raw === '1') return true
  if (raw === false || raw === 'false' || raw === 0 || raw === '0' || raw === undefined) {
    return false
  }
  throw new MediaCommandError('media-invalid-input', `${key} must be a boolean`, 400)
}

export function parseMediaMetadata(value: unknown): ParsedMediaMetadata {
  const input = asRecord(value)
  return {
    alt: stringValue(input, 'alt', { max: 500, required: true }),
    isPublic: booleanValue(input, 'isPublic'),
    source: stringValue(input, 'source', { max: 2000, required: true }),
    updatedAt: stringValue(input, 'updatedAt', { max: 100 }) || null,
  }
}

export function validatePortalMediaFile(file: PortalMediaFile): PortalMediaFile {
  if (!file.name || file.name.length > 255 || path.basename(file.name) !== file.name) {
    throw new MediaCommandError('media-invalid-file', 'A safe file name is required', 400)
  }
  if (!MEDIA_MIME_TYPES.includes(file.mimetype as (typeof MEDIA_MIME_TYPES)[number])) {
    throw new MediaCommandError('media-invalid-file-type', 'Unsupported media file type', 415)
  }
  const maximum = file.mimetype === 'application/pdf' ? MEDIA_PDF_MAX_BYTES : MEDIA_IMAGE_MAX_BYTES
  if (!Number.isSafeInteger(file.size) || file.size <= 0 || file.size !== file.data.length) {
    throw new MediaCommandError('media-invalid-file', 'The uploaded file is invalid', 400)
  }
  if (file.size > maximum) {
    throw new MediaCommandError(
      'media-file-too-large',
      'The uploaded file exceeds its size limit',
      413,
    )
  }
  return file
}

const requireMethod = <T extends keyof MediaCommandPayload>(
  payload: MediaCommandPayloadLike,
  method: T,
): NonNullable<MediaCommandPayload[T]> => {
  const port = payload as MediaCommandPayload
  const value = port[method]
  if (!value)
    throw new MediaCommandError('media-command-unavailable', 'Media command unavailable', 500)
  return value.bind(payload) as NonNullable<MediaCommandPayload[T]>
}

const resultFrom = (document: LooseRecord): MediaCommandResult => ({
  alt: typeof document.alt === 'string' ? document.alt : '',
  filename: typeof document.filename === 'string' ? document.filename : '',
  id: document.id as number | string,
  isPublic: document.isPublic === true,
  mimeType: typeof document.mimeType === 'string' ? document.mimeType : null,
  source: typeof document.source === 'string' ? document.source : '',
  updatedAt: typeof document.updatedAt === 'string' ? document.updatedAt : '',
})

const assertRevision = (document: LooseRecord, updatedAt: null | string) => {
  if (!updatedAt || typeof document.updatedAt !== 'string' || document.updatedAt !== updatedAt) {
    throw new MediaCommandError(
      'media-stale',
      'This asset changed after the editor was opened. Reload before saving.',
      409,
    )
  }
}

const relationID = (value: unknown): null | number | string => {
  if (typeof value === 'number' || typeof value === 'string') return value
  if (value && typeof value === 'object') {
    const id = (value as { id?: unknown }).id
    return typeof id === 'number' || typeof id === 'string' ? id : null
  }
  return null
}

const MEDIA_REFERENCE_CHECKS = [
  { collection: 'pages', fields: ['heroImage', 'seo.ogImage'] },
  { collection: 'products', fields: ['coverImage', 'gallery', 'seo.ogImage'] },
  { collection: 'product-categories', fields: ['seo.ogImage'] },
  { collection: 'projects', fields: ['coverImage', 'gallery', 'seo.ogImage'] },
  { collection: 'posts', fields: ['featuredImage', 'seo.ogImage'] },
  { collection: 'downloads', fields: ['file', 'coverImage', 'seo.ogImage'] },
  { collection: 'knowledge-documents', fields: ['sourceFile'] },
  { collection: 'generated-contents', fields: ['assets'] },
] as const

const assertMediaNotReferenced = async ({
  id,
  payload,
  req,
}: {
  id: number | string
  payload: MediaCommandPayloadLike
  req: PayloadRequest
}) => {
  const count = requireMethod(payload, 'count')
  for (const check of MEDIA_REFERENCE_CHECKS) {
    const result = await count({
      collection: check.collection,
      overrideAccess: false,
      req,
      where: {
        or: check.fields.map((field) => ({ [field]: { equals: id } })),
      },
    })
    if (result.totalDocs > 0) {
      throw new MediaCommandError(
        'media-in-use',
        `This asset is still referenced by ${check.collection}`,
        409,
      )
    }
  }

  const findGlobal = requireMethod(payload, 'findGlobal')
  const settings = await findGlobal({
    depth: 0,
    fallbackLocale: false,
    locale: 'en',
    overrideAccess: false,
    req,
    slug: 'site-settings',
  })
  const defaultSeo = asRecord(settings.defaultSeo)
  if (
    String(relationID(settings.logo)) === String(id) ||
    String(relationID(defaultSeo.ogImage)) === String(id)
  ) {
    throw new MediaCommandError(
      'media-in-use',
      'This asset is still referenced by site settings',
      409,
    )
  }
}

const writePortalMediaAudit = async ({
  action,
  documentId,
  payload,
  req,
}: {
  action: 'create' | 'delete' | 'update'
  documentId: number | string
  payload: MediaCommandPayloadLike
  req: PayloadRequest
}) => {
  const create = requireMethod(payload, 'create')
  await create({
    collection: 'audit-logs',
    context: { skipAudit: true },
    data: {
      action,
      actor: req.user?.id,
      documentId: String(documentId),
      resource: 'media',
    },
    overrideAccess: true,
    req,
  })
}

export async function createPortalMedia({
  file,
  input,
  payload,
  req,
}: {
  file: PortalMediaFile
  input: unknown
  payload: MediaCommandPayloadLike
  req: PayloadRequest
}): Promise<MediaCommandResult> {
  const metadata = parseMediaMetadata(input)
  const create = requireMethod(payload, 'create')
  const document = await create({
    collection: 'media',
    context: { skipAudit: true },
    data: {
      alt: metadata.alt,
      isPublic: metadata.isPublic,
      source: metadata.source,
    },
    file: validatePortalMediaFile(file),
    overrideAccess: false,
    req,
  })
  await writePortalMediaAudit({
    action: 'create',
    documentId: document.id as number | string,
    payload,
    req,
  })
  return resultFrom(document)
}

export async function updatePortalMedia({
  id,
  input,
  payload,
  req,
}: {
  id: number | string
  input: unknown
  payload: MediaCommandPayloadLike
  req: PayloadRequest
}): Promise<MediaCommandResult> {
  const metadata = parseMediaMetadata(input)
  const findByID = requireMethod(payload, 'findByID')
  const current = await findByID({
    collection: 'media',
    depth: 0,
    id,
    overrideAccess: false,
    req,
  })
  assertRevision(current, metadata.updatedAt)

  const update = requireMethod(payload, 'update')
  const document = await update({
    collection: 'media',
    context: { skipAudit: true },
    data: {
      alt: metadata.alt,
      isPublic: metadata.isPublic,
      source: metadata.source,
    },
    id,
    overrideAccess: false,
    overrideLock: false,
    req,
  })
  await writePortalMediaAudit({
    action: 'update',
    documentId: document.id as number | string,
    payload,
    req,
  })
  return resultFrom(document)
}

export async function deletePortalMedia({
  id,
  payload,
  req,
  updatedAt,
}: {
  id: number | string
  payload: MediaCommandPayloadLike
  req: PayloadRequest
  updatedAt: string
}): Promise<MediaCommandResult> {
  const findByID = requireMethod(payload, 'findByID')
  const current = await findByID({
    collection: 'media',
    depth: 0,
    id,
    overrideAccess: false,
    req,
  })
  assertRevision(current, updatedAt)
  await assertMediaNotReferenced({ id, payload, req })

  const deleteDocument = requireMethod(payload, 'delete')
  const document = await deleteDocument({
    collection: 'media',
    context: { skipAudit: true },
    id,
    overrideAccess: false,
    overrideLock: false,
    req,
  })
  await writePortalMediaAudit({
    action: 'delete',
    documentId: document.id as number | string,
    payload,
    req,
  })
  return resultFrom(document)
}
