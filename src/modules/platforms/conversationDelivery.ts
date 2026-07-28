import type {
  PlatformConversationDeliveryAuthorityPort,
  PlatformConversationDeliveryService,
  PlatformConversationOutboundPort,
} from './ports'
import {
  PlatformConversationOutboundTransportError,
  isPlatformConversationOutboundOutcomeUnknownError,
} from './conversationOutboundResult'
import {
  createProviderAcceptanceEvidence,
  MESSAGING_PLATFORMS,
  PLATFORM_CONVERSATION_OUTBOUND_ERROR_CODES,
  type ConfirmedPlatformConversationOutboundErrorCode,
  type PlatformConversationDeliveryIntent,
  type PlatformConversationDeliveryOutcome,
  type PlatformConversationOutboundRecoveryResult,
  type PlatformConversationOutboundRequest,
  type PlatformConversationOutboundResult,
} from './types'

const deliveryUnknown = (
  request: PlatformConversationOutboundRequest,
): PlatformConversationOutboundRecoveryResult => ({
  deliveryKey: request.deliveryKey,
  platform: request.platform,
  status: 'delivery_unknown',
})

const isStableIdentity = (value: unknown): value is number | string =>
  (typeof value === 'number' && Number.isSafeInteger(value)) ||
  (typeof value === 'string' && Boolean(value.trim()))

const boundedString = (value: unknown, maxLength: number): string | undefined => {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  return normalized && normalized.length <= maxLength ? normalized : undefined
}

const normalizeIntent = (input: unknown): PlatformConversationDeliveryIntent | undefined => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined
  const intent = input as Partial<PlatformConversationDeliveryIntent>
  const expectedRevision = intent.expectedRevision
  if (
    !isStableIdentity(intent.conversationId) ||
    !isStableIdentity(intent.replyId) ||
    typeof expectedRevision !== 'number' ||
    !Number.isSafeInteger(expectedRevision) ||
    expectedRevision < 0 ||
    !intent.transport ||
    typeof intent.transport !== 'object' ||
    Array.isArray(intent.transport)
  ) {
    return undefined
  }

  const accountExternalId = boundedString(intent.transport.accountExternalId, 240)
  const deliveryKey = boundedString(intent.transport.deliveryKey, 200)
  const recipientExternalId = boundedString(intent.transport.recipientExternalId, 240)
  const text = boundedString(intent.transport.text, 5_000)
  if (
    !accountExternalId ||
    !deliveryKey ||
    !recipientExternalId ||
    !text ||
    !MESSAGING_PLATFORMS.includes(intent.transport.platform)
  ) {
    return undefined
  }

  return {
    conversationId: intent.conversationId,
    expectedRevision,
    replyId: intent.replyId,
    transport: {
      accountExternalId,
      deliveryKey,
      platform: intent.transport.platform,
      recipientExternalId,
      text,
    },
  }
}

const sameIntent = (
  left: PlatformConversationDeliveryIntent,
  right: PlatformConversationDeliveryIntent,
): boolean =>
  left.conversationId === right.conversationId &&
  left.expectedRevision === right.expectedRevision &&
  left.replyId === right.replyId &&
  left.transport.accountExternalId === right.transport.accountExternalId &&
  left.transport.deliveryKey === right.transport.deliveryKey &&
  left.transport.platform === right.transport.platform &&
  left.transport.recipientExternalId === right.transport.recipientExternalId &&
  left.transport.text === right.transport.text

const identitiesMatch = (
  result: { deliveryKey: string; platform: string },
  request: PlatformConversationOutboundRequest,
): boolean => result.deliveryKey === request.deliveryKey && result.platform === request.platform

const isPlainRecord = (value: unknown): value is Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

const hasExactKeys = (value: Record<string, unknown>, expected: readonly string[]): boolean => {
  const keys = Reflect.ownKeys(value)
  return keys.length === expected.length && expected.every((key) => Object.hasOwn(value, key))
}

const isConfirmedErrorCode = (
  value: unknown,
): value is ConfirmedPlatformConversationOutboundErrorCode =>
  typeof value === 'string' &&
  value !== 'delivery_unknown' &&
  PLATFORM_CONVERSATION_OUTBOUND_ERROR_CODES.includes(
    value as ConfirmedPlatformConversationOutboundErrorCode,
  )

const normalizeSendResult = (
  value: unknown,
  request: PlatformConversationOutboundRequest,
): PlatformConversationDeliveryOutcome => {
  if (!isPlainRecord(value)) return deliveryUnknown(request)
  const result = value
  if (!identitiesMatch(result as { deliveryKey: string; platform: string }, request)) {
    return deliveryUnknown(request)
  }

  if (result.status === 'accepted' || result.status === 'duplicate') {
    return hasExactKeys(result, ['deliveryKey', 'platform', 'status'])
      ? {
          deliveryKey: request.deliveryKey,
          platform: request.platform,
          status: result.status,
        }
      : deliveryUnknown(request)
  }

  if (
    result.status !== 'blocked' ||
    !isConfirmedErrorCode(result.errorCode) ||
    typeof result.retryable !== 'boolean'
  ) {
    return deliveryUnknown(request)
  }

  if (!result.retryable) {
    return hasExactKeys(result, [
      'deliveryKey',
      'errorCode',
      'platform',
      'retryable',
      'status',
    ])
      ? {
          deliveryKey: request.deliveryKey,
          errorCode: result.errorCode,
          platform: request.platform,
          retryable: false,
          status: 'blocked',
        }
      : deliveryUnknown(request)
  }

  const hasRetryAfterSeconds = Object.hasOwn(result, 'retryAfterSeconds')
  if (
    hasRetryAfterSeconds &&
    (!Number.isInteger(result.retryAfterSeconds) || (result.retryAfterSeconds as number) <= 0)
  ) {
    return deliveryUnknown(request)
  }
  if (
    !hasExactKeys(result, [
      'deliveryKey',
      'errorCode',
      'platform',
      ...(hasRetryAfterSeconds ? ['retryAfterSeconds'] : []),
      'retryable',
      'status',
    ])
  ) {
    return deliveryUnknown(request)
  }

  const normalized: PlatformConversationOutboundResult = {
    deliveryKey: request.deliveryKey,
    errorCode: result.errorCode,
    platform: request.platform,
    ...(hasRetryAfterSeconds
      ? { retryAfterSeconds: result.retryAfterSeconds as number }
      : {}),
    retryable: true,
    status: 'blocked',
  }
  return normalized
}

const normalizeRecovery = (
  value: unknown,
  request: PlatformConversationOutboundRequest,
): PlatformConversationOutboundRecoveryResult => {
  if (!isPlainRecord(value)) return deliveryUnknown(request)
  const result = value
  if (!identitiesMatch(result as { deliveryKey: string; platform: string }, request)) {
    return deliveryUnknown(request)
  }
  if (result.status === 'delivery_unknown' || result.status === 'retry_same_delivery_key') {
    return hasExactKeys(result, ['deliveryKey', 'platform', 'status'])
      ? {
          deliveryKey: request.deliveryKey,
          platform: request.platform,
          status: result.status,
        }
      : deliveryUnknown(request)
  }
  if (result.status === 'provider_accepted') {
    if (!hasExactKeys(result, ['deliveryKey', 'platform', 'providerReference', 'status'])) {
      return deliveryUnknown(request)
    }
    const providerReference = createProviderAcceptanceEvidence({
      deliveryKey: request.deliveryKey,
      providerReference: result.providerReference,
    })
    return providerReference
      ? {
          deliveryKey: request.deliveryKey,
          platform: request.platform,
          providerReference,
          status: 'provider_accepted',
        }
      : deliveryUnknown(request)
  }
  return deliveryUnknown(request)
}

const recoverUnknownOutcome = async (
  outbound: PlatformConversationOutboundPort,
  request: PlatformConversationOutboundRequest,
): Promise<PlatformConversationOutboundRecoveryResult> => {
  try {
    const recovery = await outbound.recoverUnknownOutcome(request)
    return normalizeRecovery(recovery, request)
  } catch {
    return deliveryUnknown(request)
  }
}

const sendAndRecover = async (
  outbound: PlatformConversationOutboundPort,
  request: PlatformConversationOutboundRequest,
): Promise<PlatformConversationDeliveryOutcome> => {
  try {
    const result = await outbound.send(request)
    return normalizeSendResult(result, request)
  } catch (error) {
    if (!isPlatformConversationOutboundOutcomeUnknownError(error)) {
      return deliveryUnknown(request)
    }
    if (error.deliveryKey !== request.deliveryKey || error.platform !== request.platform) {
      return deliveryUnknown(request)
    }
    return recoverUnknownOutcome(outbound, request)
  }
}

/**
 * Build the pure application gate used by a future Task 10 handler. It neither
 * persists Jobs nor owns conversation state: the injected authority atomically
 * claims an authoritative intent and serializes handoff transitions until the
 * transport attempt releases that logical fence.
 */
export const createPlatformConversationDeliveryService = ({
  authority,
  outbound,
}: {
  authority: PlatformConversationDeliveryAuthorityPort
  outbound: PlatformConversationOutboundPort
}): PlatformConversationDeliveryService => ({
  async deliver(input): Promise<PlatformConversationDeliveryOutcome> {
    const intent = normalizeIntent(input)
    if (!intent) throw new Error('Platform conversation delivery intent is invalid')

    const claim = await authority.claimDelivery(intent)
    if (!claim) {
      return {
        deliveryKey: intent.transport.deliveryKey,
        errorCode: 'handoff_required',
        platform: intent.transport.platform,
        retryable: false,
        status: 'blocked',
      }
    }

    const authoritativeIntent = normalizeIntent(claim.intent)
    if (
      !claim.claimId.trim() ||
      !Number.isSafeInteger(claim.fencingGeneration) ||
      claim.fencingGeneration < 1 ||
      !['recover', 'send'].includes(claim.mode) ||
      !authoritativeIntent ||
      !sameIntent(authoritativeIntent, intent)
    ) {
      try {
        await authority.releaseDelivery(claim)
      } catch {
        // No provider I/O occurred, so a malformed claim remains a confirmed block.
      }
      return {
        deliveryKey: intent.transport.deliveryKey,
        errorCode: 'invalid_request',
        platform: intent.transport.platform,
        retryable: false,
        status: 'blocked',
      }
    }

    let outcome: PlatformConversationDeliveryOutcome | undefined
    let sendError: unknown
    if (claim.mode === 'recover') {
      outcome = await recoverUnknownOutcome(outbound, authoritativeIntent.transport)
      if (outcome.status === 'retry_same_delivery_key') {
        let providerIOStarted = false
        try {
          providerIOStarted = await authority.markProviderIOStarted(claim)
        } catch {
          sendError = new PlatformConversationOutboundTransportError(authoritativeIntent.transport)
        }
        if (!sendError && !providerIOStarted) {
          outcome = deliveryUnknown(authoritativeIntent.transport)
        } else if (!sendError) {
          try {
            outcome = await sendAndRecover(outbound, authoritativeIntent.transport)
          } catch (error) {
            sendError = error
          }
        }
      }
    } else {
      let providerIOStarted = false
      try {
        providerIOStarted = await authority.markProviderIOStarted(claim)
      } catch {
        sendError = new PlatformConversationOutboundTransportError(authoritativeIntent.transport)
      }

      if (!sendError && !providerIOStarted) {
        try {
          await authority.releaseDelivery(claim)
        } catch {
          // Provider I/O never started, so this remains a confirmed fence block.
        }
        return {
          deliveryKey: authoritativeIntent.transport.deliveryKey,
          errorCode: 'handoff_required',
          platform: authoritativeIntent.transport.platform,
          retryable: false,
          status: 'blocked',
        }
      }

      if (!sendError) {
        try {
          outcome = await sendAndRecover(outbound, authoritativeIntent.transport)
        } catch (error) {
          sendError = error
        }
      }
    }

    try {
      await authority.releaseDelivery(claim, outcome)
    } catch {
      if (!sendError && outcome?.status !== 'blocked') {
        outcome = deliveryUnknown(authoritativeIntent.transport)
      }
    }

    if (sendError) throw sendError
    return outcome ?? deliveryUnknown(authoritativeIntent.transport)
  },
})
