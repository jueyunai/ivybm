import { createHash } from 'node:crypto'

import type { HandoffStatus } from '../conversations/contracts'

export type PlatformFamily = 'linkedin' | 'meta' | 'tiktok'

export type MessagingPlatform = 'facebook-messenger' | 'instagram' | 'tiktok'

export const MESSAGING_PLATFORMS: readonly MessagingPlatform[] = [
  'facebook-messenger',
  'instagram',
  'tiktok',
]

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
