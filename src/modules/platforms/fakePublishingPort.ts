import type { PlatformPublishingPort } from './ports'
import {
  PLATFORM_PUBLISH_ERROR_CODES,
  type PlatformCapability,
  type PlatformPublicationStatus,
  type PlatformPublishAcceptance,
  type PlatformPublishErrorCode,
  type PlatformPublishRequest,
  type PublicationAsset,
  type PublishingPlatform,
} from './types'

type AcceptedPublication = Extract<PlatformPublishAcceptance, { status: 'accepted' }>
type BlockedPublication = Extract<PlatformPublishAcceptance, { status: 'blocked' }>

type PublicationRecord = {
  acceptance: AcceptedPublication
  fingerprint: string
  status: PlatformPublicationStatus
}

export type FakePlatformPublishFailure = {
  errorCode: PlatformPublishErrorCode
  platform: PublishingPlatform
  retryable: boolean
}

/**
 * Test/mock-only controls deliberately kept outside PlatformPublishingPort so the
 * production adapter contract remains free of simulation concerns.
 */
export type FakePlatformPublishingPort = PlatformPublishingPort & {
  failNextPublish(input: FakePlatformPublishFailure): void
  setStatus(status: PlatformPublicationStatus): void
}

export type FakePlatformPublishingPortOptions = {
  /**
   * Overrides are for deterministic UI and contract fixtures only. They never
   * indicate that an external platform account or permission is actually ready.
   */
  capabilities?: Partial<Record<PublishingPlatform, PlatformCapability>>
}

const defaultCapabilities: Record<PublishingPlatform, PlatformCapability> = {
  facebook: {
    availability: 'conditional',
    modes: ['automatic'],
    platform: 'facebook',
    reason: 'Meta Content Publishing permission requires controlled verification',
  },
  instagram: {
    availability: 'conditional',
    modes: ['automatic'],
    platform: 'instagram',
    reason: 'Instagram business account and publishing permission require verification',
  },
  linkedin: {
    availability: 'conditional',
    modes: ['assisted'],
    platform: 'linkedin',
    reason: 'Automatic publishing remains blocked until API permission is verified',
  },
}

const platformAvailabilities = ['available', 'blocked', 'conditional'] as const
const publishingModes = ['assisted', 'automatic'] as const
const publicationStates = ['failed', 'pending', 'published', 'publishing'] as const
const publishingPlatforms = ['facebook', 'instagram', 'linkedin'] as const

const clone = <Value>(value: Value): Value => structuredClone(value)

const requireRecord = (value: unknown, name: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Fake ${name} must be an object`)
  }
  return value as Record<string, unknown>
}

function assertPublishingPlatform(platform: unknown): asserts platform is PublishingPlatform {
  if (!publishingPlatforms.includes(platform as PublishingPlatform)) {
    throw new Error('Fake publishing platform is unsupported')
  }
}

const normalizeAssets = (assets: unknown): PublicationAsset[] => {
  if (!Array.isArray(assets)) {
    throw new Error('Fake publish request has invalid fields')
  }

  return assets.map((asset) => {
    const candidate = requireRecord(asset, 'publication asset')
    if (
      typeof candidate.fileName !== 'string' ||
      typeof candidate.id !== 'string' ||
      typeof candidate.mimeType !== 'string'
    ) {
      throw new Error('Fake publication asset has invalid fields')
    }
    if (candidate.sourceUrl !== undefined && typeof candidate.sourceUrl !== 'string') {
      throw new Error('Fake publication asset sourceUrl must be a string')
    }

    return candidate.sourceUrl === undefined
      ? {
          fileName: candidate.fileName,
          id: candidate.id,
          mimeType: candidate.mimeType,
        }
      : {
          fileName: candidate.fileName,
          id: candidate.id,
          mimeType: candidate.mimeType,
          sourceUrl: candidate.sourceUrl,
        }
  })
}

const normalizePublishRequest = (request: PlatformPublishRequest): PlatformPublishRequest => {
  const candidate = requireRecord(request, 'publish request')
  assertPublishingPlatform(candidate.platform)
  if (
    typeof candidate.idempotencyKey !== 'string' ||
    typeof candidate.text !== 'string' ||
    (candidate.scheduledFor !== undefined && typeof candidate.scheduledFor !== 'string')
  ) {
    throw new Error('Fake publish request has invalid fields')
  }

  const normalized = {
    assets: normalizeAssets(candidate.assets),
    idempotencyKey: candidate.idempotencyKey,
    platform: candidate.platform,
    text: candidate.text,
  }
  return candidate.scheduledFor === undefined
    ? normalized
    : { ...normalized, scheduledFor: candidate.scheduledFor }
}

const assertPublicationReference = (
  input: Pick<PlatformPublicationStatus, 'externalPublicationId' | 'platform'>,
): void => {
  const candidate = requireRecord(input, 'publication reference')
  assertPublishingPlatform(candidate.platform)
  if (
    typeof candidate.externalPublicationId !== 'string' ||
    !candidate.externalPublicationId.trim()
  ) {
    throw new Error('Fake publication reference requires an externalPublicationId')
  }
}

const commandKey = ({ idempotencyKey, platform }: PlatformPublishRequest): string =>
  `${platform}:${idempotencyKey}`

const referenceKey = ({
  externalPublicationId,
  platform,
}: Pick<PlatformPublicationStatus, 'externalPublicationId' | 'platform'>): string =>
  `${platform}:${externalPublicationId}`

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
    assets: request.assets,
    scheduledFor: request.scheduledFor ?? null,
    text: request.text,
  })

const blocked = (
  request: PlatformPublishRequest,
  errorCode: PlatformPublishErrorCode,
  retryable: boolean,
): BlockedPublication => ({
  errorCode,
  idempotencyKey: request.idempotencyKey,
  platform: request.platform,
  retryable,
  status: 'blocked',
})

const transitionTargets: Record<PlatformPublicationStatus['status'], PlatformPublicationStatus['status'][]> = {
  failed: ['failed'],
  pending: ['failed', 'pending', 'published', 'publishing'],
  published: ['published'],
  publishing: ['failed', 'published', 'publishing'],
}

const normalizePublicationStatus = (
  status: PlatformPublicationStatus,
): PlatformPublicationStatus => {
  const candidate = requireRecord(status, 'publication status')
  assertPublicationReference(status)
  if (!publicationStates.includes(candidate.status as PlatformPublicationStatus['status'])) {
    throw new Error('Fake publication status is unsupported')
  }

  if (candidate.status === 'failed') {
    if (
      !PLATFORM_PUBLISH_ERROR_CODES.includes(
        candidate.errorCode as PlatformPublishErrorCode,
      )
    ) {
      throw new Error('Fake failed publication requires a known errorCode')
    }
    if (typeof candidate.retryable !== 'boolean') {
      throw new Error('Fake failed publication requires retryable')
    }
    return {
      errorCode: candidate.errorCode as PlatformPublishErrorCode,
      externalPublicationId: status.externalPublicationId,
      platform: status.platform,
      retryable: candidate.retryable,
      status: 'failed',
    }
  }

  if ('errorCode' in candidate || 'retryable' in candidate) {
    throw new Error('Fake non-failed publication cannot include failure metadata')
  }
  return {
    externalPublicationId: status.externalPublicationId,
    platform: status.platform,
    status: candidate.status as Exclude<PlatformPublicationStatus['status'], 'failed'>,
  }
}

const assertCapability = (
  platform: PublishingPlatform,
  capability: unknown,
): PlatformCapability => {
  const candidate = requireRecord(capability, 'platform capability')
  if (candidate.platform !== platform) {
    throw new Error(`Fake platform capability override must match ${platform}`)
  }
  if (!platformAvailabilities.includes(candidate.availability as PlatformCapability['availability'])) {
    throw new Error('Fake platform capability requires a known availability')
  }
  if (
    !Array.isArray(candidate.modes) ||
    !candidate.modes.every((mode) => publishingModes.includes(mode as 'assisted' | 'automatic'))
  ) {
    throw new Error('Fake platform capability requires valid modes')
  }
  if (candidate.reason !== undefined && typeof candidate.reason !== 'string') {
    throw new Error('Fake platform capability reason must be a string')
  }
  const normalized = {
    availability: candidate.availability as PlatformCapability['availability'],
    modes: [...candidate.modes] as PlatformCapability['modes'],
    platform,
  }
  return candidate.reason === undefined
    ? normalized
    : { ...normalized, reason: candidate.reason }
}

const capabilityOverrides = (
  options: FakePlatformPublishingPortOptions,
): Record<string, unknown> => {
  const candidate = requireRecord(options, 'publishing port options')
  if (candidate.capabilities === undefined) return {}
  return requireRecord(candidate.capabilities, 'platform capability overrides')
}

const normalizePublishFailure = (
  input: FakePlatformPublishFailure,
): FakePlatformPublishFailure => {
  const candidate = requireRecord(input, 'publish failure')
  assertPublishingPlatform(candidate.platform)
  if (!PLATFORM_PUBLISH_ERROR_CODES.includes(candidate.errorCode as PlatformPublishErrorCode)) {
    throw new Error('Fake publish failure requires a known errorCode')
  }
  if (typeof candidate.retryable !== 'boolean') {
    throw new Error('Fake publish failure requires retryable')
  }
  return {
    errorCode: candidate.errorCode as PlatformPublishErrorCode,
    platform: candidate.platform,
    retryable: candidate.retryable,
  }
}

/**
 * Creates a deterministic, credential-free publishing adapter for Task 12 UI
 * mocks and Task 13 contract tests. It never performs network or database I/O.
 */
export const createFakePlatformPublishingPort = (
  options: FakePlatformPublishingPortOptions = {},
): FakePlatformPublishingPort => {
  const capabilities: Record<PublishingPlatform, PlatformCapability> = {
    ...defaultCapabilities,
  }
  for (const [platform, override] of Object.entries(capabilityOverrides(options))) {
    assertPublishingPlatform(platform)
    if (override !== undefined) capabilities[platform] = assertCapability(platform, override)
  }

  const publicationsByCommand = new Map<string, PublicationRecord>()
  const publicationsByReference = new Map<string, PublicationRecord>()
  const nextFailures = new Map<PublishingPlatform, FakePlatformPublishFailure[]>()

  return {
    async getCapability(platform) {
      assertPublishingPlatform(platform)
      return clone(capabilities[platform])
    },

    async getStatus(input) {
      assertPublicationReference(input)
      const publication = publicationsByReference.get(referenceKey(input))
      if (!publication) throw new Error('Fake platform publication is not known')
      return clone(publication.status)
    },

    async publish(request) {
      const normalizedRequest = normalizePublishRequest(request)
      if (!normalizedRequest.idempotencyKey.trim() || !normalizedRequest.text.trim()) {
        return blocked(normalizedRequest, 'invalid_request', false)
      }

      const key = commandKey(normalizedRequest)
      const fingerprint = requestFingerprint(normalizedRequest)
      const existing = publicationsByCommand.get(key)
      if (existing) {
        if (existing.fingerprint !== fingerprint) {
          return blocked(normalizedRequest, 'invalid_request', false)
        }
        return clone(existing.acceptance)
      }

      const capability = capabilities[normalizedRequest.platform]
      if (capability.availability === 'blocked' || !capability.modes.includes('automatic')) {
        return blocked(normalizedRequest, 'platform_blocked', false)
      }

      // An accepted duplicate returned above never reaches a provider call, so it
      // must not consume a failure that models the next new provider invocation.
      const queuedFailures = nextFailures.get(normalizedRequest.platform)
      const nextFailure = queuedFailures?.shift()
      if (queuedFailures?.length === 0) nextFailures.delete(normalizedRequest.platform)
      if (nextFailure) {
        return blocked(normalizedRequest, nextFailure.errorCode, nextFailure.retryable)
      }

      const acceptance: AcceptedPublication = {
        externalPublicationId: `mock:${normalizedRequest.platform}:${normalizedRequest.idempotencyKey}`,
        idempotencyKey: normalizedRequest.idempotencyKey,
        platform: normalizedRequest.platform,
        status: 'accepted',
      }
      const status: PlatformPublicationStatus = {
        externalPublicationId: acceptance.externalPublicationId,
        platform: acceptance.platform,
        status: 'pending',
      }
      const publication = { acceptance, fingerprint, status }
      publicationsByCommand.set(key, publication)
      publicationsByReference.set(referenceKey(status), publication)
      return clone(acceptance)
    },

    failNextPublish(input) {
      const normalizedFailure = normalizePublishFailure(input)
      const queuedFailures = nextFailures.get(normalizedFailure.platform) ?? []
      queuedFailures.push(normalizedFailure)
      nextFailures.set(normalizedFailure.platform, queuedFailures)
    },

    setStatus(status) {
      const normalizedStatus = normalizePublicationStatus(status)
      const publication = publicationsByReference.get(referenceKey(normalizedStatus))
      if (!publication) throw new Error('Fake platform publication is not known')

      const currentStatus = publication.status.status
      if (!transitionTargets[currentStatus].includes(normalizedStatus.status)) {
        throw new Error(
          `Fake platform publication cannot transition from ${currentStatus} to ${normalizedStatus.status}`,
        )
      }
      if (
        currentStatus === 'failed' &&
        normalizedStatus.status === 'failed' &&
        stableSerialize(publication.status) !== stableSerialize(normalizedStatus)
      ) {
        throw new Error('Fake platform publication cannot replace failed failure metadata')
      }
      publication.status = normalizedStatus
    },
  }
}
