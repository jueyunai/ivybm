import { createHash } from 'node:crypto'

import { createLinkedInAssistedPreparation } from '../publishing/assisted'
import {
  PLATFORM_PUBLISH_ERROR_CODES,
  PublishingContractValidationError,
  normalizePlatformCapabilityQuery,
  normalizePlatformPublicationStatusLookup,
  normalizePlatformPublishRequest,
  type AcceptedPlatformPublication,
  type BlockedAssistedPublication,
  type BlockedPlatformPublication,
  type ConfirmedPlatformPublishErrorCode,
  type DeliveryUnknownPlatformPublication,
  type PlatformCapability,
  type PlatformCapabilityQuery,
  type PlatformPublicationStatus,
  type PlatformPublishAcceptance,
  type PlatformPublishErrorCode,
  type PlatformPublishRequest,
  type PublishingMode,
} from '../publishing/contracts'
import type { PlatformPublishingPort } from './ports'

type StoredPublishResult = AcceptedPlatformPublication | DeliveryUnknownPlatformPublication

type PublicationRecord = {
  fingerprint: string
  result: StoredPublishResult
  status: PlatformPublicationStatus
}

export type FakePlatformPublishFailure = PlatformCapabilityQuery & {
  errorCode: PlatformPublishErrorCode
  externalPublicationId?: string
  retryable: boolean
}

export type FakePlatformPublishingPort = PlatformPublishingPort & {
  failNextPublish(input: FakePlatformPublishFailure): void
  getPublishAttemptCount(input: PlatformCapabilityQuery): number
  setStatus(status: PlatformPublicationStatus): void
}

export type FakePlatformPublishingPortOptions = {
  /** Explicit account-scoped overrides for deterministic tests only. */
  capabilities?: PlatformCapability[]
}

const platformAvailabilities = ['available', 'blocked', 'conditional'] as const
const publishingModes = ['assisted', 'automatic'] as const
const publicationStates = [
  'delivery_unknown',
  'failed',
  'pending',
  'published',
  'publishing',
] as const

const clone = <Value>(value: Value): Value => structuredClone(value)

const requireRecord = (value: unknown, name: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Fake ${name} must be an object`)
  }
  return value as Record<string, unknown>
}

const compositeKey = (...parts: Array<number | string>): string =>
  JSON.stringify(parts.map((part) => [typeof part, part]))

const capabilityKey = (input: PlatformCapabilityQuery): string =>
  compositeKey('capability', input.platform, input.platformAccountId)

const commandKey = ({
  idempotencyKey,
  platform,
  platformAccountId,
}: Pick<PlatformPublishRequest, 'idempotencyKey' | 'platform' | 'platformAccountId'>): string =>
  compositeKey('command', platform, platformAccountId, idempotencyKey)

const referenceKey = ({
  externalPublicationId,
  platform,
  platformAccountId,
}: Pick<
  AcceptedPlatformPublication,
  'externalPublicationId' | 'platform' | 'platformAccountId'
>): string =>
  compositeKey('reference', platform, platformAccountId, externalPublicationId)

const stableSerialize = (value: unknown): string => {
  if (value === undefined) return 'null'
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`

  const object = value as Record<string, unknown>
  return `{${Object.keys(object)
    .filter((key) => object[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableSerialize(object[key])}`)
    .join(',')}}`
}

const requestFingerprint = (request: PlatformPublishRequest): string =>
  stableSerialize({
    assets: request.assets.map(({ id, sha256 }) => ({ id, sha256: sha256 ?? null })),
    scheduledFor: request.scheduledFor ?? null,
    text: request.text,
  })

const defaultCapability = ({
  platform,
  platformAccountId,
}: PlatformCapabilityQuery): PlatformCapability => {
  if (platform === 'facebook') {
    return {
      availability: 'conditional',
      modes: ['automatic'],
      platform,
      platformAccountId,
      reason: 'Meta Content Publishing permission requires controlled verification',
    }
  }
  if (platform === 'instagram') {
    return {
      availability: 'conditional',
      modes: ['automatic'],
      platform,
      platformAccountId,
      reason: 'Instagram business account and publishing permission require verification',
    }
  }
  return {
    availability: 'conditional',
    modes: ['assisted'],
    platform,
    platformAccountId,
    reason: 'Automatic publishing remains blocked until API permission is verified',
  }
}

const normalizeCapability = (value: unknown): PlatformCapability => {
  const candidate = requireRecord(value, 'platform capability')
  const query = normalizePlatformCapabilityQuery(candidate)
  if (
    !platformAvailabilities.includes(candidate.availability as PlatformCapability['availability'])
  ) {
    throw new Error('Fake platform capability requires a known availability')
  }
  if (
    !Array.isArray(candidate.modes) ||
    !candidate.modes.every((mode) => publishingModes.includes(mode as PublishingMode))
  ) {
    throw new Error('Fake platform capability requires valid modes')
  }
  const modes = [...new Set(candidate.modes)] as PublishingMode[]
  const reason = candidate.reason
  if (reason !== undefined && (typeof reason !== 'string' || reason.length > 1_000)) {
    throw new Error('Fake platform capability reason must be a bounded string')
  }
  return {
    ...query,
    availability: candidate.availability as PlatformCapability['availability'],
    modes,
    ...(reason === undefined ? {} : { reason: reason.trim() }),
  }
}

const blocked = (
  identity: Pick<PlatformPublishRequest, 'idempotencyKey' | 'platform' | 'platformAccountId'>,
  errorCode: ConfirmedPlatformPublishErrorCode,
  retryable: boolean,
): BlockedPlatformPublication => ({
  errorCode,
  idempotencyKey: identity.idempotencyKey,
  platform: identity.platform,
  platformAccountId: identity.platformAccountId,
  retryable,
  status: 'blocked',
})

const blockedAssisted = (
  identity: PlatformCapabilityQuery,
  errorCode: BlockedAssistedPublication['errorCode'],
): BlockedAssistedPublication => ({
  ...identity,
  errorCode,
  mode: 'assisted',
  retryable: false,
  status: 'blocked',
})

const deliveryUnknown = (
  request: PlatformPublishRequest,
  externalPublicationId?: string,
): DeliveryUnknownPlatformPublication => ({
  errorCode: 'delivery_unknown',
  idempotencyKey: request.idempotencyKey,
  platform: request.platform,
  platformAccountId: request.platformAccountId,
  retryable: false,
  status: 'delivery_unknown',
  ...(externalPublicationId ? { externalPublicationId } : {}),
})

const normalizePublishFailure = (value: unknown): FakePlatformPublishFailure => {
  const candidate = requireRecord(value, 'publish failure')
  const query = normalizePlatformCapabilityQuery(candidate)
  if (!PLATFORM_PUBLISH_ERROR_CODES.includes(candidate.errorCode as PlatformPublishErrorCode)) {
    throw new Error('Fake publish failure requires a known errorCode')
  }
  if (typeof candidate.retryable !== 'boolean') {
    throw new Error('Fake publish failure requires retryable')
  }
  if (candidate.errorCode === 'delivery_unknown' && candidate.retryable) {
    throw new Error('Fake delivery-unknown result cannot be retryable')
  }
  const externalPublicationId =
    candidate.externalPublicationId === undefined
      ? undefined
      : normalizePlatformPublicationStatusLookup({
          ...query,
          externalPublicationId: candidate.externalPublicationId,
          idempotencyKey: 'failure-validation',
        }).externalPublicationId
  return {
    ...query,
    errorCode: candidate.errorCode as PlatformPublishErrorCode,
    retryable: candidate.retryable,
    ...(externalPublicationId ? { externalPublicationId } : {}),
  }
}

const transitionTargets: Record<
  PlatformPublicationStatus['status'],
  PlatformPublicationStatus['status'][]
> = {
  delivery_unknown: ['delivery_unknown', 'failed', 'pending'],
  failed: ['failed'],
  pending: ['failed', 'pending', 'published', 'publishing'],
  published: ['published'],
  publishing: ['failed', 'published', 'publishing'],
}

const normalizePublicationStatus = (value: unknown): PlatformPublicationStatus => {
  const candidate = requireRecord(value, 'publication status')
  const lookup = normalizePlatformPublicationStatusLookup(candidate)
  if (!publicationStates.includes(candidate.status as PlatformPublicationStatus['status'])) {
    throw new Error('Fake publication status is unsupported')
  }

  if (candidate.status === 'delivery_unknown') {
    if (candidate.errorCode !== 'delivery_unknown' || candidate.retryable !== false) {
      throw new Error('Fake delivery-unknown status requires a non-retryable delivery_unknown error')
    }
    return {
      ...lookup,
      errorCode: 'delivery_unknown',
      retryable: false,
      status: 'delivery_unknown',
    }
  }

  if (candidate.status === 'failed') {
    if (
      !PLATFORM_PUBLISH_ERROR_CODES.includes(candidate.errorCode as PlatformPublishErrorCode) ||
      candidate.errorCode === 'delivery_unknown'
    ) {
      throw new Error('Fake failed publication requires a confirmed errorCode')
    }
    if (typeof candidate.retryable !== 'boolean') {
      throw new Error('Fake failed publication requires retryable')
    }
    return {
      ...lookup,
      errorCode: candidate.errorCode as ConfirmedPlatformPublishErrorCode,
      retryable: candidate.retryable,
      status: 'failed',
    }
  }

  if (!lookup.externalPublicationId) {
    throw new Error('Fake active publication status requires an externalPublicationId')
  }
  if ('errorCode' in candidate || 'retryable' in candidate) {
    throw new Error('Fake active publication cannot include failure metadata')
  }
  return {
    ...lookup,
    externalPublicationId: lookup.externalPublicationId,
    status: candidate.status as 'pending' | 'published' | 'publishing',
  }
}

const currentPublishResult = (publication: PublicationRecord): PlatformPublishAcceptance => {
  if (publication.status.status === 'failed' || publication.status.status === 'delivery_unknown') {
    return clone(publication.status)
  }
  return clone(publication.result)
}

const externalPublicationIdFor = (request: PlatformPublishRequest): string => {
  const digest = createHash('sha256')
    .update(commandKey(request))
    .digest('hex')
    .slice(0, 32)
  return `mock:${request.platform}:${digest}`
}

export const createFakePlatformPublishingPort = (
  options: FakePlatformPublishingPortOptions = {},
): FakePlatformPublishingPort => {
  const optionRecord = requireRecord(options, 'publishing port options')
  if (optionRecord.capabilities !== undefined && !Array.isArray(optionRecord.capabilities)) {
    throw new Error('Fake platform capability overrides must be an array')
  }
  const capabilities = new Map<string, PlatformCapability>()
  for (const capability of options.capabilities ?? []) {
    const normalized = normalizeCapability(capability)
    const key = capabilityKey(normalized)
    if (capabilities.has(key)) {
      throw new Error('Fake platform capability overrides must be unique per account')
    }
    capabilities.set(key, normalized)
  }

  const publicationsByCommand = new Map<string, PublicationRecord>()
  const publicationsByReference = new Map<string, PublicationRecord>()
  const nextFailures = new Map<string, FakePlatformPublishFailure[]>()
  const publishAttempts = new Map<string, number>()

  return {
    async getCapability(input) {
      const query = normalizePlatformCapabilityQuery(input)
      return clone(capabilities.get(capabilityKey(query)) ?? defaultCapability(query))
    },

    async getStatus(input) {
      const lookup = normalizePlatformPublicationStatusLookup(input)
      const publication = publicationsByCommand.get(commandKey(lookup))
      if (!publication) throw new Error('Fake platform publication is not known')
      if (lookup.externalPublicationId) {
        const byReference = publicationsByReference.get(
          referenceKey({ ...lookup, externalPublicationId: lookup.externalPublicationId }),
        )
        if (byReference !== publication) {
          throw new Error('Fake platform publication is not known')
        }
      }
      return clone(publication.status)
    },

    async publish(input) {
      const candidate = requireRecord(input, 'publish request')
      const query = normalizePlatformCapabilityQuery(candidate)
      if (typeof candidate.idempotencyKey !== 'string') {
        throw new Error('Fake publish request requires an idempotency key')
      }

      let request: PlatformPublishRequest
      try {
        request = normalizePlatformPublishRequest(candidate)
      } catch (error) {
        if (!(error instanceof PublishingContractValidationError)) throw error
        return blocked(
          { ...query, idempotencyKey: candidate.idempotencyKey },
          'invalid_request',
          false,
        )
      }

      const key = commandKey(request)
      const fingerprint = requestFingerprint(request)
      const existing = publicationsByCommand.get(key)
      if (existing) {
        if (existing.fingerprint !== fingerprint) {
          return blocked(request, 'invalid_request', false)
        }
        return currentPublishResult(existing)
      }

      const capability = capabilities.get(capabilityKey(request)) ?? defaultCapability(request)
      if (capability.availability === 'blocked' || !capability.modes.includes('automatic')) {
        return blocked(request, 'platform_blocked', false)
      }
      if (capability.availability !== 'available') {
        return blocked(request, 'account_not_connected', false)
      }

      const scope = capabilityKey(request)
      publishAttempts.set(scope, (publishAttempts.get(scope) ?? 0) + 1)
      const queuedFailures = nextFailures.get(scope)
      const nextFailure = queuedFailures?.shift()
      if (queuedFailures?.length === 0) nextFailures.delete(scope)
      if (nextFailure) {
        if (nextFailure.errorCode !== 'delivery_unknown') {
          return blocked(
            request,
            nextFailure.errorCode as ConfirmedPlatformPublishErrorCode,
            nextFailure.retryable,
          )
        }
        const unknown = deliveryUnknown(request, nextFailure.externalPublicationId)
        const publication = { fingerprint, result: unknown, status: unknown }
        publicationsByCommand.set(key, publication)
        if (unknown.externalPublicationId) {
          publicationsByReference.set(
            referenceKey({ ...unknown, externalPublicationId: unknown.externalPublicationId }),
            publication,
          )
        }
        return clone(unknown)
      }

      const acceptance: AcceptedPlatformPublication = {
        externalPublicationId: externalPublicationIdFor(request),
        idempotencyKey: request.idempotencyKey,
        platform: request.platform,
        platformAccountId: request.platformAccountId,
        status: 'accepted',
      }
      const status: PlatformPublicationStatus = {
        externalPublicationId: acceptance.externalPublicationId,
        idempotencyKey: acceptance.idempotencyKey,
        platform: acceptance.platform,
        platformAccountId: acceptance.platformAccountId,
        status: 'pending',
      }
      const publication = { fingerprint, result: acceptance, status }
      publicationsByCommand.set(key, publication)
      publicationsByReference.set(referenceKey(acceptance), publication)
      return clone(acceptance)
    },

    async prepareAssistedPublication(input) {
      const query = normalizePlatformCapabilityQuery(input)
      const capability = capabilities.get(capabilityKey(query)) ?? defaultCapability(query)
      if (
        query.platform !== 'linkedin' ||
        capability.availability === 'blocked' ||
        !capability.modes.includes('assisted')
      ) {
        return blockedAssisted(query, 'platform_blocked')
      }
      try {
        return createLinkedInAssistedPreparation(input)
      } catch (error) {
        if (!(error instanceof PublishingContractValidationError)) throw error
        return blockedAssisted(query, 'invalid_request')
      }
    },

    failNextPublish(input) {
      const failure = normalizePublishFailure(input)
      const scope = capabilityKey(failure)
      const queued = nextFailures.get(scope) ?? []
      queued.push(failure)
      nextFailures.set(scope, queued)
    },

    getPublishAttemptCount(input) {
      const query = normalizePlatformCapabilityQuery(input)
      return publishAttempts.get(capabilityKey(query)) ?? 0
    },

    setStatus(input) {
      const status = normalizePublicationStatus(input)
      const publication = publicationsByCommand.get(commandKey(status))
      if (!publication) throw new Error('Fake platform publication is not known')

      const currentStatus = publication.status.status
      if (!transitionTargets[currentStatus].includes(status.status)) {
        throw new Error(
          `Fake platform publication cannot transition from ${currentStatus} to ${status.status}`,
        )
      }
      if (
        currentStatus === 'failed' &&
        status.status === 'failed' &&
        stableSerialize(publication.status) !== stableSerialize(status)
      ) {
        throw new Error('Fake platform publication cannot replace failed failure metadata')
      }

      const previousReference = publication.status.externalPublicationId
      const nextReference = status.externalPublicationId
      if (previousReference && nextReference && previousReference !== nextReference) {
        throw new Error('Fake platform publication cannot replace its external reference')
      }
      if (nextReference) {
        const key = referenceKey({ ...status, externalPublicationId: nextReference })
        const existing = publicationsByReference.get(key)
        if (existing && existing !== publication) {
          throw new Error('Fake platform publication external reference is already in use')
        }
        publicationsByReference.set(key, publication)
      }

      if (currentStatus === 'delivery_unknown' && status.status === 'pending') {
        if (!status.externalPublicationId) {
          throw new Error('Fake recovered publication requires an externalPublicationId')
        }
        publication.result = {
          externalPublicationId: status.externalPublicationId,
          idempotencyKey: status.idempotencyKey,
          platform: status.platform,
          platformAccountId: status.platformAccountId,
          status: 'accepted',
        }
      }
      publication.status = status
    },
  }
}
