import type { Payload, PayloadRequest, Where } from 'payload'

import type { PortalEnvironment, PortalRole } from '@/admin-portal/core/modules/types'
import {
  getJobCompensation,
  parsePublicationRecoveryIdempotencyKey,
  type JobCompensationAction,
} from '@/modules/jobs/compensation/contracts'
import type { JobStatus } from '@/modules/jobs/contracts'
import type { Job } from '@/payload-types'

export const SAFE_JOB_STATUS_FILTERS = [
  'all',
  'pending',
  'processing',
  'succeeded',
  'failed',
  'dead',
] as const

export type SafeJobStatusFilter = (typeof SAFE_JOB_STATUS_FILTERS)[number]

export interface SafeJobQuery {
  page: number
  status: SafeJobStatusFilter
}

export interface SafeJobSummary {
  attempts: number
  compensation: null | { action: JobCompensationAction; label: string }
  id: number
  lastErrorSummary: string | null
  maxAttempts: number
  nextRunAt: string | null
  reference: string
  status: JobStatus
  type: string
  updatedAt: string
}

export interface SafeJobPageSummary {
  items: SafeJobSummary[]
  pagination: { page: number; totalDocs: number; totalPages: number }
  query: SafeJobQuery
}

export interface SafeJobPageData {
  state: 'available' | 'forbidden' | 'module-disabled' | 'portal-disabled'
  summary: SafeJobPageSummary | null
}

export class SafeJobPageReadError extends Error {
  readonly code = 'portal-operations-read-failed'

  constructor(cause?: unknown) {
    super('Unable to read the operations queue', cause === undefined ? undefined : { cause })
  }
}

const first = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value

export const parseSafeJobQuery = (
  input: Record<string, string | string[] | undefined>,
): SafeJobQuery => {
  const requestedPage = Number.parseInt(first(input.page) ?? '1', 10)
  const status = first(input.status)

  return {
    page: Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1,
    status: SAFE_JOB_STATUS_FILTERS.includes(status as SafeJobStatusFilter)
      ? (status as SafeJobStatusFilter)
      : 'all',
  }
}

const safeErrorSummary = (value: string | null | undefined): string | null =>
  value ? 'Failure recorded. Follow the registered runbook before retrying.' : null

export const toSafeJobSummary = (job: Job): SafeJobSummary => {
  const compensation = getJobCompensation({
    idempotencyKey: job.idempotencyKey,
    payload: job.payload,
    status: job.status,
    type: job.type,
  })

  return {
    attempts: job.attempts,
    compensation: compensation ? { action: compensation.action, label: compensation.label } : null,
    id: job.id,
    lastErrorSummary: safeErrorSummary(job.lastError),
    maxAttempts: job.maxAttempts,
    nextRunAt: job.nextRunAt ?? null,
    reference:
      job.type === 'knowledge.index'
        ? `Knowledge index job #${job.id}`
        : job.type === 'platform.publication.execute' &&
            parsePublicationRecoveryIdempotencyKey(job.idempotencyKey)
          ? `Publication recovery job #${job.id}`
          : `Internal job #${job.id}`,
    status: job.status,
    type: job.type,
    updatedAt: job.updatedAt,
  }
}

export const loadSafeJobPageData = async ({
  env,
  payload,
  query,
  req,
  role,
}: {
  env: PortalEnvironment
  payload: Payload
  query: SafeJobQuery
  req: PayloadRequest
  role: PortalRole
}): Promise<SafeJobPageData> => {
  if (env.ADMIN_PORTAL_ENABLED !== 'true') return { state: 'portal-disabled', summary: null }
  if (env.ADMIN_PORTAL_OPERATIONS_ENABLED !== 'true') {
    return { state: 'module-disabled', summary: null }
  }
  if (role !== 'admin') return { state: 'forbidden', summary: null }

  try {
    const where: Where = query.status === 'all' ? {} : { status: { equals: query.status } }
    const result = await payload.find({
      collection: 'jobs',
      depth: 0,
      limit: 25,
      overrideAccess: false,
      page: query.page,
      req,
      select: {
        attempts: true,
        idempotencyKey: true,
        lastError: true,
        maxAttempts: true,
        nextRunAt: true,
        payload: true,
        status: true,
        type: true,
        updatedAt: true,
      },
      sort: '-updatedAt',
      where,
    })

    return {
      state: 'available',
      summary: {
        items: result.docs.map((job) => toSafeJobSummary(job as Job)),
        pagination: {
          page: result.page ?? query.page,
          totalDocs: result.totalDocs,
          totalPages: result.totalPages,
        },
        query,
      },
    }
  } catch (error) {
    throw new SafeJobPageReadError(error)
  }
}
