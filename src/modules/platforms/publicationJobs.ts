import type { Payload, PayloadRequest } from 'payload'

import { PayloadJobQueue } from '@/modules/jobs/claim'
import type { ClaimedJob, JobExecution, JobHandler } from '@/modules/jobs/contracts'
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
import type { PlatformPublicationIntent } from './publishingAuthority'
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

type PublicationJobQueue = Pick<PayloadJobQueue, 'enqueue'>

export type PublicationJobRuntime = {
  directService: PublishingService
  linkedInTransport: LinkedInPublishingTransport
  metaTransport: MetaPublishingTransport
  readLinkedInAssetBytes(input: LinkedInImageAssetIdentity): Promise<Uint8Array>
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

const isDirectRoute = (job: PublishJob): boolean =>
  job.executionRoute === 'facebook-photo-single' || job.executionRoute === 'linkedin-text-single'

const continuationNeeded = (job: PublishJob): boolean =>
  (isDirectRoute(job) && (job.status === 'accepted' || job.status === 'publishing')) ||
  ((job.executionRoute === 'instagram-image-staged' ||
    job.executionRoute === 'linkedin-image-staged') &&
    job.status === 'publishing')

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

const scheduleContinuation = async (
  job: PublishJob,
  queue: PublicationJobQueue,
  now: () => Date,
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
  await enqueuePublicationExecution({
    nextRunAt,
    publishJobId: job.id,
    queue,
    revision: job.executionRevision,
  })
}

const loadPublishJob = async (payload: Payload, id: number): Promise<PublishJob> =>
  payload.findByID({ collection: 'publish-jobs', depth: 0, id, overrideAccess: true })

const dispatchPersistedPublication = async ({
  claimedJob,
  job,
  payload,
  runtime,
}: {
  claimedJob: ClaimedJob
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
      authority: new PayloadPlatformPublicationAuthority({ payload }),
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
  const assetBytes =
    state.checkpoint.stage === 'image_initialized'
      ? await runtime.readLinkedInAssetBytes(state.asset)
      : undefined
  return dispatchPublicationWorkItem({
    ...(assetBytes ? { assetBytes } : {}),
    authority: new PayloadLinkedInImagePublishingAuthority({ payload }),
    intent,
    leaseFence: lease,
    route: selectedRoute,
    transport: runtime.linkedInTransport,
  })
}

export const createPlatformPublicationJobHandler =
  ({
    now = () => new Date(),
    payload,
    queue = new PayloadJobQueue({ payload }),
    resolveRuntime,
  }: {
    now?: () => Date
    payload: Payload
    queue?: PublicationJobQueue
    resolveRuntime: () => Promise<PublicationJobRuntime> | PublicationJobRuntime
  }): JobHandler =>
  async (claimedJob: ClaimedJob, execution: JobExecution) => {
    const input = parsePlatformPublicationJobPayload(claimedJob.payload)
    execution.assertLease()
    let persisted = await loadPublishJob(payload, input.publishJobId)
    if (persisted.executionRevision > input.expectedExecutionRevision) return
    if (persisted.executionRevision !== input.expectedExecutionRevision) {
      throw new PlatformPublicationJobError('Publication execution revision is inconsistent')
    }
    const runtime = await resolveRuntime()
    execution.assertLease()
    try {
      await dispatchPersistedPublication({ claimedJob, job: persisted, payload, runtime })
    } catch (error) {
      persisted = await loadPublishJob(payload, input.publishJobId)
      if (persisted.executionRevision > input.expectedExecutionRevision) {
        await scheduleContinuation(persisted, queue, now)
      }
      throw error
    }
    execution.assertLease()
    persisted = await loadPublishJob(payload, input.publishJobId)
    await scheduleContinuation(persisted, queue, now)
    execution.assertLease()
  }
