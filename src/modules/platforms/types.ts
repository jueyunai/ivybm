import { createHash } from 'node:crypto'

export {
  MAX_PUBLICATION_ASSETS,
  MAX_PUBLICATION_ASSET_ID_BYTES,
  MAX_PUBLICATION_FILE_NAME_BYTES,
  MAX_PUBLICATION_IDEMPOTENCY_KEY_BYTES,
  MAX_PUBLICATION_MIME_TYPE_BYTES,
  MAX_PUBLICATION_SOURCE_URL_BYTES,
  MAX_PUBLICATION_TEXT_CODE_POINTS,
  MAX_PUBLICATION_TEXT_UTF8_BYTES,
  MAX_PLATFORM_ACCOUNT_ID_BYTES,
  PLATFORM_PUBLISH_ERROR_CODES,
  PUBLISHING_PLATFORMS,
  PublishingContractValidationError,
  normalizeAssistedPublicationRequest,
  normalizePlatformAccountId,
  normalizePlatformCapabilityQuery,
  normalizePlatformPublicationStatusLookup,
  normalizePlatformPublishRequest,
  normalizePublicationAsset,
  normalizePublicationAssets,
  normalizePublicationIdempotencyKey,
  normalizePublicationSourceURL,
  normalizePublicationText,
  normalizePublishingPlatform,
} from '../publishing/contracts'
export type {
  AcceptedPlatformPublication,
  AssistedPublicationAsset,
  AssistedPublicationExport,
  AssistedPublicationPackage,
  AssistedPublicationPackageAsset,
  AssistedPublicationPreparation,
  AssistedPublicationRequest,
  BlockedPlatformPublication,
  BlockedAssistedPublication,
  ConfirmedPlatformPublishErrorCode,
  DeliveryUnknownPlatformPublication,
  FailedPlatformPublication,
  PlatformAccountId,
  PlatformAvailability,
  PlatformCapability,
  PlatformCapabilityQuery,
  PlatformPublicationStatus,
  PlatformPublicationStatusLookup,
  PlatformPublishAcceptance,
  PlatformPublishErrorCode,
  PlatformPublishRequest,
  PreparedAssistedPublication,
  PublicationAsset,
  PublishingMode,
  PublishingPlatform,
  PublishingService,
} from '../publishing/contracts'

export type PlatformFamily = 'linkedin' | 'meta' | 'tiktok'

export type MessagingPlatform = 'facebook-messenger' | 'instagram' | 'tiktok'

export type NormalizedAttachment = {
  caption?: string
  externalId?: string
  fileName?: string
  mimeType?: string
  sha256?: string
  type: string
  url?: string
}

export type NormalizedMessageContent = {
  attachments?: NormalizedAttachment[]
  messageType: string
  text?: string
}

type NormalizedEventBase = {
  accountExternalId: string
  externalEventId: string
  idempotencyKey: string
  occurredAt: string
  platform: MessagingPlatform
}

export type NormalizedInboundMessage = NormalizedEventBase & {
  contactName?: string
  content: NormalizedMessageContent
  kind: 'inbound-message'
  recipientExternalId: string
  senderExternalId: string
}

export type NormalizedMessageStatus = NormalizedEventBase & {
  errors?: Array<{ code?: string; message: string; title?: string }>
  kind: 'message-status'
  messageExternalId: string
  recipientExternalId: string
  status: 'delivered' | 'failed' | 'read' | 'sent'
}

export type NormalizedPlatformEvent = NormalizedInboundMessage | NormalizedMessageStatus

export const MAX_PLATFORM_EVENT_IDEMPOTENCY_KEY_LENGTH = 200

/**
 * Provider attachment links commonly carry short-lived signatures in their query
 * string. This connector stage never downloads attachments, so persisting those
 * credentials would add risk without providing a delivery capability. Keep only
 * an HTTPS origin and path for bounded operator context.
 */
export const sanitizeExternalAttachmentURL = (value: string): string | undefined => {
  try {
    const url = new URL(value.trim())
    if (url.protocol !== 'https:' || url.username || url.password) return undefined
    url.hash = ''
    url.search = ''
    return url.toString()
  } catch {
    return undefined
  }
}

export const platformEventKey = (platform: MessagingPlatform, externalEventId: string): string => {
  const normalizedEventID = externalEventId.trim()
  if (!normalizedEventID) throw new Error('Platform external event ID is required')
  const key = `${platform}:${normalizedEventID}`
  if (key.length > MAX_PLATFORM_EVENT_IDEMPOTENCY_KEY_LENGTH) {
    throw new Error('Platform external event ID is too long')
  }
  return key
}

/**
 * New external events must be scoped to the connected provider account as well
 * as the provider event ID. The old key remains exported only so the worker can
 * execute pre-upgrade Jobs; new ingress and durable queue writes must use v2,
 * because v1 cannot safely identify an event across two accounts when the
 * provider has not documented global ID scope.
 */
export const platformEventKeyV2 = (
  platform: MessagingPlatform,
  accountExternalId: string,
  externalEventId: string,
): string => {
  const normalizedAccountID = accountExternalId.trim()
  const normalizedEventID = externalEventId.trim()
  if (!normalizedAccountID) throw new Error('Platform account external ID is required')
  if (!normalizedEventID) throw new Error('Platform external event ID is required')
  if (normalizedAccountID !== accountExternalId || normalizedEventID !== externalEventId) {
    throw new Error('Platform event identity must not contain surrounding whitespace')
  }

  const fingerprint = createHash('sha256')
    .update(`${platform}\u0000${normalizedAccountID}\u0000${normalizedEventID}`)
    .digest('hex')
  const key = `platform-event:v2:${platform}:${fingerprint}`
  if (key.length > MAX_PLATFORM_EVENT_IDEMPOTENCY_KEY_LENGTH) {
    throw new Error('Platform event ID is too long')
  }
  return key
}

export const isPlatformEventKeyV2 = (
  platform: MessagingPlatform,
  accountExternalId: string,
  externalEventId: string,
  idempotencyKey: string,
): boolean => {
  try {
    return idempotencyKey === platformEventKeyV2(platform, accountExternalId, externalEventId)
  } catch {
    return false
  }
}

/** Accept v1 only for already-persisted Jobs; connectors must emit v2. */
export const isRecognizedPlatformEventKey = (
  platform: MessagingPlatform,
  accountExternalId: string,
  externalEventId: string,
  idempotencyKey: string,
): boolean =>
  idempotencyKey === platformEventKey(platform, externalEventId) ||
  isPlatformEventKeyV2(platform, accountExternalId, externalEventId, idempotencyKey)

export const platformTimestamp = (value: number, unit: 'milliseconds' | 'seconds'): string => {
  const timestamp = unit === 'seconds' ? value * 1_000 : value
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    throw new Error('Platform event timestamp is invalid')
  }

  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) throw new Error('Platform event timestamp is invalid')
  return date.toISOString()
}
