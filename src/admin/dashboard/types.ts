import type { StatusTone } from '../components/StatusBadge'

export type DashboardItemKind = 'conversation' | 'job' | 'lead'

export type DashboardUrgentItem = {
  href: string
  id: number | string
  kind: DashboardItemKind
  reference: string
  severity: StatusTone
  status: string
  updatedAt: string
}

export type OperatorDashboardSummary = {
  queues: {
    activeConversations: number
    failedJobs?: number
    handoffRequested: number
    newQualifiedLeads: number
  }
  urgentItems: DashboardUrgentItem[]
}
