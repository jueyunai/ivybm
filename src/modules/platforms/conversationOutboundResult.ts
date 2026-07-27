import type { MessagingPlatform } from './types'

/**
 * Public, non-retryable signal that a request crossed the provider send
 * boundary but its acceptance result was lost. Job handlers must reconcile the
 * same delivery key instead of treating this as an ordinary retryable failure.
 */
export class PlatformConversationOutboundOutcomeUnknownError extends Error {
  readonly code = 'delivery_unknown' as const
  readonly deliveryKey: string
  readonly platform: MessagingPlatform
  readonly retryable = false as const

  constructor({
    deliveryKey,
    platform,
  }: {
    deliveryKey: string
    platform: MessagingPlatform
  }) {
    super('Platform conversation outbound result is unknown')
    this.name = 'PlatformConversationOutboundOutcomeUnknownError'
    this.deliveryKey = deliveryKey
    this.platform = platform
  }
}

/** Sanitized wrapper for unexpected errors that have not declared an unknown outcome. */
export class PlatformConversationOutboundTransportError extends Error {
  readonly code = 'provider_unavailable' as const
  readonly deliveryKey: string
  readonly platform: MessagingPlatform
  readonly retryable = true as const

  constructor({
    deliveryKey,
    platform,
  }: {
    deliveryKey: string
    platform: MessagingPlatform
  }) {
    super('Platform conversation transport failed before a confirmed acceptance result')
    this.name = 'PlatformConversationOutboundTransportError'
    this.deliveryKey = deliveryKey
    this.platform = platform
  }
}

export const isPlatformConversationOutboundOutcomeUnknownError = (
  error: unknown,
): error is PlatformConversationOutboundOutcomeUnknownError =>
  error instanceof PlatformConversationOutboundOutcomeUnknownError ||
  (Boolean(error) &&
    typeof error === 'object' &&
    (error as { code?: unknown }).code === 'delivery_unknown' &&
    typeof (error as { deliveryKey?: unknown }).deliveryKey === 'string' &&
    typeof (error as { platform?: unknown }).platform === 'string' &&
    (error as { retryable?: unknown }).retryable === false)
