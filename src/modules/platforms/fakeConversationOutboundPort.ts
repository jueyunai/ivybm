import type { PlatformConversationOutboundPort } from './ports'
import { PlatformConversationOutboundOutcomeUnknownError } from './conversationOutboundResult'
import {
  createProviderAcceptanceEvidence,
  MESSAGING_PLATFORMS,
  PLATFORM_CONVERSATION_OUTBOUND_ERROR_CODES,
  type ConfirmedPlatformConversationOutboundErrorCode,
  type MessagingPlatform,
  type PlatformConversationOutboundRequest,
  type PlatformConversationOutboundRecoveryResult,
  type PlatformConversationOutboundResult,
} from './types'

export type FakeConversationOutboundFailure = {
  errorCode: ConfirmedPlatformConversationOutboundErrorCode
  platform: MessagingPlatform
  retryAfterSeconds?: number
  retryable: boolean
}

export type FakeConversationOutboundInspectionKey = {
  accountExternalId: string
  deliveryKey: string
  platform: MessagingPlatform
}

export type FakeConversationOutboundRecoveryMode =
  'manual_compensation' | 'provider_delivery_lookup' | 'provider_idempotency_key'

const FAKE_CONVERSATION_OUTBOUND_RECOVERY_MODES: readonly FakeConversationOutboundRecoveryMode[] = [
  'manual_compensation',
  'provider_delivery_lookup',
  'provider_idempotency_key',
]

export type FakePlatformConversationOutboundProviderState = {
  accepted: Map<string, PlatformConversationOutboundRequest>
  acceptedResultLosses: Map<MessagingPlatform, number>
  providerReferences: Map<string, string>
  recoveryMode: FakeConversationOutboundRecoveryMode
}

export const createFakePlatformConversationOutboundProviderState = ({
  recoveryMode = 'manual_compensation',
}: {
  recoveryMode?: FakeConversationOutboundRecoveryMode
} = {}): FakePlatformConversationOutboundProviderState => {
  if (!FAKE_CONVERSATION_OUTBOUND_RECOVERY_MODES.includes(recoveryMode)) {
    throw new Error('Fake conversation outbound recovery mode is unsupported')
  }
  return {
    accepted: new Map(),
    acceptedResultLosses: new Map(),
    providerReferences: new Map(),
    recoveryMode,
  }
}

export type FakePlatformConversationOutboundPort = PlatformConversationOutboundPort & {
  /** Queue a platform-scoped failure consumed by the next eligible send. */
  failNextSend(failure: FakeConversationOutboundFailure): void
  /** Simulate a provider accepting the next send while the worker loses its result. */
  loseAcceptedResultNext(input: { platform: MessagingPlatform }): void
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
}): string =>
  JSON.stringify(
    [request.platform, request.accountExternalId, request.deliveryKey].map((part) => [
      typeof part,
      part,
    ]),
  )

const trimmedString = (value: unknown, maxLength: number): string | undefined => {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  return normalized && normalized.length <= maxLength ? normalized : undefined
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const samePayload = (
  stored: PlatformConversationOutboundRequest,
  request: PlatformConversationOutboundRequest,
): boolean =>
  stored.accountExternalId === request.accountExternalId &&
  stored.deliveryKey === request.deliveryKey &&
  stored.platform === request.platform &&
  stored.recipientExternalId === request.recipientExternalId &&
  stored.text === request.text

const blocked = (
  request: { deliveryKey: string; platform: MessagingPlatform },
  failure: {
    errorCode: ConfirmedPlatformConversationOutboundErrorCode
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
export const createFakePlatformConversationOutboundPort = ({
  providerState = createFakePlatformConversationOutboundProviderState(),
}: {
  providerState?: FakePlatformConversationOutboundProviderState
} = {}): FakePlatformConversationOutboundPort => {
  const accepted = providerState.accepted
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
      platform,
      recipientExternalId: trimmedString(input.recipientExternalId, 240) ?? '',
      text: trimmedString(input.text, 5_000) ?? '',
    }

    if (
      !request.accountExternalId ||
      !request.deliveryKey ||
      !request.recipientExternalId ||
      !request.text
    ) {
      return blocked(request, { errorCode: 'invalid_request', retryable: false })
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
    providerState.providerReferences.set(
      key,
      `fake-provider-message-${providerState.providerReferences.size + 1}`,
    )
    const acceptedResultLosses = providerState.acceptedResultLosses.get(platform) ?? 0
    if (acceptedResultLosses > 0) {
      if (acceptedResultLosses === 1) {
        providerState.acceptedResultLosses.delete(platform)
      } else {
        providerState.acceptedResultLosses.set(platform, acceptedResultLosses - 1)
      }
      throw new PlatformConversationOutboundOutcomeUnknownError({
        deliveryKey: request.deliveryKey,
        platform: request.platform,
      })
    }
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
      (failure as { errorCode?: unknown }).errorCode === 'delivery_unknown' ||
      !PLATFORM_CONVERSATION_OUTBOUND_ERROR_CODES.includes(
        failure.errorCode as ConfirmedPlatformConversationOutboundErrorCode,
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

  const loseAcceptedResultNext = ({ platform }: { platform: MessagingPlatform }): void => {
    const supportedPlatform = assertSupportedMessagingPlatform(platform)
    providerState.acceptedResultLosses.set(
      supportedPlatform,
      (providerState.acceptedResultLosses.get(supportedPlatform) ?? 0) + 1,
    )
  }

  const recoverUnknownOutcome = async (
    input: PlatformConversationOutboundRequest,
  ): Promise<PlatformConversationOutboundRecoveryResult> => {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new Error('Fake conversation outbound request must be an object')
    }
    const platform = assertSupportedMessagingPlatform((input as { platform?: unknown }).platform)
    const request: PlatformConversationOutboundRequest = {
      accountExternalId: trimmedString(input.accountExternalId, 240) ?? '',
      deliveryKey: trimmedString(input.deliveryKey, 200) ?? '',
      platform,
      recipientExternalId: trimmedString(input.recipientExternalId, 240) ?? '',
      text: trimmedString(input.text, 5_000) ?? '',
    }
    if (
      !request.accountExternalId ||
      !request.deliveryKey ||
      !request.recipientExternalId ||
      !request.text
    ) {
      throw new Error('Fake conversation outbound recovery request is invalid')
    }

    const key = deliveryKey(request)
    const stored = accepted.get(key)
    const storedProviderReference = providerState.providerReferences.get(key)
    const providerReference = storedProviderReference
      ? createProviderAcceptanceEvidence({
          deliveryKey: request.deliveryKey,
          providerReference: storedProviderReference,
        })
      : undefined
    if (providerState.recoveryMode === 'manual_compensation') {
      return {
        deliveryKey: request.deliveryKey,
        platform,
        status: 'delivery_unknown',
      }
    }
    if (stored && !samePayload(stored, request)) {
      return {
        deliveryKey: request.deliveryKey,
        platform,
        status: 'delivery_unknown',
      }
    }
    if (providerState.recoveryMode === 'provider_delivery_lookup' && stored && providerReference) {
      return {
        deliveryKey: request.deliveryKey,
        platform,
        providerReference,
        status: 'provider_accepted',
      }
    }
    if (providerState.recoveryMode === 'provider_delivery_lookup') {
      return {
        deliveryKey: request.deliveryKey,
        platform,
        status: 'delivery_unknown',
      }
    }
    return {
      deliveryKey: request.deliveryKey,
      platform,
      status: 'retry_same_delivery_key',
    }
  }

  const getAcceptedRequest = (
    key: FakeConversationOutboundInspectionKey,
  ): PlatformConversationOutboundRequest | undefined => {
    const stored = accepted.get(deliveryKey(key))
    return stored ? structuredClone(stored) : undefined
  }

  return { failNextSend, getAcceptedRequest, loseAcceptedResultNext, recoverUnknownOutcome, send }
}
