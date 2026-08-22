import type { JobStatus } from '../contracts'

export const JOB_COMPENSATION_ACTIONS = [
  'retry-knowledge-index',
  'retry-publication-recovery',
] as const

export type JobCompensationAction = (typeof JOB_COMPENSATION_ACTIONS)[number]

export interface SafeCompensationJob {
  idempotencyKey?: string | null
  payload?: unknown
  status: JobStatus
  type: string
}

export interface JobCompensationDefinition {
  action: JobCompensationAction
  jobType: string
  label: string
}

const PUBLICATION_RECOVERY_KEY_PATTERN = /^publication-recovery:(\d+):(\d+)$/

export const parsePublicationRecoveryIdempotencyKey = (
  key: string | null | undefined,
): { publishJobId: number; revision: number } | null => {
  if (!key || typeof key !== 'string') return null
  const match = PUBLICATION_RECOVERY_KEY_PATTERN.exec(key.trim())
  if (!match) return null
  const publishJobId = Number.parseInt(match[1]!, 10)
  const revision = Number.parseInt(match[2]!, 10)
  if (!Number.isSafeInteger(publishJobId) || publishJobId < 1) return null
  if (!Number.isSafeInteger(revision) || revision < 0) return null
  return { publishJobId, revision }
}

const DEFINITIONS: readonly JobCompensationDefinition[] = [
  {
    action: 'retry-knowledge-index',
    jobType: 'knowledge.index',
    label: 'Retry knowledge indexing',
  },
  {
    action: 'retry-publication-recovery',
    jobType: 'platform.publication.execute',
    label: 'Retry publication recovery',
  },
]

const terminalForManualCompensation = (status: JobStatus): boolean =>
  status === 'failed' || status === 'dead'

/**
 * A job is never retryable just because it failed. Each action has to be
 * registered here after its owner confirms idempotency and unknown-result rules.
 */
export const getJobCompensation = (job: SafeCompensationJob): JobCompensationDefinition | null => {
  if (!terminalForManualCompensation(job.status)) return null
  if (job.type === 'knowledge.index') {
    return DEFINITIONS.find((definition) => definition.action === 'retry-knowledge-index') ?? null
  }
  if (
    job.type === 'platform.publication.execute' &&
    parsePublicationRecoveryIdempotencyKey(job.idempotencyKey)
  ) {
    return (
      DEFINITIONS.find((definition) => definition.action === 'retry-publication-recovery') ?? null
    )
  }
  return null
}
