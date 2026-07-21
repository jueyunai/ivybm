import type {
  NormalizedInboundMessage,
  NormalizedMessageStatus,
  NormalizedPlatformEvent,
  PlatformCapability,
  PlatformFamily,
  PlatformPublicationStatus,
  PlatformPublishAcceptance,
  PlatformPublishRequest,
  PublishingPlatform,
} from './types'

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

export interface ConversationMessagePort {
  writeInboundMessage(message: NormalizedInboundMessage): Promise<void>
}

export interface MessageStatusPort {
  writeMessageStatus(status: NormalizedMessageStatus): Promise<void>
}

export interface PlatformConnector {
  normalize(payload: unknown): NormalizedPlatformEvent[]
  platformFamily: PlatformFamily
}

export interface PlatformPublishingPort {
  getCapability(platform: PublishingPlatform): Promise<PlatformCapability>
  getStatus(input: {
    externalPublicationId: string
    platform: PublishingPlatform
  }): Promise<PlatformPublicationStatus>
  publish(request: PlatformPublishRequest): Promise<PlatformPublishAcceptance>
}
