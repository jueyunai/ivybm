import { HANDOFF_STATUSES, type HandoffStatus } from '../conversations/contracts'

import type { PlatformConversationOutboundPort } from './ports'
import {
  isAutomaticPlatformConversationReplyAllowed,
  MESSAGING_PLATFORMS,
  PLATFORM_CONVERSATION_OUTBOUND_ERROR_CODES,
  type MessagingPlatform,
  type PlatformConversationOutboundErrorCode,
  type PlatformConversationOutboundRequest,
  type PlatformConversationOutboundResult,
} from './types'

export type FakeConversationOutboundFailure = {
  errorCode: PlatformConversationOutboundErrorCode
  platform: MessagingPlatform
  retryAfterSeconds?: number
  retryable: boolean
}

export type FakeConversationOutboundInspectionKey = {
  accountExternalId: string
  deliveryKey: string
  platform: MessagingPlatform
}

export type FakePlatformConversationOutboundPort = PlatformConversationOutboundPort & {
  /** Queue a platform-scoped failure consumed by the next eligible send. */
  failNextSend(failure: FakeConversationOutboundFailure): void
  /** Return a defensive copy of the stored request, or undefined. */
  getAcceptedRequest(
    key: FakeConversationOutboundInspectionKey,
  ): PlatformConversationOutboundRequest | undefined
}

const assertSupportedMessagingPlatform = (value: unknown): MessagingPlatform => {
  if (typeof value !== 'string' || !MESSAGING_PLATFORMS.includes(value as MessagingPlatform)) {
    throw new Error(`Fake messaging platform is unsupported: ${String(value)}`)
  }
  return value as MessagingPlatform
}

const deliveryKey = (request: {
  accountExternalId: string
  deliveryKey: string
  platform: MessagingPlatform
}): string => `${request.platform}\u0000${request.accountExternalId}\u0000${request.deliveryKey}`

const trimmedString = (value: unknown, maxLength: number): string | undefined => {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  return normalized && normalized.length <= maxLength ? normalized : undefined
}

const isHandoffStatus = (value: unknown): value is HandoffStatus =>
  typeof value === 'string' && HANDOFF_STATUSES.includes(value as HandoffStatus)

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const samePayload = (
  stored: PlatformConversationOutboundRequest,
  request: PlatformConversationOutboundRequest,
): boolean =>
  stored.accountExternalId === request.accountExternalId &&
  stored.deliveryKey === request.deliveryKey &&
  stored.externalThreadId === request.externalThreadId &&
  stored.handoffStatus === request.handoffStatus &&
  stored.platform === request.platform &&
  stored.recipientExternalId === request.recipientExternalId &&
  stored.text === request.text

const blocked = (
  request: { deliveryKey: string; platform: MessagingPlatform },
  failure: {
    errorCode: PlatformConversationOutboundErrorCode
    retryAfterSeconds?: number
    retryable: boolean
  },
): PlatformConversationOutboundResult => {
  if (failure.retryable) {
    return {
      deliveryKey: request.deliveryKey,
      errorCode: failure.errorCode,
      platform: request.platform,
      ...(failure.retryAfterSeconds !== undefined
        ? { retryAfterSeconds: failure.retryAfterSeconds }
        : {}),
      retryable: true,
      status: 'blocked',
    }
  }

  return {
    deliveryKey: request.deliveryKey,
    errorCode: failure.errorCode,
    platform: request.platform,
    retryable: false,
    status: 'blocked',
  }
}

/**
 * Credential-free, no-network fake for the phase-one conversation outbound
 * contract. It never calls fetch or a provider SDK, never touches conversation
 * storage, and keeps all state in memory so tests stay deterministic.
 */
export const createFakePlatformConversationOutboundPort =
  (): FakePlatformConversationOutboundPort => {
    const accepted = new Map<string, PlatformConversationOutboundRequest>()
    const queuedFailures = new Map<MessagingPlatform, FakeConversationOutboundFailure[]>()

    const send = async (
      input: PlatformConversationOutboundRequest,
    ): Promise<PlatformConversationOutboundResult> => {
      if (!input || typeof input !== 'object' || Array.isArray(input)) {
        throw new Error('Fake conversation outbound request must be an object')
      }

      const platform = assertSupportedMessagingPlatform((input as { platform?: unknown }).platform)

      const request: PlatformConversationOutboundRequest = {
        accountExternalId: trimmedString(input.accountExternalId, 240) ?? '',
        deliveryKey: trimmedString(input.deliveryKey, 200) ?? '',
        externalThreadId: trimmedString(input.externalThreadId, 500) ?? '',
        handoffStatus: input.handoffStatus,
        platform,
        recipientExternalId: trimmedString(input.recipientExternalId, 240) ?? '',
        text: trimmedString(input.text, 5_000) ?? '',
      }

      if (
        !request.accountExternalId ||
        !request.deliveryKey ||
        !request.externalThreadId ||
        !isHandoffStatus(request.handoffStatus) ||
        !request.recipientExternalId ||
        !request.text
      ) {
        return blocked(request, { errorCode: 'invalid_request', retryable: false })
      }

      // Handoff suppression happens before dedup and before consuming queued
      // failures: a suppressed reply must not record state or burn a failure.
      if (!isAutomaticPlatformConversationReplyAllowed(request.handoffStatus)) {
        return blocked(request, { errorCode: 'handoff_required', retryable: false })
      }

      const key = deliveryKey(request)
      const stored = accepted.get(key)
      if (stored) {
        if (samePayload(stored, request)) {
          return {
            deliveryKey: request.deliveryKey,
            platform: request.platform,
            status: 'duplicate',
          }
        }
        return blocked(request, { errorCode: 'invalid_request', retryable: false })
      }

      const queue = queuedFailures.get(platform)
      const failure = queue?.shift()
      if (failure) return blocked(request, failure)

      accepted.set(key, structuredClone(request))
      return {
        deliveryKey: request.deliveryKey,
        platform: request.platform,
        status: 'accepted',
      }
    }

    const failNextSend = (failure: FakeConversationOutboundFailure): void => {
      if (!isRecord(failure)) {
        throw new Error('Fake conversation outbound failure must be an object')
      }
      const platform = assertSupportedMessagingPlatform(failure.platform)
      if (
        !PLATFORM_CONVERSATION_OUTBOUND_ERROR_CODES.includes(
          failure.errorCode as PlatformConversationOutboundErrorCode,
        )
      ) {
        throw new Error(
          `Fake conversation outbound error code is unsupported: ${String(failure.errorCode)}`,
        )
      }
      if (typeof failure.retryable !== 'boolean') {
        throw new Error('Fake conversation outbound failure retryable flag must be a boolean')
      }
      if (
        failure.retryAfterSeconds !== undefined &&
        (!Number.isInteger(failure.retryAfterSeconds) || failure.retryAfterSeconds <= 0)
      ) {
        throw new Error(
          'Fake conversation outbound failure retryAfterSeconds must be a positive integer',
        )
      }
      if (!failure.retryable && failure.retryAfterSeconds !== undefined) {
        throw new Error(
          'Fake conversation outbound failure retryAfterSeconds requires a retryable failure',
        )
      }

      const queue = queuedFailures.get(platform) ?? []
      queue.push({ ...failure, platform })
      queuedFailures.set(platform, queue)
    }

    const getAcceptedRequest = (
      key: FakeConversationOutboundInspectionKey,
    ): PlatformConversationOutboundRequest | undefined => {
      const stored = accepted.get(deliveryKey(key))
      return stored ? structuredClone(stored) : undefined
    }

    return { failNextSend, getAcceptedRequest, send }
  }
