import Link from 'next/link'

import type { DashboardViewServerProps } from '@payloadcms/next/views'
import { Gutter } from '@payloadcms/ui'

import { getRoleUser } from '@/access/roles'

import { StatusBadge, type StatusTone } from '../components/StatusBadge'
import { DashboardQueueCard } from '../dashboard/DashboardQueueCard'
import { getDashboardSummary } from '../dashboard/getDashboardSummary'
import type { DashboardUrgentItem } from '../dashboard/types'
import { getAdminCopy } from '../i18n'

const queueLinks = {
  activeConversations:
    '/admin/collections/conversations?where%5BhandoffStatus%5D%5Bequals%5D=human_active',
  failedJobs:
    '/admin/collections/jobs?where%5Bstatus%5D%5Bin%5D%5B0%5D=failed&where%5Bstatus%5D%5Bin%5D%5B1%5D=dead',
  handoffRequested:
    '/admin/collections/conversations?where%5BhandoffStatus%5D%5Bequals%5D=handoff_requested',
  newQualifiedLeads:
    '/admin/collections/leads?where%5Band%5D%5B0%5D%5Bstatus%5D%5Bin%5D%5B0%5D=new&where%5Band%5D%5B0%5D%5Bstatus%5D%5Bin%5D%5B1%5D=qualified&where%5Band%5D%5B1%5D%5BintentLevel%5D%5Bequals%5D=a',
}

const getRoleLabel = (
  role: 'admin' | 'operator' | 'sales',
  copy: ReturnType<typeof getAdminCopy>,
) => {
  if (role === 'admin') return copy.roleAdmin
  if (role === 'operator') return copy.roleOperator
  return copy.roleSales
}

const getUrgentItemLabel = (item: DashboardUrgentItem, copy: ReturnType<typeof getAdminCopy>) => {
  if (item.kind === 'conversation') return copy.urgentConversation(item.reference)
  if (item.kind === 'lead') return copy.urgentLead(item.reference)
  return copy.urgentJob(item.reference)
}

const getUrgentStatusLabel = (item: DashboardUrgentItem, copy: ReturnType<typeof getAdminCopy>) => {
  if (item.kind === 'conversation') return copy.status.handoffRequested
  if (item.kind === 'lead') return copy.status.highIntent
  return copy.status.failed
}

const formatUpdatedAt = (value: string, language: string | undefined) =>
  new Intl.DateTimeFormat(language === 'en' ? 'en-US' : 'zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))

export default async function OperationsDashboard({ initPageResult }: DashboardViewServerProps) {
  const { req } = initPageResult
  const copy = getAdminCopy(req.i18n.language)
  const user = getRoleUser(req.user)

  if (!user) {
    return (
      <Gutter className="ops-dashboard">
        <section className="ops-dashboard__access-denied" role="alert">
          <h1>{copy.dashboardTitle}</h1>
          <p>{copy.dashboardDescription}</p>
        </section>
      </Gutter>
    )
  }

  const summary = await getDashboardSummary({ payload: req.payload, req })
  const queueCards: Array<{
    count: number
    description: string
    href: string
    key: string
    label: string
    tone: StatusTone
  }> = [
    {
      count: summary.queues.handoffRequested,
      description: copy.workspaceDescription,
      href: queueLinks.handoffRequested,
      key: 'handoffRequested',
      label: copy.handoffRequested,
      tone: 'warning',
    },
    {
      count: summary.queues.activeConversations,
      description: copy.workspaceDescription,
      href: queueLinks.activeConversations,
      key: 'activeConversations',
      label: copy.activeConversations,
      tone: 'info',
    },
    {
      count: summary.queues.newQualifiedLeads,
      description: copy.workspaceDescription,
      href: queueLinks.newQualifiedLeads,
      key: 'newQualifiedLeads',
      label: copy.newQualifiedLeads,
      tone: 'success',
    },
    ...(summary.queues.failedJobs === undefined
      ? []
      : [
          {
            count: summary.queues.failedJobs,
            description: copy.workspaceDescription,
            href: queueLinks.failedJobs,
            key: 'failedJobs',
            label: copy.failedJobs,
            tone: 'danger' as const,
          },
        ]),
  ]

  return (
    <Gutter>
      <div className="ops-dashboard" data-testid="operations-dashboard">
        <header className="ops-dashboard__header">
          <div>
            <p className="ops-dashboard__eyebrow">{getRoleLabel(user.role, copy)}</p>
            <h1>{copy.dashboardTitle}</h1>
            <p>{copy.dashboardDescription}</p>
          </div>
        </header>

        <section aria-labelledby="ops-queues-heading" className="ops-dashboard__section">
          <div className="ops-dashboard__section-heading">
            <h2 id="ops-queues-heading">{copy.queuesHeading}</h2>
          </div>
          <div className="ops-queue-grid">
            {queueCards.map((card) => (
              <DashboardQueueCard {...card} key={card.key} openLabel={copy.openQueue} />
            ))}
          </div>
        </section>

        <section aria-labelledby="ops-urgent-heading" className="ops-dashboard__section">
          <div className="ops-dashboard__section-heading">
            <h2 id="ops-urgent-heading">{copy.urgentHeading}</h2>
          </div>
          {summary.urgentItems.length === 0 ? (
            <p className="ops-dashboard__empty">{copy.emptyUrgentItems}</p>
          ) : (
            <ul className="ops-urgent-list">
              {summary.urgentItems.map((item) => (
                <li className="ops-urgent-list__item" key={`${item.kind}-${item.id}`}>
                  <StatusBadge label={getUrgentStatusLabel(item, copy)} tone={item.severity} />
                  <div className="ops-urgent-list__body">
                    <Link href={item.href} prefetch>
                      {getUrgentItemLabel(item, copy)}
                    </Link>
                    <time dateTime={item.updatedAt}>
                      {copy.updatedAt} {formatUpdatedAt(item.updatedAt, req.i18n.language)}
                    </time>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </Gutter>
  )
}
