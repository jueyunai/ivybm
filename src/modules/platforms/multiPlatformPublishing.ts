import { createHash } from 'node:crypto'

import {
  PUBLISHING_PLATFORMS,
  PublishingContractValidationError,
  normalizePlatformCapabilityQuery,
  normalizePlatformPublishRequest,
  normalizePublicationIdempotencyKey,
  type PlatformPublishRequest,
  type PublishingPlatform,
} from '../publishing/contracts'
import {
  PLATFORM_PUBLISH_EXECUTION_STATUSES,
  type PlatformPublishExecutionSnapshot,
  type PlatformPublishExecutionStatus,
  type PlatformPublishExecutionTransition,
} from './publishingExecution'
export type MultiPlatformPublishTarget = Omit<
  PlatformPublishRequest,
  'idempotencyKey' | 'scheduledFor'
>

export type MultiPlatformPublishCommand = {
  /** One stable key for the user's single click; never sent directly to a provider. */
  idempotencyKey: string
  /** Server-recorded click time. It satisfies the legacy required PublishJob field, not delayed delivery. */
  requestedAt: string
  targets: MultiPlatformPublishTarget[]
}

export type MultiPlatformPublicationPlan = {
  commands: PlannedPlatformPublication[]
}

export type PlannedPlatformPublication = {
  /** Persist and compare atomically when an existing derived key is loaded. */
  requestFingerprint: string
  /** Server-recorded click time; persisted in the legacy required PublishJob.scheduledFor field. */
  requestedAt: string
  snapshot: PlatformPublishExecutionSnapshot
}

export type MultiPlatformPublicationResult = {
  idempotencyKey: string
  platform: PublishingPlatform
  platformAccountId: PlatformPublishRequest['platformAccountId']
  transition: PlatformPublishExecutionTransition
}

export type PlatformPublicationExecutor = (
  snapshot: PlatformPublishExecutionSnapshot,
) => Promise<PlatformPublishExecutionTransition>

const terminalStatuses = new Set<PlatformPublishExecutionStatus>([
  'delivery_unknown',
  'failed',
  'published',
])

const platformOrder = new Map<PublishingPlatform, number>(
  PUBLISHING_PLATFORMS.map((platform, index) => [platform, index]),
)

const stableSerialize = (value: unknown): string => {
  if (value === undefined || value === null) return 'null'
  if (typeof value !== 'object') return JSON.stringify([typeof value, value])
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key])}`)
    .join(',')}}`
}

const derivedIdempotencyKey = (
  baseKey: string,
  platform: PublishingPlatform,
  platformAccountId: PlatformPublishRequest['platformAccountId'],
): string =>
  // PlatformAccount IDs are Payload primary keys and therefore globally unique
  // within this single-deployment MVP. A future tenant-local ID must add its
  // tenant/workspace identity to this hash before this helper is reused.
  `publish:v1:${createHash('sha256')
    .update(stableSerialize({ baseKey, platform, platformAccountId }))
    .digest('hex')}:${platform}`

const requestFingerprint = (request: PlatformPublishRequest): string =>
  createHash('sha256')
    .update(
      stableSerialize({
        assets: request.assets.map(({ id, mimeType, sha256, sourceUrl }) => ({
          id,
          mimeType,
          sha256: sha256 ?? null,
          // Signed transport URLs may refresh when immutable content identity
          // is available. Without sha256 the URL is the only replacement guard.
          sourceUrl: sha256 ? null : (sourceUrl ?? null),
        })),
        platform: request.platform,
        platformAccountId: request.platformAccountId,
        text: request.text,
      }),
    )
    .digest('hex')

const canonicalSort = <Value extends { platform: PublishingPlatform }>(values: Value[]): Value[] =>
  [...values].sort(
    (left, right) => platformOrder.get(left.platform)! - platformOrder.get(right.platform)!,
  )

const assertUniquePlatforms = (platforms: PublishingPlatform[]): void => {
  if (!platforms.length) {
    throw new PublishingContractValidationError(
      'Multi-platform publication requires at least one target',
    )
  }
  if (new Set(platforms).size !== platforms.length) {
    throw new PublishingContractValidationError(
      'Multi-platform publication targets must be unique by platform',
    )
  }
}

const normalizedRequestedAt = (value: unknown): string => {
  if (typeof value !== 'string' || value !== value.trim()) {
    throw new PublishingContractValidationError('Multi-platform publication click time is invalid')
  }
  const milliseconds = Date.parse(value)
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) {
    throw new PublishingContractValidationError('Multi-platform publication click time is invalid')
  }
  return new Date(milliseconds).toISOString()
}

/**
 * Convert one user click into independent, globally unique PublishJob commands.
 * No provider or persistence I/O occurs here. A production repository must use
 * each derived key to atomically create-or-load the platform-specific job.
 */
export const planMultiPlatformPublication = (
  command: MultiPlatformPublishCommand,
): MultiPlatformPublicationPlan => {
  if (!command || typeof command !== 'object' || Array.isArray(command)) {
    throw new PublishingContractValidationError('Multi-platform publication command is invalid')
  }
  const baseKey = normalizePublicationIdempotencyKey(command.idempotencyKey)
  const requestedAt = normalizedRequestedAt(command.requestedAt)
  if (!Array.isArray(command.targets)) {
    throw new PublishingContractValidationError('Multi-platform publication targets are invalid')
  }

  const queries = command.targets.map((target) => normalizePlatformCapabilityQuery(target))
  assertUniquePlatforms(queries.map(({ platform }) => platform))

  const commands = command.targets.map((target, index): PlannedPlatformPublication => {
    const platform = queries[index]!.platform
    const platformAccountId = queries[index]!.platformAccountId
    const request = normalizePlatformPublishRequest({
      ...target,
      idempotencyKey: derivedIdempotencyKey(baseKey, platform, platformAccountId),
      platform,
      platformAccountId,
    })
    return {
      requestFingerprint: requestFingerprint(request),
      requestedAt,
      snapshot: { ...request, status: 'scheduled' as const },
    }
  })

  return {
    commands: [...commands].sort(
      (left, right) =>
        platformOrder.get(left.snapshot.platform)! - platformOrder.get(right.snapshot.platform)!,
    ),
  }
}

const normalizeSnapshot = (
  value: PlatformPublishExecutionSnapshot,
): PlatformPublishExecutionSnapshot => {
  const request = normalizePlatformPublishRequest(value)
  if (
    !PLATFORM_PUBLISH_EXECUTION_STATUSES.includes(value.status as PlatformPublishExecutionStatus) ||
    request.scheduledFor
  ) {
    throw new PublishingContractValidationError('Multi-platform publication snapshot is invalid')
  }
  const externalPublicationId =
    value.externalPublicationId === undefined
      ? undefined
      : typeof value.externalPublicationId === 'string' &&
          value.externalPublicationId === value.externalPublicationId.trim() &&
          value.externalPublicationId.length > 0 &&
          value.externalPublicationId.length <= 500
        ? value.externalPublicationId
        : (() => {
            throw new PublishingContractValidationError(
              'Multi-platform publication external ID is invalid',
            )
          })()
  if (
    (value.status === 'accepted' ||
      value.status === 'publishing' ||
      value.status === 'published') &&
    !externalPublicationId
  ) {
    throw new PublishingContractValidationError(
      'Active multi-platform publication requires an external ID',
    )
  }
  return {
    ...request,
    ...(externalPublicationId ? { externalPublicationId } : {}),
    status: value.status,
  }
}

const validExternalId = (value: unknown): string | undefined =>
  typeof value === 'string' && value === value.trim() && value.length > 0 && value.length <= 500
    ? value
    : undefined

const unknownTransition = (externalPublicationId?: string): PlatformPublishExecutionTransition => ({
  changed: true,
  event: 'delivery-unknown',
  ...(externalPublicationId ? { externalPublicationId } : {}),
  lastErrorCode: 'delivery_unknown',
  retryable: false,
  status: 'delivery_unknown',
  summary:
    'This platform execution failed at an unproven provider boundary; automatic resend is disabled.',
})

const validateTransition = (
  transition: PlatformPublishExecutionTransition,
): PlatformPublishExecutionTransition => {
  const externalPublicationId = validExternalId(transition?.externalPublicationId)
  if (
    !transition ||
    typeof transition !== 'object' ||
    typeof transition.changed !== 'boolean' ||
    !PLATFORM_PUBLISH_EXECUTION_STATUSES.includes(transition.status)
  ) {
    return unknownTransition(externalPublicationId)
  }
  if (
    transition.externalPublicationId !== undefined &&
    (typeof transition.externalPublicationId !== 'string' ||
      !transition.externalPublicationId.trim() ||
      transition.externalPublicationId !== transition.externalPublicationId.trim() ||
      transition.externalPublicationId.length > 500)
  ) {
    return unknownTransition()
  }
  if (transition.status === 'delivery_unknown' && transition.retryable !== false) {
    return unknownTransition(externalPublicationId)
  }
  if (
    (transition.status === 'accepted' ||
      transition.status === 'publishing' ||
      transition.status === 'published') &&
    !transition.externalPublicationId
  ) {
    return unknownTransition(externalPublicationId)
  }
  return transition
}

const executeOne = async (
  snapshot: PlatformPublishExecutionSnapshot,
  execute: PlatformPublicationExecutor,
): Promise<MultiPlatformPublicationResult> => {
  let transition: PlatformPublishExecutionTransition
  if (terminalStatuses.has(snapshot.status)) {
    transition = {
      changed: false,
      ...(snapshot.externalPublicationId
        ? { externalPublicationId: snapshot.externalPublicationId }
        : {}),
      status: snapshot.status,
    }
  } else {
    try {
      transition = validateTransition(await execute(structuredClone(snapshot)))
    } catch {
      // Only the persistence authority can prove whether provider I/O began.
      // A fan-out layer must never infer a safe retry from a thrown error.
      transition = unknownTransition()
    }
  }
  return {
    idempotencyKey: snapshot.idempotencyKey,
    platform: snapshot.platform,
    platformAccountId: snapshot.platformAccountId,
    transition,
  }
}

/**
 * Execute each persisted platform snapshot independently and concurrently.
 * One platform's rejection never rejects the whole click, and this function
 * never retries. Terminal snapshots are returned without invoking an executor.
 */
export const executeMultiPlatformPublication = async ({
  execute,
  snapshots: input,
}: {
  execute: PlatformPublicationExecutor
  snapshots: PlatformPublishExecutionSnapshot[]
}): Promise<MultiPlatformPublicationResult[]> => {
  if (typeof execute !== 'function' || !Array.isArray(input)) {
    throw new PublishingContractValidationError('Multi-platform publication execution is invalid')
  }
  const snapshots = input.map(normalizeSnapshot)
  assertUniquePlatforms(snapshots.map(({ platform }) => platform))
  return Promise.all(canonicalSort(snapshots).map((snapshot) => executeOne(snapshot, execute)))
}
