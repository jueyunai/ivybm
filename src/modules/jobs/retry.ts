import type { JobRecord, JobStatus } from './contracts'

export const MAX_JOB_ATTEMPTS = 5
export const DEFAULT_RETRY_BASE_DELAY_MS = 1_000
export const DEFAULT_RETRY_MAX_DELAY_MS = 60_000

export type RetryOptions = {
  baseDelayMs?: number
  maxDelayMs?: number
}

export type FailureTransition = {
  deadAt: Date | null
  nextRunAt: Date | null
  status: Extract<JobStatus, 'dead' | 'failed'>
}

export const retryDelayMs = (
  attempts: number,
  {
    baseDelayMs = DEFAULT_RETRY_BASE_DELAY_MS,
    maxDelayMs = DEFAULT_RETRY_MAX_DELAY_MS,
  }: RetryOptions = {},
): number => {
  if (!Number.isInteger(attempts) || attempts < 1) {
    throw new RangeError('attempts must be a positive integer')
  }

  return Math.min(baseDelayMs * 2 ** (attempts - 1), maxDelayMs)
}

export const validateMaxAttempts = (maxAttempts: number): number => {
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > MAX_JOB_ATTEMPTS) {
    throw new RangeError(`maxAttempts must be an integer between 1 and ${MAX_JOB_ATTEMPTS}`)
  }

  return maxAttempts
}

export const transitionAfterFailure = ({
  attempts,
  maxAttempts,
  now,
  retryOptions,
}: {
  attempts: number
  maxAttempts: number
  now: Date
  retryOptions?: RetryOptions
}): FailureTransition => {
  validateMaxAttempts(maxAttempts)

  if (attempts >= maxAttempts) {
    return {
      deadAt: now,
      nextRunAt: null,
      status: 'dead',
    }
  }

  return {
    deadAt: null,
    nextRunAt: new Date(now.getTime() + retryDelayMs(attempts, retryOptions)),
    status: 'failed',
  }
}

export const canRetryManually = (status: JobStatus): boolean =>
  status === 'failed' || status === 'dead'

export const manualRetryState = (
  job: Pick<JobRecord, 'manualRetryCount' | 'status'>,
  now: Date,
) => {
  if (!canRetryManually(job.status)) {
    throw new RangeError(`Cannot manually retry a ${job.status} job`)
  }

  return {
    attempts: 0,
    completedAt: null,
    deadAt: null,
    lastError: null,
    leaseExpiresAt: null,
    manualRetryCount: job.manualRetryCount + 1,
    nextRunAt: now,
    ownerToken: null,
    status: 'pending' as const,
  }
}
