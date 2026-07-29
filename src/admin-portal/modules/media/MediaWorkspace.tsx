'use client'

import { useState } from 'react'

import Link from 'next/link'
import {
  IconArrowLeft,
  IconArrowRight,
  IconGridDots,
  IconList,
  IconPhoto,
  IconSearch,
  IconUpload,
} from '@tabler/icons-react'

import { getPortalMessages } from '@/admin-portal/core/i18n/getPortalMessages'
import { usePortalPreferences } from '@/admin-portal/core/navigation/PortalPreferences'
import { Button, PortalState, StatusBadge, Surface } from '@/admin-portal/core/ui'

import type {
  MediaKindFilter,
  MediaPageState,
  MediaPageSummary,
  MediaQuery,
  MediaVisibilityFilter,
  MediaView,
} from './getMediaPage'
import { MediaGrid, formatDimensions, formatFileSize, formatType } from './MediaGrid'
import { MediaPreview } from './MediaPreview'

export interface MediaWorkspaceProps {
  pageState: MediaPageState | 'read-failed'
  summary: MediaPageSummary | null
}

export const buildMediaHref = (query: Partial<MediaQuery>): string => {
  const params = new URLSearchParams()
  if (query.q) params.set('q', query.q)
  if (query.kind && query.kind !== 'all') params.set('kind', query.kind)
  if (query.visibility && query.visibility !== 'all') params.set('visibility', query.visibility)
  if (query.source) params.set('source', query.source)
  if (query.view && query.view !== 'grid') params.set('view', query.view)
  if (query.page && query.page > 1) params.set('page', String(query.page))
  const search = params.toString()
  return search ? `/dashboard/media?${search}` : '/dashboard/media'
}

const formatTimestamp = (value: string, locale: 'en' | 'zh'): string => {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

export function MediaWorkspace({ pageState, summary }: MediaWorkspaceProps) {
  const { locale } = usePortalPreferences()
  const messages = getPortalMessages(locale).mediaWorkspace
  const [selectedId, setSelectedId] = useState<null | number | string>(null)

  if (pageState === 'forbidden') {
    return (
      <main className="portal-page portal-media">
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
      <main className="portal-page portal-media">
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
      <main className="portal-page portal-media">
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
  const kindLabels: Record<MediaKindFilter, string> = {
    all: messages.allKinds,
    image: messages.images,
    pdf: messages.pdfs,
  }
  const visibilityLabels: Record<MediaVisibilityFilter, string> = {
    all: messages.allVisibility,
    private: messages.private,
    public: messages.public,
  }
  const viewHref = (view: MediaView) => buildMediaHref({ ...summary.query, page: 1, view })

  return (
    <main className="portal-page portal-media">
      <header className="portal-page__intro portal-media__intro">
        <div>
          <p className="portal-page__eyebrow">{messages.eyebrow}</p>
          <h2>{messages.title}</h2>
          <p>{messages.description}</p>
        </div>
        <StatusBadge label={messages.editorStatus} tone="warning" />
      </header>

      <Surface as="section" className="portal-media__toolbar">
        <form
          action="/dashboard/media"
          className="portal-media__filter-form"
          key={`${summary.query.q}:${summary.query.kind}:${summary.query.visibility}:${summary.query.source}:${summary.query.view}`}
          method="get"
        >
          <input name="view" type="hidden" value={summary.query.view} />
          <label className="portal-media__field portal-media__search">
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
          <label className="portal-media__field">
            <span className="portal-field__label">{messages.kindLabel}</span>
            <select defaultValue={summary.query.kind} name="kind">
              {Object.entries(kindLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="portal-media__field">
            <span className="portal-field__label">{messages.visibilityLabel}</span>
            <select defaultValue={summary.query.visibility} name="visibility">
              {Object.entries(visibilityLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="portal-media__field">
            <span className="portal-field__label">{messages.sourceLabel}</span>
            <input
              defaultValue={summary.query.source}
              maxLength={80}
              name="source"
              placeholder={messages.sourcePlaceholder}
              type="text"
            />
          </label>
          <Button className="portal-media__filter-submit" type="submit">
            <IconSearch aria-hidden="true" size={16} stroke={1.8} />
            {messages.searchSubmit}
          </Button>
          <Button asChild variant="ghost">
            <Link href={buildMediaHref({ view: summary.query.view })}>{messages.resetFilters}</Link>
          </Button>
        </form>

        <div className="portal-media__actions">
          <nav aria-label={messages.viewLabel} className="portal-media__view-toggle">
            <Button
              asChild
              size="icon"
              variant={summary.query.view === 'grid' ? 'secondary' : 'ghost'}
            >
              <Link
                aria-current={summary.query.view === 'grid' ? 'page' : undefined}
                aria-label={messages.gridView}
                href={viewHref('grid')}
                title={messages.gridView}
              >
                <IconGridDots aria-hidden="true" size={17} stroke={1.8} />
              </Link>
            </Button>
            <Button
              asChild
              size="icon"
              variant={summary.query.view === 'list' ? 'secondary' : 'ghost'}
            >
              <Link
                aria-current={summary.query.view === 'list' ? 'page' : undefined}
                aria-label={messages.listView}
                href={viewHref('list')}
                title={messages.listView}
              >
                <IconList aria-hidden="true" size={17} stroke={1.8} />
              </Link>
            </Button>
          </nav>
          <Button disabled title={messages.uploadDisabledTitle}>
            <IconUpload aria-hidden="true" size={16} stroke={1.8} />
            {messages.upload}
          </Button>
        </div>
      </Surface>

      <div className={`portal-media__workspace${summary.items.length === 0 ? ' is-empty' : ''}`}>
        <Surface as="section" className="portal-media__library-panel">
          <header className="portal-media__panel-heading">
            <div>
              <IconPhoto aria-hidden="true" size={18} stroke={1.7} />
              <div>
                <h3>{messages.libraryTitle}</h3>
                <p>
                  {messages.total} {summary.pagination.totalDocs} {messages.itemCount}
                </p>
              </div>
            </div>
            <span>
              {summary.pagination.page} / {Math.max(summary.pagination.totalPages, 1)}
            </span>
          </header>

          {summary.items.length === 0 ? (
            <PortalState
              className="portal-media__empty"
              description={messages.emptyDescription}
              title={messages.emptyTitle}
              type="empty"
            />
          ) : (
            <MediaGrid
              items={summary.items}
              onSelect={setSelectedId}
              selectedId={selected?.id ?? null}
              view={summary.query.view}
            />
          )}

          {summary.pagination.totalPages > 1 ? (
            <nav aria-label={messages.paginationLabel} className="portal-content__pagination">
              {summary.pagination.page > 1 ? (
                <Button asChild size="compact" variant="secondary">
                  <Link
                    href={buildMediaHref({ ...summary.query, page: summary.pagination.page - 1 })}
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
                    href={buildMediaHref({ ...summary.query, page: summary.pagination.page + 1 })}
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
          <Surface as="aside" className="portal-media__detail-panel">
            <header className="portal-media__detail-heading">
              <div>
                <p>{messages.detailTitle}</p>
                <h3>{selected.filename}</h3>
              </div>
              <span>MED-{selected.id}</span>
            </header>

            <MediaPreview item={selected} key={selected.id} />

            <dl className="portal-media__metadata">
              <div>
                <dt>{messages.filename}</dt>
                <dd>{selected.filename}</dd>
              </div>
              <div>
                <dt>{messages.typeAndSize}</dt>
                <dd>
                  {formatType(selected)} · {formatFileSize(selected.filesize)}
                </dd>
              </div>
              <div>
                <dt>{messages.dimensions}</dt>
                <dd>{formatDimensions(selected)}</dd>
              </div>
              <div>
                <dt>{messages.visibilityLabel}</dt>
                <dd>{selected.isPublic ? messages.public : messages.private}</dd>
              </div>
              <div>
                <dt>{messages.sourceLabel}</dt>
                <dd>{selected.source || '—'}</dd>
              </div>
              <div>
                <dt>{messages.lastUpdated}</dt>
                <dd>{formatTimestamp(selected.updatedAt, locale)}</dd>
              </div>
              <div>
                <dt>{messages.lastUsed}</dt>
                <dd>{messages.usageGated}</dd>
              </div>
            </dl>

            <section className="portal-media__alt">
              <span>{messages.altText}</span>
              <p>{selected.alt || messages.noAlt}</p>
            </section>

            <section className="portal-media__limits">
              <strong>{messages.uploadLimitsTitle}</strong>
              <p>{messages.uploadLimits}</p>
              <small>{summary.limits.mimeTypes.join(' · ')}</small>
            </section>
          </Surface>
        ) : null}
      </div>
    </main>
  )
}
