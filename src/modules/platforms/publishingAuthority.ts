import { normalizePlatformPublishRequest, type PublishingService } from '../publishing/contracts'
import {
  executePlatformPublication,
  type PlatformPublishExecutionSnapshot,
  type PlatformPublishExecutionTransition,
} from './publishingExecution'
import { ProviderPublicationTransportError } from './publishingResult'

export const PLATFORM_PUBLICATION_BLOCK_REASONS = [
  'busy',
  'claim_conflict',
  'intent_mismatch',
  'lease_conflict',
  'missing_intent',
  'stale_revision',
] as const

export type PlatformPublicationBlockReason = (typeof PLATFORM_PUBLICATION_BLOCK_REASONS)[number]

export type PlatformPublicationIntent = {
  expectedRevision: number
  publishJobId: number
  snapshot: PlatformPublishExecutionSnapshot
}

export type PlatformPublicationLeaseFence = {
  leaseExpiresAt: string
  ownerToken: string
  queueJobId: number
}

export type PlatformPublicationClaim = {
  claimId: string
  fencingGeneration: number
  intent: PlatformPublicationIntent
  leaseFence: PlatformPublicationLeaseFence
  /** Recovery never invokes publish: provider acceptance cannot be safely replayed. */
  mode: 'recover' | 'send'
}

export type PlatformPublicationClaimResult =
  | { claim: PlatformPublicationClaim; status: 'claimed' }
  | { reason: PlatformPublicationBlockReason; status: 'blocked' }

export type PlatformPublicationMarkResult =
  { status: 'fenced' } | { reason: PlatformPublicationBlockReason; status: 'blocked' }

export type PlatformPublicationCommitResult =
  | { nextRevision: number; status: 'committed' }
  | { reason: PlatformPublicationBlockReason; status: 'blocked' }

export type PlatformPublicationCommitRecovery =
  | { status: 'claim_released' }
  | { nextRevision: number; status: 'state_advanced' }
  | { retryNotBefore: string; status: 'claim_retained' }

/** Persistent CAS boundary shared by single-call Facebook and LinkedIn publication. */
export interface PlatformPublicationAuthorityPort {
  claimPublication(
    intent: PlatformPublicationIntent,
    leaseFence: PlatformPublicationLeaseFence,
  ): Promise<PlatformPublicationClaimResult>
  /** Used only before the irreversible publish mutation, never before status GET. */
  markProviderIOStarted(claim: PlatformPublicationClaim): Promise<PlatformPublicationMarkResult>
  commitPublication(
    claim: PlatformPublicationClaim,
    transition: PlatformPublishExecutionTransition,
  ): Promise<PlatformPublicationCommitResult>
  /**
   * Resolve a failed post-I/O checkpoint without erasing the provider marker.
   * A retained claim must not be retried before its persisted lease expires.
   */
  recoverFailedCommit(claim: PlatformPublicationClaim): Promise<PlatformPublicationCommitRecovery>
  /** Valid only when mutation I/O never crossed its persisted boundary. */
  releasePublication(claim: PlatformPublicationClaim): Promise<void>
}

export type PlatformPublicationExecutionResult =
  | { reason: PlatformPublicationBlockReason; status: 'blocked' }
  | {
      recovery: PlatformPublicationCommitRecovery
      status: 'checkpoint_pending'
      transition: PlatformPublishExecutionTransition
    }
  | { status: 'transitioned'; transition: PlatformPublishExecutionTransition }

const terminal = new Set(['delivery_unknown', 'failed', 'published'])

const boundedString = (value: unknown, maxLength: number): string | undefined => {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  return normalized && normalized === value && normalized.length <= maxLength
    ? normalized
    : undefined
}

const normalizeSnapshot = (input: unknown): PlatformPublishExecutionSnapshot | undefined => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined
  const snapshot = input as Partial<PlatformPublishExecutionSnapshot>
  if (
    !['scheduled', 'accepted', 'publishing', 'published', 'failed', 'delivery_unknown'].includes(
      snapshot.status ?? '',
    )
  ) {
    return undefined
  }
  let request: ReturnType<typeof normalizePlatformPublishRequest>
  try {
    request = normalizePlatformPublishRequest(snapshot)
  } catch {
    return undefined
  }
  const expectedAuthorizationRevision = request.expectedAuthorizationRevision
  if (!Number.isSafeInteger(expectedAuthorizationRevision) || expectedAuthorizationRevision! < 0) {
    return undefined
  }
  const externalPublicationId =
    snapshot.externalPublicationId === undefined
      ? undefined
      : boundedString(snapshot.externalPublicationId, 500)
  if (snapshot.externalPublicationId !== undefined && !externalPublicationId) return undefined
  return {
    assets: request.assets,
    expectedAuthorizationRevision: expectedAuthorizationRevision!,
    ...(externalPublicationId ? { externalPublicationId } : {}),
    idempotencyKey: request.idempotencyKey,
    platform: request.platform,
    platformAccountId: request.platformAccountId,
    ...(request.scheduledFor ? { scheduledFor: request.scheduledFor } : {}),
    status: snapshot.status!,
    text: request.text,
  }
}

const normalizeIntent = (input: unknown): PlatformPublicationIntent | undefined => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined
  const intent = input as Partial<PlatformPublicationIntent>
  const snapshot = normalizeSnapshot(intent.snapshot)
  if (
    !snapshot ||
    !Number.isSafeInteger(intent.publishJobId) ||
    (intent.publishJobId as number) < 1 ||
    !Number.isSafeInteger(intent.expectedRevision) ||
    (intent.expectedRevision as number) < 0
  ) {
    return undefined
  }
  return {
    expectedRevision: intent.expectedRevision as number,
    publishJobId: intent.publishJobId as number,
    snapshot,
  }
}

const normalizeLease = (input: unknown): PlatformPublicationLeaseFence | undefined => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined
  const lease = input as Partial<PlatformPublicationLeaseFence>
  const ownerToken = boundedString(lease.ownerToken, 240)
  if (
    !ownerToken ||
    !Number.isSafeInteger(lease.queueJobId) ||
    (lease.queueJobId as number) < 1 ||
    typeof lease.leaseExpiresAt !== 'string' ||
    !Number.isFinite(Date.parse(lease.leaseExpiresAt))
  ) {
    return undefined
  }
  return {
    leaseExpiresAt: lease.leaseExpiresAt,
    ownerToken,
    queueJobId: lease.queueJobId as number,
  }
}

const sameSnapshot = (
  left: PlatformPublishExecutionSnapshot,
  right: PlatformPublishExecutionSnapshot,
): boolean =>
  left.idempotencyKey === right.idempotencyKey &&
  left.expectedAuthorizationRevision === right.expectedAuthorizationRevision &&
  left.platform === right.platform &&
  left.platformAccountId === right.platformAccountId &&
  left.externalPublicationId === right.externalPublicationId &&
  left.scheduledFor === right.scheduledFor &&
  left.status === right.status &&
  left.text === right.text &&
  JSON.stringify(left.assets) === JSON.stringify(right.assets)

export const samePlatformPublicationIntent = (
  left: PlatformPublicationIntent,
  right: PlatformPublicationIntent,
): boolean =>
  left.expectedRevision === right.expectedRevision &&
  left.publishJobId === right.publishJobId &&
  sameSnapshot(left.snapshot, right.snapshot)

const sameLeaseOwner = (
  left: PlatformPublicationLeaseFence,
  right: PlatformPublicationLeaseFence,
): boolean => left.queueJobId === right.queueJobId && left.ownerToken === right.ownerToken

const isClaim = (input: unknown): input is PlatformPublicationClaim => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return false
  const claim = input as Partial<PlatformPublicationClaim>
  const intent = normalizeIntent(claim.intent)
  const lease = normalizeLease(claim.leaseFence)
  return (
    Boolean(boundedString(claim.claimId, 240)) &&
    Number.isSafeInteger(claim.fencingGeneration) &&
    (claim.fencingGeneration as number) > 0 &&
    Boolean(intent) &&
    Boolean(lease) &&
    (claim.mode === 'recover' || claim.mode === 'send')
  )
}

const unknownTransition = (summary: string): PlatformPublishExecutionTransition => ({
  changed: true,
  event: 'delivery-unknown',
  lastErrorCode: 'delivery_unknown',
  retryable: false,
  status: 'delivery_unknown',
  summary,
})

const bestEffortRelease = async (
  authority: PlatformPublicationAuthorityPort,
  claim: PlatformPublicationClaim,
): Promise<void> => {
  try {
    await authority.releasePublication(claim)
  } catch {
    // No mutation I/O crossed the fence; a stale claim remains safe to reclaim.
  }
}

const recoverFailedCheckpoint = async (
  authority: PlatformPublicationAuthorityPort,
  claim: PlatformPublicationClaim,
): Promise<PlatformPublicationCommitRecovery> => {
  try {
    return await authority.recoverFailedCommit(claim)
  } catch {
    return {
      retryNotBefore: claim.leaseFence.leaseExpiresAt,
      status: 'claim_retained',
    }
  }
}

/**
 * Execute one single-call publication or one read-only status lookup behind a
 * persistent Job lease. Instagram's multi-stage media flow uses its stricter
 * stage authority instead of this helper.
 */
export const executeLeaseFencedPublication = async ({
  authority,
  intent: intentInput,
  leaseFence: leaseInput,
  service,
}: {
  authority: PlatformPublicationAuthorityPort
  intent: PlatformPublicationIntent
  leaseFence: PlatformPublicationLeaseFence
  service: PublishingService
}): Promise<PlatformPublicationExecutionResult> => {
  const intent = normalizeIntent(intentInput)
  const leaseFence = normalizeLease(leaseInput)
  if (!intent || !leaseFence) throw new Error('Platform publication input is invalid')
  if (intent.snapshot.platform === 'instagram') {
    return { reason: 'intent_mismatch', status: 'blocked' }
  }
  if (terminal.has(intent.snapshot.status)) {
    return {
      status: 'transitioned',
      transition: { changed: false, status: intent.snapshot.status },
    }
  }
  const claimResult = await authority.claimPublication(intent, leaseFence)
  if (claimResult.status === 'blocked') return claimResult
  const claim = claimResult.claim
  if (
    !isClaim(claim) ||
    !samePlatformPublicationIntent(claim.intent, intent) ||
    !sameLeaseOwner(claim.leaseFence, leaseFence)
  ) {
    await bestEffortRelease(authority, claim)
    return { reason: 'intent_mismatch', status: 'blocked' }
  }

  if (claim.mode === 'recover') {
    const transition = unknownTransition(
      'A previous provider mutation crossed the send boundary without a persisted result; resend is disabled.',
    )
    let committed = false
    try {
      const commit = await authority.commitPublication(claim, transition)
      committed = commit.status === 'committed'
    } catch {
      committed = false
    }
    if (!committed)
      return {
        recovery: await recoverFailedCheckpoint(authority, claim),
        status: 'checkpoint_pending',
        transition,
      }
    return { status: 'transitioned', transition }
  }

  const isMutation = claim.intent.snapshot.status === 'scheduled'
  if (isMutation) {
    let mark: PlatformPublicationMarkResult
    try {
      mark = await authority.markProviderIOStarted(claim)
    } catch {
      mark = { reason: 'claim_conflict', status: 'blocked' }
    }
    if (mark.status === 'blocked') {
      await bestEffortRelease(authority, claim)
      return mark
    }
  }

  let transition: PlatformPublishExecutionTransition
  let preIOTransportError: ProviderPublicationTransportError | undefined
  try {
    transition = await executePlatformPublication({ service, snapshot: claim.intent.snapshot })
  } catch (error) {
    if (!isMutation) {
      await bestEffortRelease(authority, claim)
      throw error
    }
    if (error instanceof ProviderPublicationTransportError) {
      preIOTransportError = error
      transition = {
        changed: false,
        lastErrorCode: 'provider_unavailable',
        retryable: true,
        status: claim.intent.snapshot.status,
        summary: 'Publication provider I/O did not begin; a fresh claimed attempt is allowed.',
      }
    } else {
      transition = unknownTransition(
        'The publication provider call failed after crossing the send fence; resend is disabled.',
      )
    }
  }

  let committed = false
  try {
    const commit = await authority.commitPublication(claim, transition)
    committed = commit.status === 'committed'
  } catch {
    committed = false
  }
  if (!committed) {
    if (!isMutation)
      throw new Error('Platform publication status checkpoint could not be committed')
    return {
      recovery: await recoverFailedCheckpoint(authority, claim),
      status: 'checkpoint_pending',
      transition,
    }
  }
  if (preIOTransportError && committed) throw preIOTransportError
  return { status: 'transitioned', transition }
}
