'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import Link from 'next/link'
import {
  IconArrowLeft,
  IconArrowRight,
  IconExternalLink,
  IconFileText,
  IconLanguage,
  IconSearch,
  IconX,
} from '@tabler/icons-react'

import { getPortalMessages } from '@/admin-portal/core/i18n/getPortalMessages'
import { usePortalPreferences } from '@/admin-portal/core/navigation/PortalPreferences'
import { Button, PortalState, StatusBadge, Surface } from '@/admin-portal/core/ui'

import {
  ContentEditor,
  ContentEditorActions,
  ContentEditorNotice,
  type ContentEditorHandle,
  type ContentEditorNotice as ContentEditorNoticeValue,
  type ContentEditorSaveResult,
  type ContentEditorTransitionRequest,
} from './ContentEditor'
import type {
  ContentItemStatus,
  ContentLocale,
  ContentQuery,
  ContentStatusFilter,
  ContentSummary,
  ContentSummaryItem,
  ContentTypeId,
  WebsiteContentPageState,
} from './getContentSummary'
import { PORTAL_CONTENT_TYPE_IDS } from './getContentSummary'

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
  unpublished: 'neutral',
}

const switchCopy = {
  en: {
    close: 'Close',
    closeEditor: 'Close editor',
    description: 'Save your changes before opening “{target}”?',
    discard: 'Discard',
    newContent: 'New content',
    save: 'Save and switch',
    title: '“{current}” has unsaved changes',
  },
  zh: {
    close: '关闭',
    closeEditor: '关闭编辑器',
    description: '是否先保存当前修改，再切换到“{target}”？',
    discard: '不保存',
    newContent: '新增内容',
    save: '保存并切换',
    title: '正在编辑“{current}”',
  },
} as const

type PendingTransition = {
  commit: () => void
  locale?: ContentLocale
  targetTitle: string
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

function CompletenessBar({
  completeLabel,
  label,
  missingCount,
  missingLabel,
  value,
}: {
  completeLabel: string
  label: string
  missingCount: number
  missingLabel: string
  value: number
}) {
  return (
    <div className="portal-content__completeness-item">
      <div className="portal-content__completeness-row">
        <span>{label}</span>
        <progress aria-label={`${label} ${value}%`} max={100} value={value} />
        <strong>{value}%</strong>
      </div>
      <small>
        {missingCount === 0 ? completeLabel : missingLabel.replace('{count}', String(missingCount))}
      </small>
    </div>
  )
}

function UnsavedChangesDialog({
  busy,
  currentTitle,
  locale,
  onCancel,
  onDiscard,
  onSave,
  targetTitle,
}: {
  busy: boolean
  currentTitle: string
  locale: 'en' | 'zh'
  onCancel: () => void
  onDiscard: () => void
  onSave: () => void
  targetTitle: string
}) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const saveRef = useRef<HTMLButtonElement>(null)
  const busyRef = useRef(busy)
  const text = switchCopy[locale]

  useEffect(() => {
    busyRef.current = busy
  }, [busy])

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null
    saveRef.current?.focus()
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busyRef.current) {
        event.preventDefault()
        onCancel()
        return
      }
      if (event.key !== 'Tab') return
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled)')
      if (!focusable?.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      previouslyFocused?.focus()
    }
  }, [onCancel])

  return (
    <div className="portal-content__dialog-backdrop">
      <div
        aria-describedby="content-switch-description"
        aria-labelledby="content-switch-title"
        aria-modal="true"
        className="portal-content__dialog"
        ref={dialogRef}
        role="dialog"
      >
        <h3 id="content-switch-title">{text.title.replace('{current}', currentTitle)}</h3>
        <p id="content-switch-description">{text.description.replace('{target}', targetTitle)}</p>
        <div className="portal-content__dialog-actions">
          <Button disabled={busy} onClick={onSave} ref={saveRef}>
            {text.save}
          </Button>
          <Button disabled={busy} onClick={onDiscard} variant="secondary">
            {text.discard}
          </Button>
        </div>
        <Button
          aria-label={text.close}
          className="portal-content__dialog-close"
          disabled={busy}
          onClick={onCancel}
          size="icon"
          variant="ghost"
        >
          <IconX aria-hidden="true" size={18} />
        </Button>
      </div>
    </div>
  )
}

function ItemButton({
  active,
  disabled = false,
  item,
  locale,
  onSelect,
}: {
  active: boolean
  disabled?: boolean
  item: ContentSummaryItem
  locale: 'en' | 'zh'
  onSelect: () => void
}) {
  const messages = getPortalMessages(locale).websiteContent

  return (
    <button
      aria-disabled={disabled || undefined}
      aria-pressed={active}
      className={`portal-content__item${active ? ' is-active' : ''}`}
      disabled={disabled}
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
  if (['pages', 'posts', 'knowledge', 'products', 'projects'].includes(type)) {
    return ['all', 'draft', 'published', 'unpublished']
  }
  if (type === 'downloads') return ['all', 'active', 'inactive']
  return ['all']
}

export function ContentHub({ pageState, summary }: ContentHubProps) {
  const { locale } = usePortalPreferences()
  const messages = getPortalMessages(locale).websiteContent
  const [selectedId, setSelectedId] = useState<number | string | null>(null)
  const [transientItem, setTransientItem] = useState<ContentSummaryItem | null>(null)
  const [editor, setEditor] = useState<'create' | 'edit' | null>(null)
  const [editorInitialLocale, setEditorInitialLocale] = useState<ContentLocale>('en')
  const [notice, setNotice] = useState<ContentEditorNoticeValue>(null)
  const [pendingTransition, setPendingTransition] = useState<PendingTransition | null>(null)
  const [switchBusy, setSwitchBusy] = useState(false)
  const [editorMinHeight, setEditorMinHeight] = useState<number | null>(null)
  const editorRef = useRef<ContentEditorHandle>(null)
  const editorFrameRef = useRef<HTMLDivElement>(null)
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const showNotice = useCallback((nextNotice: ContentEditorNoticeValue) => {
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current)
    setNotice(nextNotice)
    if (nextNotice) {
      noticeTimerRef.current = setTimeout(() => {
        setNotice(null)
        noticeTimerRef.current = null
      }, 5_000)
    }
  }, [])

  useEffect(
    () => () => {
      if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current)
    },
    [],
  )
  const cancelTransition = useCallback(() => setPendingTransition(null), [])

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
    editor === 'create'
      ? null
      : (summary.items.find((item) => String(item.id) === String(selectedId)) ??
        (String(transientItem?.id) === String(selectedId) ? transientItem : null) ??
        summary.items[0] ??
        null)

  const captureEditorHeight = () => {
    const height = editorFrameRef.current?.getBoundingClientRect().height ?? 0
    if (height > 0) setEditorMinHeight(Math.ceil(height))
  }

  const commitOpenCreate = () => {
    if (editor) captureEditorHeight()
    else setEditorMinHeight(null)
    setSelectedId(null)
    setTransientItem(null)
    setEditorInitialLocale('en')
    setPendingTransition(null)
    showNotice(null)
    setEditor('create')
  }

  const commitSwitch = (item: ContentSummaryItem) => {
    captureEditorHeight()
    setSelectedId(item.id)
    setTransientItem(null)
    setEditorInitialLocale('en')
    setPendingTransition(null)
    showNotice(null)
    setEditor('edit')
  }

  const commitCloseEditor = () => {
    setPendingTransition(null)
    setEditor(null)
    setEditorMinHeight(null)
  }

  const requestTransition: ContentEditorTransitionRequest = (targetTitle, commit, options) => {
    if (editorRef.current?.isDirty()) {
      setPendingTransition({ commit, locale: options?.locale, targetTitle })
      return
    }
    commit()
  }

  const promoteCreatedItem = (
    saved: ContentEditorSaveResult,
    targetLocale: ContentLocale,
  ) => {
    const item: ContentSummaryItem = {
      ...saved.result,
      localeCompleteness: { ar: 0, en: 0 },
      localeMissing: { ar: [], en: [] },
      previewHrefs: { ar: null, en: null },
    }
    setTransientItem(item)
    setSelectedId(item.id)
    setEditorInitialLocale(targetLocale)
    setEditor('edit')
  }

  const openCreate = () =>
    requestTransition(switchCopy[locale].newContent, commitOpenCreate)

  const requestSelection = (item: ContentSummaryItem) => {
    if (!editor) {
      setSelectedId(item.id)
      return
    }
    if (editor === 'edit' && String(item.id) === String(selected?.id)) return
    requestTransition(item.title, () => commitSwitch(item))
  }

  const saveAndTransition = async () => {
    if (!pendingTransition) return
    setSwitchBusy(true)
    const target = pendingTransition
    const saved = await editorRef.current?.saveCurrent()
    setSwitchBusy(false)
    if (saved) {
      setPendingTransition(null)
      if (saved.created && target.locale) {
        promoteCreatedItem(saved, target.locale)
        return
      }
      target.commit()
    }
  }

  const statusOptions = statusOptionsFor(summary.query.type)
  const statusLabel: Record<ContentStatusFilter, string> = {
    active: messages.statuses.active,
    all: messages.allStatuses,
    draft: messages.statuses.draft,
    inactive: messages.statuses.inactive,
    published: messages.statuses.published,
    unpublished: messages.statuses.unpublished,
  }

  return (
    <main className="portal-page portal-content">
      {notice ? <ContentEditorNotice notice={notice} onDismiss={() => showNotice(null)} /> : null}
      <header className="portal-page__intro portal-content__intro">
        <div>
          <h2>{messages.title}</h2>
          <p>{messages.description}</p>
        </div>
        <div className="portal-content__intro-actions">
          <StatusBadge label={messages.editorStatus} tone="success" />
          {PORTAL_CONTENT_TYPE_IDS.includes(
            summary.query.type as (typeof PORTAL_CONTENT_TYPE_IDS)[number],
          ) ? (
            <ContentEditorActions onCreate={openCreate} />
          ) : null}
        </div>
      </header>

      <nav aria-label={messages.title} className="portal-content__types">
        {summary.collections
          .filter((collection) =>
            PORTAL_CONTENT_TYPE_IDS.includes(
              collection.id as (typeof PORTAL_CONTENT_TYPE_IDS)[number],
            ),
          )
          .map((collection) => (
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
                    onSelect={() => requestSelection(item)}
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

        {editor ? (
          <Surface
            as="aside"
            className="portal-content__detail-panel portal-content__detail-panel--editor"
          >
            <div
              className="portal-content__editor-frame"
              ref={editorFrameRef}
              style={editorMinHeight ? { minHeight: `${editorMinHeight}px` } : undefined}
            >
              <ContentEditor
                initialLocale={editorInitialLocale}
                key={`${editor}:${editor === 'edit' ? String(selected?.id ?? 'none') : 'new'}`}
                item={editor === 'edit' ? selected : null}
                mode={editor}
                onClose={(force = false) => {
                  if (force) {
                    commitCloseEditor()
                    return
                  }
                  requestTransition(switchCopy[locale].closeEditor, commitCloseEditor)
                }}
                onNotice={showNotice}
                onRequestTransition={requestTransition}
                ref={editorRef}
                type={summary.query.type}
              />
            </div>
          </Surface>
        ) : selected ? (
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
                <CompletenessBar
                  completeLabel={messages.completenessComplete}
                  label={messages.english}
                  missingCount={selected.localeMissing.en.length}
                  missingLabel={messages.completenessMissing}
                  value={selected.localeCompleteness.en}
                />
                <CompletenessBar
                  completeLabel={messages.completenessComplete}
                  label={messages.arabic}
                  missingCount={selected.localeMissing.ar.length}
                  missingLabel={messages.completenessMissing}
                  value={selected.localeCompleteness.ar}
                />
              </section>

              {PORTAL_CONTENT_TYPE_IDS.includes(
                summary.query.type as (typeof PORTAL_CONTENT_TYPE_IDS)[number],
              ) ? (
                <ContentEditorActions onCreate={openCreate} onEdit={() => setEditor('edit')} />
              ) : null}

              {selected.previewHrefs.en || selected.previewHrefs.ar ? (
                <div aria-label={messages.preview} className="portal-content__preview-actions">
                  {selected.previewHrefs.en ? (
                    <Button asChild variant="secondary">
                      <Link href={selected.previewHrefs.en} rel="noreferrer" target="_blank">
                        <IconExternalLink aria-hidden="true" size={16} stroke={1.8} />
                        {messages.previewEnglish}
                      </Link>
                    </Button>
                  ) : null}
                  {selected.previewHrefs.ar ? (
                    <Button asChild variant="secondary">
                      <Link
                        dir="rtl"
                        href={selected.previewHrefs.ar}
                        lang="ar"
                        rel="noreferrer"
                        target="_blank"
                      >
                        <IconExternalLink aria-hidden="true" size={16} stroke={1.8} />
                        {messages.previewArabic}
                      </Link>
                    </Button>
                  ) : null}
                </div>
              ) : (
                <p className="portal-content__preview-note">{messages.noPreview}</p>
              )}
            </>
          </Surface>
        ) : null}
      </div>
      {pendingTransition ? (
        <UnsavedChangesDialog
          busy={switchBusy}
          currentTitle={
            editor === 'create'
              ? locale === 'zh'
                ? '新增内容'
                : 'New content'
              : (selected?.title ?? '')
          }
          locale={locale}
          onCancel={cancelTransition}
          onDiscard={() => {
            const target = pendingTransition
            setPendingTransition(null)
            target.commit()
          }}
          onSave={() => void saveAndTransition()}
          targetTitle={pendingTransition.targetTitle}
        />
      ) : null}
    </main>
  )
}
