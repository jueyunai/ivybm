/**
 * Pure, credential-free builders and parsers for the four Meta Graph publishing
 * operations that this codebase issues to Facebook Pages and Instagram
 * Professional accounts. None of the exported functions perform network I/O,
 * read configuration, or carry access tokens through inputs or outputs. The
 * surrounding adapter is responsible for attaching the token to the request
 * envelope at dispatch time; this module only describes the body that the
 * Graph endpoint must receive.
 *
 * Endpoint reference (Meta Graph API, verified 2026-07-26):
 * - POST /{PAGE_ID}/photos with url and optional caption
 * - POST /{IG_ID}/media with image_url and optional caption
 * - POST /{IG_ID}/media_publish with creation_id
 * - GET  /{CONTAINER_ID}?fields=status_code
 *
 * No idempotency support or provider lookup by IVYBM idempotencyKey is proven
 * for any of these endpoints. These helpers therefore MUST NOT be used to
 * implement a blind retry after an unknown transport outcome. The adapter that
 * consumes this module must fence the command before network I/O and stop for
 * manual reconciliation when it cannot prove whether the provider accepted it.
 */

export type MetaPublishingHttpRequest = {
  body?: Record<string, unknown>
  method: 'GET' | 'POST'
  path: string
  query?: Record<string, string>
}

export type FacebookPagePhotoRequestInput = {
  caption?: string
  pageId: string
  url: string
}

export type InstagramMediaRequestInput = {
  caption?: string
  igId: string
  imageUrl: string
}

export type InstagramMediaPublishRequestInput = {
  creationId: string
  igId: string
}

export type InstagramContainerStatusRequestInput = {
  containerId: string
}

export type FacebookPagePhotoResponse =
  { photoId: string; postId?: string } | { photoId?: never; postId: string }

export type InstagramMediaResponse = {
  creationId: string
}

export type InstagramMediaPublishResponse = {
  igMediaId: string
}

export type InstagramMediaStatusCode =
  'EXPIRED' | 'ERROR' | 'FINISHED' | 'IN_PROGRESS' | 'PUBLISHED'

export type InstagramContainerStatusResponse = {
  statusCode: InstagramMediaStatusCode
}

const MAX_META_IDENTIFIER_LENGTH = 32
const MAX_FACEBOOK_POST_IDENTIFIER_LENGTH = MAX_META_IDENTIFIER_LENGTH * 2 + 1
const MAX_FACEBOOK_CAPTION_LENGTH = 5_000
const MAX_INSTAGRAM_CAPTION_LENGTH = 2_200
const DECIMAL_IDENTIFIER_PATTERN = /^[0-9]+$/
const FACEBOOK_POST_IDENTIFIER_PATTERN = /^([0-9]+)_([0-9]+)$/
const FORBIDDEN_RAW_URL_CHARACTER_PATTERN = /[\u0000-\u0020\u007F]/

const INSTAGRAM_MEDIA_STATUS_CODES: readonly InstagramMediaStatusCode[] = [
  'EXPIRED',
  'ERROR',
  'FINISHED',
  'IN_PROGRESS',
  'PUBLISHED',
]

const requireMetaIdentifier = (value: unknown, fieldName: string): string => {
  if (
    typeof value !== 'string' ||
    !value.length ||
    value.length > MAX_META_IDENTIFIER_LENGTH ||
    !DECIMAL_IDENTIFIER_PATTERN.test(value)
  ) {
    throw new Error(`Meta ${fieldName} must be a bounded decimal path segment`)
  }
  return value
}

const requireFacebookPostIdentifier = (value: unknown): string => {
  const match = typeof value === 'string' ? FACEBOOK_POST_IDENTIFIER_PATTERN.exec(value) : undefined
  if (
    typeof value !== 'string' ||
    !value.length ||
    value.length > MAX_FACEBOOK_POST_IDENTIFIER_LENGTH ||
    !match ||
    match[1].length > MAX_META_IDENTIFIER_LENGTH ||
    match[2].length > MAX_META_IDENTIFIER_LENGTH
  ) {
    throw new Error('Meta Facebook post response identifier is invalid')
  }
  return value
}

const normalizeCaption = (value: unknown, maxLength: number): string | undefined => {
  if (value === undefined) return undefined
  if (typeof value !== 'string') {
    throw new Error('Meta caption must be a string')
  }
  const trimmed = value.trim()
  if (!trimmed.length) return undefined
  if (Array.from(trimmed).length > maxLength) {
    throw new Error(`Meta caption must be ${maxLength} characters or fewer`)
  }
  return trimmed
}

const requirePublishingUrl = (value: unknown, fieldName: string): string => {
  if (typeof value !== 'string') {
    throw new Error(`Meta ${fieldName} must be a string`)
  }
  const trimmed = value.trim()
  if (!trimmed.length || FORBIDDEN_RAW_URL_CHARACTER_PATTERN.test(trimmed)) {
    throw new Error('Meta publishing URL must be an HTTPS URL without credentials or fragments')
  }
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    throw new Error('Meta publishing URL must be an HTTPS URL without credentials or fragments')
  }
  if (
    parsed.protocol !== 'https:' ||
    parsed.username ||
    parsed.password ||
    parsed.hash.length > 0
  ) {
    throw new Error('Meta publishing URL must be an HTTPS URL without credentials or fragments')
  }
  return trimmed
}

/**
 * Build a credential-free Facebook Page single-photo publish request. The
 * adapter layer is responsible for attaching the page access token at dispatch
 * time; this function only validates and assembles the request body.
 */
export const buildFacebookPagePhotoRequest = (
  input: FacebookPagePhotoRequestInput,
): MetaPublishingHttpRequest => {
  const pageId = requireMetaIdentifier(input?.pageId, 'identifier')
  const url = requirePublishingUrl(input?.url, 'publishing URL')
  const body: Record<string, unknown> = { url }
  const caption = normalizeCaption(input?.caption, MAX_FACEBOOK_CAPTION_LENGTH)
  if (caption !== undefined) body.caption = caption

  return {
    body,
    method: 'POST',
    path: `/${pageId}/photos`,
  }
}

/**
 * Build a credential-free Instagram Professional media container creation
 * request. The image URL is validated but never fetched.
 */
export const buildInstagramMediaRequest = (
  input: InstagramMediaRequestInput,
): MetaPublishingHttpRequest => {
  const igId = requireMetaIdentifier(input?.igId, 'identifier')
  const imageUrl = requirePublishingUrl(input?.imageUrl, 'publishing URL')
  const body: Record<string, unknown> = { image_url: imageUrl }
  const caption = normalizeCaption(input?.caption, MAX_INSTAGRAM_CAPTION_LENGTH)
  if (caption !== undefined) body.caption = caption

  return {
    body,
    method: 'POST',
    path: `/${igId}/media`,
  }
}

/**
 * Build a credential-free Instagram Professional media publish request that
 * promotes a previously created media container.
 */
export const buildInstagramMediaPublishRequest = (
  input: InstagramMediaPublishRequestInput,
): MetaPublishingHttpRequest => {
  const igId = requireMetaIdentifier(input?.igId, 'identifier')
  const creationId = requireMetaIdentifier(input?.creationId, 'identifier')

  return {
    body: { creation_id: creationId },
    method: 'POST',
    path: `/${igId}/media_publish`,
  }
}

/**
 * Build a credential-free Instagram Professional container status request.
 * The status code is the only documented field for this query.
 */
export const buildInstagramContainerStatusRequest = (
  input: InstagramContainerStatusRequestInput,
): MetaPublishingHttpRequest => {
  const containerId = requireMetaIdentifier(input?.containerId, 'identifier')

  return {
    method: 'GET',
    path: `/${containerId}`,
    query: { fields: 'status_code' },
  }
}

const requireRecord = (value: unknown): Record<string, unknown> | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined
  }
  return value as Record<string, unknown>
}

const readExactString = (record: Record<string, unknown>, key: string): string | undefined => {
  const candidate = record[key]
  if (typeof candidate !== 'string') return undefined
  const trimmed = candidate.trim()
  return trimmed.length ? trimmed : undefined
}

/**
 * Parse a Facebook Page single-photo publish response. Per the Graph
 * documentation the response carries `id` (the photo id) and/or `post_id`
 * (the page post id). We surface at least one of them so the caller can drive
 * follow-up status checks; raw provider error bodies do not leak through the
 * thrown message.
 */
export const parseFacebookPagePhotoResponse = (value: unknown): FacebookPagePhotoResponse => {
  const record = requireRecord(value)
  if (!record) throw new Error('Meta Facebook page photo response is invalid')
  const photoIdCandidate = readExactString(record, 'id')
  const postIdCandidate = readExactString(record, 'post_id')
  if (!photoIdCandidate && !postIdCandidate) {
    throw new Error('Meta Facebook page photo response requires a photo id or post id')
  }
  const photoId = photoIdCandidate
    ? requireMetaIdentifier(photoIdCandidate, 'Facebook photo response identifier')
    : undefined
  const postId = postIdCandidate ? requireFacebookPostIdentifier(postIdCandidate) : undefined
  if (photoId && postId) return { photoId, postId }
  if (photoId) return { photoId }
  if (postId) return { postId }
  throw new Error('Meta Facebook page photo response requires a photo id or post id')
}

/**
 * Parse an Instagram /media container creation response. The Graph endpoint
 * returns `{ "id": "<container_id>" }` on success.
 */
export const parseInstagramMediaResponse = (value: unknown): InstagramMediaResponse => {
  const record = requireRecord(value)
  if (!record) throw new Error('Meta Instagram media response is invalid')
  const creationIdCandidate = readExactString(record, 'id')
  if (!creationIdCandidate) throw new Error('Meta Instagram media response requires a creation id')
  const creationId = requireMetaIdentifier(
    creationIdCandidate,
    'Instagram creation response identifier',
  )
  return { creationId }
}

/**
 * Parse an Instagram /media_publish response. The Graph endpoint returns
 * `{ "id": "<ig_media_id>" }` on success.
 */
export const parseInstagramMediaPublishResponse = (
  value: unknown,
): InstagramMediaPublishResponse => {
  const record = requireRecord(value)
  if (!record) throw new Error('Meta Instagram media publish response is invalid')
  const igMediaIdCandidate = readExactString(record, 'id')
  if (!igMediaIdCandidate) {
    throw new Error('Meta Instagram media publish response requires an ig media id')
  }
  const igMediaId = requireMetaIdentifier(igMediaIdCandidate, 'Instagram media response identifier')
  return { igMediaId }
}

/**
 * Parse an Instagram container status response. Only the five documented
 * `status_code` values are accepted; everything else is rejected with a
 * sanitized message that never echoes the provider payload.
 */
export const parseInstagramContainerStatusResponse = (
  value: unknown,
): InstagramContainerStatusResponse => {
  const record = requireRecord(value)
  if (!record) throw new Error('Meta Instagram container status response is invalid')
  const statusCode = record.status_code
  if (
    typeof statusCode !== 'string' ||
    !INSTAGRAM_MEDIA_STATUS_CODES.includes(statusCode as InstagramMediaStatusCode)
  ) {
    throw new Error('Meta Instagram container status code is not allowed')
  }
  return { statusCode: statusCode as InstagramMediaStatusCode }
}
