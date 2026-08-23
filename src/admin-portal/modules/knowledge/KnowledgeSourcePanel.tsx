/* eslint-disable @next/next/no-img-element -- previews are private same-origin asset responses. */
'use client'

import { FormEvent, useCallback, useEffect, useRef, useState } from 'react'

import { Button, StatusBadge, Surface } from '@/admin-portal/core/ui'
import { getPortalMessages } from '@/admin-portal/core/i18n/getPortalMessages'
import { usePortalPreferences } from '@/admin-portal/core/navigation/PortalPreferences'

type Source = {
  detectedLanguage: null | string
  errorCode: null | string
  errorSummary: null | string
  filename: string
  filesize: number
  id: number | string
  imageCount: number
  mimeType: null | string
  processingStage: string
  processingStatus: string
  sourceTitle: string
  sourceType: string
  sourceVersion: string
  updatedAt: string
}

type SourceDetail = {
  assets: { id: number | string; mimeType: null | string; name: string; previewURL: null | string; sequence: number }[]
  outputs: {
    customerVisible: boolean
    id: number | string
    indexStatus: string
    locale: 'ar' | 'en'
    reviewStatus: string
    riskTopics: RiskTopic[]
    sourceTitle: string
  }[]
}

type RiskTopic = keyof ReturnType<typeof getPortalMessages>['knowledgeWorkspace']['ingestion']['riskTopics']

type SourcePagination = {
  hasNextPage: boolean
  page: number
  pageSize: number
  totalDocs: number
  totalPages: number
}

const initialPagination: SourcePagination = {
  hasNextPage: false,
  page: 1,
  pageSize: 25,
  totalDocs: 0,
  totalPages: 1,
}

export function KnowledgeSourcePanel({ role }: { role: 'admin' | 'operator' }) {
  const { locale } = usePortalPreferences()
  const messages = getPortalMessages(locale).knowledgeWorkspace.ingestion
  const [sources, setSources] = useState<Source[]>([])
  const [pagination, setPagination] = useState<SourcePagination>(initialPagination)
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<{ message: string; tone: 'danger' | 'success' } | null>(null)
  const [detail, setDetail] = useState<{ data: SourceDetail; id: number | string } | null>(null)
  const currentPage = useRef(1)
  const refreshSequence = useRef(0)

  const refresh = useCallback(async (requestedPage = currentPage.current) => {
    const sequence = ++refreshSequence.current
    const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1
    try {
      const response = await fetch(`/api/portal/knowledge/sources?page=${page}`, { cache: 'no-store' })
      if (!response.ok) return
      const body = (await response.json()) as { pagination?: Partial<SourcePagination>; sources?: Source[] }
      if (sequence !== refreshSequence.current) return
      const totalPages = Number.isSafeInteger(body.pagination?.totalPages) && Number(body.pagination?.totalPages) > 0
        ? Number(body.pagination?.totalPages)
        : 1
      const nextPagination = {
        hasNextPage: body.pagination?.hasNextPage === true,
        page: Number.isSafeInteger(body.pagination?.page) && Number(body.pagination?.page) > 0
          ? Number(body.pagination?.page)
          : page,
        pageSize: Number.isSafeInteger(body.pagination?.pageSize) && Number(body.pagination?.pageSize) > 0
          ? Number(body.pagination?.pageSize)
          : initialPagination.pageSize,
        totalDocs: Number.isSafeInteger(body.pagination?.totalDocs) && Number(body.pagination?.totalDocs) >= 0
          ? Number(body.pagination?.totalDocs)
          : Array.isArray(body.sources) ? body.sources.length : 0,
        totalPages,
      }
      currentPage.current = nextPagination.page
      setSources(Array.isArray(body.sources) ? body.sources : [])
      setPagination(nextPagination)
    } catch {
      // Server components and unit tests can render without an absolute browser URL.
    }
  }, [])

  useEffect(() => {
    const initial = window.setTimeout(() => void refresh(), 0)
    const timer = window.setInterval(() => void refresh(), 5_000)
    return () => {
      window.clearTimeout(initial)
      window.clearInterval(timer)
    }
  }, [refresh])

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setBusy(true)
    setFeedback(null)
    try {
      const form = event.currentTarget
      const response = await fetch('/api/portal/knowledge/sources', { body: new FormData(form), headers: { 'Idempotency-Key': `portal-knowledge-source:${crypto.randomUUID()}` }, method: 'POST' })
      if (!response.ok) throw new Error('upload')
      setFeedback({ message: messages.uploadSuccess, tone: 'success' })
      form.reset()
      await refresh(1)
    } catch {
      setFeedback({ message: messages.uploadError, tone: 'danger' })
    } finally {
      setBusy(false)
    }
  }

  const retry = async (source: Source) => {
    setBusy(true)
    setFeedback(null)
    try {
      const response = await fetch(`/api/portal/knowledge/sources/${source.id}/retry`, { headers: { 'Idempotency-Key': `portal-knowledge-source-retry:${source.id}:${crypto.randomUUID()}` }, method: 'POST' })
      if (!response.ok) throw new Error('retry')
      setFeedback({ message: messages.retrySuccess, tone: 'success' })
      await refresh()
    } catch {
      setFeedback({ message: messages.retryError, tone: 'danger' })
    } finally {
      setBusy(false)
    }
  }

  const openDetails = async (source: Source) => {
    try {
      const response = await fetch(`/api/portal/knowledge/sources/${source.id}`, { cache: 'no-store' })
      if (!response.ok) return
      const body = (await response.json()) as SourceDetail
      setDetail({ data: body, id: source.id })
    } catch {
      // A private preview is optional; source status remains visible if it fails.
    }
  }

  const statusLabel = (status: string) =>
    status === 'archived'
      ? messages.archived
      : status === 'failed'
        ? messages.failed
        : status === 'needs_review'
          ? messages.needsReview
          : status === 'processing'
            ? messages.processing
            : messages.queued

  const stageLabel = (stage: string) =>
    messages.stages[stage as keyof typeof messages.stages] ?? messages.stages.queued

  const fileSizeLabel = (bytes: number) =>
    bytes > 0 ? `${(bytes / 1024 / 1024).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1)} MB` : '—'

  const errorLabel = (source: Source): string | null => {
    if (!source.errorSummary) return null
    return messages.errorSummaries[source.errorCode ?? ''] ?? messages.errorSummaries.unknown
  }

  const changePage = (page: number) => {
    setDetail(null)
    void refresh(page)
  }

  return (
    <Surface as="section" className="portal-knowledge__ingestion">
      <header className="portal-knowledge__panel-heading">
        <div>
          <h3>{messages.title}</h3>
          <p>{messages.uploadDescription}</p>
        </div>
      </header>
      <form className="portal-knowledge__ingestion-form" onSubmit={submit}>
        <label><span>{messages.sourceTitle}</span><input maxLength={500} name="sourceTitle" required /></label>
        <label><span>{messages.sourceVersion}</span><input maxLength={100} name="sourceVersion" required /></label>
        <label><span>{messages.sourceType}</span><select defaultValue="other" name="sourceType"><option value="faq">{locale === 'zh' ? '常见问答 (FAQ)' : 'FAQ'}</option><option value="product-manual">{locale === 'zh' ? '产品手册' : 'Product manual'}</option><option value="technical-specification">{locale === 'zh' ? '技术规范' : 'Technical specification'}</option><option value="sales-script">{locale === 'zh' ? '销售话术' : 'Sales script'}</option><option value="project-case">{locale === 'zh' ? '项目案例' : 'Project case'}</option><option value="other">{locale === 'zh' ? '其他' : 'Other'}</option></select></label>
        <label><span>{messages.originalLanguage}</span><select defaultValue="auto" name="originalLanguage"><option value="auto">{locale === 'zh' ? '自动识别' : 'Auto'}</option><option value="en">{messages.english}</option><option value="ar">{messages.arabic}</option><option value="zh">中文</option></select></label>
        <label><span>{messages.file}</span><input accept=".docx,.pdf,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" name="file" required type="file" /></label>
        <Button disabled={busy} type="submit">{busy ? messages.processing : messages.submit}</Button>
      </form>
      {feedback ? <p role={feedback.tone === 'danger' ? 'alert' : 'status'}>{feedback.message}</p> : null}
      <div className="portal-knowledge__sources" aria-label={messages.title}>
        {sources.length === 0 ? <p>{messages.noSources}</p> : sources.map((source) => (
          <article key={source.id}>
            <div><strong>{source.sourceTitle}</strong><span><a href={`/api/portal/knowledge/sources/${source.id}/file`} rel="noreferrer" target="_blank">{source.filename}</a> · v{source.sourceVersion} · {source.detectedLanguage?.toUpperCase() ?? '—'} · {fileSizeLabel(source.filesize)} · {stageLabel(source.processingStage)} · {messages.imageCount}: {source.imageCount}</span></div>
            <StatusBadge label={statusLabel(source.processingStatus)} tone={source.processingStatus === 'failed' ? 'danger' : source.processingStatus === 'needs_review' ? 'warning' : source.processingStatus === 'processing' ? 'info' : 'neutral'} />
            <Button onClick={() => void openDetails(source)} size="compact" variant="ghost">{messages.outputDrafts}</Button>
            {errorLabel(source) ? <p role="alert">{errorLabel(source)}</p> : null}
            {source.processingStatus === 'needs_review' ? <span>{messages.outputDrafts}: {messages.english} / {messages.arabic}</span> : null}
            {source.processingStatus === 'failed' && role === 'admin' ? <Button disabled={busy} onClick={() => void retry(source)} size="compact" variant="secondary">{messages.retry}</Button> : null}
            {source.processingStatus === 'failed' && role !== 'admin' ? <small>{messages.adminRetry}</small> : null}
          </article>
        ))}
      </div>
      {pagination.totalDocs > 0 ? (
        <nav aria-label={messages.sourcePagination} className="portal-knowledge__source-pagination">
          <Button
            disabled={pagination.page <= 1}
            onClick={() => changePage(pagination.page - 1)}
            size="compact"
            variant="ghost"
          >
            {messages.previousPage}
          </Button>
          <span aria-live="polite">
            {messages.pageLabel} {pagination.page}/{pagination.totalPages} · {pagination.totalDocs}{' '}
            {messages.sourceCountLabel}
          </span>
          <Button
            disabled={!pagination.hasNextPage || pagination.page >= pagination.totalPages}
            onClick={() => changePage(pagination.page + 1)}
            size="compact"
            variant="ghost"
          >
            {messages.nextPage}
          </Button>
        </nav>
      ) : null}
      {detail ? <div className="portal-knowledge__source-detail">
        <strong>{messages.outputDrafts}</strong>
        <div className="portal-knowledge__source-outputs">
          {detail.data.outputs.length
            ? detail.data.outputs.map((output) => (
                <div key={output.id}>
                  <a
                    href={`/dashboard/knowledge?locale=${output.locale}&q=${encodeURIComponent(output.sourceTitle)}`}
                  >
                    {output.locale === 'ar' ? messages.arabic : messages.english} · {output.reviewStatus}
                  </a>
                  {output.riskTopics.length ? (
                    <span>
                      {messages.riskWarning}:{' '}
                      {output.riskTopics.map((topic) => messages.riskTopics[topic]).join(', ')}
                    </span>
                  ) : null}
                </div>
              ))
            : <span>{messages.noSources}</span>}
        </div>
        {detail.data.assets.length ? <div className="portal-knowledge__source-assets">{detail.data.assets.map((asset) => asset.previewURL ? <img alt={asset.name} key={asset.id} src={asset.previewURL} /> : null)}</div> : null}
      </div> : null}
    </Surface>
  )
}
