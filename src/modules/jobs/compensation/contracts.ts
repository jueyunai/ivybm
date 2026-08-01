import type { JobStatus } from '../contracts'

export const JOB_COMPENSATION_ACTIONS = ['retry-knowledge-index'] as const

export type JobCompensationAction = (typeof JOB_COMPENSATION_ACTIONS)[number]

export interface SafeCompensationJob {
  status: JobStatus
  type: string
}

export interface JobCompensationDefinition {
  action: JobCompensationAction
  jobType: string
  label: string
}

const DEFINITIONS: readonly JobCompensationDefinition[] = [
  {
    action: 'retry-knowledge-index',
    jobType: 'knowledge.index',
    label: 'Retry knowledge indexing',
  },
]

const terminalForManualCompensation = (status: JobStatus): boolean =>
  status === 'failed' || status === 'dead'

/**
 * A job is never retryable just because it failed. Each action has to be
 * registered here after its owner confirms idempotency and unknown-result rules.
 */
export const getJobCompensation = (
  job: SafeCompensationJob,
): JobCompensationDefinition | null => {
  if (!terminalForManualCompensation(job.status)) return null
  return DEFINITIONS.find((definition) => definition.jobType === job.type) ?? null
}
