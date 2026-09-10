'use client'

import { useEffect, useRef, useState, type KeyboardEvent } from 'react'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  IconAlertTriangle,
  IconArrowLeft,
  IconArrowRight,
  IconBook2,
  IconCpu,
  IconFileUpload,
  IconFilter,
  IconLock,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconSettings,
  IconSparkles,
} from '@tabler/icons-react'

import { getPortalMessages } from '@/admin-portal/core/i18n/getPortalMessages'
import { usePortalPreferences } from '@/admin-portal/core/navigation/PortalPreferences'
import {
  Button,
  DrawerDialog,
  PortalState,
  SearchInput,
  StatusBadge,
  Surface,
  UiSelect,
} from '@/admin-portal/core/ui'

import type {
  KnowledgeDocumentSummary,
  KnowledgeIndexFilter,
  KnowledgeIndexStatus,
  KnowledgeLocaleFilter,
  KnowledgePageState,
  KnowledgePageSummary,
  KnowledgeQuery,
  KnowledgeReviewFilter,
  KnowledgeReviewStatus,
  KnowledgeSourceType,
  KnowledgeSourceTypeFilter,
  KnowledgeVisibilityFilter,
} from './getKnowledgePage'
import { KnowledgeIndexClientError, requestKnowledgeIndex } from './requestKnowledgeIndex'
import { KnowledgeAiDebug } from './KnowledgeAiDebug'
import { KnowledgeEditor, KnowledgeEditButton } from './KnowledgeEditor'
import { KnowledgeSourcePanel } from './KnowledgeSourcePanel'

export interface KnowledgeWorkspaceProps {
  pageState: KnowledgePageState | 'read-failed'
  summary: KnowledgePageSummary | null
}

type Feedback = { message: string; tone: 'danger' | 'info' | 'success' }

export const buildKnowledgeHref = (query: Partial<KnowledgeQuery>): string => {
  const params = new URLSearchParams()
  if (query.q) params.set('q', query.q)
  if (query.review && query.review !== 'all') params.set('review', query.review)
  if (query.index && query.index !== 'all') params.set('index', query.index)
  if (query.locale && query.locale !== 'all') params.set('locale', query.locale)
  if (query.visibility && query.visibility !== 'all') {
    params.set('visibility', query.visibility)
  }
  if (query.sourceType && query.sourceType !== 'all') {
    params.set('sourceType', query.sourceType)
  }
  if (query.page && query.page > 1) params.set('page', String(query.page))
  const search = params.toString()
  return search ? `/dashboard/knowledge?${search}` : '/dashboard/knowledge'
}

const formatTimestamp = (value: string, locale: 'en' | 'zh'): string => {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

const reviewTone: Record<KnowledgeReviewStatus, 'info' | 'neutral' | 'success'> = {
  archived: 'neutral',
  draft: 'info',
  reviewed: 'success',
}

const indexTone: Record<KnowledgeIndexStatus, 'danger' | 'info' | 'success' | 'warning'> = {
  failed: 'danger',
  pending: 'warning',
  processing: 'info',
  ready: 'success',
}

export function KnowledgeWorkspace({ pageState, summary }: KnowledgeWorkspaceProps) {
  const { locale } = usePortalPreferences()
  const messages = getPortalMessages(locale).knowledgeWorkspace
  const router = useRouter()
  const ingestionTriggerRef = useRef<HTMLButtonElement>(null)
  const [activeTab, setActiveTab] = useState<'debug' | 'documents'>('documents')
  const [ingestDrawerOpen, setIngestDrawerOpen] = useState(false)
  const [showMoreFilters, setShowMoreFilters] = useState(false)
  const [selectedId, setSelectedId] = useState<null | number | string>(null)
  const [indexing, setIndexing] = useState(false)
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const [editor, setEditor] = useState<'create' | 'edit' | null>(null)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const tab = params.get('tab')
    const drawer = params.get('drawer')

    if (tab === 'debug' || drawer === 'ingest') {
      queueMicrotask(() => {
        if (tab === 'debug') setActiveTab('debug')
        if (drawer === 'ingest') setIngestDrawerOpen(true)
      })
    }
  }, [])

  if (pageState === 'forbidden') {
    return (
      <main className="portal-page portal-knowledge">
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
      <main className="portal-page portal-knowledge">
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
      <main className="portal-page portal-knowledge">
        <PortalState
          description={messages.readErrorDescription}
          title={messages.readErrorTitle}
          type="error"
        />
      </main>
    )
  }

  const selected =
    summary.documents.find((document) => String(document.id) === String(selectedId)) ??
    summary.documents[0] ??
    null
  const hasIndexCommand = summary.commands.includes('knowledge:index')
  const isOperatorRetryBlocked = selected?.indexStatus === 'failed' && summary.role === 'operator'
  const canIndex =
    hasIndexCommand &&
    selected?.reviewStatus === 'reviewed' &&
    selected.indexStatus !== 'processing' &&
    !isOperatorRetryBlocked

  const reviewLabels: Record<KnowledgeReviewFilter, string> = {
    all: messages.allReviewStatuses,
    archived: messages.reviewStatuses.archived,
    draft: messages.reviewStatuses.draft,
    reviewed: messages.reviewStatuses.reviewed,
  }
  const indexLabels: Record<KnowledgeIndexFilter, string> = {
    all: messages.allIndexStatuses,
    failed: messages.indexStatuses.failed,
    pending: messages.indexStatuses.pending,
    processing: messages.indexStatuses.processing,
    ready: messages.indexStatuses.ready,
  }
  const localeLabels: Record<KnowledgeLocaleFilter, string> = {
    all: messages.allLocales,
    ar: messages.arabic,
    en: messages.english,
  }
  const visibilityLabels: Record<KnowledgeVisibilityFilter, string> = {
    all: messages.allVisibility,
    customer: messages.customerVisible,
    internal: messages.internalOnly,
  }
  const sourceLabels: Record<KnowledgeSourceTypeFilter, string> = {
    all: messages.allSourceTypes,
    faq: messages.sourceTypes.faq,
    'product-manual': messages.sourceTypes['product-manual'],
    'technical-specification': messages.sourceTypes['technical-specification'],
    'sales-script': messages.sourceTypes['sales-script'],
    'project-case': messages.sourceTypes['project-case'],
    other: messages.sourceTypes.other,
  }

  const indexDisabledTitle = !selected
    ? messages.selectDocument
    : selected.reviewStatus !== 'reviewed'
      ? messages.reviewRequired
      : selected.indexStatus === 'processing'
        ? messages.alreadyProcessing
        : isOperatorRetryBlocked
          ? messages.adminRetryRequired
          : undefined

  const indexSelectedDocument = async () => {
    if (!selected || !canIndex || indexing) return
    setIndexing(true)
    setFeedback(null)
    try {
      const result = await requestKnowledgeIndex(selected.id)
      setFeedback({
        message: result.state === 'duplicate' ? messages.indexDuplicate : messages.indexAccepted,
        tone: result.state === 'duplicate' ? 'info' : 'success',
      })
      router.refresh()
    } catch (error) {
      const code = error instanceof KnowledgeIndexClientError ? error.code : 'network_failure'
      const message =
        code === 'knowledge-not-reviewed' || code === 'knowledge_not_reviewed'
          ? messages.reviewRequired
          : code === 'knowledge-index-rate-limited' || code === 'knowledge_index_rate_limited'
            ? messages.indexRateLimited
            : code === 'knowledge-document-not-found' || code === 'knowledge_document_not_found'
              ? messages.documentNotFound
              : code === 'invalid_document_id'
                ? messages.invalidDocument
                : messages.indexUnavailable
      setFeedback({ message, tone: 'danger' })
    } finally {
      setIndexing(false)
    }
  }

  const metrics = [
    {
      caption: messages.metrics.readyCaption,
      label: messages.metrics.ready,
      tone: 'success' as const,
      value: summary.counts.ready,
    },
    {
      caption: messages.metrics.draftCaption,
      label: messages.metrics.draft,
      tone: 'warning' as const,
      value: summary.counts.draft,
    },
    {
      caption: messages.metrics.processingCaption,
      label: messages.metrics.processing,
      tone: 'info' as const,
      value: summary.counts.processing,
    },
    {
      caption: messages.metrics.failedCaption,
      label: messages.metrics.failed,
      tone: 'danger' as const,
      value: summary.counts.failed,
    },
  ]

  const hasSecondaryFilters =
    summary.query.locale !== 'all' ||
    summary.query.visibility !== 'all' ||
    summary.query.sourceType !== 'all'
  const secondaryFilterCount = [
    summary.query.locale !== 'all',
    summary.query.visibility !== 'all',
    summary.query.sourceType !== 'all',
  ].filter(Boolean).length

  const switchTab = (tab: 'debug' | 'documents') => {
    setActiveTab(tab)
    const params = new URLSearchParams(window.location.search)
    if (tab === 'debug') params.set('tab', 'debug')
    else params.delete('tab')
    const search = params.toString()
    window.history.replaceState(
      null,
      '',
      search ? `/dashboard/knowledge?${search}` : '/dashboard/knowledge',
    )
  }

  const handleTabKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    let next: 'debug' | 'documents' | null = null
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown' || event.key === 'End')
      next = 'debug'
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp' || event.key === 'Home')
      next = 'documents'
    if (!next) return

    event.preventDefault()
    switchTab(next)
    event.currentTarget.querySelector<HTMLButtonElement>(`[aria-controls="panel-${next}"]`)?.focus()
  }

  const updateFilter = (name: keyof KnowledgeQuery, value: string) => {
    const params = new URLSearchParams(window.location.search)
    if (value === 'all') params.delete(name)
    else params.set(name, value)
    params.delete('page')
    router.push(params.toString() ? `/dashboard/knowledge?${params}` : '/dashboard/knowledge')
  }

  return (
    <main className="portal-page portal-knowledge">
      <header className="portal-page__intro portal-knowledge__intro">
        <div>
          <h2>{messages.title}</h2>
          <p>{messages.description}</p>
        </div>
        <div className="portal-knowledge__header-actions">
          <Button
            onClick={() => setIngestDrawerOpen(true)}
            ref={ingestionTriggerRef}
            variant="secondary"
          >
            <IconFileUpload aria-hidden="true" size={16} stroke={1.8} />
            {locale === 'zh' ? '批量解析入库' : 'Batch ingestion'}
          </Button>
          <Button
            onClick={() => {
              setEditor('create')
              setFeedback(null)
              switchTab('documents')
            }}
          >
            <IconPlus aria-hidden="true" size={16} stroke={1.8} />
            {messages.addDocument}
          </Button>
        </div>
      </header>

      {feedback ? (
        <div
          className={`portal-knowledge__feedback portal-knowledge__feedback--${feedback.tone}`}
          role={feedback.tone === 'danger' ? 'alert' : 'status'}
        >
          {feedback.message}
        </div>
      ) : null}

      <div
        aria-label={locale === 'zh' ? '知识库工作模式' : 'Knowledge workspace tabs'}
        className="portal-segmented portal-knowledge__tabs"
        onKeyDown={handleTabKeyDown}
        role="tablist"
      >
        <Button
          aria-controls="panel-documents"
          aria-selected={activeTab === 'documents'}
          onClick={() => switchTab('documents')}
          role="tab"
          size="compact"
          tabIndex={activeTab === 'documents' ? 0 : -1}
          variant={activeTab === 'documents' ? 'primary' : 'ghost'}
        >
          <IconBook2 aria-hidden="true" size={15} stroke={1.8} />
          {locale === 'zh' ? '知识文档库' : 'Knowledge documents'}
          <span className="portal-knowledge__tab-badge">{summary.pagination.totalDocs}</span>
        </Button>
        <Button
          aria-controls="panel-debug"
          aria-selected={activeTab === 'debug'}
          onClick={() => switchTab('debug')}
          role="tab"
          size="compact"
          tabIndex={activeTab === 'debug' ? 0 : -1}
          variant={activeTab === 'debug' ? 'primary' : 'ghost'}
        >
          <IconCpu aria-hidden="true" size={15} stroke={1.8} />
          {locale === 'zh' ? 'AI 调试与底座' : 'AI debug and foundation'}
        </Button>
      </div>

      <div
        className="portal-knowledge__tab-panel"
        hidden={activeTab !== 'documents'}
        id="panel-documents"
        role="tabpanel"
      >
        <section aria-label={messages.metricsLabel} className="portal-knowledge__metrics">
          {metrics.map((metric) => (
            <Surface as="article" className="portal-knowledge__metric" key={metric.label}>
              <div>
                <span>{metric.label}</span>
                <StatusBadge label={metric.caption} tone={metric.tone} />
              </div>
              <strong>{metric.value}</strong>
            </Surface>
          ))}
        </section>

        <Surface as="section" className="portal-knowledge__filters">
          <form
            action="/dashboard/knowledge"
            className="portal-knowledge__filter-form"
            method="get"
          >
            <div className="portal-knowledge__filter-row">
              <div className="portal-knowledge__filter-item portal-knowledge__search">
                <span className="portal-knowledge__filter-label">{messages.searchLabel}</span>
                <SearchInput
                  aria-label={messages.searchLabel}
                  defaultValue={summary.query.q}
                  maxLength={80}
                  name="q"
                  placeholder={messages.searchPlaceholder}
                />
              </div>
              <KnowledgeSelect
                label={messages.reviewLabel}
                name="review"
                onChange={(value) => updateFilter('review', value)}
                options={reviewLabels}
                value={summary.query.review}
              />
              <KnowledgeSelect
                label={messages.indexLabel}
                name="index"
                onChange={(value) => updateFilter('index', value)}
                options={indexLabels}
                value={summary.query.index}
              />
              <div className="portal-knowledge__filter-actions">
                <Button
                  aria-expanded={showMoreFilters || hasSecondaryFilters}
                  className={`portal-knowledge__more-filters-btn${hasSecondaryFilters ? ' is-active' : ''}`}
                  onClick={() => setShowMoreFilters((current) => !current)}
                  size="compact"
                  type="button"
                  variant={showMoreFilters || hasSecondaryFilters ? 'secondary' : 'ghost'}
                >
                  <IconFilter aria-hidden="true" size={14} stroke={1.8} />
                  {locale === 'zh' ? '更多筛选' : 'More filters'}
                  {secondaryFilterCount > 0 ? (
                    <span className="portal-knowledge__filter-badge">{secondaryFilterCount}</span>
                  ) : null}
                </Button>
                <Button className="portal-knowledge__filter-submit" size="compact" type="submit">
                  <IconSearch aria-hidden="true" size={15} stroke={1.8} />
                  {messages.applyFilters}
                </Button>
                <Button asChild size="compact" variant="ghost">
                  <Link href="/dashboard/knowledge">{messages.resetFilters}</Link>
                </Button>
              </div>
            </div>
            <div
              className="portal-knowledge__filter-row portal-knowledge__filter-row--secondary"
              hidden={!showMoreFilters && !hasSecondaryFilters}
            >
              <KnowledgeSelect
                label={messages.localeLabel}
                name="locale"
                onChange={(value) => updateFilter('locale', value)}
                options={localeLabels}
                value={summary.query.locale}
              />
              <KnowledgeSelect
                label={messages.visibilityLabel}
                name="visibility"
                onChange={(value) => updateFilter('visibility', value)}
                options={visibilityLabels}
                value={summary.query.visibility}
              />
              <KnowledgeSelect
                label={messages.sourceTypeLabel}
                name="sourceType"
                onChange={(value) => updateFilter('sourceType', value)}
                options={sourceLabels}
                value={summary.query.sourceType}
              />
            </div>
          </form>
        </Surface>

        <div className="portal-knowledge__workspace">
          <Surface as="section" className="portal-knowledge__documents">
            <header className="portal-knowledge__panel-heading">
              <div>
                <IconBook2 aria-hidden="true" size={18} stroke={1.8} />
                <div>
                  <h3>{messages.documentListTitle}</h3>
                  <p>
                    {summary.pagination.totalDocs} {messages.documentCount}
                  </p>
                </div>
              </div>
              <span>
                {summary.pagination.page} / {Math.max(summary.pagination.totalPages, 1)}
              </span>
            </header>

            {summary.documents.length === 0 ? (
              <PortalState
                className="portal-knowledge__empty"
                description={messages.emptyDescription}
                title={messages.emptyTitle}
                type="empty"
              />
            ) : (
              <div
                aria-label={messages.documentTableLabel}
                className="portal-knowledge__table-wrap"
                role="region"
              >
                <table className="portal-knowledge__table">
                  <thead>
                    <tr>
                      <th>{messages.documentColumn}</th>
                      <th>{messages.localeColumn}</th>
                      <th>{messages.visibilityColumn}</th>
                      <th>{messages.reviewColumn}</th>
                      <th>{messages.indexColumn}</th>
                      <th>{messages.updatedColumn}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.documents.map((document) => (
                      <KnowledgeDocumentRow
                        document={document}
                        indexLabel={indexLabels[document.indexStatus]}
                        isSelected={
                          editor !== 'create' && String(document.id) === String(selected?.id)
                        }
                        key={document.id}
                        locale={locale}
                        messages={messages}
                        onSelect={() => {
                          setSelectedId(document.id)
                          if (editor === 'create') setEditor(null)
                          setFeedback(null)
                        }}
                        reviewLabel={reviewLabels[document.reviewStatus]}
                        sourceLabel={sourceLabels[document.sourceType as KnowledgeSourceType]}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {summary.pagination.totalPages > 1 ? (
              <nav aria-label={messages.paginationLabel} className="portal-content__pagination">
                {summary.pagination.page > 1 ? (
                  <Button asChild size="compact" variant="secondary">
                    <Link
                      href={buildKnowledgeHref({
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
                      href={buildKnowledgeHref({
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

          <Surface
            as="aside"
            className={`portal-knowledge__detail${editor ? ' portal-knowledge__detail--editor' : ''}`}
          >
            {editor ? (
              <KnowledgeEditor
                item={editor === 'edit' ? selected : null}
                key={`${editor}:${editor === 'edit' ? String(selected?.id ?? 'none') : 'new'}`}
                mode={editor}
                onClose={() => setEditor(null)}
              />
            ) : selected ? (
              <>
                <header className="portal-knowledge__detail-header">
                  <div>
                    <span className="portal-knowledge__detail-type">
                      {sourceLabels[selected.sourceType as KnowledgeSourceType]} · v
                      {selected.sourceVersion}
                    </span>
                    <h3>{selected.sourceTitle}</h3>
                  </div>
                  <div className="portal-knowledge__detail-actions">
                    {hasIndexCommand ? (
                      <Button
                        disabled={!canIndex || indexing}
                        onClick={indexSelectedDocument}
                        size="compact"
                        title={indexDisabledTitle}
                        variant="secondary"
                      >
                        <IconRefresh
                          aria-hidden="true"
                          className={indexing ? 'is-spinning' : undefined}
                          size={15}
                          stroke={1.8}
                        />
                        {indexing ? messages.indexing : messages.startIndex}
                      </Button>
                    ) : null}
                    <KnowledgeEditButton onClick={() => setEditor('edit')} />
                  </div>
                </header>
                <dl className="portal-knowledge__detail-meta">
                  <div>
                    <dt>{messages.localeColumn}</dt>
                    <dd>{selected.locale.toUpperCase()}</dd>
                  </div>
                  <div>
                    <dt>{messages.visibilityColumn}</dt>
                    <dd>{selected.customerVisible ? messages.yes : messages.no}</dd>
                  </div>
                  <div>
                    <dt>{messages.reviewColumn}</dt>
                    <dd>
                      <StatusBadge
                        label={reviewLabels[selected.reviewStatus]}
                        tone={reviewTone[selected.reviewStatus]}
                      />
                    </dd>
                  </div>
                  <div>
                    <dt>{messages.indexColumn}</dt>
                    <dd>
                      <StatusBadge
                        label={indexLabels[selected.indexStatus]}
                        tone={indexTone[selected.indexStatus]}
                      />
                    </dd>
                  </div>
                  <div>
                    <dt>{messages.updatedColumn}</dt>
                    <dd>{formatTimestamp(selected.updatedAt, locale)}</dd>
                  </div>
                </dl>
              </>
            ) : (
              <PortalState
                description={messages.emptyDescription}
                title={messages.emptyTitle}
                type="empty"
              />
            )}
          </Surface>
        </div>
      </div>

      <div
        className="portal-knowledge__tab-panel"
        hidden={activeTab !== 'debug'}
        id="panel-debug"
        role="tabpanel"
      >
        <div className="portal-knowledge__debug-layout">
          <Surface as="section" className="portal-knowledge__debug-sandbox">
            <header className="portal-knowledge__debug-sandbox-header">
              <div>
                <IconSparkles aria-hidden="true" size={18} stroke={1.8} />
                <div>
                  <h3>{locale === 'zh' ? 'AI 客服问答调试' : 'AI assistant debug'}</h3>
                  <p>
                    {locale === 'zh'
                      ? '输入真实访客咨询，检查知识召回与安全回答。'
                      : 'Test customer prompts, knowledge retrieval, and safe responses.'}
                  </p>
                </div>
              </div>
            </header>
            {summary.ai.access === 'admin' && summary.commands.includes('knowledge:ai-debug') ? (
              <KnowledgeAiDebug />
            ) : (
              <div className="portal-knowledge__admin-only portal-knowledge__admin-only--sandbox">
                <IconLock aria-hidden="true" size={20} stroke={1.8} />
                <div>
                  <strong>
                    {locale === 'zh'
                      ? '仅管理员可使用 AI 客服调试'
                      : 'AI debugging requires administrator access'}
                  </strong>
                  <p>{messages.aiAdminOnlyDescription}</p>
                </div>
              </div>
            )}
          </Surface>

          <aside className="portal-knowledge__debug-side">
            <Surface as="section" className="portal-knowledge__side-panel">
              <header className="portal-knowledge__side-heading">
                <div>
                  <IconSettings aria-hidden="true" size={17} stroke={1.8} />
                  <h3>{messages.aiRoutesTitle}</h3>
                </div>
                <span className="is-admin-only">{messages.adminOnly}</span>
              </header>
              {summary.ai.access === 'admin-only' ? (
                <div className="portal-knowledge__admin-only">
                  <IconLock aria-hidden="true" size={18} stroke={1.8} />
                  <div>
                    <strong>{messages.aiAdminOnlyTitle}</strong>
                    <p>{messages.aiAdminOnlyDescription}</p>
                  </div>
                </div>
              ) : (
                <ul className="portal-knowledge__route-list">
                  {summary.ai.routes.map((route) => (
                    <li key={route.usageKey}>
                      <div>
                        <span>
                          {route.operation === 'embedding'
                            ? messages.embeddingRoute
                            : messages.textRoute}
                        </span>
                        <strong>
                          {[route.provider, route.model, route.dimensions]
                            .filter(Boolean)
                            .join(' · ') || messages.routeUnconfigured}
                        </strong>
                      </div>
                      <StatusBadge
                        label={
                          route.status === 'ready'
                            ? messages.routeReady
                            : messages.routeActionRequired
                        }
                        tone={route.status === 'ready' ? 'success' : 'warning'}
                      />
                    </li>
                  ))}
                </ul>
              )}
              <p className="portal-knowledge__credential-note">{messages.credentialsNeverShown}</p>
            </Surface>

            <Surface as="section" className="portal-knowledge__side-panel">
              <header className="portal-knowledge__side-heading">
                <div>
                  <IconBook2 aria-hidden="true" size={17} stroke={1.8} />
                  <h3>{messages.promptsTitle}</h3>
                </div>
                <span>{messages.operatorMaintainable}</span>
              </header>
              {summary.prompts.length === 0 ? (
                <p className="portal-knowledge__side-empty">{messages.noPrompts}</p>
              ) : (
                <ul className="portal-knowledge__prompt-list">
                  {summary.prompts.map((prompt) => (
                    <li key={prompt.id}>
                      <div>
                        <strong>{prompt.key}</strong>
                        <span>
                          {messages.promptPurposes[prompt.purpose]} · {prompt.locale.toUpperCase()}
                        </span>
                      </div>
                      <StatusBadge
                        label={`v${prompt.version} · ${messages.promptStatuses[prompt.status]}`}
                        tone={
                          prompt.status === 'active'
                            ? 'success'
                            : prompt.status === 'draft'
                              ? 'warning'
                              : 'neutral'
                        }
                      />
                    </li>
                  ))}
                </ul>
              )}
              <div className="portal-knowledge__immutable-note">
                <strong>{messages.promptImmutableTitle}</strong>
                <p>{messages.promptImmutableDescription}</p>
              </div>
            </Surface>

            {summary.counts.failed > 0 ? (
              <section className="portal-knowledge__recovery" role="status">
                <IconAlertTriangle aria-hidden="true" size={18} stroke={1.8} />
                <div>
                  <strong>{messages.recoveryTitle}</strong>
                  <p>{messages.recoveryDescription}</p>
                </div>
              </section>
            ) : null}
          </aside>
        </div>
      </div>

      <DrawerDialog
        closeLabel={locale === 'zh' ? '关闭抽屉' : 'Close drawer'}
        description={messages.ingestion.uploadDescription}
        maxWidth="760px"
        onOpenChange={(open) => {
          setIngestDrawerOpen(open)
          if (!open) queueMicrotask(() => ingestionTriggerRef.current?.focus())
        }}
        open={ingestDrawerOpen}
        title={messages.ingestion.title}
      >
        <KnowledgeSourcePanel role={summary.role} />
      </DrawerDialog>
    </main>
  )
}

function KnowledgeSelect<T extends string>({
  label,
  name,
  onChange,
  options,
  value,
}: {
  label: string
  name: string
  onChange?: (value: string) => void
  options: Record<T, string>
  value: T
}) {
  return (
    <div className="portal-knowledge__filter-item">
      <span className="portal-knowledge__filter-label">{label}</span>
      <UiSelect
        ariaLabel={label}
        name={name}
        onChange={onChange}
        options={Object.entries(options).map(([optionValue, optionLabel]) => ({
          label: String(optionLabel),
          value: optionValue,
        }))}
        value={value}
      />
    </div>
  )
}

function KnowledgeDocumentRow({
  document,
  indexLabel,
  isSelected,
  locale,
  messages,
  onSelect,
  reviewLabel,
  sourceLabel,
}: {
  document: KnowledgeDocumentSummary
  indexLabel: string
  isSelected: boolean
  locale: 'en' | 'zh'
  messages: ReturnType<typeof getPortalMessages>['knowledgeWorkspace']
  onSelect: () => void
  reviewLabel: string
  sourceLabel: string
}) {
  return (
    <tr
      aria-selected={isSelected}
      className={isSelected ? 'is-selected' : undefined}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onSelect()
        }
      }}
      tabIndex={0}
    >
      <td data-label={messages.documentColumn}>
        <button
          aria-pressed={isSelected}
          onClick={(event) => {
            event.stopPropagation()
            onSelect()
          }}
          tabIndex={-1}
          type="button"
        >
          <strong>{document.sourceTitle}</strong>
          <span>
            {sourceLabel} · v{document.sourceVersion}
          </span>
        </button>
      </td>
      <td data-label={messages.localeColumn}>{document.locale.toUpperCase()}</td>
      <td data-label={messages.visibilityColumn}>
        {document.customerVisible ? messages.yes : messages.no}
      </td>
      <td data-label={messages.reviewColumn}>
        <StatusBadge label={reviewLabel} tone={reviewTone[document.reviewStatus]} />
      </td>
      <td data-label={messages.indexColumn}>
        <StatusBadge label={indexLabel} tone={indexTone[document.indexStatus]} />
      </td>
      <td data-label={messages.updatedColumn}>
        <time dateTime={document.updatedAt}>{formatTimestamp(document.updatedAt, locale)}</time>
      </td>
    </tr>
  )
}
