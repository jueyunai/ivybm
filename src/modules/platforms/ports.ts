import type {
  NormalizedInboundMessage,
  NormalizedMessageStatus,
  NormalizedPlatformEvent,
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
