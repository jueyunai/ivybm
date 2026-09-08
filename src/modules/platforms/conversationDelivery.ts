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
  type PlatformConversationDeliveryBlockReason,
  type PlatformConversationDeliveryClaim,
  type PlatformConversationDeliveryIntent,
  type PlatformConversationDeliveryLeaseFence,
  type PlatformConversationDeliveryMarkResult,
  type PlatformConversationDeliveryOutcome,
  type PlatformConversationOutboundRecoveryResult,
  type PlatformConversationOutboundRequest,
  type PlatformConversationOutboundResult,
} from './types'

export class PlatformConversationDeliveryPersistenceError extends Error {
  readonly outcome: PlatformConversationDeliveryOutcome

  constructor(outcome: PlatformConversationDeliveryOutcome, cause?: unknown) {
    super('Platform conversation delivery outcome could not be persisted', { cause })
    this.name = 'PlatformConversationDeliveryPersistenceError'
    this.outcome = structuredClone(outcome)
  }
}

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
    typeof intent.jobId !== 'number' ||
    !Number.isSafeInteger(intent.jobId) ||
    intent.jobId < 1 ||
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
    jobId: intent.jobId,
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

const normalizeLeaseFence = (
  input: unknown,
): PlatformConversationDeliveryLeaseFence | undefined => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined
  const fence = input as Partial<PlatformConversationDeliveryLeaseFence>
  if (
    typeof fence.jobId !== 'number' ||
    !Number.isSafeInteger(fence.jobId) ||
    fence.jobId < 1 ||
    typeof fence.ownerToken !== 'string' ||
    !fence.ownerToken.trim() ||
    fence.ownerToken.length > 240 ||
    /[\u0000-\u001F\u007F-\u009F]/u.test(fence.ownerToken) ||
    typeof fence.leaseExpiresAt !== 'string' ||
    !Number.isFinite(Date.parse(fence.leaseExpiresAt))
  ) {
    return undefined
  }
  return {
    jobId: fence.jobId,
    leaseExpiresAt: fence.leaseExpiresAt,
    ownerToken: fence.ownerToken,
  }
}

const sameIntent = (
  left: PlatformConversationDeliveryIntent,
  right: PlatformConversationDeliveryIntent,
): boolean =>
  left.conversationId === right.conversationId &&
  left.expectedRevision === right.expectedRevision &&
  left.jobId === right.jobId &&
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

const sameLeaseOwner = (
  left: PlatformConversationDeliveryLeaseFence,
  right: PlatformConversationDeliveryLeaseFence,
): boolean => left.jobId === right.jobId && left.ownerToken === right.ownerToken

const authorityBlockedOutcome = (
  reason: PlatformConversationDeliveryBlockReason,
  request: PlatformConversationOutboundRequest,
): PlatformConversationDeliveryOutcome => {
  if (reason === 'busy' || reason === 'claim_conflict') {
    return {
      deliveryKey: request.deliveryKey,
      errorCode: 'delivery_busy',
      platform: request.platform,
      retryable: true,
      status: 'blocked',
    }
  }
  if (reason === 'lease_conflict') {
    return {
      deliveryKey: request.deliveryKey,
      errorCode: 'lease_conflict',
      platform: request.platform,
      retryable: true,
      status: 'blocked',
    }
  }
  if (reason === 'stale_revision') {
    return {
      deliveryKey: request.deliveryKey,
      errorCode: 'stale_revision',
      platform: request.platform,
      retryable: false,
      status: 'blocked',
    }
  }
  if (reason === 'handoff_required') {
    return {
      deliveryKey: request.deliveryKey,
      errorCode: 'handoff_required',
      platform: request.platform,
      retryable: false,
      status: 'blocked',
    }
  }
  if (reason === 'ai_auto_reply_paused') {
    return {
      deliveryKey: request.deliveryKey,
      errorCode: 'ai_auto_reply_paused',
      platform: request.platform,
      retryable: false,
      status: 'blocked',
    }
  }
  return {
    deliveryKey: request.deliveryKey,
    errorCode: 'invalid_request',
    platform: request.platform,
    retryable: false,
    status: 'blocked',
  }
}

const isClaim = (value: unknown): value is PlatformConversationDeliveryClaim => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const claim = value as Partial<PlatformConversationDeliveryClaim>
  const intent = normalizeIntent(claim.intent)
  const leaseFence = normalizeLeaseFence(claim.leaseFence)
  return (
    typeof claim.claimId === 'string' &&
    Boolean(claim.claimId.trim()) &&
    Number.isSafeInteger(claim.fencingGeneration) &&
    (claim.mode === 'send' || claim.mode === 'recover') &&
    intent !== undefined &&
    leaseFence !== undefined &&
    intent.jobId === leaseFence.jobId
  )
}

const recoveryMarkBlockedOutcome = (
  result: Extract<PlatformConversationDeliveryMarkResult, { status: 'blocked' }>,
  request: PlatformConversationOutboundRequest,
): PlatformConversationDeliveryOutcome =>
  result.reason === 'busy' ||
  result.reason === 'claim_conflict' ||
  result.reason === 'lease_conflict'
    ? authorityBlockedOutcome(result.reason, request)
    : deliveryUnknown(request)

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
    return hasExactKeys(result, ['deliveryKey', 'errorCode', 'platform', 'retryable', 'status'])
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
    ...(hasRetryAfterSeconds ? { retryAfterSeconds: result.retryAfterSeconds as number } : {}),
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
  async deliver(input, leaseInput): Promise<PlatformConversationDeliveryOutcome> {
    const intent = normalizeIntent(input)
    const leaseFence = normalizeLeaseFence(leaseInput)
    if (!intent || !leaseFence) throw new Error('Platform conversation delivery input is invalid')
    if (intent.jobId !== leaseFence.jobId) {
      return authorityBlockedOutcome('intent_mismatch', intent.transport)
    }

    const claimResult = await authority.claimDelivery(intent, leaseFence)
    if (claimResult.status === 'blocked') {
      return authorityBlockedOutcome(claimResult.reason, intent.transport)
    }
    const claim = claimResult.claim
    if (!isClaim(claim)) {
      try {
        await authority.releaseDelivery(claim)
      } catch {
        // The authority returned malformed state; release is best-effort and provider I/O is forbidden.
      }
      return authorityBlockedOutcome('intent_mismatch', intent.transport)
    }
    if (!sameLeaseOwner(claim.leaseFence, leaseFence)) {
      try {
        await authority.releaseDelivery(claim)
      } catch {
        // No provider I/O occurred; malformed authority state remains fail closed.
      }
      return authorityBlockedOutcome('intent_mismatch', intent.transport)
    }

    const authoritativeIntent = normalizeIntent(claim.intent)
    if (
      !claim.claimId.trim() ||
      !Number.isSafeInteger(claim.fencingGeneration) ||
      claim.fencingGeneration < 1 ||
      !['recover', 'send'].includes(claim.mode) ||
      !authoritativeIntent ||
      !sameIntent(authoritativeIntent, intent) ||
      authoritativeIntent.jobId !== claim.leaseFence.jobId ||
      !sameLeaseOwner(claim.leaseFence, leaseFence)
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
        let providerIOStarted: PlatformConversationDeliveryMarkResult = {
          status: 'blocked',
          reason: 'claim_conflict',
        }
        try {
          providerIOStarted = await authority.markProviderIOStarted(claim)
        } catch {
          sendError = new PlatformConversationOutboundTransportError(authoritativeIntent.transport)
        }
        if (!sendError && providerIOStarted.status === 'blocked') {
          outcome = recoveryMarkBlockedOutcome(providerIOStarted, authoritativeIntent.transport)
        } else if (!sendError) {
          try {
            outcome = await sendAndRecover(outbound, authoritativeIntent.transport)
          } catch (error) {
            sendError = error
          }
        }
      }
    } else {
      let providerIOStarted: PlatformConversationDeliveryMarkResult = {
        status: 'blocked',
        reason: 'claim_conflict',
      }
      try {
        providerIOStarted = await authority.markProviderIOStarted(claim)
      } catch {
        sendError = new PlatformConversationOutboundTransportError(authoritativeIntent.transport)
      }

      if (!sendError && providerIOStarted.status === 'blocked') {
        try {
          await authority.releaseDelivery(claim)
        } catch {
          // Provider I/O never started. A normal Job retry is safe and gives the
          // authority another chance to clear the durable claim.
          throw new PlatformConversationOutboundTransportError(authoritativeIntent.transport)
        }
        return authorityBlockedOutcome(providerIOStarted.reason, authoritativeIntent.transport)
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
    } catch (error) {
      if (!sendError) {
        throw new PlatformConversationDeliveryPersistenceError(
          outcome ?? deliveryUnknown(authoritativeIntent.transport),
          error,
        )
      }
    }

    if (sendError) throw sendError
    return outcome ?? deliveryUnknown(authoritativeIntent.transport)
  },
})
