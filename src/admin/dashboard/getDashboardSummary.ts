import type { Payload, PayloadRequest, Where } from 'payload'

import { getRoleUser } from '@/access/roles'
import { HIGH_INTENT_LEAD_WHERE } from '@/modules/leads/highIntent'

import type { DashboardUrgentItem, OperatorDashboardSummary } from './types'

const MAX_URGENT_ITEMS_PER_KIND = 3

export const DASHBOARD_QUERY_BUDGET = 7

const emptySummary = (): OperatorDashboardSummary => ({
  queues: {
    activeConversations: 0,
    handoffRequested: 0,
    newQualifiedLeads: 0,
  },
  urgentItems: [],
})

const toUpdatedAt = (value: string | null | undefined, fallback: string): string =>
  value || fallback

const byMostRecent = (left: DashboardUrgentItem, right: DashboardUrgentItem): number =>
  Date.parse(right.updatedAt) - Date.parse(left.updatedAt)

export const getDashboardSummary = async ({
  payload,
  req,
}: {
  payload: Payload
  req: PayloadRequest
}): Promise<OperatorDashboardSummary> => {
  const user = getRoleUser(req.user)
  if (!user) return emptySummary()

  const handoffWhere: Where = { handoffStatus: { equals: 'handoff_requested' } }
  const activeWhere: Where = { handoffStatus: { equals: 'human_active' } }
  const failedJobWhere: Where = { status: { in: ['failed', 'dead'] } }

  const [handoffCount, activeCount, leadCount, failedJobCount, handoffItems, leadItems, jobItems] =
    await Promise.all([
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
        where: HIGH_INTENT_LEAD_WHERE,
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
        limit: MAX_URGENT_ITEMS_PER_KIND,
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
        where: handoffWhere,
      }),
      payload.find({
        collection: 'leads',
        depth: 0,
        limit: MAX_URGENT_ITEMS_PER_KIND,
        overrideAccess: false,
        pagination: false,
        req,
        select: {
          intentLevel: true,
          status: true,
          updatedAt: true,
        },
        sort: '-updatedAt',
        where: HIGH_INTENT_LEAD_WHERE,
      }),
      user.role === 'admin'
        ? payload.find({
            collection: 'jobs',
            depth: 0,
            limit: MAX_URGENT_ITEMS_PER_KIND,
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

  const urgentItems: DashboardUrgentItem[] = [
    ...handoffItems.docs.map((item) => ({
      href: `/admin/collections/conversations/${item.id}`,
      id: item.id,
      kind: 'conversation' as const,
      reference: item.publicId,
      severity: 'warning' as const,
      status: item.handoffStatus,
      updatedAt: toUpdatedAt(item.lastMessageAt, item.updatedAt),
    })),
    ...leadItems.docs.map((item) => ({
      href: `/admin/collections/leads/${item.id}`,
      id: item.id,
      kind: 'lead' as const,
      reference: String(item.id),
      severity: 'warning' as const,
      status: item.intentLevel,
      updatedAt: item.updatedAt,
    })),
    ...(jobItems?.docs.map((item) => ({
      href: `/admin/collections/jobs/${item.id}`,
      id: item.id,
      kind: 'job' as const,
      reference: item.type,
      severity: 'danger' as const,
      status: item.status,
      updatedAt: item.updatedAt,
    })) ?? []),
  ].sort(byMostRecent)

  return {
    queues: {
      activeConversations: activeCount.totalDocs,
      ...(failedJobCount ? { failedJobs: failedJobCount.totalDocs } : {}),
      handoffRequested: handoffCount.totalDocs,
      newQualifiedLeads: leadCount.totalDocs,
    },
    urgentItems,
  }
}
