export const PUBLISHING_PLATFORMS = ['facebook', 'instagram', 'linkedin'] as const

export type PublishingPlatform = (typeof PUBLISHING_PLATFORMS)[number]
export type PlatformAvailability = 'available' | 'blocked' | 'conditional'
export type PublishingMode = 'assisted' | 'automatic'
export type PlatformAccountId = number | string

export const PLATFORM_PUBLISH_ERROR_CODES = [
  'account_not_connected',
  'authorization_required',
  'delivery_unknown',
  'invalid_request',
  'permission_required',
  'platform_blocked',
  'provider_unavailable',
  'rate_limited',
] as const

export type PlatformPublishErrorCode = (typeof PLATFORM_PUBLISH_ERROR_CODES)[number]
export type ConfirmedPlatformPublishErrorCode = Exclude<
  PlatformPublishErrorCode,
  'delivery_unknown'
>

export const MAX_PUBLICATION_ASSETS = 100
export const MAX_PUBLICATION_ASSET_ID_BYTES = 240
export const MAX_PUBLICATION_FILE_NAME_BYTES = 255
export const MAX_PUBLICATION_IDEMPOTENCY_KEY_BYTES = 200
export const MAX_PUBLICATION_MIME_TYPE_BYTES = 120
export const MAX_PUBLICATION_SOURCE_URL_BYTES = 2_048
export const MAX_PUBLICATION_TEXT_CODE_POINTS = 3_000
export const MAX_PUBLICATION_TEXT_UTF8_BYTES = 12_000
export const MAX_PLATFORM_ACCOUNT_ID_BYTES = 200

export type PublicationAsset = {
  fileName: string
  /** Stable internal asset identity. It must not change when a delivery URL is refreshed. */
  id: string
  mimeType: string
  /** Optional immutable content identity used to detect content replacement under the same ID. */
  sha256?: string
  /** Ephemeral transport location. Signed query data is preserved; fragments are removed. */
  sourceUrl?: string
}

export type AssistedPublicationAsset = Omit<PublicationAsset, 'sourceUrl'>

/** Caller-resolved media; the service never accepts or fetches an external URL. */
export type AssistedPublicationPackageAsset = AssistedPublicationAsset & {
  bytes: Uint8Array
}

export type AssistedPublicationExport = {
  assets: AssistedPublicationAsset[]
  checklist: string[]
  copyText: string
  mode: 'assisted'
  platform: 'linkedin'
}

/** A browser or protected route can expose these bytes as a deterministic download. */
export type AssistedPublicationPackage = {
  bytes: Uint8Array
  fileName: string
  mimeType: 'application/zip'
  mode: 'assisted'
  platform: 'linkedin'
}

export type PlatformCapabilityQuery = {
  platform: PublishingPlatform
  platformAccountId: PlatformAccountId
}

export type PlatformCapability = PlatformCapabilityQuery & {
  availability: PlatformAvailability
  modes: PublishingMode[]
  reason?: string
}

export type PlatformPublishRequest = PlatformCapabilityQuery & {
  assets: PublicationAsset[]
  /** Stable caller command key, scoped to one platform account. */
  idempotencyKey: string
  scheduledFor?: string
  text: string
}

type PlatformPublicationCommand = PlatformCapabilityQuery & {
  idempotencyKey: string
}

export type AcceptedPlatformPublication = PlatformPublicationCommand & {
  /** Adapter correlation handle; never a Task 12 persistence primary key. */
  externalPublicationId: string
  status: 'accepted'
}

export type BlockedPlatformPublication = PlatformPublicationCommand & {
  errorCode: ConfirmedPlatformPublishErrorCode
  retryable: boolean
  status: 'blocked'
}

export type DeliveryUnknownPlatformPublication = PlatformPublicationCommand & {
  /** The request crossed the send boundary; do not retry without reconciliation evidence. */
  errorCode: 'delivery_unknown'
  externalPublicationId?: string
  retryable: false
  status: 'delivery_unknown'
}

export type FailedPlatformPublication = PlatformPublicationCommand & {
  errorCode: ConfirmedPlatformPublishErrorCode
  externalPublicationId?: string
  retryable: boolean
  status: 'failed'
}

export type PlatformPublishAcceptance =
  | AcceptedPlatformPublication
  | BlockedPlatformPublication
  | DeliveryUnknownPlatformPublication
  | FailedPlatformPublication

export type PlatformPublicationStatusLookup = PlatformPublicationCommand & {
  externalPublicationId?: string
}

export type PlatformPublicationStatus =
  | DeliveryUnknownPlatformPublication
  | FailedPlatformPublication
  | (PlatformPublicationCommand & {
      externalPublicationId: string
      status: 'pending' | 'published' | 'publishing'
    })

export type AssistedPublicationRequest = {
  assets: AssistedPublicationPackageAsset[]
  platform: 'linkedin'
  platformAccountId: PlatformAccountId
  text: string
}

export type PreparedAssistedPublication = {
  artifact: AssistedPublicationPackage
  manifest: AssistedPublicationExport
  mode: 'assisted'
  platform: 'linkedin'
  platformAccountId: PlatformAccountId
  status: 'prepared'
}

export type BlockedAssistedPublication = PlatformCapabilityQuery & {
  errorCode: 'invalid_request' | 'platform_blocked'
  mode: 'assisted'
  retryable: false
  status: 'blocked'
}

export type AssistedPublicationPreparation =
  | BlockedAssistedPublication
  | PreparedAssistedPublication

export interface PublishingService {
  getCapability(input: PlatformCapabilityQuery): Promise<PlatformCapability>
  /** Query by the account-scoped command key; the provider handle is an optional cross-check. */
  getStatus(input: PlatformPublicationStatusLookup): Promise<PlatformPublicationStatus>
  /**
   * Reusing a key never implies a new provider attempt after accepted, failed, or
   * delivery_unknown. A confirmed retryable pre-send failure may reuse the key;
   * retrying a recorded failed command requires a new caller command key.
   */
  publish(request: PlatformPublishRequest): Promise<PlatformPublishAcceptance>
  /** Build a local LinkedIn fallback package without any provider or network call. */
  prepareAssistedPublication(
    request: AssistedPublicationRequest,
  ): Promise<AssistedPublicationPreparation>
}

export class PublishingContractValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PublishingContractValidationError'
  }
}

const encoder = new TextEncoder()

const utf8Length = (value: string): number => encoder.encode(value).byteLength

const hasLoneSurrogate = (value: string): boolean => {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1)
      if (next < 0xdc00 || next > 0xdfff) return true
      index += 1
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true
    }
  }
  return false
}

const requireRecord = (value: unknown, name: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new PublishingContractValidationError(`${name} must be an object`)
  }
  return value as Record<string, unknown>
}

const boundedText = (
  value: unknown,
  name: string,
  maxBytes: number,
  { lowercase = false }: { lowercase?: boolean } = {},
): string => {
  if (typeof value !== 'string') {
    throw new PublishingContractValidationError(`${name} must be a string`)
  }
  const normalized = value.trim().normalize('NFC')
  if (!normalized || hasLoneSurrogate(normalized) || utf8Length(normalized) > maxBytes) {
    throw new PublishingContractValidationError(`${name} is invalid or too long`)
  }
  return lowercase ? normalized.toLowerCase() : normalized
}

export const normalizePublishingPlatform = (value: unknown): PublishingPlatform => {
  if (!PUBLISHING_PLATFORMS.includes(value as PublishingPlatform)) {
    throw new PublishingContractValidationError('Publishing platform is unsupported')
  }
  return value as PublishingPlatform
}

export const normalizePlatformAccountId = (value: unknown): PlatformAccountId => {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new PublishingContractValidationError('Platform account ID is invalid')
    }
    return value
  }
  if (typeof value !== 'string') {
    throw new PublishingContractValidationError('Platform account ID is invalid')
  }
  const normalized = value.trim().normalize('NFC')
  if (
    !normalized ||
    normalized !== value ||
    hasLoneSurrogate(normalized) ||
    utf8Length(normalized) > MAX_PLATFORM_ACCOUNT_ID_BYTES
  ) {
    throw new PublishingContractValidationError('Platform account ID is invalid')
  }
  return normalized
}

export const normalizePublicationIdempotencyKey = (value: unknown): string => {
  if (typeof value !== 'string') {
    throw new PublishingContractValidationError('Publishing idempotency key must be a string')
  }
  const normalized = value.trim().normalize('NFC')
  if (
    !normalized ||
    normalized !== value ||
    hasLoneSurrogate(normalized) ||
    utf8Length(normalized) > MAX_PUBLICATION_IDEMPOTENCY_KEY_BYTES
  ) {
    throw new PublishingContractValidationError('Publishing idempotency key is invalid or too long')
  }
  return normalized
}

export const normalizePublicationSourceURL = (value: unknown): string => {
  if (typeof value !== 'string' || hasLoneSurrogate(value)) {
    throw new PublishingContractValidationError('Publication asset source URL is invalid')
  }
  const trimmed = value.trim()
  if (!trimmed || utf8Length(trimmed) > MAX_PUBLICATION_SOURCE_URL_BYTES) {
    throw new PublishingContractValidationError('Publication asset source URL is invalid or too long')
  }
  try {
    const url = new URL(trimmed)
    if (url.protocol !== 'https:' || url.username || url.password) {
      throw new PublishingContractValidationError('Publication asset source URL must be HTTPS')
    }
    url.hash = ''
    const normalized = url.toString()
    if (utf8Length(normalized) > MAX_PUBLICATION_SOURCE_URL_BYTES) {
      throw new PublishingContractValidationError('Publication asset source URL is too long')
    }
    return normalized
  } catch (error) {
    if (error instanceof PublishingContractValidationError) throw error
    throw new PublishingContractValidationError('Publication asset source URL is invalid')
  }
}

export const normalizePublicationAsset = (value: unknown): PublicationAsset => {
  const candidate = requireRecord(value, 'Publication asset')
  const id = boundedText(candidate.id, 'Publication asset ID', MAX_PUBLICATION_ASSET_ID_BYTES)
  const fileName = boundedText(
    candidate.fileName,
    'Publication asset file name',
    MAX_PUBLICATION_FILE_NAME_BYTES,
  )
  const mimeType = boundedText(
    candidate.mimeType,
    'Publication asset MIME type',
    MAX_PUBLICATION_MIME_TYPE_BYTES,
    { lowercase: true },
  )
  const sha256 =
    candidate.sha256 === undefined
      ? undefined
      : boundedText(candidate.sha256, 'Publication asset SHA-256', 64, { lowercase: true })
  if (sha256 !== undefined && !/^[a-f0-9]{64}$/.test(sha256)) {
    throw new PublishingContractValidationError('Publication asset SHA-256 is invalid')
  }
  const sourceUrl =
    candidate.sourceUrl === undefined
      ? undefined
      : normalizePublicationSourceURL(candidate.sourceUrl)
  return {
    fileName,
    id,
    mimeType,
    ...(sha256 ? { sha256 } : {}),
    ...(sourceUrl ? { sourceUrl } : {}),
  }
}

export const normalizePublicationAssets = (value: unknown): PublicationAsset[] => {
  if (!Array.isArray(value) || value.length > MAX_PUBLICATION_ASSETS) {
    throw new PublishingContractValidationError(
      `Publication assets must contain at most ${MAX_PUBLICATION_ASSETS} items`,
    )
  }
  const assets = value.map(normalizePublicationAsset)
  const ids = new Set<string>()
  for (const asset of assets) {
    if (ids.has(asset.id)) {
      throw new PublishingContractValidationError('Publication asset IDs must be unique')
    }
    ids.add(asset.id)
  }
  return assets
}

export const normalizePublicationText = (value: unknown): string => {
  if (typeof value !== 'string') {
    throw new PublishingContractValidationError('Publication text must be a string')
  }
  const normalized = value.replace(/\r\n?/g, '\n').trim().normalize('NFC')
  if (
    !normalized ||
    hasLoneSurrogate(normalized) ||
    Array.from(normalized).length > MAX_PUBLICATION_TEXT_CODE_POINTS ||
    utf8Length(normalized) > MAX_PUBLICATION_TEXT_UTF8_BYTES
  ) {
    throw new PublishingContractValidationError('Publication text is invalid or too long')
  }
  return normalized
}

export const normalizePlatformCapabilityQuery = (value: unknown): PlatformCapabilityQuery => {
  const candidate = requireRecord(value, 'Publishing capability query')
  return {
    platform: normalizePublishingPlatform(candidate.platform),
    platformAccountId: normalizePlatformAccountId(candidate.platformAccountId),
  }
}

export const normalizePlatformPublishRequest = (value: unknown): PlatformPublishRequest => {
  const candidate = requireRecord(value, 'Publish request')
  const base = normalizePlatformCapabilityQuery(candidate)
  const scheduledFor =
    candidate.scheduledFor === undefined
      ? undefined
      : (() => {
          if (typeof candidate.scheduledFor !== 'string') {
            throw new PublishingContractValidationError('Scheduled publication time is invalid')
          }
          const milliseconds = Date.parse(candidate.scheduledFor)
          if (!Number.isFinite(milliseconds)) {
            throw new PublishingContractValidationError('Scheduled publication time is invalid')
          }
          return new Date(milliseconds).toISOString()
        })()
  return {
    ...base,
    assets: normalizePublicationAssets(candidate.assets),
    idempotencyKey: normalizePublicationIdempotencyKey(candidate.idempotencyKey),
    ...(scheduledFor ? { scheduledFor } : {}),
    text: normalizePublicationText(candidate.text),
  }
}

export const normalizeAssistedPublicationRequest = (
  value: unknown,
): AssistedPublicationRequest => {
  const candidate = requireRecord(value, 'Assisted publication request')
  const base = normalizePlatformCapabilityQuery(candidate)
  if (base.platform !== 'linkedin') {
    throw new PublishingContractValidationError('Assisted publishing is only supported for LinkedIn')
  }
  if (!Array.isArray(candidate.assets) || candidate.assets.length > MAX_PUBLICATION_ASSETS) {
    throw new PublishingContractValidationError(
      `Assisted publication assets must contain at most ${MAX_PUBLICATION_ASSETS} items`,
    )
  }
  const rawAssets = candidate.assets.map((value) => {
    const asset = requireRecord(value, 'Assisted publication asset')
    if ('sourceUrl' in asset) {
      throw new PublishingContractValidationError(
        'Assisted publication assets must not include sourceUrl',
      )
    }
    if (!(asset.bytes instanceof Uint8Array)) {
      throw new PublishingContractValidationError(
        'Assisted publication assets require Uint8Array bytes',
      )
    }
    return asset
  })
  const assets = normalizePublicationAssets(
    rawAssets.map(({ fileName, id, mimeType, sha256 }) => ({ fileName, id, mimeType, sha256 })),
  ).map((asset, index) => ({ ...asset, bytes: rawAssets[index].bytes as Uint8Array }))
  return {
    assets,
    platform: 'linkedin',
    platformAccountId: base.platformAccountId,
    text: normalizePublicationText(candidate.text),
  }
}

export const normalizePlatformPublicationStatusLookup = (
  value: unknown,
): PlatformPublicationStatusLookup => {
  const candidate = requireRecord(value, 'Publication status lookup')
  const base = normalizePlatformCapabilityQuery(candidate)
  const externalPublicationId =
    candidate.externalPublicationId === undefined
      ? undefined
      : boundedText(candidate.externalPublicationId, 'External publication ID', 240)
  return {
    ...base,
    idempotencyKey: normalizePublicationIdempotencyKey(candidate.idempotencyKey),
    ...(externalPublicationId ? { externalPublicationId } : {}),
  }
}
