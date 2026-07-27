import { createHash } from 'node:crypto'

import type { HandoffStatus } from '../conversations/contracts'

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

export const MESSAGING_PLATFORMS: readonly MessagingPlatform[] = [
  'facebook-messenger',
  'instagram',
  'tiktok',
]
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

/**
 * Stable, credential-free error taxonomy for phase-one automatic conversation
 * replies. `handoff_required` and `message_window_closed` are conversation
 * specific; the rest mirror the publishing taxonomy so operators learn one set.
 */
export const PLATFORM_CONVERSATION_OUTBOUND_ERROR_CODES = [
  'account_not_connected',
  'authorization_required',
  'handoff_required',
  'invalid_request',
  'message_window_closed',
  'permission_required',
  'platform_blocked',
  'provider_unavailable',
  'rate_limited',
  'unknown',
] as const

export type PlatformConversationOutboundErrorCode =
  (typeof PLATFORM_CONVERSATION_OUTBOUND_ERROR_CODES)[number]

/**
 * Server-only, credential-free command to deliver one automatic conversation
 * reply. The deliveryKey is the idempotency anchor scoped by platform and
 * account; the adapter never sees tokens or conversation internals.
 */
export type PlatformConversationOutboundRequest = {
  accountExternalId: string
  deliveryKey: string
  externalThreadId: string
  /**
   * Authoritative snapshot freshly loaded by ConversationService immediately
   * before this send. A worker must not reuse the status captured at enqueue.
   */
  handoffStatus: HandoffStatus
  platform: MessagingPlatform
  recipientExternalId: string
  text: string
}

type PlatformConversationOutboundResultBase = {
  deliveryKey: string
  platform: MessagingPlatform
}

/**
 * Acceptance-only outcome: a reply is accepted (or a known duplicate) or it is
 * blocked with a machine-readable reason. There is deliberately no `sent` or
 * `delivered` state; a future reviewed provider-status callback must record
 * verified delivery separately.
 */
type PlatformConversationOutboundBlockedResult = PlatformConversationOutboundResultBase & {
  errorCode: PlatformConversationOutboundErrorCode
  status: 'blocked'
} & (
    | { retryAfterSeconds?: never; retryable: false }
    | { retryAfterSeconds?: number; retryable: true }
  )

export type PlatformConversationOutboundResult =
  | (PlatformConversationOutboundResultBase & {
      status: 'accepted' | 'duplicate'
    })
  | PlatformConversationOutboundBlockedResult

/**
 * A worker may lose its own result after a provider accepts a delivery. These
 * actions tell the delivery service how it may safely converge; they do not
 * assert that a customer has received a message.
 */
export const PLATFORM_CONVERSATION_OUTBOUND_RECOVERY_ACTIONS = [
  'delivery_unknown',
  'provider_accepted',
  'retry_same_delivery_key',
] as const

export type PlatformConversationOutboundRecoveryAction =
  (typeof PLATFORM_CONVERSATION_OUTBOUND_RECOVERY_ACTIONS)[number]

declare const PROVIDER_ACCEPTANCE_EVIDENCE: unique symbol

/**
 * A non-empty, opaque reference returned by a provider lookup. Adapters must
 * construct it only from provider-issued acceptance evidence, never from an
 * internal delivery key.
 */
export type ProviderAcceptanceEvidence = string & {
  readonly [PROVIDER_ACCEPTANCE_EVIDENCE]: true
}

/**
 * Narrow an externally returned provider reference before a recovery result
 * can claim provider acceptance. Empty or whitespace-only evidence must fail
 * closed to `delivery_unknown`.
 */
export const createProviderAcceptanceEvidence = ({
  deliveryKey,
  providerReference,
}: {
  deliveryKey: unknown
  providerReference: unknown
}): ProviderAcceptanceEvidence | undefined => {
  if (typeof deliveryKey !== 'string' || typeof providerReference !== 'string') return undefined
  const normalizedReference = providerReference.trim()
  return normalizedReference && normalizedReference !== deliveryKey.trim()
    ? (normalizedReference as ProviderAcceptanceEvidence)
    : undefined
}

export type PlatformConversationOutboundRecoveryResult =
  | (PlatformConversationOutboundResultBase & {
      providerReference?: never
      status: 'delivery_unknown' | 'retry_same_delivery_key'
    })
  | (PlatformConversationOutboundResultBase & {
      /**
       * Opaque provider-issued acceptance evidence obtained by an explicit
       * lookup. It is not the internal deliveryKey and does not claim that the
       * recipient has received the message.
       */
      providerReference: ProviderAcceptanceEvidence
      status: 'provider_accepted'
    })

/**
 * Automatic platform replies are only allowed while the authoritative
 * conversation state machine keeps the AI in charge.
 */
export const isAutomaticPlatformConversationReplyAllowed = (status: HandoffStatus): boolean =>
  status === 'ai_active'
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
