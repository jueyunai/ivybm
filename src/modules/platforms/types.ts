import { createHash } from 'node:crypto'

export type PlatformFamily = 'linkedin' | 'meta' | 'tiktok'

export type MessagingPlatform = 'facebook-messenger' | 'instagram' | 'tiktok'

export type PublishingPlatform = 'facebook' | 'instagram' | 'linkedin'

export type PlatformAvailability = 'available' | 'blocked' | 'conditional'

export type PublishingMode = 'assisted' | 'automatic'

/**
 * Stable, credential-free error taxonomy consumed by the Task 12 publishing UI.
 * Provider-specific response bodies stay inside the later platform adapter.
 */
export const PLATFORM_PUBLISH_ERROR_CODES = [
  'account_not_connected',
  'authorization_required',
  'invalid_request',
  'permission_required',
  'platform_blocked',
  'provider_unavailable',
  'rate_limited',
  'unknown',
] as const

// `unknown` means the provider may already have accepted the request. Until a
// real adapter proves provider idempotency or lookup evidence, it must be
// surfaced as non-retryable for manual reconciliation.

export type PlatformPublishErrorCode = (typeof PLATFORM_PUBLISH_ERROR_CODES)[number]

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

export type PublicationAsset = {
  fileName: string
  id: string
  mimeType: string
  sourceUrl?: string
}

export type PlatformCapability = {
  availability: PlatformAvailability
  modes: PublishingMode[]
  platform: PublishingPlatform
  reason?: string
}

export type PlatformPublishRequest = {
  assets: PublicationAsset[]
  /** Stable caller command key. Idempotency is scoped to one target platform. */
  idempotencyKey: string
  platform: PublishingPlatform
  scheduledFor?: string
  text: string
}

export type PlatformPublishAcceptance =
  | {
      /**
       * Stable adapter-issued correlation handle (normally a provider publication
       * or asynchronous job ID) that can be passed back to `getStatus`. This is
       * never a Task 12 persistence primary key.
       */
      externalPublicationId: string
      idempotencyKey: string
      platform: PublishingPlatform
      status: 'accepted'
    }
  | {
      errorCode: PlatformPublishErrorCode
      idempotencyKey: string
      platform: PublishingPlatform
      retryable: boolean
      status: 'blocked'
    }

type PlatformPublicationStatusBase = {
  /** The same adapter-issued handle supplied to `getStatus`. */
  externalPublicationId: string
  platform: PublishingPlatform
}

export type PlatformPublicationStatus =
  | (PlatformPublicationStatusBase & {
      errorCode: PlatformPublishErrorCode
      retryable: boolean
      status: 'failed'
    })
  | (PlatformPublicationStatusBase & {
      errorCode?: never
      retryable?: never
      status: 'pending' | 'published' | 'publishing'
    })

export type AssistedPublicationExport = {
  assets: PublicationAsset[]
  checklist: string[]
  copyText: string
  mode: 'assisted'
  platform: 'linkedin'
}

/**
 * A caller-resolved media asset used to create the LinkedIn manual-delivery ZIP.
 * The package builder never fetches `sourceUrl`; the caller must explicitly supply
 * already-authorized bytes from the internal media layer.
 */
export type AssistedPublicationPackageAsset = PublicationAsset & {
  bytes: Uint8Array
}

/** A browser or route can expose these bytes as a deterministic file download. */
export type AssistedPublicationPackage = {
  bytes: Uint8Array
  fileName: string
  mimeType: 'application/zip'
  mode: 'assisted'
  platform: 'linkedin'
}

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
