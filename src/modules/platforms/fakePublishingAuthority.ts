import type {
  PlatformPublicationAuthorityPort,
  PlatformPublicationBlockReason,
  PlatformPublicationClaim,
  PlatformPublicationClaimResult,
  PlatformPublicationCommitResult,
  PlatformPublicationIntent,
  PlatformPublicationLeaseFence,
  PlatformPublicationMarkResult,
} from './publishingAuthority'
import { samePlatformPublicationIntent } from './publishingAuthority'
import type { PlatformPublishExecutionTransition } from './publishingExecution'

export type FakePlatformPublicationAuthority = PlatformPublicationAuthorityPort & {
  expireClaim(jobId: number): boolean
  failNextCommit(): void
  getIntent(jobId: number): PlatformPublicationIntent | undefined
  registerIntent(intent: PlatformPublicationIntent): void
  setJobLease(lease: PlatformPublicationLeaseFence): void
}

const clone = <Value>(value: Value): Value => structuredClone(value)
const sameLeaseOwner = (
  left: PlatformPublicationLeaseFence,
  right: PlatformPublicationLeaseFence,
): boolean => left.jobId === right.jobId && left.ownerToken === right.ownerToken
const isUnexpired = (lease: PlatformPublicationLeaseFence): boolean =>
  Date.parse(lease.leaseExpiresAt) > Date.now()

export const createFakePlatformPublicationAuthority = ({
  initialIntents = [],
  initialJobLeases = [],
}: {
  initialIntents?: PlatformPublicationIntent[]
  initialJobLeases?: PlatformPublicationLeaseFence[]
} = {}): FakePlatformPublicationAuthority => {
  const active = new Map<number, { claim: PlatformPublicationClaim; providerIOStarted: boolean }>()
  const generations = new Map<number, number>()
  const intents = new Map<number, PlatformPublicationIntent>()
  const leases = new Map<number, PlatformPublicationLeaseFence>()
  const recoveryRequired = new Set<number>()
  let nextClaim = 1
  let rejectNextCommit = false

  const registerIntent = (intent: PlatformPublicationIntent): void => {
    const current = intents.get(intent.jobId)
    if (current && !samePlatformPublicationIntent(current, intent)) {
      throw new Error('Fake PublishJob is already bound to another publication intent')
    }
    intents.set(intent.jobId, clone(intent))
  }
  const setJobLease = (lease: PlatformPublicationLeaseFence): void => {
    leases.set(lease.jobId, clone(lease))
  }
  const reclaim = (jobId: number): void => {
    const current = active.get(jobId)
    if (!current) return
    const lease = leases.get(jobId)
    if (lease && sameLeaseOwner(lease, current.claim.leaseFence) && isUnexpired(lease)) return
    if (current.providerIOStarted) recoveryRequired.add(jobId)
    active.delete(jobId)
  }
  for (const intent of initialIntents) registerIntent(intent)
  for (const lease of initialJobLeases) setJobLease(lease)

  const claimPublication = async (
    input: PlatformPublicationIntent,
    lease: PlatformPublicationLeaseFence,
  ): Promise<PlatformPublicationClaimResult> => {
    reclaim(input.jobId)
    const stored = intents.get(input.jobId)
    const currentLease = leases.get(input.jobId)
    if (active.has(input.jobId)) return { reason: 'busy', status: 'blocked' }
    if (!currentLease || !sameLeaseOwner(currentLease, lease) || !isUnexpired(currentLease)) {
      return { reason: 'lease_conflict', status: 'blocked' }
    }
    if (!stored) return { reason: 'missing_intent', status: 'blocked' }
    if (!samePlatformPublicationIntent(stored, input)) {
      return {
        reason:
          stored.expectedRevision === input.expectedRevision ? 'intent_mismatch' : 'stale_revision',
        status: 'blocked',
      }
    }
    const generation = (generations.get(input.jobId) ?? 0) + 1
    generations.set(input.jobId, generation)
    const claim: PlatformPublicationClaim = {
      claimId: `fake-publication-claim-${nextClaim++}`,
      fencingGeneration: generation,
      intent: clone(stored),
      leaseFence: clone(lease),
      mode: recoveryRequired.has(input.jobId) ? 'recover' : 'send',
    }
    active.set(input.jobId, { claim, providerIOStarted: false })
    return { claim: clone(claim), status: 'claimed' }
  }

  const validate = (
    claim: PlatformPublicationClaim,
  ):
    | { current: { claim: PlatformPublicationClaim; providerIOStarted: boolean } }
    | { reason: PlatformPublicationBlockReason } => {
    const current = active.get(claim.intent.jobId)
    if (
      !current ||
      current.claim.claimId !== claim.claimId ||
      current.claim.fencingGeneration !== claim.fencingGeneration ||
      !samePlatformPublicationIntent(current.claim.intent, claim.intent) ||
      !sameLeaseOwner(current.claim.leaseFence, claim.leaseFence)
    ) {
      return { reason: 'claim_conflict' }
    }
    const lease = leases.get(claim.intent.jobId)
    if (!lease || !sameLeaseOwner(lease, claim.leaseFence) || !isUnexpired(lease)) {
      return { reason: 'lease_conflict' }
    }
    const stored = intents.get(claim.intent.jobId)
    if (!stored) return { reason: 'missing_intent' }
    if (!samePlatformPublicationIntent(stored, claim.intent)) {
      return {
        reason:
          stored.expectedRevision === claim.intent.expectedRevision
            ? 'intent_mismatch'
            : 'stale_revision',
      }
    }
    return { current }
  }

  const markProviderIOStarted = async (
    claim: PlatformPublicationClaim,
  ): Promise<PlatformPublicationMarkResult> => {
    const checked = validate(claim)
    if ('reason' in checked) return { reason: checked.reason, status: 'blocked' }
    checked.current.providerIOStarted = true
    return { status: 'fenced' }
  }

  const commitPublication = async (
    claim: PlatformPublicationClaim,
    transition: PlatformPublishExecutionTransition,
  ): Promise<PlatformPublicationCommitResult> => {
    const checked = validate(claim)
    if ('reason' in checked) return { reason: checked.reason, status: 'blocked' }
    if (rejectNextCommit) {
      rejectNextCommit = false
      return { reason: 'claim_conflict', status: 'blocked' }
    }
    const nextRevision = claim.intent.expectedRevision + 1
    intents.set(claim.intent.jobId, {
      expectedRevision: nextRevision,
      jobId: claim.intent.jobId,
      snapshot: {
        ...clone(claim.intent.snapshot),
        ...(transition.externalPublicationId
          ? { externalPublicationId: transition.externalPublicationId }
          : {}),
        status: transition.status,
      },
    })
    active.delete(claim.intent.jobId)
    recoveryRequired.delete(claim.intent.jobId)
    return { nextRevision, status: 'committed' }
  }

  const releasePublication = async (claim: PlatformPublicationClaim): Promise<void> => {
    const checked = validate(claim)
    if ('reason' in checked || checked.current.providerIOStarted) {
      throw new Error('Fake publication claim cannot be released')
    }
    active.delete(claim.intent.jobId)
  }

  return {
    claimPublication,
    commitPublication,
    expireClaim(jobId) {
      const current = active.get(jobId)
      if (!current) return false
      if (current.providerIOStarted) recoveryRequired.add(jobId)
      active.delete(jobId)
      return true
    },
    failNextCommit() {
      rejectNextCommit = true
    },
    getIntent(jobId) {
      const value = intents.get(jobId)
      return value ? clone(value) : undefined
    },
    markProviderIOStarted,
    registerIntent,
    releasePublication,
    setJobLease,
  }
}
