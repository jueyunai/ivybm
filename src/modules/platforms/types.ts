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
  idempotencyKey: string
  platform: PublishingPlatform
  scheduledFor?: string
  text: string
}

export type PlatformPublishAcceptance =
  | {
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
  externalPublicationId?: string
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

export const platformTimestamp = (value: number, unit: 'milliseconds' | 'seconds'): string => {
  const timestamp = unit === 'seconds' ? value * 1_000 : value
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    throw new Error('Platform event timestamp is invalid')
  }

  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) throw new Error('Platform event timestamp is invalid')
  return date.toISOString()
}
