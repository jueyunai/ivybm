import type {
  NormalizedInboundMessage,
  NormalizedMessageStatus,
  NormalizedPlatformEvent,
  PlatformConversationDeliveryClaim,
  PlatformConversationDeliveryClaimResult,
  PlatformConversationDeliveryIntent,
  PlatformConversationDeliveryLeaseFence,
  PlatformConversationDeliveryMarkResult,
  PlatformConversationDeliveryOutcome,
  PlatformConversationOutboundRequest,
  PlatformConversationOutboundRecoveryResult,
  PlatformConversationOutboundResult,
  PlatformFamily,
} from './types'
import type { PublishingService } from '../publishing/contracts'

export type PersistedPlatformEvent = {
  event: NormalizedPlatformEvent
  eventDigest: string
  rawPayloadDigest: string
}

export type EnqueuePlatformEventResult = {
  idempotencyKey: string
  status: 'accepted' | 'conflict' | 'duplicate'
}

export interface PlatformEventRepository {
  enqueueBatch(events: PersistedPlatformEvent[]): Promise<EnqueuePlatformEventResult[]>
}

export interface WebhookRateLimiter {
  consume(key: string): Promise<boolean>
}

export type WebhookVerificationInput = {
  headers: Readonly<Record<string, string | undefined>>
  rawBody: Uint8Array
}

export interface WebhookVerifier {
  verify(input: WebhookVerificationInput): boolean | Promise<boolean>
}

export type PlatformEventDeliveryResult = {
  idempotencyKey: string
  status: 'accepted' | 'duplicate'
}

export interface ConversationMessagePort {
  /**
   * Handle at-least-once worker delivery. Persistently deduplicate by
   * message.idempotencyKey before creating a conversation, message, or lead.
   */
  writeInboundMessage(message: NormalizedInboundMessage): Promise<PlatformEventDeliveryResult>
}

export interface MessageStatusPort {
  /** Persistently deduplicate repeated provider callbacks by status.idempotencyKey. */
  writeMessageStatus(status: NormalizedMessageStatus): Promise<PlatformEventDeliveryResult>
}

export interface PlatformConnector {
  normalize(payload: unknown): NormalizedPlatformEvent[]
  platformFamily: PlatformFamily
}

export type PlatformPublishingPort = PublishingService

export interface PlatformConversationOutboundPort {
  /**
   * Deliver one automatic conversation reply. `deliveryKey`, scoped by
   * platform and account, is the idempotency anchor. A real adapter must make
   * that deduplication atomic across I/O and map it to a provider idempotency
   * mechanism where available; this port never reports provider delivery.
   */
  send(request: PlatformConversationOutboundRequest): Promise<PlatformConversationOutboundResult>

  /**
   * Reconcile an unknown result after a provider may have accepted a request
   * but the worker died before it persisted the result. This method must never
   * blind-send: it only permits same-key retry, returns provider-issued,
   * opaque acceptance evidence, or declares delivery unknown for manual
   * compensation. `provider_accepted` must never be returned without that
   * external evidence.
   */
  recoverUnknownOutcome(
    request: PlatformConversationOutboundRequest,
  ): Promise<PlatformConversationOutboundRecoveryResult>
}

/**
 * Authority used to atomically fence a queued AI reply before provider I/O.
 * The same authority must serialize handoff transitions against active claims,
 * so `human_active` cannot commit and then be followed by an automatic send.
 */
export interface PlatformConversationDeliveryAuthorityPort {
  claimDelivery(
    intent: PlatformConversationDeliveryIntent,
    leaseFence: PlatformConversationDeliveryLeaseFence,
  ): Promise<PlatformConversationDeliveryClaimResult>
  /** Atomically validate the current Job lease and fence this generation before provider I/O. */
  markProviderIOStarted(
    claim: PlatformConversationDeliveryClaim,
  ): Promise<PlatformConversationDeliveryMarkResult>
  releaseDelivery(
    claim: PlatformConversationDeliveryClaim,
    outcome?: PlatformConversationDeliveryOutcome,
  ): Promise<void>
}

/** Public application contract consumed by a future reviewed Task 10 handler. */
export interface PlatformConversationDeliveryService {
  deliver(
    intent: PlatformConversationDeliveryIntent,
    leaseFence: PlatformConversationDeliveryLeaseFence,
  ): Promise<PlatformConversationDeliveryOutcome>
}
