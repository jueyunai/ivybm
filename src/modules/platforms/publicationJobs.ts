import type { Payload, PayloadRequest } from 'payload'

import { PayloadJobQueue, type EnsureRunnableJobOptions } from '@/modules/jobs/claim'
import { getJobCompensation } from '@/modules/jobs/compensation/contracts'
import {
  JobRetryNotBeforeError,
  type ClaimedJob,
  type JobExecution,
  type JobHandler,
  type JobRecord,
} from '@/modules/jobs/contracts'
import type { PublishJob } from '@/payload-types'

import { normalizePlatformPublishRequest, type PublishingService } from '../publishing/contracts'
import type {
  LinkedInImageAssetIdentity,
  LinkedInImagePublishingCheckpoint,
  LinkedInImagePublishingIntent,
} from './linkedin/imagePublishingExecution'
import type { LinkedInPublishingTransport } from './linkedin/publishingOutbound'
import type {
  InstagramPublishingCheckpoint,
  InstagramPublishingIntent,
} from './meta/instagramPublishingExecution'
import type { MetaPublishingTransport } from './meta/publishingOutbound'
import {
  PayloadInstagramPublishingAuthority,
  PayloadLinkedInImagePublishingAuthority,
  PayloadPlatformPublicationAuthority,
} from './payloadPublishingAuthority'
import {
  dispatchPublicationWorkItem,
  type PublicationWorkerDispatchResult,
  type PublicationWorkerRoute,
} from './publicationWorkerDispatch'
import type {
  PlatformPublicationAuthorityPort,
  PlatformPublicationIntent,
} from './publishingAuthority'
import type { PlatformPublishExecutionSnapshot } from './publishingExecution'

export const PLATFORM_PUBLICATION_JOB_TYPE = 'platform.publication.execute'

export type PlatformPublicationJobPayload = {
  expectedExecutionRevision: number
  publishJobId: number
}

export class PlatformPublicationJobError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PlatformPublicationJobError'
  }
}

type PublicationJobQueue = Pick<PayloadJobQueue, 'enqueue'> & {
  ensureRunnable?: (
    input: Parameters<PayloadJobQueue['enqueue']>[0],
    options?: EnsureRunnableJobOptions,
  ) => ReturnType<PayloadJobQueue['enqueue']>
}

export type PublicationJobRuntime = {
  directService: PublishingService
  linkedInTransport: LinkedInPublishingTransport
  metaTransport: MetaPublishingTransport
  readLinkedInAssetBytes(input: LinkedInImageAssetIdentity): Promise<Uint8Array | null>
}

const record = (value: unknown, field: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new PlatformPublicationJobError(`Publication job ${field} is invalid`)
  }
  return value as Record<string, unknown>
}

const positiveInteger = (value: unknown, field: string): number => {
  const number = typeof value === 'number' ? value : Number(value)
  if (!Number.isSafeInteger(number) || number < 1) {
    throw new PlatformPublicationJobError(`Publication job ${field} is invalid`)
  }
  return number
}

const nonNegativeInteger = (value: unknown, field: string): number => {
  const number = typeof value === 'number' ? value : Number(value)
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new PlatformPublicationJobError(`Publication job ${field} is invalid`)
  }
  return number
}

const relationshipID = (value: unknown, field: string): number =>
  positiveInteger(
    value && typeof value === 'object' && 'id' in value ? (value as { id?: unknown }).id : value,
    field,
  )

export const parsePlatformPublicationJobPayload = (
  value: Record<string, unknown>,
): PlatformPublicationJobPayload => ({
  expectedExecutionRevision: nonNegativeInteger(
    value.expectedExecutionRevision,
    'expectedExecutionRevision',
  ),
  publishJobId: positiveInteger(value.publishJobId, 'publishJobId'),
})

const route = (value: unknown): PublicationWorkerRoute => {
  if (
    value !== 'facebook-photo-single' &&
    value !== 'instagram-image-staged' &&
    value !== 'linkedin-text-single' &&
    value !== 'linkedin-image-staged'
  ) {
    throw new PlatformPublicationJobError('Publication job executionRoute is invalid')
  }
  return value
}

const leaseFence = (job: ClaimedJob) => ({
  leaseExpiresAt: job.leaseExpiresAt,
  ownerToken: job.ownerToken,
  queueJobId: job.id,
})

const directSnapshot = (job: PublishJob): PlatformPublishExecutionSnapshot => {
  const request = normalizePlatformPublishRequest(job.requestSnapshot)
  if (request.scheduledFor) {
    throw new PlatformPublicationJobError('Publication queue only accepts immediate requests')
  }
  return {
    ...request,
    expectedAuthorizationRevision: nonNegativeInteger(
      job.authorizationRevision,
      'authorizationRevision',
    ),
    ...(job.externalPublicationId ? { externalPublicationId: job.externalPublicationId } : {}),
    status: job.status,
  }
}

const linkedInImageState = (value: unknown) => {
  const state = record(value, 'providerCheckpoint')
  return {
    asset: record(state.asset, 'providerCheckpoint.asset') as LinkedInImageAssetIdentity,
    checkpoint: record(
      state.checkpoint,
      'providerCheckpoint.checkpoint',
    ) as LinkedInImagePublishingCheckpoint,
  }
}

const isDirectRoute = (job: Pick<PublishJob, 'executionRoute'>): boolean =>
  job.executionRoute === 'facebook-photo-single' || job.executionRoute === 'linkedin-text-single'

const terminalStatuses = new Set<PublishJob['status']>(['delivery_unknown', 'failed', 'published'])

type PublicationQueueState = Pick<
  PublishJob,
  'executionRevision' | 'executionRoute' | 'providerIOStartedAt' | 'status'
>

const continuationNeeded = (job: PublicationQueueState): boolean =>
  (isDirectRoute(job) && (job.status === 'accepted' || job.status === 'publishing')) ||
  ((job.executionRoute === 'instagram-image-staged' ||
    job.executionRoute === 'linkedin-image-staged') &&
    job.status === 'publishing')

export type PublicationQueueObligation =
  'complete' | 'continuation' | 'recovery' | 'status-successor' | 'unresolved'

export const classifyPublicationQueueObligation = (
  job: PublicationQueueState & { claimId?: string | null; claimLeaseExpiresAt?: string | null },
  expectedExecutionRevision: number,
  _now: Date = new Date(),
): PublicationQueueObligation => {
  if (terminalStatuses.has(job.status)) return 'complete'
  if (job.providerIOStartedAt) return 'recovery'
  if (job.executionRevision > expectedExecutionRevision && continuationNeeded(job)) {
    return 'continuation'
  }
  if (job.executionRevision === expectedExecutionRevision && continuationNeeded(job)) {
    return 'status-successor'
  }
  return 'unresolved'
}

export const enqueuePublicationExecution = async ({
  nextRunAt,
  publishJobId,
  queue,
  req,
  revision,
}: {
  nextRunAt?: Date
  publishJobId: number
  queue: PublicationJobQueue
  req?: PayloadRequest
  revision: number
}) =>
  queue.enqueue(
    {
      idempotencyKey: `publication-execute:${publishJobId}:${revision}`,
      // One retry is allowed only when the platform executor proves provider I/O never began.
      maxAttempts: 2,
      ...(nextRunAt ? { nextRunAt } : {}),
      payload: { expectedExecutionRevision: revision, publishJobId },
      type: PLATFORM_PUBLICATION_JOB_TYPE,
    },
    req,
  )

export const enqueuePublicationStatusSuccessor = async ({
  nextRunAt,
  publishJobId,
  queue,
  revision,
}: {
  nextRunAt: Date
  publishJobId: number
  queue: PublicationJobQueue
  revision: number
}) =>
  queue.ensureRunnable
    ? queue.ensureRunnable(
        {
          idempotencyKey: `publication-status:${publishJobId}:${revision}`,
          maxAttempts: 2,
          nextRunAt,
          payload: { expectedExecutionRevision: revision, publishJobId },
          type: PLATFORM_PUBLICATION_JOB_TYPE,
        },
        { rearmSucceeded: true },
      )
    : queue.enqueue({
        idempotencyKey: `publication-status:${publishJobId}:${revision}`,
        maxAttempts: 2,
        nextRunAt,
        payload: { expectedExecutionRevision: revision, publishJobId },
        type: PLATFORM_PUBLICATION_JOB_TYPE,
      })

export const isPublicationStatusRecoveryKey = (
  key: string | null | undefined,
  publishJobId: number,
  revision: number,
): boolean => key === `publication-status:${publishJobId}:${revision}`

export const isPublicationRecoveryKey = (
  key: string | null | undefined,
  publishJobId: number,
  revision: number,
): boolean => key === `publication-recovery:${publishJobId}:${revision}`

export const enqueuePublicationRecovery = async ({
  nextRunAt,
  publishJobId,
  queue,
  revision,
}: {
  nextRunAt: Date
  publishJobId: number
  queue: PublicationJobQueue
  revision: number
}) =>
  queue.enqueue({
    idempotencyKey: `publication-recovery:${publishJobId}:${revision}`,
    maxAttempts: 2,
    nextRunAt,
    payload: { expectedExecutionRevision: revision, publishJobId },
    type: PLATFORM_PUBLICATION_JOB_TYPE,
  })

export const isRunnableSuccessor = (job: JobRecord, _now: Date = new Date()): boolean => {
  if (job.status === 'processing') {
    if (!job.ownerToken || !job.leaseExpiresAt) return false
    const leaseExpiry = Date.parse(job.leaseExpiresAt)
    if (!Number.isFinite(leaseExpiry)) return false
    return job.attempts < job.maxAttempts
  }
  return (
    (job.status === 'pending' || job.status === 'failed') &&
    job.attempts < job.maxAttempts &&
    Boolean(job.nextRunAt) &&
    Number.isFinite(Date.parse(job.nextRunAt!))
  )
}

const finalAttemptLeaseExpiry = (job: JobRecord, now: Date): Date | null => {
  if (
    job.status !== 'processing' ||
    job.attempts < job.maxAttempts ||
    !job.ownerToken ||
    !job.leaseExpiresAt
  ) {
    return null
  }
  const leaseExpiry = Date.parse(job.leaseExpiresAt)
  return Number.isFinite(leaseExpiry) && leaseExpiry > now.getTime() ? new Date(leaseExpiry) : null
}

const statusSuccessorNextRunAt = (
  job: Pick<PublishJob, 'claimLeaseExpiresAt'>,
  instant: Date,
  fallbackDelayMs = 0,
) => {
  const leaseExpiry = job.claimLeaseExpiresAt ? Date.parse(job.claimLeaseExpiresAt) : Number.NaN
  return Number.isFinite(leaseExpiry) && leaseExpiry > instant.getTime()
    ? new Date(leaseExpiry + 1)
    : new Date(instant.getTime() + fallbackDelayMs)
}

export const assertRunnableSuccessor = (
  job: JobRecord,
  kind: 'continuation' | 'recovery' | 'status-successor',
  now: Date = new Date(),
): void => {
  if (isRunnableSuccessor(job, now)) return
  if (
    kind === 'status-successor' &&
    getJobCompensation({
      idempotencyKey: job.idempotencyKey,
      status: job.status,
      type: job.type,
    })
  ) {
    return
  }
  throw new PlatformPublicationJobError(
    `Publication ${kind} job ${job.id} is ${job.status}; manual recovery is required`,
  )
}

const scheduleContinuation = async (
  job: PublishJob,
  queue: PublicationJobQueue,
  now: () => Date,
  sourceJob: Pick<ClaimedJob, 'attempts' | 'maxAttempts'>,
): Promise<void> => {
  if (!continuationNeeded(job)) return
  const stage = isDirectRoute(job)
    ? 'direct-status'
    : job.executionRoute === 'linkedin-image-staged'
      ? record(
          record(job.providerCheckpoint, 'providerCheckpoint').checkpoint,
          'providerCheckpoint.checkpoint',
        ).stage
      : record(job.providerCheckpoint, 'providerCheckpoint').stage
  const nextRunAt =
    stage === 'container_created' || stage === 'direct-status'
      ? new Date(now().getTime() + 2_000)
      : undefined
  const instant = now()

  // The checkpoint and its execution continuation are separate durable writes.
  // On the final source attempt, persist a read-only obligation first so an
  // INSERT failure cannot leave accepted/publishing with no recovery entry.
  if (sourceJob.attempts >= sourceJob.maxAttempts) {
    const watchdog = await enqueuePublicationStatusSuccessor({
      nextRunAt: statusSuccessorNextRunAt(job, instant, 2_000),
      publishJobId: job.id,
      queue,
      revision: job.executionRevision,
    })
    assertRunnableSuccessor(watchdog.job, 'status-successor', instant)
  }

  const queued = await enqueuePublicationExecution({
    nextRunAt,
    publishJobId: job.id,
    queue,
    revision: job.executionRevision,
  })
  if (isRunnableSuccessor(queued.job, instant)) return
  const finalLeaseExpiry = finalAttemptLeaseExpiry(queued.job, instant)
  const watchdog = await enqueuePublicationStatusSuccessor({
    nextRunAt: finalLeaseExpiry ? new Date(finalLeaseExpiry.getTime() + 1) : instant,
    publishJobId: job.id,
    queue,
    revision: job.executionRevision,
  })
  assertRunnableSuccessor(watchdog.job, 'status-successor', instant)
}

const scheduleRecovery = async (
  job: PublishJob,
  queue: PublicationJobQueue,
  now: () => Date,
): Promise<void> => {
  if (!job.providerIOStartedAt) {
    throw new PlatformPublicationJobError('Publication recovery requires a provider I/O marker')
  }
  const instant = now()
  const leaseExpiry = job.claimLeaseExpiresAt ? Date.parse(job.claimLeaseExpiresAt) : Number.NaN
  const nextRunAt =
    Number.isFinite(leaseExpiry) && leaseExpiry > instant.getTime()
      ? new Date(leaseExpiry + 1)
      : instant
  const queued = await enqueuePublicationRecovery({
    nextRunAt,
    publishJobId: job.id,
    queue,
    revision: job.executionRevision,
  })
  assertRunnableSuccessor(queued.job, 'recovery', instant)
}

const scheduleStatusSuccessor = async (
  job: PublishJob,
  queue: PublicationJobQueue,
  now: () => Date,
): Promise<void> => {
  const instant = now()
  const queued = await enqueuePublicationStatusSuccessor({
    nextRunAt: statusSuccessorNextRunAt(job, instant),
    publishJobId: job.id,
    queue,
    revision: job.executionRevision,
  })
  assertRunnableSuccessor(queued.job, 'status-successor', instant)
}

const loadPublishJob = async (payload: Payload, id: number): Promise<PublishJob> =>
  payload.findByID({ collection: 'publish-jobs', depth: 0, id, overrideAccess: true })

const reconcileDurableOutcome = async ({
  currentIdempotencyKey,
  dispatchError,
  expectedExecutionRevision,
  job,
  now,
  queue,
  sourceJob,
}: {
  currentIdempotencyKey?: string | null
  dispatchError?: unknown
  expectedExecutionRevision: number
  job: PublishJob
  now: () => Date
  queue: PublicationJobQueue
  sourceJob: Pick<ClaimedJob, 'attempts' | 'maxAttempts'>
}): Promise<void> => {
  if (job.executionRevision < expectedExecutionRevision) {
    throw new PlatformPublicationJobError('Publication execution revision is inconsistent')
  }
  const obligation = classifyPublicationQueueObligation(job, expectedExecutionRevision, now())
  if (obligation === 'complete') return
  if (obligation === 'recovery') {
    if (isPublicationRecoveryKey(currentIdempotencyKey, job.id, job.executionRevision)) {
      const leaseExpiry = job.claimLeaseExpiresAt ? Date.parse(job.claimLeaseExpiresAt) : Number.NaN
      if (Number.isFinite(leaseExpiry) && leaseExpiry > now().getTime()) {
        throw new JobRetryNotBeforeError(
          dispatchError instanceof Error
            ? dispatchError.message
            : 'Publication recovery checkpoint is unresolved; waiting for the retained claim lease to expire.',
          new Date(leaseExpiry + 1),
        )
      }
      if (dispatchError) throw dispatchError
      throw new PlatformPublicationJobError(
        'Publication recovery checkpoint is unresolved; the bounded recovery job must be retried or manually compensated.',
      )
    }
    await scheduleRecovery(job, queue, now)
    throw new PlatformPublicationJobError(
      'Publication checkpoint is unresolved; durable recovery was scheduled without replaying provider I/O',
    )
  }
  if (obligation === 'continuation') {
    await scheduleContinuation(job, queue, now, sourceJob)
    return
  }
  if (obligation === 'status-successor') {
    if (isPublicationStatusRecoveryKey(currentIdempotencyKey, job.id, job.executionRevision)) {
      const leaseExpiry = job.claimLeaseExpiresAt ? Date.parse(job.claimLeaseExpiresAt) : Number.NaN
      if (Number.isFinite(leaseExpiry) && leaseExpiry > now().getTime()) {
        throw new JobRetryNotBeforeError(
          dispatchError instanceof Error
            ? dispatchError.message
            : 'Publication status checkpoint remains unresolved; waiting for the retained claim lease to expire.',
          new Date(leaseExpiry + 1),
        )
      }
      if (dispatchError) throw dispatchError
      throw new PlatformPublicationJobError(
        'Publication status checkpoint remains unresolved; the bounded status recovery job must be retried or manually compensated.',
      )
    }
    await scheduleStatusSuccessor(job, queue, now)
    throw new PlatformPublicationJobError(
      'Publication status checkpoint is unresolved with a retained claim; durable status successor was scheduled',
    )
  }
  if (dispatchError) throw dispatchError
  throw new PlatformPublicationJobError(
    'Publication dispatch did not reach a terminal state or hand off to a runnable durable successor',
  )
}

const dispatchPersistedPublication = async ({
  claimedJob,
  createDirectAuthority,
  job,
  payload,
  runtime,
}: {
  claimedJob: ClaimedJob
  createDirectAuthority: (payload: Payload) => PlatformPublicationAuthorityPort
  job: PublishJob
  payload: Payload
  runtime: PublicationJobRuntime
}): Promise<PublicationWorkerDispatchResult> => {
  const selectedRoute = route(job.executionRoute)
  const platformAccountId = relationshipID(job.platformAccount, 'platformAccount')
  const lease = leaseFence(claimedJob)
  if (selectedRoute === 'facebook-photo-single' || selectedRoute === 'linkedin-text-single') {
    const intent: PlatformPublicationIntent = {
      expectedRevision: job.executionRevision,
      publishJobId: job.id,
      snapshot: directSnapshot(job),
    }
    return dispatchPublicationWorkItem({
      authority: createDirectAuthority(payload),
      intent,
      leaseFence: lease,
      route: selectedRoute,
      service: runtime.directService,
    })
  }
  if (selectedRoute === 'instagram-image-staged') {
    const intent: InstagramPublishingIntent = {
      checkpoint: record(
        job.providerCheckpoint,
        'providerCheckpoint',
      ) as InstagramPublishingCheckpoint,
      expectedRevision: job.executionRevision,
      idempotencyKey: job.idempotencyKey,
      platform: 'instagram',
      platformAccountId,
      publishJobId: job.id,
    }
    return dispatchPublicationWorkItem({
      authority: new PayloadInstagramPublishingAuthority({ payload }),
      intent,
      leaseFence: lease,
      route: selectedRoute,
      transport: runtime.metaTransport,
    })
  }
  const state = linkedInImageState(job.providerCheckpoint)
  const intent: LinkedInImagePublishingIntent = {
    asset: state.asset,
    checkpoint: state.checkpoint,
    expectedRevision: job.executionRevision,
    idempotencyKey: job.idempotencyKey,
    platform: 'linkedin',
    platformAccountId,
    publishJobId: job.id,
  }
  return dispatchPublicationWorkItem({
    authority: new PayloadLinkedInImagePublishingAuthority({ payload }),
    intent,
    leaseFence: lease,
    ...(state.checkpoint.stage === 'image_initialized'
      ? { readAssetBytes: runtime.readLinkedInAssetBytes }
      : {}),
    route: selectedRoute,
    transport: runtime.linkedInTransport,
  })
}

export const createPlatformPublicationJobHandler =
  ({
    createDirectAuthority = (authorityPayload) =>
      new PayloadPlatformPublicationAuthority({ payload: authorityPayload }),
    now = () => new Date(),
    payload,
    queue = new PayloadJobQueue({ payload }),
    resolveRuntime,
  }: {
    createDirectAuthority?: (payload: Payload) => PlatformPublicationAuthorityPort
    now?: () => Date
    payload: Payload
    queue?: PublicationJobQueue
    resolveRuntime: (
      route: PublicationWorkerRoute,
    ) => Promise<PublicationJobRuntime> | PublicationJobRuntime
  }): JobHandler =>
  async (claimedJob: ClaimedJob, execution: JobExecution) => {
    const input = parsePlatformPublicationJobPayload(claimedJob.payload)
    execution.assertLease()
    let persisted = await loadPublishJob(payload, input.publishJobId)
    if (persisted.executionRevision < input.expectedExecutionRevision) {
      throw new PlatformPublicationJobError('Publication execution revision is inconsistent')
    }
    if (terminalStatuses.has(persisted.status)) return
    if (persisted.executionRevision > input.expectedExecutionRevision) {
      await reconcileDurableOutcome({
        currentIdempotencyKey: claimedJob.idempotencyKey,
        expectedExecutionRevision: input.expectedExecutionRevision,
        job: persisted,
        now,
        queue,
        sourceJob: claimedJob,
      })
      execution.assertLease()
      return
    }
    const runtime = await resolveRuntime(route(persisted.executionRoute))
    execution.assertLease()
    let dispatchError: unknown
    try {
      await dispatchPersistedPublication({
        claimedJob,
        createDirectAuthority,
        job: persisted,
        payload,
        runtime,
      })
    } catch (error) {
      dispatchError = error
    }
    execution.assertLease()
    persisted = await loadPublishJob(payload, input.publishJobId)
    await reconcileDurableOutcome({
      ...(dispatchError ? { dispatchError } : {}),
      currentIdempotencyKey: claimedJob.idempotencyKey,
      expectedExecutionRevision: input.expectedExecutionRevision,
      job: persisted,
      now,
      queue,
      sourceJob: claimedJob,
    })
    execution.assertLease()
  }
