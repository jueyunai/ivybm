'use client'

import {
  IconAlertTriangle,
  IconHeadset,
  IconMessageCircle,
  IconShieldCheck,
  IconUserCheck,
  type Icon as TablerIcon,
} from '@tabler/icons-react'

import type { PortalUser } from '@/admin-portal/core/auth/types'
import { getPortalMessages } from '@/admin-portal/core/i18n/getPortalMessages'
import { usePortalPreferences } from '@/admin-portal/core/navigation/PortalPreferences'
import { PortalState, StatusBadge, Surface } from '@/admin-portal/core/ui'

import type {
  PortalOverviewPriorityItem,
  PortalOverviewPriorityKind,
  PortalOverviewSummary,
} from './getPortalOverview'

export interface OverviewPageProps {
  readError?: boolean
  summary: PortalOverviewSummary | null
  user: PortalUser
}

const priorityTone: Record<
  PortalOverviewPriorityKind,
  'danger' | 'info' | 'warning'
> = {
  'active-conversation': 'info',
  'handoff-request': 'warning',
  job: 'danger',
  lead: 'info',
}

const formatTimestamp = (value: string, locale: 'en' | 'zh'): string => {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value

  return new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

function PriorityItem({
  item,
  locale,
}: {
  item: PortalOverviewPriorityItem
  locale: 'en' | 'zh'
}) {
  const messages = getPortalMessages(locale).overview
  const kind = messages.priorityKinds[item.kind]
  const status =
    item.status in messages.statuses
      ? messages.statuses[item.status as keyof typeof messages.statuses]
      : item.status

  return (
    <li className="portal-overview__priority-item">
      <StatusBadge label={kind.label} tone={priorityTone[item.kind]} />
      <div className="portal-overview__priority-copy">
        <strong>{item.reference}</strong>
        <span>{kind.description}</span>
      </div>
      <div className="portal-overview__priority-meta">
        <strong>{status}</strong>
        <time dateTime={item.updatedAt}>
          {messages.updatedAt} {formatTimestamp(item.updatedAt, locale)}
        </time>
      </div>
    </li>
  )
}

export function OverviewPage({ readError = false, summary, user }: OverviewPageProps) {
  const { locale } = usePortalPreferences()
  const messages = getPortalMessages(locale).overview

  const queueCards: Array<{
    count: number
    description: string
    icon: TablerIcon
    id: string
    label: string
    tone: 'accent' | 'danger' | 'warning'
  }> = summary
    ? [
        {
          count: summary.queues.handoffRequested,
          description: messages.queue.handoffRequested.description,
          icon: IconMessageCircle,
          id: 'handoff-requested',
          label: messages.queue.handoffRequested.label,
          tone: 'danger',
        },
        {
          count: summary.queues.activeConversations,
          description: messages.queue.activeConversations.description,
          icon: IconHeadset,
          id: 'active-conversations',
          label: messages.queue.activeConversations.label,
          tone: 'warning',
        },
        {
          count: summary.queues.newQualifiedLeads,
          description: messages.queue.newQualifiedLeads.description,
          icon: IconUserCheck,
          id: 'new-qualified-leads',
          label: messages.queue.newQualifiedLeads.label,
          tone: 'accent',
        },
        ...(summary.queues.failedJobs === undefined
          ? []
          : [
              {
                count: summary.queues.failedJobs,
                description: messages.queue.failedJobs.description,
                icon: IconAlertTriangle,
                id: 'failed-jobs',
                label: messages.queue.failedJobs.label,
                tone: 'danger' as const,
              },
            ]),
      ]
    : []

  return (
    <main className="portal-page portal-overview">
      <header className="portal-page__intro portal-overview__intro">
        <div>
          <p className="portal-page__eyebrow">{messages.eyebrow}</p>
          <h2>{messages.title}</h2>
          <p>{messages.description}</p>
        </div>
        <StatusBadge label={messages.scopeBadge} tone="success" />
      </header>

      {readError || !summary ? (
        <PortalState
          className="portal-overview__read-error"
          description={messages.readErrorDescription}
          title={messages.readErrorTitle}
          type="error"
        />
      ) : (
        <>
          <section aria-label={messages.title} className="portal-overview__queues">
            {queueCards.map(({ count, description, icon: Icon, id, label, tone }) => (
              <article
                className={`portal-overview__queue-card portal-overview__queue-card--${tone}`}
                key={id}
              >
                <div className="portal-overview__queue-heading">
                  <h3>{label}</h3>
                  <Icon aria-hidden="true" size={18} stroke={1.8} />
                </div>
                <strong className="portal-overview__queue-value">{count}</strong>
                <p>{description}</p>
              </article>
            ))}
          </section>

          <div className="portal-overview__work-grid">
            <Surface as="section" className="portal-overview__priority">
              <div className="portal-overview__section-heading">
                <div>
                  <h3>{messages.priorityTitle}</h3>
                  <p>{messages.priorityDescription}</p>
                </div>
              </div>

              {summary.priorityItems.length === 0 ? (
                <PortalState
                  className="portal-overview__empty-state"
                  description={messages.emptyDescription}
                  title={messages.emptyTitle}
                  type="empty"
                />
              ) : (
                <ul className="portal-overview__priority-list">
                  {summary.priorityItems.map((item) => (
                    <PriorityItem item={item} key={`${item.kind}-${item.id}`} locale={locale} />
                  ))}
                </ul>
              )}
            </Surface>

            <div className="portal-overview__aside-stack">
              <Surface as="aside" className="portal-overview__dependencies">
                <div className="portal-overview__section-heading">
                  <div>
                    <h3>{messages.dependencyTitle}</h3>
                    <p>{messages.dependencyDescription}</p>
                  </div>
                  <StatusBadge label={messages.dependencyStatus} tone="warning" />
                </div>
                <ul>
                  {summary.dependencies.map((dependency) => {
                    const copy = messages.dependencyItems[dependency.id]
                    return (
                      <li key={dependency.id}>
                        <strong>{copy.label}</strong>
                        <span>{copy.description}</span>
                      </li>
                    )
                  })}
                </ul>
              </Surface>

              <Surface as="aside" className="portal-overview__role-notice" variant="subtle">
                <IconShieldCheck aria-hidden="true" size={22} stroke={1.8} />
                <h3>{messages.roleNoticeTitle}</h3>
                <p>{messages.roleNotice[user.role]}</p>
              </Surface>
            </div>
          </div>
        </>
      )}
    </main>
  )
}
