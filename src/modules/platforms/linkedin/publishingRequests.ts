/**
 * Pure, credential-free builders and parsers for the LinkedIn Posts / Images
 * API operations that this codebase issues from the publishing adapter. None of
 * the exported functions perform network I/O, read configuration, or carry
 * access tokens through inputs or outputs. The surrounding adapter is
 * responsible for attaching the bearer token to the request envelope at
 * dispatch time; this module only describes the body, path, and protocol
 * headers that the LinkedIn endpoint must receive.
 *
 * Endpoint reference (LinkedIn API, verified 2026-07-26):
 * - POST /rest/posts with author URN
 *     (urn:li:person:<id> or urn:li:organization:<digits>),
 *     commentary, visibility PUBLIC,
 *     distribution {feedDistribution:'MAIN_FEED',
 *                   targetEntities:[],
 *                   thirdPartyDistributionChannels:[]},
 *     lifecycleState PUBLISHED, isReshareDisabledByAuthor false.
 *     Image posts add content.media.id = urn:li:image:<opaque-id> and optional
 *     altText. Success is 201 with the x-restli-id response header.
 * - GET /rest/posts/{URL-encoded post URN} returns lifecycleState, etc.
 * - POST /rest/images?action=initializeUpload with body
 *     {initializeUploadRequest:{owner:<person or organization URN>}}.
 *     Response {value:{uploadUrl, uploadUrlExpiresAt, image:'urn:li:image:<opaque-id>'}}.
 *     The Images API links to the official Vector Assets upload instructions,
 *     which require PUT to the returned uploadUrl. The credential-bearing
 *     Authorization header remains the responsibility of the transport
 *     adapter and is never represented by these pure helpers.
 *
 * Required headers for every JSON request:
 *   Linkedin-Version: YYYYMM
 *   X-Restli-Protocol-Version: 2.0.0
 *   Content-Type: application/json
 *
 * No idempotency support or provider lookup by IVYBM idempotencyKey is proven
 * for any of these endpoints. These helpers therefore MUST NOT be used to
 * implement a blind retry after an unknown transport outcome. The adapter that
 * consumes this module must fence the command before network I/O and stop for
 * manual reconciliation when it cannot prove whether the provider accepted it.
 */

export type LinkedInVisibility = 'PUBLIC'

export type LinkedInLifecycleState = 'PUBLISHED'

export type LinkedInFeedDistribution = 'MAIN_FEED'

export type LinkedInHeaders = Readonly<Record<string, string>>

export type LinkedInPublishingHttpRequest = {
  body?: Record<string, unknown>
  headers?: LinkedInHeaders
  method: 'GET' | 'POST'
  path: string
  query?: Record<string, string>
}

export type LinkedInAuthorUrnInput =
  { kind: 'person'; personId: string } | { kind: 'organization'; organizationId: string }

export type LinkedInTextPostRequestInput = {
  author: LinkedInAuthorUrnInput
  commentary: string
  linkedInVersion: string
}

export type LinkedInImageMediaInput = {
  altText?: string
  imageUrn: string
}

export type LinkedInImagePostRequestInput = {
  author: LinkedInAuthorUrnInput
  commentary: string
  image: LinkedInImageMediaInput
  linkedInVersion: string
}

export type LinkedInImageInitializeUploadRequestInput = {
  author: LinkedInAuthorUrnInput
  linkedInVersion: string
}

export type LinkedInImageInitializeUploadBody = {
  initializeUploadRequest: {
    owner: string
  }
}

export type LinkedInImageBinaryUploadInput = {
  /**
   * Pre-signed upload URL returned by /rest/images?action=initializeUpload.
   * The Authorization header is deliberately omitted so the payload remains
   * credential-free; the transport adapter attaches it immediately before I/O.
   */
  contentType: string
  bytes: Uint8Array
  /** Provider-issued expiry retained so the transport can re-check it at I/O time. */
  uploadUrlExpiresAt: number
  /** Injectable clock used by the pure pre-dispatch validation. */
  nowMilliseconds?: number
  uploadUrl: string
}

export type LinkedInImageBinaryUploadPayload = Omit<
  LinkedInImageBinaryUploadInput,
  'nowMilliseconds'
> & {
  method: 'PUT'
}

export type LinkedInPostStatusRequestInput = {
  linkedInVersion: string
  postUrn: string
}

export type LinkedInTextPostBody = {
  author: string
  commentary: string
  distribution: {
    feedDistribution: LinkedInFeedDistribution
    targetEntities: []
    thirdPartyDistributionChannels: []
  }
  isReshareDisabledByAuthor: false
  lifecycleState: LinkedInLifecycleState
  visibility: LinkedInVisibility
}

export type LinkedInImagePostBody = LinkedInTextPostBody & {
  content: {
    media: {
      altText?: string
      id: string
    }
  }
}

export type LinkedInPostCreationResponse = {
  postUrn: string
}

export type LinkedInImageInitializeUploadResponse = {
  imageUrn: string
  uploadUrl: string
  uploadUrlExpiresAt: number
}

export type LinkedInPostLifecycleState = 'PUBLISHED' | 'DRAFT' | 'PROCESSING'

export type LinkedInPostStatusResponse = {
  lifecycleState: LinkedInPostLifecycleState
}

const LINKED_IN_PERSON_NAMESPACE = 'urn:li:person:'
const LINKED_IN_ORGANIZATION_NAMESPACE = 'urn:li:organization:'
const LINKED_IN_IMAGE_NAMESPACE = 'urn:li:image:'
const LINKED_IN_POST_NAMESPACE = 'urn:li:share:'
const LINKED_IN_UGC_POST_NAMESPACE = 'urn:li:ugcPost:'

const MAX_LINKED_IN_OPAQUE_ID_LENGTH = 128
const MAX_LINKED_IN_NUMERIC_LENGTH = 32
const MAX_COMMENTARY_LENGTH = 3_000
const MAX_ALT_TEXT_LENGTH = 300
const MAX_VERSION_LENGTH = 6
const MIN_EPOCH_MILLISECONDS = 1_000_000_000_000

const LINKED_IN_RESTLI_PROTOCOL_VERSION = '2.0.0'
const LINKED_IN_JSON_CONTENT_TYPE = 'application/json'
const LINKED_IN_IMAGE_CONTENT_TYPES = new Set(['image/gif', 'image/jpeg', 'image/png'])
const FORBIDDEN_RAW_URL_CHARACTER_PATTERN = /[\u0000-\u0020\u007F]/

const DECIMAL_URN_ID_PATTERN = /^[0-9]+$/
const OPAQUE_URN_ID_PATTERN = /^[A-Za-z0-9_-]+$/
const LINKED_IN_VERSION_PATTERN = /^(\d{4})(\d{2})$/
const LINKED_IN_POST_LIFECYCLE_STATES: readonly LinkedInPostLifecycleState[] = [
  'DRAFT',
  'PROCESSING',
  'PUBLISHED',
]

const requireLinkedInVersion = (value: unknown): string => {
  if (typeof value !== 'string') {
    throw new Error('LinkedIn-Version must be a six-digit YYYYMM string')
  }
  const trimmed = value.trim()
  if (!trimmed.length || trimmed.length !== MAX_VERSION_LENGTH) {
    throw new Error('LinkedIn-Version must be a six-digit YYYYMM string')
  }
  const match = LINKED_IN_VERSION_PATTERN.exec(trimmed)
  if (!match) {
    throw new Error('LinkedIn-Version must be a six-digit YYYYMM string')
  }
  const month = Number(match[2])
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error('LinkedIn-Version month must be between 01 and 12')
  }
  return trimmed
}

const requireDecimalUrnId = (value: unknown, fieldName: string): string => {
  if (
    typeof value !== 'string' ||
    !value.length ||
    value.length > MAX_LINKED_IN_NUMERIC_LENGTH ||
    !DECIMAL_URN_ID_PATTERN.test(value)
  ) {
    throw new Error(`LinkedIn ${fieldName} URN id must be a bounded decimal path segment`)
  }
  return value
}

const requireOpaqueUrnId = (value: unknown, fieldName: string): string => {
  if (
    typeof value !== 'string' ||
    !value.length ||
    value.length > MAX_LINKED_IN_OPAQUE_ID_LENGTH ||
    !OPAQUE_URN_ID_PATTERN.test(value)
  ) {
    throw new Error(`LinkedIn ${fieldName} URN id must be a bounded opaque path segment`)
  }
  return value
}

const authorUrnFromInput = (input: LinkedInAuthorUrnInput | undefined): string => {
  if (!input || typeof input !== 'object') {
    throw new Error('LinkedIn author URN is required')
  }
  if (input.kind === 'person') {
    return `${LINKED_IN_PERSON_NAMESPACE}${requireOpaqueUrnId(input.personId, 'person')}`
  }
  if (input.kind === 'organization') {
    return `${LINKED_IN_ORGANIZATION_NAMESPACE}${requireDecimalUrnId(input.organizationId, 'organization')}`
  }
  throw new Error('LinkedIn author URN is required')
}

const requireImageUrn = (value: unknown): string => {
  if (typeof value !== 'string') {
    throw new Error('LinkedIn image URN is required')
  }
  const trimmed = value.trim()
  if (!trimmed.length) {
    throw new Error('LinkedIn image URN is required')
  }
  if (
    !trimmed.startsWith(LINKED_IN_IMAGE_NAMESPACE) ||
    trimmed.length > LINKED_IN_IMAGE_NAMESPACE.length + MAX_LINKED_IN_OPAQUE_ID_LENGTH
  ) {
    throw new Error('LinkedIn image URN is not allowed')
  }
  const suffix = trimmed.slice(LINKED_IN_IMAGE_NAMESPACE.length)
  if (
    !suffix.length ||
    suffix.length > MAX_LINKED_IN_OPAQUE_ID_LENGTH ||
    !OPAQUE_URN_ID_PATTERN.test(suffix)
  ) {
    throw new Error('LinkedIn image URN is not allowed')
  }
  return trimmed
}

const requireNumericUrnId = (suffix: string): string => {
  if (
    !suffix.length ||
    suffix.length > MAX_LINKED_IN_NUMERIC_LENGTH ||
    !DECIMAL_URN_ID_PATTERN.test(suffix)
  ) {
    throw new Error('LinkedIn URN id must be a bounded decimal path segment')
  }
  return suffix
}

const requirePostUrn = (value: unknown, fieldName: string): string => {
  if (typeof value !== 'string') {
    throw new Error(`LinkedIn ${fieldName} URN is required`)
  }
  const trimmed = value.trim()
  if (!trimmed.length) {
    throw new Error(`LinkedIn ${fieldName} URN is required`)
  }
  const matchedNamespace = trimmed.startsWith(LINKED_IN_POST_NAMESPACE)
    ? LINKED_IN_POST_NAMESPACE
    : trimmed.startsWith(LINKED_IN_UGC_POST_NAMESPACE)
      ? LINKED_IN_UGC_POST_NAMESPACE
      : ''
  if (
    !matchedNamespace ||
    trimmed.length === matchedNamespace.length ||
    trimmed.includes('/') ||
    trimmed.includes('?') ||
    trimmed.includes('#') ||
    trimmed.includes('\\') ||
    trimmed.slice(matchedNamespace.length).includes(':')
  ) {
    throw new Error(`LinkedIn ${fieldName} URN is not allowed`)
  }
  const id = requireNumericUrnId(trimmed.slice(matchedNamespace.length))
  return `${matchedNamespace}${id}`
}

const requireCommentary = (value: unknown): string => {
  if (typeof value !== 'string') {
    throw new Error('LinkedIn commentary must be a string')
  }
  const trimmed = value.trim()
  if (!trimmed.length) {
    throw new Error('LinkedIn commentary must not be empty')
  }
  if (Array.from(trimmed).length > MAX_COMMENTARY_LENGTH) {
    throw new Error(`LinkedIn commentary must be ${MAX_COMMENTARY_LENGTH} characters or fewer`)
  }
  return trimmed
}

const normalizeAltText = (value: unknown): string | undefined => {
  if (value === undefined) return undefined
  if (typeof value !== 'string') {
    throw new Error('LinkedIn image alt text must be a string')
  }
  const trimmed = value.trim()
  if (!trimmed.length) return undefined
  if (Array.from(trimmed).length > MAX_ALT_TEXT_LENGTH) {
    throw new Error(`LinkedIn image alt text must be ${MAX_ALT_TEXT_LENGTH} characters or fewer`)
  }
  return trimmed
}

const requireUploadUrl = (value: unknown): string => {
  if (typeof value !== 'string') {
    throw new Error(
      'LinkedIn image upload URL must be an HTTPS URL without credentials or fragments',
    )
  }
  const trimmed = value.trim()
  if (!trimmed.length || FORBIDDEN_RAW_URL_CHARACTER_PATTERN.test(trimmed)) {
    throw new Error(
      'LinkedIn image upload URL must be an HTTPS URL without credentials or fragments',
    )
  }
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    throw new Error(
      'LinkedIn image upload URL must be an HTTPS URL without credentials or fragments',
    )
  }
  if (
    parsed.protocol !== 'https:' ||
    parsed.username ||
    parsed.password ||
    parsed.hash.length > 0
  ) {
    throw new Error(
      'LinkedIn image upload URL must be an HTTPS URL without credentials or fragments',
    )
  }
  return trimmed
}

const requireBinaryUploadBytes = (value: unknown): Uint8Array => {
  if (!(value instanceof Uint8Array)) {
    throw new Error('LinkedIn image upload bytes must be a Uint8Array')
  }
  if (!value.byteLength) {
    throw new Error('LinkedIn image upload bytes must be non-empty')
  }
  return value
}

const requireUploadExpiry = (value: unknown, nowMilliseconds: unknown): number => {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < MIN_EPOCH_MILLISECONDS ||
    typeof nowMilliseconds !== 'number' ||
    !Number.isSafeInteger(nowMilliseconds) ||
    nowMilliseconds < MIN_EPOCH_MILLISECONDS
  ) {
    throw new Error('LinkedIn image upload expiry timestamp is invalid')
  }
  if (value <= nowMilliseconds) {
    throw new Error('LinkedIn image upload URL has expired')
  }
  return value
}

const requireImageContentType = (value: unknown): string => {
  if (typeof value !== 'string') {
    throw new Error('LinkedIn image upload content type must be JPEG, PNG, or GIF')
  }
  const trimmed = value.trim()
  if (!trimmed.length) {
    throw new Error('LinkedIn image upload content type must be JPEG, PNG, or GIF')
  }
  if (trimmed.length > 128) {
    throw new Error('LinkedIn image upload content type must be JPEG, PNG, or GIF')
  }
  const normalized = trimmed.toLowerCase()
  if (!LINKED_IN_IMAGE_CONTENT_TYPES.has(normalized)) {
    throw new Error('LinkedIn image upload content type must be JPEG, PNG, or GIF')
  }
  return normalized
}

const buildLinkedInJsonHeaders = (linkedInVersion: string): Record<string, string> => ({
  'Content-Type': LINKED_IN_JSON_CONTENT_TYPE,
  'Linkedin-Version': requireLinkedInVersion(linkedInVersion),
  'X-Restli-Protocol-Version': LINKED_IN_RESTLI_PROTOCOL_VERSION,
})

/**
 * Build the credential-free headers for a LinkedIn JSON request. The
 * adapter layer is responsible for adding the bearer token at dispatch
 * time; this function only normalizes the protocol/version/content-type
 * triple and refuses to echo any other input as a header.
 */
export const buildLinkedInJsonRequestHeaders = (input: {
  linkedInVersion: string
}): LinkedInHeaders => {
  const headers = buildLinkedInJsonHeaders(requireLinkedInVersion(input?.linkedInVersion))
  return Object.freeze({ ...headers })
}

const buildLinkedInPostDistribution = (): {
  feedDistribution: LinkedInFeedDistribution
  targetEntities: []
  thirdPartyDistributionChannels: []
} => ({
  feedDistribution: 'MAIN_FEED',
  targetEntities: [],
  thirdPartyDistributionChannels: [],
})

/**
 * Build a credential-free LinkedIn text post request. The adapter is
 * responsible for attaching the bearer token at dispatch time.
 */
export const buildLinkedInTextPostRequest = (
  input: LinkedInTextPostRequestInput,
): LinkedInPublishingHttpRequest => {
  const author = authorUrnFromInput(input?.author)
  const commentary = requireCommentary(input?.commentary)
  const linkedInVersion = requireLinkedInVersion(input?.linkedInVersion)
  const body: LinkedInTextPostBody = {
    author,
    commentary,
    distribution: buildLinkedInPostDistribution(),
    isReshareDisabledByAuthor: false,
    lifecycleState: 'PUBLISHED',
    visibility: 'PUBLIC',
  }

  return {
    body: body as unknown as Record<string, unknown>,
    headers: buildLinkedInJsonHeaders(linkedInVersion),
    method: 'POST',
    path: '/rest/posts',
  }
}

/**
 * Build a credential-free LinkedIn single-image post request. The image
 * must already have been uploaded via /rest/images; this function does
 * not initiate any upload.
 */
export const buildLinkedInImagePostRequest = (
  input: LinkedInImagePostRequestInput,
): LinkedInPublishingHttpRequest => {
  const author = authorUrnFromInput(input?.author)
  const commentary = requireCommentary(input?.commentary)
  const linkedInVersion = requireLinkedInVersion(input?.linkedInVersion)
  const imageUrn = requireImageUrn(input?.image?.imageUrn)
  const altText = normalizeAltText(input?.image?.altText)
  const media: { altText?: string; id: string } = altText
    ? { altText, id: imageUrn }
    : { id: imageUrn }
  const body: LinkedInImagePostBody = {
    author,
    commentary,
    content: { media },
    distribution: buildLinkedInPostDistribution(),
    isReshareDisabledByAuthor: false,
    lifecycleState: 'PUBLISHED',
    visibility: 'PUBLIC',
  }

  return {
    body: body as unknown as Record<string, unknown>,
    headers: buildLinkedInJsonHeaders(linkedInVersion),
    method: 'POST',
    path: '/rest/posts',
  }
}

/**
 * Build a credential-free LinkedIn /rest/images?action=initializeUpload
 * request body. The response contains a pre-signed uploadUrl the adapter
 * will hand back via the binary upload payload type.
 */
export const buildLinkedInImageInitializeUploadRequest = (
  input: LinkedInImageInitializeUploadRequestInput,
): LinkedInPublishingHttpRequest => {
  const author = authorUrnFromInput(input?.author)
  const linkedInVersion = requireLinkedInVersion(input?.linkedInVersion)
  const body: LinkedInImageInitializeUploadBody = {
    initializeUploadRequest: { owner: author },
  }

  return {
    body: body as unknown as Record<string, unknown>,
    headers: buildLinkedInJsonHeaders(linkedInVersion),
    method: 'POST',
    path: '/rest/images',
    query: { action: 'initializeUpload' },
  }
}

/**
 * Validate a candidate LinkedIn image binary upload. This is an opaque
 * payload seam: the adapter supplies the pre-signed uploadUrl from the
 * initializeUpload response, the rendered bytes, and the binary content
 * type. Official LinkedIn upload instructions require PUT; credentials stay
 * outside this value and are attached by the transport adapter.
 */
export const buildLinkedInImageBinaryUploadPayload = (
  input: LinkedInImageBinaryUploadInput,
): LinkedInImageBinaryUploadPayload => {
  const uploadUrl = requireUploadUrl(input?.uploadUrl)
  const bytes = requireBinaryUploadBytes(input?.bytes)
  const contentType = requireImageContentType(input?.contentType)
  const uploadUrlExpiresAt = requireUploadExpiry(
    input?.uploadUrlExpiresAt,
    input?.nowMilliseconds ?? Date.now(),
  )
  return Object.freeze({
    bytes,
    contentType,
    method: 'PUT' as const,
    uploadUrl,
    uploadUrlExpiresAt,
  })
}

/**
 * Build a credential-free LinkedIn GET /rest/posts/{postUrn} status
 * request. The builder URL-encodes the post URN and requests AUTHOR view so
 * pending DRAFT / PROCESSING states remain observable during recovery.
 */
export const buildLinkedInPostStatusRequest = (
  input: LinkedInPostStatusRequestInput,
): LinkedInPublishingHttpRequest => {
  const postUrn = requirePostUrn(input?.postUrn, 'post')
  const linkedInVersion = requireLinkedInVersion(input?.linkedInVersion)

  return {
    headers: buildLinkedInJsonHeaders(linkedInVersion),
    method: 'GET',
    path: `/rest/posts/${encodeURIComponent(postUrn)}`,
    query: { viewContext: 'AUTHOR' },
  }
}

const requireRecord = (value: unknown): Record<string, unknown> | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined
  }
  return value as Record<string, unknown>
}

const readNonEmptyString = (
  record: Record<string, unknown>,
  keys: readonly string[],
): string | undefined => {
  for (const key of keys) {
    const candidate = record[key]
    if (typeof candidate !== 'string') continue
    const trimmed = candidate.trim()
    if (trimmed.length) return trimmed
  }
  return undefined
}

const requireAuthoredPostUrnString = (value: unknown, fieldName: string): string => {
  if (typeof value !== 'string') {
    throw new Error(`LinkedIn ${fieldName} URN is required`)
  }
  const trimmed = value.trim()
  if (!trimmed.length) {
    throw new Error(`LinkedIn ${fieldName} URN is required`)
  }
  const matchedNamespace = trimmed.startsWith(LINKED_IN_POST_NAMESPACE)
    ? LINKED_IN_POST_NAMESPACE
    : trimmed.startsWith(LINKED_IN_UGC_POST_NAMESPACE)
      ? LINKED_IN_UGC_POST_NAMESPACE
      : ''
  if (
    !matchedNamespace ||
    trimmed.length === matchedNamespace.length ||
    trimmed.includes('/') ||
    trimmed.includes('?') ||
    trimmed.includes('#') ||
    trimmed.includes('\\') ||
    trimmed.slice(matchedNamespace.length).includes(':')
  ) {
    throw new Error(`LinkedIn ${fieldName} URN is not allowed`)
  }
  const id = requireNumericUrnId(trimmed.slice(matchedNamespace.length))
  return `${matchedNamespace}${id}`
}

/**
 * Parse the LinkedIn post creation response. The Posts API does not return
 * the post URN in the JSON body on success; the official contract is the
 * 201 status code plus the `x-restli-id` response header. The adapter
 * passes the raw header value in here so callers stay credential-free and
 * transport-agnostic.
 */
export const parseLinkedInPostCreationResponse = (input: {
  xRestliId?: string | null
}): LinkedInPostCreationResponse => {
  const candidate = input?.xRestliId
  if (typeof candidate !== 'string') {
    throw new Error('LinkedIn post creation response is invalid')
  }
  const postUrn = requireAuthoredPostUrnString(candidate, 'post')
  return { postUrn }
}

/**
 * Parse the LinkedIn /rest/images initializeUpload JSON response. The body
 * looks like `{value:{uploadUrl, uploadUrlExpiresAt, image:'urn:li:image:<opaque-id>'}}`.
 */
export const parseLinkedInImageInitializeUploadResponse = (
  value: unknown,
): LinkedInImageInitializeUploadResponse => {
  const record = requireRecord(value)
  if (!record) throw new Error('LinkedIn image initialize upload response is invalid')
  const valueRecord = requireRecord(record.value)
  if (!valueRecord) {
    throw new Error('LinkedIn image initialize upload response is invalid')
  }
  const uploadUrl = readNonEmptyString(valueRecord, ['uploadUrl'])
  if (!uploadUrl) {
    throw new Error('LinkedIn image initialize upload response requires an upload URL')
  }
  const imageUrn = readNonEmptyString(valueRecord, ['image'])
  if (!imageUrn) {
    throw new Error('LinkedIn image initialize upload response requires an image URN')
  }
  requireUploadUrl(uploadUrl)
  requireImageUrn(imageUrn)
  const uploadUrlExpiresAt = valueRecord.uploadUrlExpiresAt
  if (
    typeof uploadUrlExpiresAt !== 'number' ||
    !Number.isSafeInteger(uploadUrlExpiresAt) ||
    uploadUrlExpiresAt < MIN_EPOCH_MILLISECONDS
  ) {
    throw new Error('LinkedIn image initialize upload response requires an expiry timestamp')
  }
  return { imageUrn, uploadUrl, uploadUrlExpiresAt }
}

/**
 * Parse a LinkedIn GET /rest/posts/{postUrn} status response. The
 * lifecycleState is the only documented field for this query and must be
 * one of the published lifecycle states; anything else is rejected with a
 * sanitized message that never echoes the provider payload.
 */
export const parseLinkedInPostStatusResponse = (value: unknown): LinkedInPostStatusResponse => {
  const record = requireRecord(value)
  if (!record) throw new Error('LinkedIn post status response is invalid')
  const lifecycleState = record.lifecycleState
  if (
    typeof lifecycleState !== 'string' ||
    !LINKED_IN_POST_LIFECYCLE_STATES.includes(lifecycleState as LinkedInPostLifecycleState)
  ) {
    throw new Error('LinkedIn post lifecycle state is not allowed')
  }
  return { lifecycleState: lifecycleState as LinkedInPostLifecycleState }
}
