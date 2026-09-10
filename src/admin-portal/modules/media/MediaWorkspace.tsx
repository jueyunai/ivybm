'use client'

import { useState } from 'react'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
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
import {
  Button,
  PortalState,
  SearchInput,
  Surface,
  UiSelect,
} from '@/admin-portal/core/ui'

import type {
  MediaKindFilter,
  MediaPageState,
  MediaPageSummary,
  MediaQuery,
  MediaVisibilityFilter,
  MediaView,
} from './getMediaPage'
import { MediaGrid, formatDimensions, formatFileSize, formatType } from './MediaGrid'
import { MediaEditor, MediaEditorButton } from './MediaEditor'
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
  const router = useRouter()
  const [selectedId, setSelectedId] = useState<null | number | string>(null)
  const [editor, setEditor] = useState<'create' | 'edit' | null>(null)

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
          <h2>{messages.title}</h2>
          <p>{messages.description}</p>
        </div>
      </header>

      <Surface as="section" className="portal-media__toolbar">
        <form
          action="/dashboard/media"
          className="portal-media__filter-form"
          key={`${summary.query.q}:${summary.query.kind}:${summary.query.visibility}:${summary.query.source}:${summary.query.view}`}
          method="get"
        >
          <input name="view" type="hidden" value={summary.query.view} />
          <div className="portal-media__filter-item portal-media__search">
            <label className="portal-media__filter-label" htmlFor="media-search-input">
              {messages.searchLabel}
            </label>
            <SearchInput
              aria-label={messages.searchLabel}
              defaultValue={summary.query.q}
              id="media-search-input"
              maxLength={80}
              name="q"
              placeholder={messages.searchPlaceholder}
            />
          </div>
          <div className="portal-media__filter-item">
            <span className="portal-media__filter-label">{messages.kindLabel}</span>
            <UiSelect
              ariaLabel={messages.kindLabel}
              name="kind"
              onChange={(value) =>
                router.push(
                  buildMediaHref({ ...summary.query, kind: value as MediaKindFilter, page: 1 }),
                )
              }
              options={Object.entries(kindLabels).map(([value, label]) => ({ label, value }))}
              value={summary.query.kind}
            />
          </div>
          <div className="portal-media__filter-item">
            <span className="portal-media__filter-label">{messages.visibilityLabel}</span>
            <UiSelect
              ariaLabel={messages.visibilityLabel}
              name="visibility"
              onChange={(value) =>
                router.push(
                  buildMediaHref({
                    ...summary.query,
                    page: 1,
                    visibility: value as MediaVisibilityFilter,
                  }),
                )
              }
              options={Object.entries(visibilityLabels).map(([value, label]) => ({ label, value }))}
              value={summary.query.visibility}
            />
          </div>
          <div className="portal-media__filter-item portal-media__source">
            <label className="portal-media__filter-label" htmlFor="media-source-input">
              {messages.sourceLabel}
            </label>
            <input
              defaultValue={summary.query.source}
              id="media-source-input"
              maxLength={80}
              name="source"
              placeholder={messages.sourcePlaceholder}
              type="text"
            />
          </div>
          <div className="portal-media__filter-actions">
            <Button className="portal-media__filter-submit" size="compact" type="submit">
              <IconSearch aria-hidden="true" size={16} stroke={1.8} />
              {messages.searchSubmit}
            </Button>
            <Button asChild size="compact" variant="ghost">
              <Link href={buildMediaHref({ view: summary.query.view })}>
                {messages.resetFilters}
              </Link>
            </Button>
          </div>
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
          <Button onClick={() => setEditor('create')}>
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

        {editor ? (
          <Surface
            as="aside"
            className="portal-media__detail-panel portal-media__detail-panel--editor"
          >
            <MediaEditor
              key={`${editor}:${editor === 'edit' ? String(selected?.id ?? 'none') : 'new'}`}
              item={editor === 'edit' ? selected : null}
              mode={editor}
              onClose={() => setEditor(null)}
            />
          </Surface>
        ) : selected ? (
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

            <div className="portal-media__detail-actions">
              <MediaEditorButton onClick={() => setEditor('edit')} />
            </div>
          </Surface>
        ) : null}
      </div>
    </main>
  )
}
