import type { Payload, PayloadRequest, Where } from 'payload'

import { getRoleUser } from '@/access/roles'

const MAX_PRIORITY_ITEMS_PER_KIND = 3

export const PORTAL_OVERVIEW_QUERY_BUDGET = 7

export const PORTAL_OVERVIEW_QUEUE_FILTERS = [
  'all',
  'handoff-requested',
  'active-conversations',
  'new-qualified-leads',
  'failed-jobs',
] as const

export type PortalOverviewQueueFilter = (typeof PORTAL_OVERVIEW_QUEUE_FILTERS)[number]

export interface PortalOverviewQuery {
  queue: PortalOverviewQueueFilter
}

export type PortalOverviewPriorityKind = 'active-conversation' | 'handoff-request' | 'job' | 'lead'

export type PortalOverviewDependencyId = 'feishu-failures'

export interface PortalOverviewPriorityItem {
  id: number | string
  kind: PortalOverviewPriorityKind
  reference: string
  status: string
  updatedAt: string
}

export interface PortalOverviewSummary {
  dependencies: Array<{
    id: PortalOverviewDependencyId
    status: 'dependency-gated'
  }>
  priorityItems: PortalOverviewPriorityItem[]
  queues: {
    activeConversations: number
    failedJobs?: number
    handoffRequested: number
    newQualifiedLeads: number
  }
}

const firstValue = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value

export function parsePortalOverviewQuery(
  input: Record<string, string | string[] | undefined>,
): PortalOverviewQuery {
  const queue = firstValue(input.queue)

  return {
    queue: PORTAL_OVERVIEW_QUEUE_FILTERS.includes(queue as PortalOverviewQueueFilter)
      ? (queue as PortalOverviewQueueFilter)
      : 'all',
  }
}

const dependencies = (): PortalOverviewSummary['dependencies'] => [
  { id: 'feishu-failures', status: 'dependency-gated' },
]

const emptySummary = (): PortalOverviewSummary => ({
  dependencies: dependencies(),
  priorityItems: [],
  queues: {
    activeConversations: 0,
    handoffRequested: 0,
    newQualifiedLeads: 0,
  },
})

const toUpdatedAt = (value: string | null | undefined, fallback: string): string =>
  value || fallback

const byMostRecent = (
  left: PortalOverviewPriorityItem,
  right: PortalOverviewPriorityItem,
): number => {
  const leftTimestamp = Date.parse(left.updatedAt)
  const rightTimestamp = Date.parse(right.updatedAt)
  return (
    (Number.isNaN(rightTimestamp) ? 0 : rightTimestamp) -
    (Number.isNaN(leftTimestamp) ? 0 : leftTimestamp)
  )
}

export class PortalOverviewReadError extends Error {
  readonly code = 'portal-overview-read-failed'

  constructor(cause?: unknown) {
    super('Unable to read the Portal overview', cause === undefined ? undefined : { cause })
    this.name = 'PortalOverviewReadError'
  }
}

export async function getPortalOverview({
  payload,
  req,
}: {
  payload: Payload
  req: PayloadRequest
}): Promise<PortalOverviewSummary> {
  const user = getRoleUser(req.user)
  if (!user) return emptySummary()

  const handoffWhere: Where = { handoffStatus: { equals: 'handoff_requested' } }
  const activeWhere: Where = { handoffStatus: { equals: 'human_active' } }
  const priorityConversationWhere: Where = {
    handoffStatus: { in: ['handoff_requested', 'human_active'] },
  }
  const highIntentLeadWhere: Where = {
    and: [{ status: { in: ['new', 'qualified'] } }, { intentLevel: { equals: 'a' } }],
  }
  const failedJobWhere: Where = { status: { in: ['failed', 'dead'] } }

  try {
    const [
      handoffCount,
      activeCount,
      leadCount,
      failedJobCount,
      conversationItems,
      leadItems,
      jobItems,
    ] = await Promise.all([
      payload.count({
        collection: 'conversations',
        overrideAccess: false,
        req,
        where: handoffWhere,
      }),
      payload.count({
        collection: 'conversations',
        overrideAccess: false,
        req,
        where: activeWhere,
      }),
      payload.count({
        collection: 'leads',
        overrideAccess: false,
        req,
        where: highIntentLeadWhere,
      }),
      user.role === 'admin'
        ? payload.count({
            collection: 'jobs',
            overrideAccess: false,
            req,
            where: failedJobWhere,
          })
        : Promise.resolve(undefined),
      payload.find({
        collection: 'conversations',
        depth: 0,
        limit: MAX_PRIORITY_ITEMS_PER_KIND,
        overrideAccess: false,
        pagination: false,
        req,
        select: {
          handoffStatus: true,
          lastMessageAt: true,
          publicId: true,
          updatedAt: true,
        },
        sort: '-lastMessageAt',
        where: priorityConversationWhere,
      }),
      payload.find({
        collection: 'leads',
        depth: 0,
        limit: MAX_PRIORITY_ITEMS_PER_KIND,
        overrideAccess: false,
        pagination: false,
        req,
        select: {
          intentLevel: true,
          status: true,
          updatedAt: true,
        },
        sort: '-updatedAt',
        where: highIntentLeadWhere,
      }),
      user.role === 'admin'
        ? payload.find({
            collection: 'jobs',
            depth: 0,
            limit: MAX_PRIORITY_ITEMS_PER_KIND,
            overrideAccess: false,
            pagination: false,
            req,
            select: {
              status: true,
              type: true,
              updatedAt: true,
            },
            sort: '-updatedAt',
            where: failedJobWhere,
          })
        : Promise.resolve(undefined),
    ])

    const priorityItems: PortalOverviewPriorityItem[] = [
      ...conversationItems.docs.map((item) => ({
        id: item.id,
        kind:
          item.handoffStatus === 'handoff_requested'
            ? ('handoff-request' as const)
            : ('active-conversation' as const),
        reference: item.publicId,
        status: item.handoffStatus,
        updatedAt: toUpdatedAt(item.lastMessageAt, item.updatedAt),
      })),
      ...leadItems.docs.map((item) => ({
        id: item.id,
        kind: 'lead' as const,
        reference: `LEAD-${String(item.id).padStart(4, '0')}`,
        status: item.status,
        updatedAt: item.updatedAt,
      })),
      ...(jobItems?.docs.map((item) => ({
        id: item.id,
        kind: 'job' as const,
        reference: item.type,
        status: item.status,
        updatedAt: item.updatedAt,
      })) ?? []),
    ].sort(byMostRecent)

    return {
      dependencies: dependencies(),
      priorityItems,
      queues: {
        activeConversations: activeCount.totalDocs,
        ...(failedJobCount === undefined ? {} : { failedJobs: failedJobCount.totalDocs }),
        handoffRequested: handoffCount.totalDocs,
        newQualifiedLeads: leadCount.totalDocs,
      },
    }
  } catch (error) {
    throw new PortalOverviewReadError(error)
  }
}
