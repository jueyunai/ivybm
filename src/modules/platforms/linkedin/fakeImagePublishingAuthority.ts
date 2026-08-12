import type {
  LinkedInImagePublishingAuthorityPort,
  LinkedInImagePublishingBlockReason,
  LinkedInImagePublishingClaim,
  LinkedInImagePublishingClaimResult,
  LinkedInImagePublishingCommitResult,
  LinkedInImagePublishingIntent,
  LinkedInImagePublishingLeaseFence,
  LinkedInImagePublishingMarkResult,
  LinkedInImagePublishingTransition,
} from './imagePublishingExecution'
import { sameLinkedInImagePublishingIntent } from './imagePublishingExecution'

export type FakeLinkedInImagePublishingAuthority = LinkedInImagePublishingAuthorityPort & {
  expireClaim(jobId: number): boolean
  failNextCommit(): void
  failNextPreIORelease(): void
  getIntent(jobId: number): LinkedInImagePublishingIntent | undefined
  registerIntent(intent: LinkedInImagePublishingIntent): void
  setJobLease(lease: LinkedInImagePublishingLeaseFence): void
}

const clone = <Value>(value: Value): Value => structuredClone(value)
const sameLeaseOwner = (
  left: LinkedInImagePublishingLeaseFence,
  right: LinkedInImagePublishingLeaseFence,
): boolean => left.jobId === right.jobId && left.ownerToken === right.ownerToken
const unexpired = (lease: LinkedInImagePublishingLeaseFence): boolean =>
  Date.parse(lease.leaseExpiresAt) > Date.now()

export const createFakeLinkedInImagePublishingAuthority = ({
  initialIntents = [],
  initialJobLeases = [],
}: {
  initialIntents?: LinkedInImagePublishingIntent[]
  initialJobLeases?: LinkedInImagePublishingLeaseFence[]
} = {}): FakeLinkedInImagePublishingAuthority => {
  const active = new Map<
    number,
    { claim: LinkedInImagePublishingClaim; providerIOStarted: boolean }
  >()
  const generations = new Map<number, number>()
  const intents = new Map<number, LinkedInImagePublishingIntent>()
  const leases = new Map<number, LinkedInImagePublishingLeaseFence>()
  const recoveryRequired = new Set<number>()
  let nextClaim = 1
  let rejectNextCommit = false
  let rejectNextPreIORelease = false

  const registerIntent = (intent: LinkedInImagePublishingIntent): void => {
    const stored = intents.get(intent.jobId)
    if (stored && !sameLinkedInImagePublishingIntent(stored, intent)) {
      throw new Error('Fake LinkedIn image PublishJob is already bound to another intent')
    }
    intents.set(intent.jobId, clone(intent))
  }
  const setJobLease = (lease: LinkedInImagePublishingLeaseFence): void => {
    leases.set(lease.jobId, clone(lease))
  }
  const reclaim = (jobId: number): void => {
    const current = active.get(jobId)
    if (!current) return
    const lease = leases.get(jobId)
    if (lease && sameLeaseOwner(lease, current.claim.leaseFence) && unexpired(lease)) return
    if (current.providerIOStarted) recoveryRequired.add(jobId)
    active.delete(jobId)
  }
  for (const intent of initialIntents) registerIntent(intent)
  for (const lease of initialJobLeases) setJobLease(lease)

  const claimStage = async (
    input: LinkedInImagePublishingIntent,
    lease: LinkedInImagePublishingLeaseFence,
  ): Promise<LinkedInImagePublishingClaimResult> => {
    reclaim(input.jobId)
    const stored = intents.get(input.jobId)
    const currentLease = leases.get(input.jobId)
    if (active.has(input.jobId)) return { reason: 'busy', status: 'blocked' }
    if (!currentLease || !sameLeaseOwner(currentLease, lease) || !unexpired(currentLease)) {
      return { reason: 'lease_conflict', status: 'blocked' }
    }
    if (!stored) return { reason: 'missing_intent', status: 'blocked' }
    if (!sameLinkedInImagePublishingIntent(stored, input)) {
      return {
        reason:
          stored.expectedRevision === input.expectedRevision ? 'intent_mismatch' : 'stale_revision',
        status: 'blocked',
      }
    }
    const fencingGeneration = (generations.get(input.jobId) ?? 0) + 1
    generations.set(input.jobId, fencingGeneration)
    const claim: LinkedInImagePublishingClaim = {
      claimId: `fake-linkedin-image-claim-${nextClaim++}`,
      fencingGeneration,
      intent: clone(stored),
      leaseFence: clone(lease),
      mode: recoveryRequired.has(input.jobId) ? 'recover' : 'send',
    }
    active.set(input.jobId, { claim, providerIOStarted: false })
    return { claim: clone(claim), status: 'claimed' }
  }

  const validate = (
    claim: LinkedInImagePublishingClaim,
  ):
    | {
        current: { claim: LinkedInImagePublishingClaim; providerIOStarted: boolean }
      }
    | { reason: LinkedInImagePublishingBlockReason } => {
    const current = active.get(claim.intent.jobId)
    if (
      !current ||
      current.claim.claimId !== claim.claimId ||
      current.claim.fencingGeneration !== claim.fencingGeneration ||
      !sameLinkedInImagePublishingIntent(current.claim.intent, claim.intent) ||
      !sameLeaseOwner(current.claim.leaseFence, claim.leaseFence)
    ) {
      return { reason: 'claim_conflict' }
    }
    const lease = leases.get(claim.intent.jobId)
    if (!lease || !sameLeaseOwner(lease, claim.leaseFence) || !unexpired(lease)) {
      return { reason: 'lease_conflict' }
    }
    const stored = intents.get(claim.intent.jobId)
    if (!stored) return { reason: 'missing_intent' }
    if (!sameLinkedInImagePublishingIntent(stored, claim.intent)) {
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
    claim: LinkedInImagePublishingClaim,
  ): Promise<LinkedInImagePublishingMarkResult> => {
    const checked = validate(claim)
    if ('reason' in checked) return { reason: checked.reason, status: 'blocked' }
    checked.current.providerIOStarted = true
    return { status: 'fenced' }
  }

  const commitStage = async (
    claim: LinkedInImagePublishingClaim,
    transition: LinkedInImagePublishingTransition,
  ): Promise<LinkedInImagePublishingCommitResult> => {
    const checked = validate(claim)
    if ('reason' in checked) return { reason: checked.reason, status: 'blocked' }
    if (rejectNextCommit) {
      rejectNextCommit = false
      return { reason: 'claim_conflict', status: 'blocked' }
    }
    const nextRevision = claim.intent.expectedRevision + 1
    intents.set(claim.intent.jobId, {
      ...clone(claim.intent),
      checkpoint: clone(transition.checkpoint),
      expectedRevision: nextRevision,
    })
    active.delete(claim.intent.jobId)
    recoveryRequired.delete(claim.intent.jobId)
    return { nextRevision, status: 'committed' }
  }

  const releaseStage = async (claim: LinkedInImagePublishingClaim): Promise<void> => {
    const checked = validate(claim)
    if ('reason' in checked || checked.current.providerIOStarted) {
      throw new Error('Fake LinkedIn image claim cannot be released')
    }
    active.delete(claim.intent.jobId)
  }

  const releaseProvenPreIOFailure = async (
    claim: LinkedInImagePublishingClaim,
  ): Promise<LinkedInImagePublishingMarkResult> => {
    const checked = validate(claim)
    if ('reason' in checked) return { reason: checked.reason, status: 'blocked' }
    if (!checked.current.providerIOStarted || rejectNextPreIORelease) {
      rejectNextPreIORelease = false
      return { reason: 'claim_conflict', status: 'blocked' }
    }
    active.delete(claim.intent.jobId)
    recoveryRequired.delete(claim.intent.jobId)
    return { status: 'fenced' }
  }

  return {
    claimStage,
    commitStage,
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
    failNextPreIORelease() {
      rejectNextPreIORelease = true
    },
    getIntent(jobId) {
      const value = intents.get(jobId)
      return value ? clone(value) : undefined
    },
    markProviderIOStarted,
    registerIntent,
    releaseProvenPreIOFailure,
    releaseStage,
    setJobLease,
  }
}
