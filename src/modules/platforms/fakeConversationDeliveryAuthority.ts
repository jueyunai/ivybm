import { isAutomaticPlatformConversationReplyAllowed } from './types'
import type { PlatformConversationDeliveryAuthorityPort } from './ports'
import type {
  PlatformConversationDeliveryClaim,
  PlatformConversationDeliveryIntent,
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
    registerDeliveryIntent(intent: PlatformConversationDeliveryIntent): void
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

/**
 * In-memory CAS/claim authority fake. It performs no Payload or network I/O;
 * future persistence must serialize the same claim with handoff transitions.
 */
export const createFakePlatformConversationDeliveryAuthority = ({
  initialIntents = [],
  initialSnapshots = [],
}: {
  initialIntents?: PlatformConversationDeliveryIntent[]
  initialSnapshots?: PlatformConversationDeliverySnapshot[]
} = {}): FakePlatformConversationDeliveryAuthority => {
  const activeClaims = new Map<
    string,
    { claim: PlatformConversationDeliveryClaim; providerIOStarted: boolean }
  >()
  const fencingGenerations = new Map<string, number>()
  const intents = new Map<string, PlatformConversationDeliveryIntent>()
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

  for (const intent of initialIntents) registerDeliveryIntent(intent)
  for (const snapshot of initialSnapshots) setDeliverySnapshot(snapshot)

  const claimDelivery = async (
    input: PlatformConversationDeliveryIntent,
  ): Promise<PlatformConversationDeliveryClaim | undefined> => {
    const key = conversationKey(input.conversationId)
    const snapshot = snapshots.get(key)
    const identity = intentIdentityKey(input)
    const stored = intents.get(identity)
    const recoveryIntent = recoveryRequired.get(identity)
    const requiresRecovery = Boolean(recoveryIntent && sameIntent(recoveryIntent, input))
    if (
      activeClaims.has(key) ||
      !snapshot ||
      !stored ||
      !sameIntent(stored, input) ||
      (!requiresRecovery &&
        (snapshot.revision !== input.expectedRevision ||
          !isAutomaticPlatformConversationReplyAllowed(snapshot.handoffStatus)))
    ) {
      return undefined
    }

    const fencingGeneration = (fencingGenerations.get(key) ?? 0) + 1
    fencingGenerations.set(key, fencingGeneration)
    const claim: PlatformConversationDeliveryClaim = {
      claimId: `fake-delivery-claim-${nextClaimId++}`,
      fencingGeneration,
      intent: structuredClone(stored),
      mode: requiresRecovery ? 'recover' : 'send',
    }
    activeClaims.set(key, { claim, providerIOStarted: false })
    return structuredClone(claim)
  }

  const markProviderIOStarted = async (
    claim: PlatformConversationDeliveryClaim,
  ): Promise<boolean> => {
    const key = conversationKey(claim.intent.conversationId)
    const active = activeClaims.get(key)
    if (
      !active ||
      active.claim.claimId !== claim.claimId ||
      active.claim.fencingGeneration !== claim.fencingGeneration ||
      !sameIntent(active.claim.intent, claim.intent)
    ) {
      return false
    }
    active.providerIOStarted = true
    return true
  }

  const releaseDelivery = async (
    claim: PlatformConversationDeliveryClaim,
    outcome?: PlatformConversationDeliveryOutcome,
  ): Promise<void> => {
    const key = conversationKey(claim.intent.conversationId)
    const active = activeClaims.get(key)
    if (
      !active ||
      active.claim.claimId !== claim.claimId ||
      active.claim.fencingGeneration !== claim.fencingGeneration ||
      !sameIntent(active.claim.intent, claim.intent)
    ) {
      throw new Error('Fake platform conversation delivery claim is invalid or no longer active')
    }
    activeClaims.delete(key)
    if (outcome && !['delivery_unknown', 'retry_same_delivery_key'].includes(outcome.status)) {
      recoveryRequired.delete(intentIdentityKey(claim.intent))
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

  return {
    claimDelivery,
    expireDeliveryClaim,
    getDeliverySnapshot,
    registerDeliveryIntent,
    markProviderIOStarted,
    releaseDelivery,
    setDeliverySnapshot,
  }
}
