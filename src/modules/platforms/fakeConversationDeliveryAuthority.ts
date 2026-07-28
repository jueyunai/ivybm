import { isAutomaticPlatformConversationReplyAllowed } from './types'
import type { PlatformConversationDeliveryAuthorityPort } from './ports'
import type {
  PlatformConversationDeliveryClaim,
  PlatformConversationDeliveryClaimResult,
  PlatformConversationDeliveryIntent,
  PlatformConversationDeliveryLeaseFence,
  PlatformConversationDeliveryMarkResult,
  PlatformConversationDeliveryOutcome,
  PlatformConversationDeliverySnapshot,
} from './types'

export type FakePlatformConversationDeliveryAuthority =
  PlatformConversationDeliveryAuthorityPort & {
    /** Simulate worker-lease expiry; a started attempt must be recovered on reclaim. */
    expireDeliveryClaim(conversationId: number | string): boolean
    getDeliverySnapshot(
      conversationId: number | string,
    ): PlatformConversationDeliverySnapshot | undefined
    getJobLease(jobId: number): PlatformConversationDeliveryLeaseFence | undefined
    registerDeliveryIntent(intent: PlatformConversationDeliveryIntent): void
    setJobLease(leaseFence: PlatformConversationDeliveryLeaseFence): void
    setDeliverySnapshot(snapshot: PlatformConversationDeliverySnapshot): boolean
  }

const compositeKey = (...parts: Array<number | string>): string =>
  JSON.stringify(parts.map((part) => [typeof part, part]))

const conversationKey = (conversationId: number | string): string =>
  compositeKey(conversationId)

const intentIdentityKey = (intent: PlatformConversationDeliveryIntent): string =>
  compositeKey(
    intent.conversationId,
    intent.replyId,
    intent.transport.platform,
    intent.transport.accountExternalId,
    intent.transport.deliveryKey,
  )

const sameIntent = (
  stored: PlatformConversationDeliveryIntent,
  input: PlatformConversationDeliveryIntent,
): boolean =>
  stored.conversationId === input.conversationId &&
  stored.expectedRevision === input.expectedRevision &&
  stored.replyId === input.replyId &&
  stored.transport.accountExternalId === input.transport.accountExternalId &&
  stored.transport.deliveryKey === input.transport.deliveryKey &&
  stored.transport.platform === input.transport.platform &&
  stored.transport.recipientExternalId === input.transport.recipientExternalId &&
  stored.transport.text === input.transport.text

const sameLeaseFence = (
  stored: PlatformConversationDeliveryLeaseFence,
  input: PlatformConversationDeliveryLeaseFence,
): boolean =>
  stored.jobId === input.jobId &&
  stored.leaseExpiresAt === input.leaseExpiresAt &&
  stored.ownerToken === input.ownerToken

const isUnexpiredLease = (leaseFence: PlatformConversationDeliveryLeaseFence): boolean => {
  const expiresAt = Date.parse(leaseFence.leaseExpiresAt)
  return Number.isFinite(expiresAt) && expiresAt > Date.now()
}

/**
 * In-memory CAS/claim authority fake. It performs no Payload or network I/O;
 * future persistence must serialize the same claim with handoff transitions.
 */
export const createFakePlatformConversationDeliveryAuthority = ({
  initialIntents = [],
  initialJobLeases = [],
  initialSnapshots = [],
}: {
  initialIntents?: PlatformConversationDeliveryIntent[]
  initialJobLeases?: PlatformConversationDeliveryLeaseFence[]
  initialSnapshots?: PlatformConversationDeliverySnapshot[]
} = {}): FakePlatformConversationDeliveryAuthority => {
  const activeClaims = new Map<
    string,
    { claim: PlatformConversationDeliveryClaim; providerIOStarted: boolean }
  >()
  const fencingGenerations = new Map<string, number>()
  const intents = new Map<string, PlatformConversationDeliveryIntent>()
  const jobLeases = new Map<number, PlatformConversationDeliveryLeaseFence>()
  const recoveryRequired = new Map<string, PlatformConversationDeliveryIntent>()
  const snapshots = new Map<string, PlatformConversationDeliverySnapshot>()
  let nextClaimId = 1

  const registerDeliveryIntent = (intent: PlatformConversationDeliveryIntent): void => {
    const key = intentIdentityKey(intent)
    const existing = intents.get(key)
    if (existing && !sameIntent(existing, intent)) {
      throw new Error('Fake platform conversation delivery intent identity is already registered')
    }
    intents.set(key, structuredClone(intent))
  }

  const setDeliverySnapshot = (snapshot: PlatformConversationDeliverySnapshot): boolean => {
    const key = conversationKey(snapshot.conversationId)
    if (activeClaims.has(key)) return false
    snapshots.set(key, structuredClone(snapshot))
    return true
  }

  const setJobLease = (leaseFence: PlatformConversationDeliveryLeaseFence): void => {
    jobLeases.set(leaseFence.jobId, structuredClone(leaseFence))
  }

  for (const intent of initialIntents) registerDeliveryIntent(intent)
  for (const leaseFence of initialJobLeases) setJobLease(leaseFence)
  for (const snapshot of initialSnapshots) setDeliverySnapshot(snapshot)

  const claimDelivery = async (
    input: PlatformConversationDeliveryIntent,
    leaseFence: PlatformConversationDeliveryLeaseFence,
  ): Promise<PlatformConversationDeliveryClaimResult> => {
    const key = conversationKey(input.conversationId)
    const snapshot = snapshots.get(key)
    const identity = intentIdentityKey(input)
    const stored = intents.get(identity)
    const recoveryIntent = recoveryRequired.get(identity)
    const requiresRecovery = Boolean(recoveryIntent && sameIntent(recoveryIntent, input))
    const currentLease = jobLeases.get(leaseFence.jobId)
    if (activeClaims.has(key)) return { reason: 'busy', status: 'blocked' }
    if (!currentLease || !sameLeaseFence(currentLease, leaseFence) || !isUnexpiredLease(currentLease)) {
      return { reason: 'lease_conflict', status: 'blocked' }
    }
    if (!snapshot) return { reason: 'missing_snapshot', status: 'blocked' }
    if (!stored) return { reason: 'missing_intent', status: 'blocked' }
    if (!sameIntent(stored, input)) return { reason: 'intent_mismatch', status: 'blocked' }
    if (!requiresRecovery && !isAutomaticPlatformConversationReplyAllowed(snapshot.handoffStatus)) {
      return { reason: 'handoff_required', status: 'blocked' }
    }
    if (!requiresRecovery && snapshot.revision !== input.expectedRevision) {
      return { reason: 'stale_revision', status: 'blocked' }
    }

    const fencingGeneration = (fencingGenerations.get(key) ?? 0) + 1
    fencingGenerations.set(key, fencingGeneration)
    const claim: PlatformConversationDeliveryClaim = {
      claimId: `fake-delivery-claim-${nextClaimId++}`,
      fencingGeneration,
      intent: structuredClone(stored),
      leaseFence: structuredClone(leaseFence),
      mode: requiresRecovery ? 'recover' : 'send',
    }
    activeClaims.set(key, { claim, providerIOStarted: false })
    return { claim: structuredClone(claim), status: 'claimed' }
  }

  const markProviderIOStarted = async (
    claim: PlatformConversationDeliveryClaim,
  ): Promise<PlatformConversationDeliveryMarkResult> => {
    const key = conversationKey(claim.intent.conversationId)
    const active = activeClaims.get(key)
    const snapshot = snapshots.get(key)
    if (
      !active ||
      active.claim.claimId !== claim.claimId ||
      active.claim.fencingGeneration !== claim.fencingGeneration ||
      !sameIntent(active.claim.intent, claim.intent) ||
      !sameLeaseFence(active.claim.leaseFence, claim.leaseFence)
    ) {
      return { reason: 'claim_conflict', status: 'blocked' }
    }
    const currentLease = jobLeases.get(claim.leaseFence.jobId)
    if (
      !currentLease ||
      !sameLeaseFence(currentLease, claim.leaseFence) ||
      !isUnexpiredLease(currentLease)
    ) {
      return { reason: 'lease_conflict', status: 'blocked' }
    }
    if (!snapshot) return { reason: 'missing_snapshot', status: 'blocked' }
    if (!isAutomaticPlatformConversationReplyAllowed(snapshot.handoffStatus)) {
      return { reason: 'handoff_required', status: 'blocked' }
    }
    if (snapshot.revision !== claim.intent.expectedRevision) {
      return { reason: 'stale_revision', status: 'blocked' }
    }
    active.providerIOStarted = true
    return { status: 'fenced' }
  }

  const releaseDelivery = async (
    claim: PlatformConversationDeliveryClaim,
    outcome?: PlatformConversationDeliveryOutcome,
  ): Promise<void> => {
    const key = conversationKey(claim.intent.conversationId)
    const active = activeClaims.get(key)
    const currentLease = jobLeases.get(claim.leaseFence.jobId)
    if (
      !active ||
      active.claim.claimId !== claim.claimId ||
      active.claim.fencingGeneration !== claim.fencingGeneration ||
      !sameIntent(active.claim.intent, claim.intent) ||
      !sameLeaseFence(active.claim.leaseFence, claim.leaseFence) ||
      !currentLease ||
      !sameLeaseFence(currentLease, claim.leaseFence) ||
      !isUnexpiredLease(currentLease)
    ) {
      throw new Error('Fake platform conversation delivery claim is invalid or no longer active')
    }
    activeClaims.delete(key)
    const identity = intentIdentityKey(claim.intent)
    if (outcome && ['delivery_unknown', 'retry_same_delivery_key'].includes(outcome.status)) {
      recoveryRequired.set(identity, structuredClone(claim.intent))
    } else if (!outcome && active.providerIOStarted) {
      recoveryRequired.set(identity, structuredClone(claim.intent))
    } else if (outcome) {
      recoveryRequired.delete(identity)
    }
  }

  const expireDeliveryClaim = (conversationId: number | string): boolean => {
    const key = conversationKey(conversationId)
    const active = activeClaims.get(key)
    if (!active) return false
    if (active.providerIOStarted) {
      recoveryRequired.set(intentIdentityKey(active.claim.intent), structuredClone(active.claim.intent))
    }
    activeClaims.delete(key)
    return true
  }

  const getDeliverySnapshot = (
    conversationId: number | string,
  ): PlatformConversationDeliverySnapshot | undefined => {
    const snapshot = snapshots.get(conversationKey(conversationId))
    return snapshot ? structuredClone(snapshot) : undefined
  }

  const getJobLease = (
    jobId: number,
  ): PlatformConversationDeliveryLeaseFence | undefined => {
    const leaseFence = jobLeases.get(jobId)
    return leaseFence ? structuredClone(leaseFence) : undefined
  }

  return {
    claimDelivery,
    expireDeliveryClaim,
    getDeliverySnapshot,
    getJobLease,
    registerDeliveryIntent,
    markProviderIOStarted,
    releaseDelivery,
    setJobLease,
    setDeliverySnapshot,
  }
}
