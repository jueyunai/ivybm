import type {
  NormalizedInboundMessage,
  NormalizedMessageStatus,
  NormalizedPlatformEvent,
  PlatformFamily,
} from './types'

export type EnqueuePlatformEventResult = 'accepted' | 'duplicate'

export interface PlatformEventRepository {
  enqueue(event: NormalizedPlatformEvent): Promise<EnqueuePlatformEventResult>
}

export interface WebhookRateLimiter {
  consume(key: string): Promise<boolean>
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
