export const JOB_STATUSES = ['pending', 'processing', 'succeeded', 'failed', 'dead'] as const

export type JobStatus = (typeof JOB_STATUSES)[number]

export type JobPayload = Record<string, unknown>

export type JobRecord = {
  attempts: number
  completedAt: string | null
  createdAt: string
  deadAt: string | null
  id: number
  idempotencyKey: string | null
  lastError: string | null
  leaseExpiresAt: string | null
  manualRetryCount: number
  maxAttempts: number
  nextRunAt: string | null
  ownerToken: string | null
  payload: JobPayload
  status: JobStatus
  type: string
  updatedAt: string
}

export type ClaimedJob = JobRecord & {
  leaseExpiresAt: string
  ownerToken: string
}

export type CreateJobInput = {
  idempotencyKey?: string
  maxAttempts?: number
  nextRunAt?: Date
  payload: JobPayload
  type: string
}

export type JobFailure = {
  error: Error
  job: ClaimedJob
}

export type JobRetryActor = {
  id: number | string
  role: 'admin' | 'operator' | 'sales'
}

export type JobExecution = {
  assertLease: () => void
  renewLease: () => Promise<ClaimedJob>
  signal: AbortSignal
}

export type JobHandler = (job: ClaimedJob, execution: JobExecution) => Promise<void>

export interface JobQueue {
  claimNext: () => Promise<ClaimedJob | null>
  complete: (job: ClaimedJob) => Promise<JobRecord>
  fail: (failure: JobFailure) => Promise<JobRecord>
  renew: (job: ClaimedJob) => Promise<ClaimedJob>
}

export class JobQueueError extends Error {
  readonly code: 'conflict' | 'forbidden' | 'not_found' | 'validation'

  constructor(code: JobQueueError['code'], message: string) {
    super(message)
    this.code = code
    this.name = 'JobQueueError'
  }
}

export class JobLeaseLostError extends Error {
  readonly cause?: unknown

  constructor(message: string, cause?: unknown) {
    super(message)
    this.cause = cause
    this.name = 'JobLeaseLostError'
  }
}
