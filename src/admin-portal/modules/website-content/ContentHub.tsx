'use client'

import { useState } from 'react'

import Link from 'next/link'
import {
  IconArrowLeft,
  IconArrowRight,
  IconExternalLink,
  IconFileText,
  IconLanguage,
  IconSearch,
} from '@tabler/icons-react'

import { getPortalMessages } from '@/admin-portal/core/i18n/getPortalMessages'
import { usePortalPreferences } from '@/admin-portal/core/navigation/PortalPreferences'
import { Button, PortalState, StatusBadge, Surface } from '@/admin-portal/core/ui'

import type {
  ContentItemStatus,
  ContentQuery,
  ContentStatusFilter,
  ContentSummary,
  ContentSummaryItem,
  ContentTypeId,
  WebsiteContentPageState,
} from './getContentSummary'

export interface ContentHubProps {
  pageState: WebsiteContentPageState | 'read-failed'
  summary: ContentSummary | null
}

const statusTone: Record<ContentItemStatus, 'info' | 'neutral' | 'success' | 'warning'> = {
  active: 'success',
  'always-visible': 'info',
  draft: 'warning',
  inactive: 'neutral',
  published: 'success',
}

const buildContentHref = (query: Partial<ContentQuery> & Pick<ContentQuery, 'type'>): string => {
  const params = new URLSearchParams()
  params.set('type', query.type)
  if (query.status && query.status !== 'all') params.set('status', query.status)
  if (query.q) params.set('q', query.q)
  if (query.page && query.page > 1) params.set('page', String(query.page))
  return `/dashboard/content?${params.toString()}`
}

const formatTimestamp = (value: null | string, locale: 'en' | 'zh'): string => {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

function CompletenessBar({ label, value }: { label: string; value: number }) {
  return (
    <div className="portal-content__completeness-row">
      <span>{label}</span>
      <progress aria-label={`${label} ${value}%`} max={100} value={value} />
      <strong>{value}%</strong>
    </div>
  )
}

function ItemButton({
  active,
  item,
  locale,
  onSelect,
}: {
  active: boolean
  item: ContentSummaryItem
  locale: 'en' | 'zh'
  onSelect: () => void
}) {
  const messages = getPortalMessages(locale).websiteContent

  return (
    <button
      aria-pressed={active}
      className={`portal-content__item${active ? ' is-active' : ''}`}
      onClick={onSelect}
      type="button"
    >
      <span className="portal-content__item-heading">
        <strong>{item.title}</strong>
        <StatusBadge label={messages.statuses[item.status]} tone={statusTone[item.status]} />
      </span>
      <span className="portal-content__item-slug">/{item.slug}</span>
      <span className="portal-content__item-meta">
        <span>EN {item.localeCompleteness.en}%</span>
        <span>AR {item.localeCompleteness.ar}%</span>
        <time dateTime={item.updatedAt}>{formatTimestamp(item.updatedAt, locale)}</time>
      </span>
    </button>
  )
}

const statusOptionsFor = (type: ContentTypeId): ContentStatusFilter[] => {
  if (['pages', 'posts', 'products', 'projects'].includes(type)) {
    return ['all', 'draft', 'published']
  }
  if (type === 'downloads') return ['all', 'active', 'inactive']
  return ['all']
}

export function ContentHub({ pageState, summary }: ContentHubProps) {
  const { locale } = usePortalPreferences()
  const messages = getPortalMessages(locale).websiteContent
  const [selectedId, setSelectedId] = useState<number | string | null>(null)

  if (pageState === 'forbidden') {
    return (
      <main className="portal-page portal-content">
        <PortalState
          description={messages.forbiddenDescription}
          title={messages.forbiddenTitle}
          type="forbidden"
        />
      </main>
    )
  }

  if (pageState === 'module-disabled' || pageState === 'portal-disabled') {
    return (
      <main className="portal-page portal-content">
        <PortalState
          description={messages.moduleDisabledDescription}
          title={messages.moduleDisabledTitle}
          type="blocked"
        />
      </main>
    )
  }

  if (pageState === 'read-failed' || !summary) {
    return (
      <main className="portal-page portal-content">
        <PortalState
          description={messages.readErrorDescription}
          title={messages.readErrorTitle}
          type="error"
        />
      </main>
    )
  }

  const selected =
    summary.items.find((item) => String(item.id) === String(selectedId)) ?? summary.items[0] ?? null
  const statusOptions = statusOptionsFor(summary.query.type)
  const statusLabel: Record<ContentStatusFilter, string> = {
    active: messages.statuses.active,
    all: messages.allStatuses,
    draft: messages.statuses.draft,
    inactive: messages.statuses.inactive,
    published: messages.statuses.published,
  }

  return (
    <main className="portal-page portal-content">
      <header className="portal-page__intro portal-content__intro">
        <div>
          <p className="portal-page__eyebrow">{messages.eyebrow}</p>
          <h2>{messages.title}</h2>
          <p>{messages.description}</p>
        </div>
        <StatusBadge label={messages.editorStatus} tone="warning" />
      </header>

      <nav aria-label={messages.title} className="portal-content__types">
        {summary.collections.map((collection) => (
          <Link
            aria-current={collection.id === summary.query.type ? 'page' : undefined}
            className={collection.id === summary.query.type ? 'is-active' : undefined}
            href={buildContentHref({ type: collection.id })}
            key={collection.id}
          >
            <span>{messages.collections[collection.id]}</span>
            <strong>{collection.total}</strong>
            <small>{formatTimestamp(collection.updatedAt, locale)}</small>
          </Link>
        ))}
      </nav>

      <Surface as="section" className="portal-content__filters">
        <form
          action="/dashboard/content"
          className="portal-content__filter-form"
          key={`${summary.query.type}:${summary.query.status}:${summary.query.q}`}
          method="get"
        >
          <input name="type" type="hidden" value={summary.query.type} />
          <label className="portal-content__search">
            <span className="portal-field__label">{messages.searchLabel}</span>
            <span className="portal-field__control">
              <IconSearch aria-hidden="true" size={16} stroke={1.8} />
              <input
                defaultValue={summary.query.q}
                maxLength={80}
                name="q"
                placeholder={messages.searchPlaceholder}
                type="search"
              />
            </span>
          </label>
          <label className="portal-content__status-filter">
            <span className="portal-field__label">{messages.filterLabel}</span>
            <select defaultValue={summary.query.status} name="status">
              {statusOptions.map((status) => (
                <option key={status} value={status}>
                  {statusLabel[status]}
                </option>
              ))}
            </select>
          </label>
          <Button className="portal-content__submit" type="submit">
            <IconSearch aria-hidden="true" size={16} stroke={1.8} />
            {messages.searchSubmit}
          </Button>
          <Button asChild variant="ghost">
            <Link href={buildContentHref({ type: summary.query.type })}>
              {messages.resetFilters}
            </Link>
          </Button>
        </form>
      </Surface>

      <div className={`portal-content__workspace${summary.items.length === 0 ? ' is-empty' : ''}`}>
        <Surface as="section" className="portal-content__list-panel">
          <header className="portal-content__panel-heading">
            <div>
              <h3>{messages.collections[summary.query.type]}</h3>
              <p>
                {messages.total} {summary.pagination.totalDocs} {messages.itemCount}
              </p>
            </div>
            {summary.statusBreakdown ? (
              <div className="portal-content__breakdown">
                {Object.entries(summary.statusBreakdown).map(([status, count]) => (
                  <span key={status}>
                    {statusLabel[status as ContentStatusFilter]} <strong>{count}</strong>
                  </span>
                ))}
              </div>
            ) : null}
          </header>

          {summary.items.length === 0 ? (
            <PortalState
              className="portal-content__empty"
              description={messages.emptyDescription}
              title={messages.emptyTitle}
              type="empty"
            />
          ) : (
            <ol className="portal-content__items">
              {summary.items.map((item) => (
                <li key={item.id}>
                  <ItemButton
                    active={String(item.id) === String(selected?.id)}
                    item={item}
                    locale={locale}
                    onSelect={() => setSelectedId(item.id)}
                  />
                </li>
              ))}
            </ol>
          )}

          {summary.pagination.totalPages > 1 ? (
            <nav aria-label={`${messages.title} pagination`} className="portal-content__pagination">
              {summary.pagination.page > 1 ? (
                <Button asChild size="compact" variant="secondary">
                  <Link
                    href={buildContentHref({
                      ...summary.query,
                      page: summary.pagination.page - 1,
                    })}
                  >
                    <IconArrowLeft aria-hidden="true" size={15} stroke={1.8} />
                    {messages.previousPage}
                  </Link>
                </Button>
              ) : (
                <span />
              )}
              <span>
                {summary.pagination.page} / {summary.pagination.totalPages}
              </span>
              {summary.pagination.page < summary.pagination.totalPages ? (
                <Button asChild size="compact" variant="secondary">
                  <Link
                    href={buildContentHref({
                      ...summary.query,
                      page: summary.pagination.page + 1,
                    })}
                  >
                    {messages.nextPage}
                    <IconArrowRight aria-hidden="true" size={15} stroke={1.8} />
                  </Link>
                </Button>
              ) : (
                <span />
              )}
            </nav>
          ) : null}
        </Surface>

        {selected ? (
          <Surface as="aside" className="portal-content__detail-panel">
            <>
              <header className="portal-content__detail-heading">
                <span aria-hidden="true" className="portal-content__detail-icon">
                  <IconFileText size={20} stroke={1.8} />
                </span>
                <div>
                  <p>{messages.selectedItem}</p>
                  <h3>{selected.title}</h3>
                </div>
                <StatusBadge
                  label={messages.statuses[selected.status]}
                  tone={statusTone[selected.status]}
                />
              </header>

              <dl className="portal-content__detail-meta">
                <div>
                  <dt>{messages.slug}</dt>
                  <dd>/{selected.slug}</dd>
                </div>
                <div>
                  <dt>{messages.lastUpdated}</dt>
                  <dd>{formatTimestamp(selected.updatedAt, locale)}</dd>
                </div>
              </dl>

              <section className="portal-content__locale-section">
                <header>
                  <IconLanguage aria-hidden="true" size={17} stroke={1.8} />
                  <h4>{messages.localeCompleteness}</h4>
                </header>
                <CompletenessBar label={messages.english} value={selected.localeCompleteness.en} />
                <CompletenessBar label={messages.arabic} value={selected.localeCompleteness.ar} />
              </section>

              {selected.previewHref ? (
                <Button asChild variant="secondary">
                  <Link href={selected.previewHref} rel="noreferrer" target="_blank">
                    <IconExternalLink aria-hidden="true" size={16} stroke={1.8} />
                    {messages.preview}
                  </Link>
                </Button>
              ) : (
                <p className="portal-content__preview-note">{messages.noPreview}</p>
              )}

              <PortalState
                className="portal-content__editor-gate"
                description={messages.editorDescription}
                title={messages.editorTitle}
                type="dependency-gated"
              />
            </>
          </Surface>
        ) : null}
      </div>
    </main>
  )
}
