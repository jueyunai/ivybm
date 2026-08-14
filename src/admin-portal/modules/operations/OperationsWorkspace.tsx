'use client'

import { useState } from 'react'

import { IconRefresh, IconRotateClockwise } from '@tabler/icons-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

import { usePortalPreferences } from '@/admin-portal/core/navigation/PortalPreferences'
import { Button, PortalState, StatusBadge, Surface } from '@/admin-portal/core/ui'

import type { SafeJobPageData, SafeJobQuery, SafeJobSummary } from './getSafeJobPage'

const messages = {
  en: {
    all: 'All states',
    attempts: 'Attempts',
    cancel: 'Cancel',
    empty: 'No jobs match this view.',
    error: 'The operation could not be completed.',
    failed: 'Failed',
    filter: 'Filter',
    forbidden: 'Only administrators can view job operations.',
    nextRun: 'Next run',
    noRetry: 'No automated retry is registered for this job.',
    pending: 'Pending',
    processing: 'Processing',
    refresh: 'Refresh',
    retry: 'Retry safely',
    retryConfirm: 'Confirm retry',
    retryHelp: 'This action follows the registered compensation rule and rechecks current state.',
    success: 'The safe retry was accepted.',
    succeeded: 'Succeeded',
    title: 'Exceptions & compensation',
    unavailable: 'The operations queue could not be loaded.',
    updated: 'Updated',
  },
  zh: {
    all: '全部状态',
    attempts: '尝试次数',
    cancel: '取消',
    empty: '当前筛选没有任务。',
    error: '本次操作未能完成。',
    failed: '失败',
    filter: '筛选',
    forbidden: '只有管理员可以查看任务异常。',
    nextRun: '下次执行',
    noRetry: '该任务没有注册可自动执行的安全重试。',
    pending: '待执行',
    processing: '执行中',
    refresh: '刷新',
    retry: '安全重试',
    retryConfirm: '确认重试',
    retryHelp: '此操作只调用已注册的补偿规则，并会重新校验当前状态。',
    success: '安全重试已受理。',
    succeeded: '成功',
    title: '异常与补偿',
    unavailable: '异常任务暂时无法读取。',
    updated: '更新时间',
  },
} as const

type OperationsCopy = (typeof messages)[keyof typeof messages]

const statusTone = (status: SafeJobSummary['status']) =>
  status === 'succeeded'
    ? 'success' as const
    : status === 'failed' || status === 'dead'
      ? 'danger' as const
      : status === 'processing'
        ? 'info' as const
        : 'warning' as const

const labelForStatus = (status: SafeJobSummary['status'], copy: OperationsCopy): string =>
  status === 'succeeded' ? copy.succeeded : status === 'processing' ? copy.processing : status === 'pending' ? copy.pending : copy.failed

const hrefFor = (query: SafeJobQuery, status: string) => {
  const params = new URLSearchParams()
  if (status !== 'all') params.set('status', status)
  if (query.page > 1) params.set('page', String(query.page))
  return `/dashboard/operations?${params}`
}

function JobCard({ copy, item, onDone }: { copy: OperationsCopy; item: SafeJobSummary; onDone: () => void }) {
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const retry = async () => {
    setBusy(true)
    setError(null)
    try {
      const response = await fetch(`/api/portal/operations/jobs/${item.id}/retry`, {
        body: JSON.stringify({ updatedAt: item.updatedAt }),
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      })
      const payload = await response.json() as { error?: { message?: string } }
      if (!response.ok) throw new Error(payload.error?.message || copy.error)
      onDone()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : copy.error)
      setConfirm(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <article className="portal-operations__job">
      <header>
        <div><p>{item.type}</p><h3>{item.reference}</h3></div>
        <StatusBadge label={labelForStatus(item.status, copy)} tone={statusTone(item.status)} />
      </header>
      <dl>
        <div><dt>{copy.attempts}</dt><dd>{item.attempts} / {item.maxAttempts}</dd></div>
        <div><dt>{copy.nextRun}</dt><dd>{item.nextRunAt ? new Date(item.nextRunAt).toLocaleString() : '—'}</dd></div>
        <div><dt>{copy.updated}</dt><dd>{new Date(item.updatedAt).toLocaleString()}</dd></div>
      </dl>
      {item.lastErrorSummary ? <p className="portal-operations__error-summary">{item.lastErrorSummary}</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      {item.compensation ? (
        <footer>
          {confirm ? <><p>{copy.retryHelp}</p><Button disabled={busy} onClick={() => void retry()} size="compact"><IconRotateClockwise aria-hidden="true" size={15} />{copy.retryConfirm}</Button><Button disabled={busy} onClick={() => setConfirm(false)} size="compact" variant="ghost">{copy.cancel}</Button></> : <Button disabled={busy} onClick={() => setConfirm(true)} size="compact" variant="secondary"><IconRotateClockwise aria-hidden="true" size={15} />{copy.retry}</Button>}
        </footer>
      ) : <small>{copy.noRetry}</small>}
    </article>
  )
}

export function OperationsWorkspace({ pageState, summary }: { pageState: SafeJobPageData['state'] | 'read-failed'; summary: SafeJobPageData['summary'] }) {
  const router = useRouter()
  const { locale } = usePortalPreferences()
  const copy = messages[locale]
  const [feedback, setFeedback] = useState<string | null>(null)

  if (pageState !== 'available' || !summary) {
    const type = pageState === 'forbidden' ? 'forbidden' : pageState === 'read-failed' ? 'error' : 'blocked'
    const description = pageState === 'forbidden' ? copy.forbidden : pageState === 'read-failed' ? copy.unavailable : copy.unavailable
    return <main className="portal-page portal-operations"><PortalState description={description} title={copy.title} type={type} /></main>
  }

  const onDone = () => { setFeedback(copy.success); router.refresh() }

  return (
    <main className="portal-page portal-operations">
      <header className="portal-page__intro portal-operations__intro">
        <div><h2>{copy.title}</h2><p>{copy.retryHelp}</p></div>
        <Button onClick={() => router.refresh()} variant="secondary"><IconRefresh aria-hidden="true" size={16} />{copy.refresh}</Button>
      </header>
      {feedback ? <p className="portal-operations__feedback" role="status">{feedback}</p> : null}
      <Surface as="section" className="portal-operations__filters">
        <form action="/dashboard/operations" method="get"><label><span>{copy.filter}</span><select defaultValue={summary.query.status} name="status"><option value="all">{copy.all}</option><option value="pending">{copy.pending}</option><option value="processing">{copy.processing}</option><option value="succeeded">{copy.succeeded}</option><option value="failed">{copy.failed}</option><option value="dead">{copy.failed}</option></select></label><Button type="submit">{copy.filter}</Button></form>
      </Surface>
      {summary.items.length ? <section className="portal-operations__grid">{summary.items.map((item) => <JobCard copy={copy} item={item} key={item.id} onDone={onDone} />)}</section> : <Surface as="section"><PortalState description={copy.empty} title={copy.empty} type="empty" /></Surface>}
      {summary.pagination.totalPages > 1 ? <nav className="portal-operations__pagination"><Button asChild disabled={summary.pagination.page <= 1} size="compact" variant="secondary"><Link href={hrefFor({ ...summary.query, page: summary.pagination.page - 1 }, summary.query.status)}>‹</Link></Button><span>{summary.pagination.page} / {summary.pagination.totalPages}</span><Button asChild disabled={summary.pagination.page >= summary.pagination.totalPages} size="compact" variant="secondary"><Link href={hrefFor({ ...summary.query, page: summary.pagination.page + 1 }, summary.query.status)}>›</Link></Button></nav> : null}
    </main>
  )
}
