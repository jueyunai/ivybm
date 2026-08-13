import type {
  InstagramPublishingAuthorityPort,
  InstagramPublishingBlockReason,
  InstagramPublishingClaim,
  InstagramPublishingClaimResult,
  InstagramPublishingCommitResult,
  InstagramPublishingIntent,
  InstagramPublishingLeaseFence,
  InstagramPublishingMarkResult,
  InstagramPublishingTransition,
} from './instagramPublishingExecution'
import { sameInstagramPublishingIntent } from './instagramPublishingExecution'

export type FakeInstagramPublishingAuthority = InstagramPublishingAuthorityPort & {
  expireStageClaim(publishJobId: number): boolean
  failNextCommit(): void
  getIntent(publishJobId: number): InstagramPublishingIntent | undefined
  registerIntent(intent: InstagramPublishingIntent): void
  setJobLease(leaseFence: InstagramPublishingLeaseFence): void
}

const sameLeaseOwner = (
  left: InstagramPublishingLeaseFence,
  right: InstagramPublishingLeaseFence,
): boolean => left.queueJobId === right.queueJobId && left.ownerToken === right.ownerToken

const isUnexpiredLease = (leaseFence: InstagramPublishingLeaseFence): boolean => {
  const expiresAt = Date.parse(leaseFence.leaseExpiresAt)
  return Number.isFinite(expiresAt) && expiresAt > Date.now()
}

const clone = <Value>(value: Value): Value => structuredClone(value)

/** Deterministic in-memory CAS fake; it performs no Payload or network I/O. */
export const createFakeInstagramPublishingAuthority = ({
  initialIntents = [],
  initialJobLeases = [],
}: {
  initialIntents?: InstagramPublishingIntent[]
  initialJobLeases?: InstagramPublishingLeaseFence[]
} = {}): FakeInstagramPublishingAuthority => {
  const activeClaims = new Map<
    number,
    { claim: InstagramPublishingClaim; providerIOStarted: boolean }
  >()
  const fencingGenerations = new Map<number, number>()
  const intents = new Map<number, InstagramPublishingIntent>()
  const jobLeases = new Map<number, InstagramPublishingLeaseFence>()
  const recoveryRequired = new Set<number>()
  let nextClaimId = 1
  let rejectNextCommit = false

  const registerIntent = (intent: InstagramPublishingIntent): void => {
    const existing = intents.get(intent.publishJobId)
    if (existing && !sameInstagramPublishingIntent(existing, intent)) {
      throw new Error('Fake Instagram PublishJob is already bound to another intent')
    }
    intents.set(intent.publishJobId, clone(intent))
  }

  const setJobLease = (leaseFence: InstagramPublishingLeaseFence): void => {
    jobLeases.set(leaseFence.queueJobId, clone(leaseFence))
  }

  const reclaimStaleClaim = (jobId: number): void => {
    const active = activeClaims.get(jobId)
    if (!active) return
    const currentLease = jobLeases.get(active.claim.leaseFence.queueJobId)
    if (
      currentLease &&
      sameLeaseOwner(currentLease, active.claim.leaseFence) &&
      isUnexpiredLease(currentLease)
    ) {
      return
    }
    if (active.providerIOStarted) recoveryRequired.add(jobId)
    activeClaims.delete(jobId)
  }

  for (const intent of initialIntents) registerIntent(intent)
  for (const lease of initialJobLeases) setJobLease(lease)

  const claimStage = async (
    input: InstagramPublishingIntent,
    leaseFence: InstagramPublishingLeaseFence,
  ): Promise<InstagramPublishingClaimResult> => {
    reclaimStaleClaim(input.publishJobId)
    const stored = intents.get(input.publishJobId)
    const currentLease = jobLeases.get(leaseFence.queueJobId)
    if (activeClaims.has(input.publishJobId)) return { reason: 'busy', status: 'blocked' }
    if (
      !currentLease ||
      !sameLeaseOwner(currentLease, leaseFence) ||
      !isUnexpiredLease(currentLease)
    ) {
      return { reason: 'lease_conflict', status: 'blocked' }
    }
    if (!stored) return { reason: 'missing_intent', status: 'blocked' }
    if (!sameInstagramPublishingIntent(stored, input)) {
      return {
        reason:
          stored.expectedRevision === input.expectedRevision ? 'intent_mismatch' : 'stale_revision',
        status: 'blocked',
      }
    }
    const fencingGeneration = (fencingGenerations.get(input.publishJobId) ?? 0) + 1
    fencingGenerations.set(input.publishJobId, fencingGeneration)
    const claim: InstagramPublishingClaim = {
      claimId: `fake-instagram-claim-${nextClaimId++}`,
      fencingGeneration,
      intent: clone(stored),
      leaseFence: clone(leaseFence),
      mode: recoveryRequired.has(input.publishJobId) ? 'recover' : 'send',
    }
    activeClaims.set(input.publishJobId, { claim, providerIOStarted: false })
    return { claim: clone(claim), status: 'claimed' }
  }

  const validateActiveClaim = (
    claim: InstagramPublishingClaim,
  ):
    | { active: { claim: InstagramPublishingClaim; providerIOStarted: boolean } }
    | { reason: InstagramPublishingBlockReason } => {
    const active = activeClaims.get(claim.intent.publishJobId)
    if (
      !active ||
      active.claim.claimId !== claim.claimId ||
      active.claim.fencingGeneration !== claim.fencingGeneration ||
      !sameInstagramPublishingIntent(active.claim.intent, claim.intent) ||
      !sameLeaseOwner(active.claim.leaseFence, claim.leaseFence)
    ) {
      return { reason: 'claim_conflict' }
    }
    const currentLease = jobLeases.get(claim.leaseFence.queueJobId)
    if (
      !currentLease ||
      !sameLeaseOwner(currentLease, claim.leaseFence) ||
      !isUnexpiredLease(currentLease)
    ) {
      return { reason: 'lease_conflict' }
    }
    const stored = intents.get(claim.intent.publishJobId)
    if (!stored) return { reason: 'missing_intent' }
    if (!sameInstagramPublishingIntent(stored, claim.intent)) {
      return {
        reason:
          stored.expectedRevision === claim.intent.expectedRevision
            ? 'intent_mismatch'
            : 'stale_revision',
      }
    }
    return { active }
  }

  const markProviderIOStarted = async (
    claim: InstagramPublishingClaim,
  ): Promise<InstagramPublishingMarkResult> => {
    const validated = validateActiveClaim(claim)
    if ('reason' in validated) return { reason: validated.reason, status: 'blocked' }
    validated.active.providerIOStarted = true
    return { status: 'fenced' }
  }

  const commitStage = async (
    claim: InstagramPublishingClaim,
    transition: InstagramPublishingTransition,
  ): Promise<InstagramPublishingCommitResult> => {
    const validated = validateActiveClaim(claim)
    if ('reason' in validated) return { reason: validated.reason, status: 'blocked' }
    if (rejectNextCommit) {
      rejectNextCommit = false
      return { reason: 'claim_conflict', status: 'blocked' }
    }
    if (
      transition.checkpoint.accountExternalId !== claim.intent.checkpoint.accountExternalId ||
      transition.checkpoint.imageUrl !== claim.intent.checkpoint.imageUrl ||
      transition.checkpoint.caption !== claim.intent.checkpoint.caption
    ) {
      return { reason: 'intent_mismatch', status: 'blocked' }
    }
    const nextRevision = claim.intent.expectedRevision + 1
    intents.set(claim.intent.publishJobId, {
      ...clone(claim.intent),
      checkpoint: clone(transition.checkpoint),
      expectedRevision: nextRevision,
    })
    activeClaims.delete(claim.intent.publishJobId)
    recoveryRequired.delete(claim.intent.publishJobId)
    return { nextRevision, status: 'committed' }
  }

  const releaseStage = async (claim: InstagramPublishingClaim): Promise<void> => {
    const validated = validateActiveClaim(claim)
    if ('reason' in validated) {
      throw new Error('Fake Instagram publishing claim is invalid or no longer active')
    }
    if (validated.active.providerIOStarted) {
      throw new Error('Fake Instagram publishing claim crossed provider I/O and cannot be released')
    }
    activeClaims.delete(claim.intent.publishJobId)
  }

  return {
    claimStage,
    commitStage,
    expireStageClaim(publishJobId) {
      const active = activeClaims.get(publishJobId)
      if (!active) return false
      if (active.providerIOStarted) recoveryRequired.add(publishJobId)
      activeClaims.delete(publishJobId)
      return true
    },
    failNextCommit() {
      rejectNextCommit = true
    },
    getIntent(publishJobId) {
      const intent = intents.get(publishJobId)
      return intent ? clone(intent) : undefined
    },
    markProviderIOStarted,
    registerIntent,
    releaseStage,
    setJobLease,
  }
}
