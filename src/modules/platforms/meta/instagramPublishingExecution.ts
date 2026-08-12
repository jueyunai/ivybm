import {
  ProviderPublicationConfirmedError,
  ProviderPublicationResultUnknownError,
  ProviderPublicationTransportError,
} from '../publishingResult'
import type { MetaPublishingTransport } from './publishingOutbound'

export const INSTAGRAM_PUBLISHING_STAGES = [
  'scheduled',
  'container_created',
  'container_ready',
  'publishing',
  'published',
  'failed',
  'delivery_unknown',
] as const

export type InstagramPublishingStage = (typeof INSTAGRAM_PUBLISHING_STAGES)[number]

export type InstagramPublishingCheckpoint = {
  accountExternalId: string
  caption?: string
  containerId?: string
  imageUrl: string
  mediaId?: string
  stage: InstagramPublishingStage
}

export type InstagramPublishingIntent = {
  checkpoint: InstagramPublishingCheckpoint
  expectedRevision: number
  idempotencyKey: string
  jobId: number
  platform: 'instagram'
  platformAccountId: number | string
}

export type InstagramPublishingLeaseFence = {
  jobId: number
  leaseExpiresAt: string
  ownerToken: string
}

export const INSTAGRAM_PUBLISHING_BLOCK_REASONS = [
  'busy',
  'claim_conflict',
  'intent_mismatch',
  'lease_conflict',
  'missing_intent',
  'stale_revision',
] as const

export type InstagramPublishingBlockReason = (typeof INSTAGRAM_PUBLISHING_BLOCK_REASONS)[number]

export type InstagramPublishingClaim = {
  claimId: string
  fencingGeneration: number
  intent: InstagramPublishingIntent
  leaseFence: InstagramPublishingLeaseFence
  /** A recovered claim must fail closed; Meta has no safe mutation replay key. */
  mode: 'recover' | 'send'
}

export type InstagramPublishingClaimResult =
  | { claim: InstagramPublishingClaim; status: 'claimed' }
  | { reason: InstagramPublishingBlockReason; status: 'blocked' }

export type InstagramPublishingMarkResult =
  { status: 'fenced' } | { reason: InstagramPublishingBlockReason; status: 'blocked' }

export type InstagramPublishingCommitResult =
  | { nextRevision: number; status: 'committed' }
  | { reason: InstagramPublishingBlockReason; status: 'blocked' }

export type InstagramPublishingTransition = {
  changed: boolean
  checkpoint: InstagramPublishingCheckpoint
  event?:
    'blocked' | 'container-created' | 'failed' | 'published' | 'publishing' | 'ready' | 'unknown'
  errorCode?: string
  retryable?: boolean
  summary?: string
}

/**
 * Persistence authority for one PublishJob stage. A production implementation
 * must claim and commit with a single-row CAS that binds the PublishJob,
 * PlatformAccount, idempotency key, revision and current Jobs lease.
 */
export interface InstagramPublishingAuthorityPort {
  claimStage(
    intent: InstagramPublishingIntent,
    leaseFence: InstagramPublishingLeaseFence,
  ): Promise<InstagramPublishingClaimResult>
  /** Persist the irreversible provider-I/O boundary before any Graph call. */
  markProviderIOStarted(claim: InstagramPublishingClaim): Promise<InstagramPublishingMarkResult>
  /** Atomically persist the next checkpoint/revision and release the claim. */
  commitStage(
    claim: InstagramPublishingClaim,
    transition: InstagramPublishingTransition,
  ): Promise<InstagramPublishingCommitResult>
  /** Release only when provider I/O did not start. */
  releaseStage(claim: InstagramPublishingClaim): Promise<void>
}

const terminal = new Set<InstagramPublishingStage>(['delivery_unknown', 'failed', 'published'])

const isStableIdentity = (value: unknown): value is number | string =>
  (typeof value === 'number' && Number.isSafeInteger(value)) ||
  (typeof value === 'string' && Boolean(value.trim()) && value.length <= 240)

const boundedString = (value: unknown, maxLength: number): string | undefined => {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  if (
    !normalized ||
    normalized !== value ||
    normalized.length > maxLength ||
    /[\u0000-\u001F\u007F-\u009F]/u.test(normalized)
  ) {
    return undefined
  }
  return normalized
}

const normalizedProviderId = (value: unknown): string | undefined =>
  typeof value === 'string' && /^[0-9]{1,32}$/.test(value) ? value : undefined

const normalizeCheckpoint = (input: unknown): InstagramPublishingCheckpoint | undefined => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined
  const checkpoint = input as Partial<InstagramPublishingCheckpoint>
  const accountExternalId = boundedString(checkpoint.accountExternalId, 240)
  const imageUrl = boundedString(checkpoint.imageUrl, 2_000)
  const caption =
    checkpoint.caption === undefined ? undefined : boundedString(checkpoint.caption, 2_200)
  const containerId =
    checkpoint.containerId === undefined ? undefined : normalizedProviderId(checkpoint.containerId)
  const mediaId =
    checkpoint.mediaId === undefined ? undefined : normalizedProviderId(checkpoint.mediaId)
  if (
    !accountExternalId ||
    !imageUrl ||
    (checkpoint.caption !== undefined && !caption) ||
    (checkpoint.containerId !== undefined && !containerId) ||
    (checkpoint.mediaId !== undefined && !mediaId) ||
    !INSTAGRAM_PUBLISHING_STAGES.includes(checkpoint.stage as InstagramPublishingStage)
  ) {
    return undefined
  }
  return {
    accountExternalId,
    ...(caption ? { caption } : {}),
    ...(containerId ? { containerId } : {}),
    imageUrl,
    ...(mediaId ? { mediaId } : {}),
    stage: checkpoint.stage as InstagramPublishingStage,
  }
}

const normalizeIntent = (input: unknown): InstagramPublishingIntent | undefined => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined
  const intent = input as Partial<InstagramPublishingIntent>
  const checkpoint = normalizeCheckpoint(intent.checkpoint)
  const idempotencyKey = boundedString(intent.idempotencyKey, 200)
  if (
    !checkpoint ||
    !idempotencyKey ||
    intent.platform !== 'instagram' ||
    !isStableIdentity(intent.platformAccountId) ||
    !Number.isSafeInteger(intent.jobId) ||
    (intent.jobId as number) < 1 ||
    !Number.isSafeInteger(intent.expectedRevision) ||
    (intent.expectedRevision as number) < 0
  ) {
    return undefined
  }
  return {
    checkpoint,
    expectedRevision: intent.expectedRevision as number,
    idempotencyKey,
    jobId: intent.jobId as number,
    platform: 'instagram',
    platformAccountId: intent.platformAccountId,
  }
}

const normalizeLeaseFence = (input: unknown): InstagramPublishingLeaseFence | undefined => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined
  const fence = input as Partial<InstagramPublishingLeaseFence>
  const ownerToken = boundedString(fence.ownerToken, 240)
  if (
    !ownerToken ||
    !Number.isSafeInteger(fence.jobId) ||
    (fence.jobId as number) < 1 ||
    typeof fence.leaseExpiresAt !== 'string' ||
    !Number.isFinite(Date.parse(fence.leaseExpiresAt))
  ) {
    return undefined
  }
  return {
    jobId: fence.jobId as number,
    leaseExpiresAt: fence.leaseExpiresAt,
    ownerToken,
  }
}

const sameCheckpoint = (
  left: InstagramPublishingCheckpoint,
  right: InstagramPublishingCheckpoint,
): boolean =>
  left.accountExternalId === right.accountExternalId &&
  left.caption === right.caption &&
  left.containerId === right.containerId &&
  left.imageUrl === right.imageUrl &&
  left.mediaId === right.mediaId &&
  left.stage === right.stage

export const sameInstagramPublishingIntent = (
  left: InstagramPublishingIntent,
  right: InstagramPublishingIntent,
): boolean =>
  left.expectedRevision === right.expectedRevision &&
  left.idempotencyKey === right.idempotencyKey &&
  left.jobId === right.jobId &&
  left.platform === right.platform &&
  left.platformAccountId === right.platformAccountId &&
  sameCheckpoint(left.checkpoint, right.checkpoint)

const sameLeaseOwner = (
  left: InstagramPublishingLeaseFence,
  right: InstagramPublishingLeaseFence,
): boolean => left.jobId === right.jobId && left.ownerToken === right.ownerToken

const isClaim = (input: unknown): input is InstagramPublishingClaim => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return false
  const claim = input as Partial<InstagramPublishingClaim>
  const intent = normalizeIntent(claim.intent)
  const leaseFence = normalizeLeaseFence(claim.leaseFence)
  return (
    Boolean(boundedString(claim.claimId, 240)) &&
    Number.isSafeInteger(claim.fencingGeneration) &&
    (claim.fencingGeneration as number) > 0 &&
    Boolean(intent) &&
    Boolean(leaseFence) &&
    intent?.jobId === leaseFence?.jobId &&
    (claim.mode === 'recover' || claim.mode === 'send')
  )
}

const failed = (
  checkpoint: InstagramPublishingCheckpoint,
  error: ProviderPublicationConfirmedError,
): InstagramPublishingTransition => ({
  changed: true,
  checkpoint: { ...checkpoint, stage: 'failed' },
  errorCode: error.code,
  event: 'failed',
  retryable: error.retryable,
  summary: 'Instagram confirmed that this publication stage failed.',
})

const unknown = (
  checkpoint: InstagramPublishingCheckpoint,
  summary: string,
): InstagramPublishingTransition => ({
  changed: true,
  checkpoint: { ...checkpoint, stage: 'delivery_unknown' },
  errorCode: 'delivery_unknown',
  event: 'unknown',
  retryable: false,
  summary,
})

const blocked = (
  checkpoint: InstagramPublishingCheckpoint,
  reason: InstagramPublishingBlockReason,
): InstagramPublishingTransition => ({
  changed: false,
  checkpoint,
  errorCode: reason,
  event: 'blocked',
  retryable: reason === 'busy' || reason === 'claim_conflict' || reason === 'lease_conflict',
  summary: 'Instagram publishing is blocked by the authoritative persistence fence.',
})

const runClaimedStage = async (
  checkpoint: InstagramPublishingCheckpoint,
  transport: MetaPublishingTransport,
): Promise<InstagramPublishingTransition> => {
  if (checkpoint.stage === 'scheduled') {
    const result = await transport.createInstagramMedia({
      accountExternalId: checkpoint.accountExternalId,
      caption: checkpoint.caption,
      imageUrl: checkpoint.imageUrl,
    })
    const containerId = normalizedProviderId(result.creationId)
    if (!containerId) {
      return unknown(checkpoint, 'Instagram container identifier is unknown; resend is disabled.')
    }
    return {
      changed: true,
      checkpoint: { ...checkpoint, containerId, stage: 'container_created' },
      event: 'container-created',
      summary: 'Instagram media container was created and checkpointed.',
    }
  }

  if (checkpoint.stage === 'container_created') {
    const containerId = normalizedProviderId(checkpoint.containerId)
    if (!containerId) {
      return unknown(checkpoint, 'Persisted Instagram container identifier is invalid.')
    }
    const result = await transport.getInstagramContainerStatus({
      accountExternalId: checkpoint.accountExternalId,
      containerId,
    })
    if (result.state === 'ready') {
      return {
        changed: true,
        checkpoint: { ...checkpoint, containerId, stage: 'container_ready' },
        event: 'ready',
        summary: 'Instagram media container is ready to publish.',
      }
    }
    if (result.state === 'pending') {
      return {
        changed: false,
        checkpoint: { ...checkpoint, containerId },
        event: 'publishing',
        summary: 'Instagram media container is still processing.',
      }
    }
    if (result.state === 'published') {
      return unknown(
        checkpoint,
        'Instagram reports the container as published without a stored media ID.',
      )
    }
    return {
      changed: true,
      checkpoint: { ...checkpoint, containerId, stage: 'failed' },
      errorCode: 'platform_blocked',
      event: 'failed',
      retryable: false,
      summary: 'Instagram media container expired or failed processing.',
    }
  }

  if (checkpoint.stage === 'container_ready') {
    const containerId = normalizedProviderId(checkpoint.containerId)
    if (!containerId) {
      return unknown(checkpoint, 'Persisted Instagram container identifier is invalid.')
    }
    const result = await transport.publishInstagramMedia({
      accountExternalId: checkpoint.accountExternalId,
      creationId: containerId,
    })
    const mediaId = normalizedProviderId(result.igMediaId)
    if (!mediaId) {
      return unknown(checkpoint, 'Instagram media identifier is unknown; resend is disabled.')
    }
    return {
      changed: true,
      checkpoint: { ...checkpoint, containerId, mediaId, stage: 'published' },
      event: 'published',
      summary: 'Instagram confirmed publication.',
    }
  }

  return unknown(
    checkpoint,
    checkpoint.stage === 'publishing'
      ? 'Instagram publish began without a persisted provider result; resend is disabled.'
      : 'Instagram publishing checkpoint is unsupported.',
  )
}

/**
 * Execute exactly one Instagram stage behind an authoritative Job lease. The
 * provider boundary is persisted before Graph I/O; a reclaimed started claim
 * becomes delivery_unknown and is never replayed.
 */
export const executeInstagramPublishingStage = async ({
  authority,
  intent: intentInput,
  leaseFence: leaseInput,
  transport,
}: {
  authority: InstagramPublishingAuthorityPort
  intent: InstagramPublishingIntent
  leaseFence: InstagramPublishingLeaseFence
  transport: MetaPublishingTransport
}): Promise<InstagramPublishingTransition> => {
  const intent = normalizeIntent(intentInput)
  const leaseFence = normalizeLeaseFence(leaseInput)
  if (!intent || !leaseFence) throw new Error('Instagram publishing input is invalid')
  if (terminal.has(intent.checkpoint.stage)) {
    return { changed: false, checkpoint: intent.checkpoint }
  }
  if (intent.jobId !== leaseFence.jobId) {
    return blocked(intent.checkpoint, 'intent_mismatch')
  }

  const claimResult = await authority.claimStage(intent, leaseFence)
  if (claimResult.status === 'blocked') {
    return blocked(intent.checkpoint, claimResult.reason)
  }
  const claim = claimResult.claim
  if (
    !isClaim(claim) ||
    !sameInstagramPublishingIntent(claim.intent, intent) ||
    !sameLeaseOwner(claim.leaseFence, leaseFence)
  ) {
    try {
      await authority.releaseStage(claim)
    } catch {
      // No provider I/O occurred. Malformed authority state remains blocked.
    }
    return blocked(intent.checkpoint, 'intent_mismatch')
  }

  if (claim.mode === 'recover') {
    const transition = unknown(
      claim.intent.checkpoint,
      'A previous Instagram provider call crossed the send boundary without a persisted result; resend is disabled.',
    )
    try {
      await authority.commitStage(claim, transition)
    } catch {
      // The caller still receives fail-closed state; a future reclaim remains recovery-only.
    }
    return transition
  }

  let markResult: InstagramPublishingMarkResult
  try {
    markResult = await authority.markProviderIOStarted(claim)
  } catch {
    return blocked(intent.checkpoint, 'claim_conflict')
  }
  if (markResult.status === 'blocked') {
    try {
      await authority.releaseStage(claim)
    } catch {
      // Provider I/O never started, so retry remains safe after a fresh claim.
    }
    return blocked(intent.checkpoint, markResult.reason)
  }

  let transition: InstagramPublishingTransition
  let preIOTransportError: ProviderPublicationTransportError | undefined
  try {
    transition = await runClaimedStage(claim.intent.checkpoint, transport)
  } catch (error) {
    if (error instanceof ProviderPublicationConfirmedError) {
      transition = failed(claim.intent.checkpoint, error)
    } else if (error instanceof ProviderPublicationResultUnknownError) {
      transition = unknown(
        claim.intent.checkpoint,
        'Instagram publication outcome is unknown; resend is disabled.',
      )
    } else if (error instanceof ProviderPublicationTransportError) {
      preIOTransportError = error
      transition = {
        changed: false,
        checkpoint: claim.intent.checkpoint,
        errorCode: 'provider_unavailable',
        event: 'blocked',
        retryable: true,
        summary: 'Instagram provider I/O did not begin; a fresh claimed attempt is allowed.',
      }
    } else {
      transition = unknown(
        claim.intent.checkpoint,
        'Instagram publication outcome is unknown; resend is disabled.',
      )
    }
  }

  let committed = false
  try {
    const commit = await authority.commitStage(claim, transition)
    committed = commit.status === 'committed'
  } catch {
    committed = false
  }
  if (!committed) {
    return unknown(
      claim.intent.checkpoint,
      'Instagram provider I/O crossed the fence but its checkpoint could not be committed; resend is disabled.',
    )
  }
  if (preIOTransportError) throw preIOTransportError
  return transition
}
