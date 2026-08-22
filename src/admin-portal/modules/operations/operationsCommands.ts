import type { Payload, PayloadRequest } from 'payload'

import {
  getJobCompensation,
  parsePublicationRecoveryIdempotencyKey,
} from '@/modules/jobs/compensation/contracts'
import { PayloadJobQueue } from '@/modules/jobs/claim'
import { enqueueKnowledgeIndexJob, parseKnowledgeIndexJobPayload } from '@/modules/knowledge/jobs'
import { parsePlatformPublicationJobPayload } from '@/modules/platforms/publicationJobs'
import type { User } from '@/payload-types'

export class OperationsCommandError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'OperationsCommandError'
  }
}

const expectedRevision = (value: unknown): string => {
  if (typeof value !== 'string' || !value.trim()) {
    throw new OperationsCommandError('operations-stale', 'Reload the job before retrying.', 409)
  }
  return value
}

export const retryPortalJob = async ({
  enqueueKnowledgeIndex = enqueueKnowledgeIndexJob,
  id,
  input,
  payload,
  queue = new PayloadJobQueue({ payload }),
  req,
  user,
}: {
  enqueueKnowledgeIndex?: typeof enqueueKnowledgeIndexJob
  id: number
  input: Record<string, unknown>
  payload: Payload
  queue?: Pick<PayloadJobQueue, 'retryManually'>
  req: PayloadRequest
  user: User
}) => {
  if (user.role !== 'admin') {
    throw new OperationsCommandError('operations-forbidden', 'Administrator access required.', 403)
  }

  const job = await payload.findByID({
    collection: 'jobs',
    depth: 0,
    id,
    overrideAccess: false,
    req,
  })
  if (!job) throw new OperationsCommandError('operations-job-not-found', 'Job was not found.', 404)
  if (job.updatedAt !== expectedRevision(input.updatedAt)) {
    throw new OperationsCommandError(
      'operations-stale',
      'The job changed. Refresh before retrying.',
      409,
    )
  }

  const compensation = getJobCompensation({
    idempotencyKey: job.idempotencyKey,
    payload: job.payload,
    status: job.status,
    type: job.type,
  })
  if (!compensation) {
    throw new OperationsCommandError(
      'operations-compensation-unavailable',
      'This job has no registered safe retry action.',
      409,
    )
  }

  if (compensation.action === 'retry-knowledge-index') {
    let documentId: number
    try {
      if (!job.payload || typeof job.payload !== 'object' || Array.isArray(job.payload)) {
        throw new Error('invalid payload')
      }
      documentId = parseKnowledgeIndexJobPayload(job.payload as Record<string, unknown>).documentId
    } catch {
      throw new OperationsCommandError(
        'operations-invalid-job-payload',
        'The knowledge index job cannot be safely retried.',
        409,
      )
    }
    const result = await enqueueKnowledgeIndex({
      documentId,
      manualRetryActor: { id: user.id, role: user.role },
      payload,
      requestedBy: typeof user.id === 'number' ? user.id : null,
    })
    return { action: compensation.action, jobId: result.job.id, status: result.job.status }
  }

  if (compensation.action === 'retry-publication-recovery') {
    const keyInfo = parsePublicationRecoveryIdempotencyKey(job.idempotencyKey)
    if (!keyInfo) {
      throw new OperationsCommandError(
        'operations-invalid-job-payload',
        'The publication recovery job cannot be safely retried.',
        409,
      )
    }
    let parsedPayload: ReturnType<typeof parsePlatformPublicationJobPayload>
    try {
      if (!job.payload || typeof job.payload !== 'object' || Array.isArray(job.payload)) {
        throw new Error('invalid payload')
      }
      parsedPayload = parsePlatformPublicationJobPayload(job.payload as Record<string, unknown>)
    } catch {
      throw new OperationsCommandError(
        'operations-invalid-job-payload',
        'The publication recovery payload is invalid.',
        409,
      )
    }

    if (
      parsedPayload.publishJobId !== keyInfo.publishJobId ||
      parsedPayload.expectedExecutionRevision !== keyInfo.revision
    ) {
      throw new OperationsCommandError(
        'operations-invalid-job-payload',
        'The publication recovery payload does not match its idempotency key.',
        409,
      )
    }

    const publishJob = await payload.findByID({
      collection: 'publish-jobs',
      depth: 0,
      id: keyInfo.publishJobId,
      overrideAccess: true,
      req,
    })
    if (!publishJob) {
      throw new OperationsCommandError(
        'operations-invalid-job-payload',
        'The associated publication job was not found.',
        404,
      )
    }

    if (publishJob.executionRevision !== keyInfo.revision || !publishJob.providerIOStartedAt) {
      throw new OperationsCommandError(
        'operations-invalid-job-payload',
        'The publication job state does not match the recovery requirement.',
        409,
      )
    }

    const retried = await queue.retryManually(job.id, { id: user.id, role: user.role }, req)
    return { action: compensation.action, jobId: retried.id, status: retried.status }
  }

  const exhaustive: never = compensation.action
  throw new OperationsCommandError('operations-compensation-unavailable', exhaustive, 409)
}
