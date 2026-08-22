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
  expireClaim(publishJobId: number): boolean
  failNextCommit(): void
  getIntent(publishJobId: number): PlatformPublicationIntent | undefined
  registerIntent(intent: PlatformPublicationIntent): void
  setJobLease(lease: PlatformPublicationLeaseFence): void
}

const clone = <Value>(value: Value): Value => structuredClone(value)
const sameLeaseOwner = (
  left: PlatformPublicationLeaseFence,
  right: PlatformPublicationLeaseFence,
): boolean => left.queueJobId === right.queueJobId && left.ownerToken === right.ownerToken
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
    const current = intents.get(intent.publishJobId)
    if (current && !samePlatformPublicationIntent(current, intent)) {
      throw new Error('Fake PublishJob is already bound to another publication intent')
    }
    intents.set(intent.publishJobId, clone(intent))
  }
  const setJobLease = (lease: PlatformPublicationLeaseFence): void => {
    leases.set(lease.queueJobId, clone(lease))
  }
  const reclaim = (jobId: number): void => {
    const current = active.get(jobId)
    if (!current) return
    const lease = leases.get(current.claim.leaseFence.queueJobId)
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
    reclaim(input.publishJobId)
    const stored = intents.get(input.publishJobId)
    const currentLease = leases.get(lease.queueJobId)
    if (active.has(input.publishJobId)) return { reason: 'busy', status: 'blocked' }
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
    const generation = (generations.get(input.publishJobId) ?? 0) + 1
    generations.set(input.publishJobId, generation)
    const claim: PlatformPublicationClaim = {
      claimId: `fake-publication-claim-${nextClaim++}`,
      fencingGeneration: generation,
      intent: clone(stored),
      leaseFence: clone(lease),
      mode: recoveryRequired.has(input.publishJobId) ? 'recover' : 'send',
    }
    active.set(input.publishJobId, { claim, providerIOStarted: false })
    return { claim: clone(claim), status: 'claimed' }
  }

  const validate = (
    claim: PlatformPublicationClaim,
  ):
    | { current: { claim: PlatformPublicationClaim; providerIOStarted: boolean } }
    | { reason: PlatformPublicationBlockReason } => {
    const current = active.get(claim.intent.publishJobId)
    if (
      !current ||
      current.claim.claimId !== claim.claimId ||
      current.claim.fencingGeneration !== claim.fencingGeneration ||
      !samePlatformPublicationIntent(current.claim.intent, claim.intent) ||
      !sameLeaseOwner(current.claim.leaseFence, claim.leaseFence)
    ) {
      return { reason: 'claim_conflict' }
    }
    const lease = leases.get(claim.leaseFence.queueJobId)
    if (!lease || !sameLeaseOwner(lease, claim.leaseFence) || !isUnexpired(lease)) {
      return { reason: 'lease_conflict' }
    }
    const stored = intents.get(claim.intent.publishJobId)
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
      if (checked.current.providerIOStarted) recoveryRequired.add(claim.intent.publishJobId)
      active.delete(claim.intent.publishJobId)
      return { reason: 'claim_conflict', status: 'blocked' }
    }
    const nextRevision = claim.intent.expectedRevision + 1
    intents.set(claim.intent.publishJobId, {
      expectedRevision: nextRevision,
      publishJobId: claim.intent.publishJobId,
      snapshot: {
        ...clone(claim.intent.snapshot),
        ...(transition.externalPublicationId
          ? { externalPublicationId: transition.externalPublicationId }
          : {}),
        status: transition.status,
      },
    })
    active.delete(claim.intent.publishJobId)
    recoveryRequired.delete(claim.intent.publishJobId)
    return { nextRevision, status: 'committed' }
  }

  const releasePublication = async (claim: PlatformPublicationClaim): Promise<void> => {
    const checked = validate(claim)
    if ('reason' in checked || checked.current.providerIOStarted) {
      throw new Error('Fake publication claim cannot be released')
    }
    active.delete(claim.intent.publishJobId)
  }

  return {
    claimPublication,
    commitPublication,
    expireClaim(publishJobId) {
      const current = active.get(publishJobId)
      if (!current) return false
      if (current.providerIOStarted) recoveryRequired.add(publishJobId)
      active.delete(publishJobId)
      return true
    },
    failNextCommit() {
      rejectNextCommit = true
    },
    getIntent(publishJobId) {
      const value = intents.get(publishJobId)
      return value ? clone(value) : undefined
    },
    markProviderIOStarted,
    registerIntent,
    releasePublication,
    setJobLease,
  }
}
