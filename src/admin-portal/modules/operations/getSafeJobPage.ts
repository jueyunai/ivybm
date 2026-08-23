import type { Payload, PayloadRequest, Where } from 'payload'

import type { PortalEnvironment, PortalRole } from '@/admin-portal/core/modules/types'
import {
  getJobCompensation,
  parsePublicationRecoveryIdempotencyKey,
  parsePublicationStatusRecoveryIdempotencyKey,
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

export const formatJobTypeLabel = (type: string, locale: 'en' | 'zh' = 'zh'): string => {
  const labels = {
    en: {
      'feishu.connection.provision': 'Feishu Connection Setup',
      'feishu.handoff.notify': 'Feishu Handoff Notice',
      'feishu.lead.followup.reminder': 'Feishu Follow-up Reminder',
      'feishu.lead.sync': 'Feishu Lead Sync',
      'feishu.lead.sync.failure.notify': 'Feishu Sync Failure Notice',
      'knowledge.index': 'Knowledge Vector Indexing',
      'knowledge.ingest': 'Knowledge Document Ingestion',
      'platform.conversation.deliver': 'Social Message Delivery',
      'platform.event.dispatch': 'Social Event Dispatch',
      'platform.publication.execute': 'Social Content Publishing',
    },
    zh: {
      'feishu.connection.provision': '飞书连接配置',
      'feishu.handoff.notify': '飞书接管提醒通知',
      'feishu.lead.followup.reminder': '飞书线索跟进提醒',
      'feishu.lead.sync': '飞书线索同步',
      'feishu.lead.sync.failure.notify': '飞书同步失败提醒',
      'knowledge.index': '知识库向量索引',
      'knowledge.ingest': '知识库文档解析',
      'platform.conversation.deliver': '社媒消息发送',
      'platform.event.dispatch': '社媒事件分发',
      'platform.publication.execute': '社媒内容发布',
    },
  } as const
  return labels[locale][type.toLowerCase() as keyof (typeof labels)[typeof locale]] ??
    (locale === 'zh' ? '后台任务' : 'Background task')
}

const safeErrorSummary = (
  job: Pick<Job, 'attempts' | 'lastError' | 'maxAttempts' | 'status'>,
): string | null => {
  if (typeof job.lastError !== 'string' || !job.lastError.trim()) return null
  if (
    !Number.isSafeInteger(job.attempts) ||
    !Number.isSafeInteger(job.maxAttempts) ||
    job.attempts < 0 ||
    job.maxAttempts < 1
  ) {
    return null
  }
  if (job.status === 'failed' && job.attempts < job.maxAttempts) {
    return 'Task failed; automatic retry is scheduled.'
  }
  if (job.status === 'dead' && job.attempts >= job.maxAttempts) {
    return 'Task failed; automatic retries stopped. Check configuration before retrying manually.'
  }
  return null
}

export const toSafeJobSummary = (job: Job): SafeJobSummary => {
  const compensation = getJobCompensation({
    idempotencyKey: job.idempotencyKey,
    status: job.status,
    type: job.type,
  })

  return {
    attempts: job.attempts,
    compensation: compensation ? { action: compensation.action, label: compensation.label } : null,
    id: job.id,
    lastErrorSummary: safeErrorSummary(job),
    maxAttempts: job.maxAttempts,
    nextRunAt: job.nextRunAt ?? null,
    reference:
      job.type === 'knowledge.index'
        ? `Knowledge index job #${job.id}`
        : job.type === 'platform.publication.execute' &&
            parsePublicationRecoveryIdempotencyKey(job.idempotencyKey)
          ? `Publication recovery job #${job.id}`
          : job.type === 'platform.publication.execute' &&
              parsePublicationStatusRecoveryIdempotencyKey(job.idempotencyKey)
            ? `Publication status recovery job #${job.id}`
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
