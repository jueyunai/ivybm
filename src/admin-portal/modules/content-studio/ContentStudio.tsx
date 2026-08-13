'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  IconArrowLeft,
  IconArrowRight,
  IconCalendar,
  IconChecks,
  IconFileDownload,
  IconPlus,
  IconRefresh,
  IconSend,
  IconSparkles,
  IconTrash,
} from '@tabler/icons-react'

import { usePortalCommandKey } from '@/admin-portal/core/commands/usePortalCommandKey'
import { usePortalPreferences } from '@/admin-portal/core/navigation/PortalPreferences'
import { Button, PortalState, StatusBadge, Surface } from '@/admin-portal/core/ui'

import type {
  ContentStudioItem,
  ContentStudioPageData,
  ContentStudioQuery,
  ContentStudioSourceReference,
  ContentStudioSummary,
} from './getContentStudioPage'
import { formatScheduledAt } from './formatScheduledAt'
import { getContentStudioMessages } from './messages'

export function ContentStudio({
  pageState,
  summary,
}: {
  pageState: ContentStudioPageData['state'] | 'read-failed'
  summary: ContentStudioSummary | null
}) {
  const { locale } = usePortalPreferences()
  const copy = getContentStudioMessages(locale)
  const router = useRouter()
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [editor, setEditor] = useState<'create' | 'edit' | null>(null)
  const [generator, setGenerator] = useState(false)
  const [reviewing, setReviewing] = useState(false)
  const [publishingNow, setPublishingNow] = useState(false)
  const [scheduling, setScheduling] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [isRefreshing, startRefresh] = useTransition()
  const hasActivePublication =
    summary?.items.some((item) =>
      item.publishJobs.some(
        (job) =>
          job.mode === 'automatic' &&
          (job.status === 'scheduled' || job.status === 'accepted' || job.status === 'publishing'),
      ),
    ) ?? false

  useEffect(() => {
    if (!hasActivePublication) return
    let refreshCount = 0
    const interval = window.setInterval(() => {
      refreshCount += 1
      startRefresh(() => router.refresh())
      if (refreshCount >= 15) window.clearInterval(interval)
    }, 2_000)
    return () => window.clearInterval(interval)
  }, [hasActivePublication, router])

  if (pageState !== 'available' || !summary)
    return (
      <main className="portal-page portal-content-studio">
        <PortalState
          description={copy.unavailable}
          title={copy.unavailable}
          type={
            pageState === 'forbidden'
              ? 'forbidden'
              : pageState === 'read-failed'
                ? 'error'
                : 'blocked'
          }
        />
      </main>
    )
  const selected = summary.items.find((item) => item.id === selectedId) ?? summary.items[0] ?? null
  const refreshPublicationResults = () => startRefresh(() => router.refresh())
  const onDone = (message: string) => {
    setEditor(null)
    setGenerator(false)
    setReviewing(false)
    setPublishingNow(false)
    setScheduling(false)
    setFeedback(message)
    startRefresh(() => router.refresh())
  }

  return (
    <main className="portal-page portal-content-studio">
      <header className="portal-page__intro portal-content-studio__intro">
        <div>
          <p className="portal-page__eyebrow">CONTENT / AI STUDIO</p>
          <h2>{copy.title}</h2>
          <p>{summary.publishingEnabled ? copy.automaticNotice : copy.publishingUnavailable}</p>
        </div>
        <div className="portal-content-studio__intro-actions">
          <Button
            onClick={() => {
              setGenerator(true)
              setFeedback(null)
            }}
            variant="secondary"
          >
            <IconSparkles aria-hidden="true" size={16} />
            {copy.generate}
          </Button>
          <Button
            onClick={() => {
              setEditor('create')
              setFeedback(null)
            }}
          >
            <IconPlus aria-hidden="true" size={16} />
            {copy.add}
          </Button>
        </div>
      </header>
      {feedback ? (
        <p className="portal-content-studio__feedback" role="status">
          {feedback}
        </p>
      ) : null}
      <Surface as="section" className="portal-content-studio__filters">
        <form action="/dashboard/content-studio" method="get">
          <label>
            <span>{copy.titleField}</span>
            <input defaultValue={summary.query.q} name="q" type="search" />
          </label>
          <label>
            <span>{copy.status}</span>
            <select defaultValue={summary.query.status} name="status">
              <option value="all">{copy.status}</option>
              {(['draft', 'review', 'approved'] as const).map((status) => (
                <option key={status} value={status}>
                  {copy.statusLabels[status]}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>{copy.platform}</span>
            <select defaultValue={summary.query.platform} name="platform">
              <option value="all">{copy.platform}</option>
              {(['facebook', 'instagram', 'linkedin'] as const).map((platform) => (
                <option key={platform} value={platform}>
                  {copy.platformLabels[platform]}
                </option>
              ))}
            </select>
          </label>
          <Button type="submit">{copy.filter}</Button>
        </form>
      </Surface>
      {generator ? (
        <Surface as="section" className="portal-content-studio__editor">
          <GenerateDraftEditor
            copy={copy}
            options={summary.options}
            onClose={() => setGenerator(false)}
            onDone={onDone}
          />
        </Surface>
      ) : null}
      {editor ? (
        <Surface as="section" className="portal-content-studio__editor">
          <DraftEditor
            key={`${editor}:${editor === 'edit' ? String(selected?.id ?? 'none') : 'new'}`}
            copy={copy}
            item={editor === 'edit' ? selected : null}
            options={summary.options}
            onClose={() => setEditor(null)}
            onDone={onDone}
          />
        </Surface>
      ) : null}
      {reviewing && selected ? (
        <Surface as="section" className="portal-content-studio__editor">
          <ReviewEditor
            copy={copy}
            item={selected}
            onClose={() => setReviewing(false)}
            onDone={onDone}
          />
        </Surface>
      ) : null}
      {scheduling && selected ? (
        <Surface as="section" className="portal-content-studio__editor">
          <ScheduleEditor
            copy={copy}
            item={selected}
            onClose={() => setScheduling(false)}
            onDone={onDone}
          />
        </Surface>
      ) : null}
      {publishingNow && selected ? (
        <Surface as="section" className="portal-content-studio__editor">
          <PublishNowEditor
            copy={copy}
            item={selected}
            onClose={() => setPublishingNow(false)}
            onDone={onDone}
            options={summary.options.platformAccounts}
          />
        </Surface>
      ) : null}
      <div className="portal-content-studio__workspace">
        <Surface as="section" className="portal-content-studio__list">
          <header>
            <h3>{copy.title}</h3>
            <span>
              {summary.pagination.totalDocs} {copy.total}
            </span>
          </header>
          {summary.items.length ? (
            <ul>
              {summary.items.map((item) => (
                <li key={item.id}>
                  <button
                    aria-pressed={selected?.id === item.id}
                    className={selected?.id === item.id ? 'is-selected' : undefined}
                    onClick={() => {
                      setSelectedId(item.id)
                      setFeedback(null)
                    }}
                    type="button"
                  >
                    <strong>{item.title}</strong>
                    <span>
                      {copy.platformLabels[item.platform]} · {item.contentLocale.toUpperCase()}
                    </span>
                    <StatusBadge label={copy.statusLabels[item.status]} tone={tone(item.status)} />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <PortalState description={copy.empty} title={copy.empty} type="empty" />
          )}
          {summary.pagination.totalPages > 1 ? (
            <Pagination
              copy={copy}
              query={summary.query}
              page={summary.pagination.page}
              totalPages={summary.pagination.totalPages}
            />
          ) : null}
        </Surface>
        <Surface as="section" className="portal-content-studio__detail">
          {selected ? (
            <ContentDetail
              copy={copy}
              disabled={isRefreshing}
              item={selected}
              onDelete={() => onDone(copy.feedback)}
              onEdit={() => setEditor('edit')}
              onReview={() => setReviewing(true)}
              onPublish={() => setPublishingNow(true)}
              onRefresh={refreshPublicationResults}
              publishingAvailable={
                summary.publishingEnabled && summary.options.platformAccounts.length > 0
              }
              onSchedule={() => setScheduling(true)}
              onSubmitToReview={() => onDone(copy.readyForReview)}
            />
          ) : (
            <PortalState description={copy.empty} title={copy.empty} type="empty" />
          )}
        </Surface>
      </div>
    </main>
  )
}

type Copy = ReturnType<typeof getContentStudioMessages>

const tone = (status: ContentStudioItem['status']): 'info' | 'neutral' | 'success' | 'warning' =>
  status === 'approved' ? 'success' : status === 'review' ? 'info' : 'warning'
const request = async (
  url: string,
  method: 'DELETE' | 'PATCH' | 'POST',
  body: Record<string, unknown>,
  onResponse?: () => void,
) => {
  const response = await fetch(url, {
    body: JSON.stringify(body),
    credentials: 'same-origin',
    headers: {
      'content-type': 'application/json',
      'Idempotency-Key':
        typeof body.idempotencyKey === 'string'
          ? body.idempotencyKey
          : `portal-content-studio:${crypto.randomUUID()}`,
    },
    method,
  })
  const data = (await response.json()) as { error?: { message?: string } }
  onResponse?.()
  if (!response.ok) throw new Error(data.error?.message || 'Request failed')
  return data
}
const href = (query: ContentStudioQuery, page: number) => {
  const params = new URLSearchParams()
  if (query.q) params.set('q', query.q)
  if (query.status !== 'all') params.set('status', query.status)
  if (query.platform !== 'all') params.set('platform', query.platform)
  if (page > 1) params.set('page', String(page))
  return `/dashboard/content-studio?${params}`
}

function Pagination({
  copy,
  page,
  query,
  totalPages,
}: {
  copy: Copy
  page: number
  query: ContentStudioQuery
  totalPages: number
}) {
  return (
    <nav className="portal-content-studio__pagination">
      <Button asChild disabled={page <= 1} size="compact" variant="secondary">
        <Link href={href(query, page - 1)}>
          <IconArrowLeft aria-hidden="true" size={15} />
          {copy.previous}
        </Link>
      </Button>
      <span>
        {page} / {totalPages}
      </span>
      <Button asChild disabled={page >= totalPages} size="compact" variant="secondary">
        <Link href={href(query, page + 1)}>
          {copy.next}
          <IconArrowRight aria-hidden="true" size={15} />
        </Link>
      </Button>
    </nav>
  )
}

function ContentDetail({
  copy,
  disabled,
  item,
  onDelete,
  onEdit,
  onReview,
  onPublish,
  onRefresh,
  publishingAvailable,
  onSchedule,
  onSubmitToReview,
}: {
  copy: Copy
  disabled: boolean
  item: ContentStudioItem
  onDelete: () => void
  onEdit: () => void
  onReview: () => void
  onPublish: () => void
  onRefresh: () => void
  publishingAvailable: boolean
  onSchedule: () => void
  onSubmitToReview: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const canDelete =
    item.status === 'draft' && item.publishJobs.length === 0 && item.reviews.length === 0
  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      await request(`/api/portal/content-studio/${item.id}`, 'POST', {
        action: 'submit-review',
        updatedAt: item.updatedAt,
      })
      onSubmitToReview()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : copy.unknown)
    } finally {
      setBusy(false)
    }
  }
  const remove = async () => {
    setBusy(true)
    setError(null)
    try {
      await request(`/api/portal/content-studio/${item.id}`, 'DELETE', {
        updatedAt: item.updatedAt,
      })
      onDelete()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : copy.unknown)
    } finally {
      setBusy(false)
    }
  }
  const downloadPackage = async () => {
    setBusy(true)
    setError(null)
    try {
      const response = await fetch(`/api/portal/content-studio/${item.id}/linkedin-package`, {
        credentials: 'same-origin',
      })
      if (!response.ok) {
        const data = (await response.json()) as { error?: { message?: string } }
        throw new Error(data.error?.message || copy.unknown)
      }
      const blob = await response.blob()
      const anchor = document.createElement('a')
      anchor.href = URL.createObjectURL(blob)
      anchor.download = 'linkedin-assisted-post.zip'
      anchor.click()
      URL.revokeObjectURL(anchor.href)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : copy.unknown)
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      {error ? <p role="alert">{error}</p> : null}
      <header className="portal-content-studio__detail-heading">
        <div>
          <p>{copy.workflow}</p>
          <h3>{item.title}</h3>
          <span>
            {copy.platformLabels[item.platform]} · {copy.typeLabels[item.contentType]} ·{' '}
            {item.contentLocale.toUpperCase()}
          </span>
        </div>
        <StatusBadge label={copy.statusLabels[item.status]} tone={tone(item.status)} />
      </header>
      <section className="portal-content-studio__copy">
        <h4>{copy.body}</h4>
        <pre dir={item.contentLocale === 'ar' ? 'rtl' : undefined}>{item.body}</pre>
      </section>
      <section>
        <h4>{copy.facts}</h4>
        {item.sourceReferences.length ? (
          <ul className="portal-content-studio__sources">
            {item.sourceReferences.map((source, index) => (
              <li key={`${source.claim}:${index}`}>
                <strong>{source.claim}</strong>
                <span>{source.source}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p>{copy.noSources}</p>
        )}
      </section>
      <section className="portal-content-studio__relations">
        <div>
          <h4>{copy.assets}</h4>
          <p>{item.assets.map((asset) => asset.label).join(', ') || '—'}</p>
        </div>
        <div>
          <h4>{copy.knowledge}</h4>
          <p>{item.knowledgeSources.map((source) => source.label).join(', ') || '—'}</p>
        </div>
      </section>
      <section>
        <h4>{copy.review}</h4>
        {item.reviews.length ? (
          <ul className="portal-content-studio__timeline">
            {item.reviews.map((review) => (
              <li key={review.id}>
                <StatusBadge
                  label={review.decision === 'approved' ? copy.approved : copy.revised}
                  tone={review.decision === 'approved' ? 'success' : 'warning'}
                />
                <span>{review.comments || '—'}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p>—</p>
        )}
      </section>
      <section>
        <div className="portal-content-studio__section-heading">
          <h4>{copy.schedule}</h4>
          <Button disabled={disabled} onClick={onRefresh} size="compact" variant="ghost">
            <IconRefresh aria-hidden="true" size={15} />
            {copy.refreshPublicationResults}
          </Button>
        </div>
        {item.publishJobs.length ? (
          <ul className="portal-content-studio__timeline">
            {item.publishJobs.map((job) => (
              <li key={job.id}>
                <StatusBadge
                  label={copy.statusLabels[job.status]}
                  tone={
                    job.status === 'published'
                      ? 'success'
                      : job.status === 'failed'
                        ? 'danger'
                        : job.status === 'delivery_unknown'
                          ? 'warning'
                          : 'info'
                  }
                />
                <span>{formatScheduledAt(job.scheduledFor)}</span>
                <small>
                  {copy.platformLabels[job.platform]} · {copy.modeLabels[job.mode]}
                </small>
                {job.externalPublicationUrl ? (
                  <a href={job.externalPublicationUrl} rel="noreferrer" target="_blank">
                    {job.externalPublicationId ?? job.externalPublicationUrl}
                  </a>
                ) : job.externalPublicationId ? (
                  <code>{job.externalPublicationId}</code>
                ) : null}
                {job.lastErrorSummary ? <small>{job.lastErrorSummary}</small> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p>—</p>
        )}
      </section>
      <footer className="portal-content-studio__detail-actions">
        {item.status === 'draft' ? (
          <>
            <Button disabled={busy || disabled} onClick={onEdit} size="compact" variant="secondary">
              {copy.edit}
            </Button>
            <Button
              disabled={busy || disabled || item.sourceReferences.length === 0}
              onClick={() => void submit()}
              size="compact"
            >
              <IconSend aria-hidden="true" size={15} />
              {copy.sendReview}
            </Button>
          </>
        ) : null}
        {item.status === 'review' ? (
          <Button disabled={busy || disabled} onClick={onReview} size="compact">
            <IconChecks aria-hidden="true" size={15} />
            {copy.review}
          </Button>
        ) : null}
        {item.status === 'approved' ? (
          <>
            <Button
              disabled={busy || disabled || !publishingAvailable}
              onClick={onPublish}
              size="compact"
              title={!publishingAvailable ? copy.publishingUnavailable : undefined}
            >
              <IconSend aria-hidden="true" size={15} />
              {copy.immediatePublish}
            </Button>
            <Button disabled={busy || disabled} onClick={onSchedule} size="compact">
              <IconCalendar aria-hidden="true" size={15} />
              {copy.schedule}
            </Button>
            {item.platform === 'linkedin' ? (
              <Button
                disabled={busy || disabled}
                onClick={() => void downloadPackage()}
                size="compact"
                variant="secondary"
              >
                <IconFileDownload aria-hidden="true" size={15} />
                {copy.downloadPackage}
              </Button>
            ) : null}
          </>
        ) : null}
        {canDelete ? (
          confirmDelete ? (
            <>
              <Button
                disabled={busy || disabled}
                onClick={() => void remove()}
                size="compact"
                variant="danger"
              >
                {copy.deleteConfirm}
              </Button>
              <Button
                disabled={busy || disabled}
                onClick={() => setConfirmDelete(false)}
                size="compact"
                variant="ghost"
              >
                {copy.cancel}
              </Button>
            </>
          ) : (
            <Button
              disabled={busy || disabled}
              onClick={() => setConfirmDelete(true)}
              size="compact"
              variant="ghost"
            >
              <IconTrash aria-hidden="true" size={15} />
              {copy.delete}
            </Button>
          )
        ) : null}
      </footer>
    </>
  )
}

function DraftEditor({
  copy,
  item,
  onClose,
  onDone,
  options,
}: {
  copy: Copy
  item: ContentStudioItem | null
  onClose: () => void
  onDone: (message: string) => void
  options: ContentStudioSummary['options']
}) {
  const initial = useMemo(
    () => ({
      assets: item?.assets.map((asset) => String(asset.id)) ?? [],
      body: item?.body ?? '',
      contentLocale: item?.contentLocale ?? 'en',
      contentType: item?.contentType ?? 'post',
      knowledgeSources: item?.knowledgeSources.map((source) => String(source.id)) ?? [],
      platform: item?.platform ?? 'linkedin',
      sourceReferences: item?.sourceReferences ?? [],
      title: item?.title ?? '',
    }),
    [item],
  )
  const createCommand = usePortalCommandKey('portal-content-studio')
  const [form, setForm] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const update = <Key extends keyof typeof form>(key: Key, value: (typeof form)[Key]) =>
    setForm((current) => ({ ...current, [key]: value }))
  const toggle = (key: 'assets' | 'knowledgeSources', value: string) =>
    update(
      key,
      form[key].includes(value) ? form[key].filter((id) => id !== value) : [...form[key], value],
    )
  const save = async () => {
    setBusy(true)
    setError(null)
    try {
      const body = {
        ...form,
        ...(item ? { updatedAt: item.updatedAt } : {}),
      }
      const createKey = item ? null : createCommand.key(JSON.stringify(body))
      await request(
        item ? `/api/portal/content-studio/${item.id}` : '/api/portal/content-studio',
        item ? 'PATCH' : 'POST',
        createKey ? { ...body, idempotencyKey: createKey } : body,
        createKey ? () => createCommand.receivedResponse(createKey) : undefined,
      )
      onDone(copy.feedback)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : copy.unknown)
    } finally {
      setBusy(false)
    }
  }
  const selectedSources = options.knowledgeSources
    .filter((option) => form.knowledgeSources.includes(String(option.id)))
    .flatMap((option) => (option.reference ? [option.reference] : []))
  return (
    <div className="portal-content-studio__form">
      <header>
        <div>
          <IconSparkles aria-hidden="true" size={18} />
          <h3>{item ? copy.edit : copy.add}</h3>
        </div>
        <Button onClick={onClose} size="compact" variant="ghost">
          {copy.cancel}
        </Button>
      </header>
      {error ? <p role="alert">{error}</p> : null}
      <div className="portal-content-studio__form-grid">
        <Field label={copy.titleField}>
          <input
            maxLength={180}
            onChange={(event) => update('title', event.target.value)}
            value={form.title}
          />
        </Field>
        <Field label={copy.platform}>
          <select
            onChange={(event) => update('platform', event.target.value as typeof form.platform)}
            value={form.platform}
          >
            {(['facebook', 'instagram', 'linkedin'] as const).map((platform) => (
              <option key={platform} value={platform}>
                {copy.platformLabels[platform]}
              </option>
            ))}
          </select>
        </Field>
        <Field label={copy.locale}>
          <select
            onChange={(event) =>
              update('contentLocale', event.target.value as typeof form.contentLocale)
            }
            value={form.contentLocale}
          >
            <option value="en">EN</option>
            <option value="ar">AR</option>
          </select>
        </Field>
        <Field label={copy.type}>
          <select
            onChange={(event) =>
              update('contentType', event.target.value as typeof form.contentType)
            }
            value={form.contentType}
          >
            {(['post', 'carousel', 'long-form'] as const).map((type) => (
              <option key={type} value={type}>
                {copy.typeLabels[type]}
              </option>
            ))}
          </select>
        </Field>
        <Field label={copy.body} wide>
          <textarea
            dir={form.contentLocale === 'ar' ? 'rtl' : undefined}
            maxLength={30_000}
            onChange={(event) => update('body', event.target.value)}
            rows={10}
            value={form.body}
          />
        </Field>
        <Field label={copy.assets} wide>
          <MultiOptions
            options={options.assets}
            selected={form.assets}
            toggle={(value) => toggle('assets', value)}
          />
        </Field>
        <Field label={copy.knowledge} wide>
          <MultiOptions
            options={options.knowledgeSources}
            selected={form.knowledgeSources}
            toggle={(value) => toggle('knowledgeSources', value)}
          />
        </Field>
      </div>
      <FactEditor
        copy={copy}
        sources={selectedSources}
        value={form.sourceReferences}
        onChange={(sourceReferences) => update('sourceReferences', sourceReferences)}
      />
      <footer>
        <Button disabled={busy} onClick={() => void save()}>
          {item ? copy.save : copy.create}
        </Button>
      </footer>
    </div>
  )
}

function GenerateDraftEditor({
  copy,
  onClose,
  onDone,
  options,
}: {
  copy: Copy
  onClose: () => void
  onDone: (message: string) => void
  options: ContentStudioSummary['options']
}) {
  const command = usePortalCommandKey('portal-content-studio:generate')
  const [form, setForm] = useState({
    assets: [] as string[],
    brief: '',
    contentLocale: 'en' as 'ar' | 'en',
    contentType: 'post' as ContentStudioItem['contentType'],
    knowledgeSources: [] as string[],
    platform: 'linkedin' as ContentStudioItem['platform'],
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const update = <Key extends keyof typeof form>(key: Key, value: (typeof form)[Key]) =>
    setForm((current) => ({ ...current, [key]: value }))
  const toggle = (key: 'assets' | 'knowledgeSources', value: string) =>
    update(
      key,
      form[key].includes(value) ? form[key].filter((id) => id !== value) : [...form[key], value],
    )
  const generate = async () => {
    setBusy(true)
    setError(null)
    try {
      const idempotencyKey = command.key(JSON.stringify(form))
      await request(
        '/api/portal/content-studio/generate',
        'POST',
        { ...form, idempotencyKey },
        () => command.receivedResponse(idempotencyKey),
      )
      onDone(copy.generationComplete)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : copy.unknown)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="portal-content-studio__form">
      <header>
        <div>
          <IconSparkles aria-hidden="true" size={18} />
          <h3>{copy.generate}</h3>
        </div>
        <Button onClick={onClose} size="compact" variant="ghost">
          {copy.cancel}
        </Button>
      </header>
      {error ? <p role="alert">{error}</p> : null}
      <p className="portal-content-studio__generation-note">{copy.generationDescription}</p>
      <div className="portal-content-studio__form-grid">
        <Field label={copy.brief} wide>
          <textarea
            maxLength={2000}
            onChange={(event) => update('brief', event.target.value)}
            rows={5}
            value={form.brief}
          />
        </Field>
        <Field label={copy.platform}>
          <select
            onChange={(event) => update('platform', event.target.value as typeof form.platform)}
            value={form.platform}
          >
            {(['facebook', 'instagram', 'linkedin'] as const).map((platform) => (
              <option key={platform} value={platform}>
                {copy.platformLabels[platform]}
              </option>
            ))}
          </select>
        </Field>
        <Field label={copy.locale}>
          <select
            onChange={(event) =>
              update('contentLocale', event.target.value as typeof form.contentLocale)
            }
            value={form.contentLocale}
          >
            <option value="en">EN</option>
            <option value="ar">AR</option>
          </select>
        </Field>
        <Field label={copy.type}>
          <select
            onChange={(event) =>
              update('contentType', event.target.value as typeof form.contentType)
            }
            value={form.contentType}
          >
            {(['post', 'carousel', 'long-form'] as const).map((type) => (
              <option key={type} value={type}>
                {copy.typeLabels[type]}
              </option>
            ))}
          </select>
        </Field>
        <Field label={copy.knowledge} wide>
          <MultiOptions
            options={options.knowledgeSources}
            selected={form.knowledgeSources}
            toggle={(value) => toggle('knowledgeSources', value)}
          />
        </Field>
        <Field label={copy.assets} wide>
          <MultiOptions
            options={options.assets}
            selected={form.assets}
            toggle={(value) => toggle('assets', value)}
          />
        </Field>
      </div>
      <footer>
        <Button
          disabled={busy || !form.brief.trim() || !form.knowledgeSources.length}
          onClick={() => void generate()}
        >
          <IconSparkles aria-hidden="true" size={16} />
          {copy.generate}
        </Button>
      </footer>
    </div>
  )
}

function ReviewEditor({
  copy,
  item,
  onClose,
  onDone,
}: {
  copy: Copy
  item: ContentStudioItem
  onClose: () => void
  onDone: (message: string) => void
}) {
  const keys = Object.keys(copy.reviewChecks) as Array<keyof typeof copy.reviewChecks>
  const [checklist, setChecklist] = useState<Record<string, boolean>>({})
  const [comments, setComments] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const decide = async (decision: 'approved' | 'revision-requested') => {
    setBusy(true)
    setError(null)
    try {
      await request(`/api/portal/content-studio/${item.id}`, 'POST', {
        action: 'review',
        checklist,
        comments,
        decision,
        updatedAt: item.updatedAt,
      })
      onDone(decision === 'approved' ? copy.reviewComplete : copy.revised)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : copy.unknown)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="portal-content-studio__form">
      <header>
        <h3>{copy.reviewChecklist}</h3>
        <Button onClick={onClose} size="compact" variant="ghost">
          {copy.cancel}
        </Button>
      </header>
      {error ? <p role="alert">{error}</p> : null}
      <div className="portal-content-studio__checklist">
        {keys.map((key) => (
          <label key={key}>
            <input
              checked={checklist[key] ?? false}
              onChange={(event) =>
                setChecklist((current) => ({ ...current, [key]: event.target.checked }))
              }
              type="checkbox"
            />
            {copy.reviewChecks[key]}
          </label>
        ))}
      </div>
      <Field label={copy.reviewComments}>
        <textarea
          maxLength={5000}
          onChange={(event) => setComments(event.target.value)}
          rows={5}
          value={comments}
        />
      </Field>
      <footer>
        <Button
          disabled={busy || !keys.every((key) => checklist[key])}
          onClick={() => void decide('approved')}
        >
          {copy.approve}
        </Button>
        <Button
          disabled={busy}
          onClick={() => void decide('revision-requested')}
          variant="secondary"
        >
          {copy.revised}
        </Button>
      </footer>
    </div>
  )
}

export function ScheduleEditor({
  copy,
  item,
  onClose,
  onDone,
}: {
  copy: Copy
  item: ContentStudioItem
  onClose: () => void
  onDone: (message: string) => void
}) {
  const mode = 'assisted'
  const command = usePortalCommandKey('portal-content-studio:schedule')
  const [scheduledFor, setScheduledFor] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const schedule = async () => {
    setBusy(true)
    setError(null)
    try {
      const body = {
        action: 'schedule',
        mode,
        platform: item.platform,
        scheduledFor: new Date(scheduledFor).toISOString(),
        updatedAt: item.updatedAt,
      }
      const idempotencyKey = command.key(JSON.stringify(body))
      await request(
        `/api/portal/content-studio/${item.id}`,
        'POST',
        { ...body, idempotencyKey },
        () => command.receivedResponse(idempotencyKey),
      )
      onDone(copy.scheduled)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : copy.unknown)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="portal-content-studio__form">
      <header>
        <h3>{copy.schedule}</h3>
        <Button onClick={onClose} size="compact" variant="ghost">
          {copy.cancel}
        </Button>
      </header>
      {error ? <p role="alert">{error}</p> : null}
      <p>{copy.assistedNotice}</p>
      <div className="portal-content-studio__form-grid">
        <Field label={copy.scheduleAt}>
          <input
            onChange={(event) => setScheduledFor(event.target.value)}
            required
            type="datetime-local"
            value={scheduledFor}
          />
        </Field>
        <Field label={copy.mode}>
          <input disabled value={copy.modeLabels.assisted} />
        </Field>
      </div>
      <footer>
        <Button disabled={busy || !scheduledFor} onClick={() => void schedule()}>
          {copy.schedule}
        </Button>
      </footer>
    </div>
  )
}

export function PublishNowEditor({
  copy,
  item,
  onClose,
  onDone,
  options,
}: {
  copy: Copy
  item: ContentStudioItem
  onClose: () => void
  onDone: (message: string) => void
  options: ContentStudioSummary['options']['platformAccounts']
}) {
  const command = usePortalCommandKey('portal-content-studio:publish-now')
  const [selected, setSelected] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const publish = async () => {
    setBusy(true)
    setError(null)
    try {
      const body = {
        action: 'publish-now',
        targetAccountIds: selected.map(Number),
        updatedAt: item.updatedAt,
      }
      const idempotencyKey = command.key(JSON.stringify(body))
      await request(
        `/api/portal/content-studio/${item.id}`,
        'POST',
        { ...body, idempotencyKey },
        () => command.receivedResponse(idempotencyKey),
      )
      onDone(copy.publishQueued)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : copy.unknown)
    } finally {
      setBusy(false)
    }
  }
  const selectedPlatforms = new Set(
    options.filter(({ id }) => selected.includes(String(id))).map(({ platform }) => platform),
  )
  return (
    <div className="portal-content-studio__form">
      <header>
        <h3>{copy.immediatePublish}</h3>
        <Button onClick={onClose} size="compact" variant="ghost">
          {copy.cancel}
        </Button>
      </header>
      {error ? <p role="alert">{error}</p> : null}
      <p>{copy.immediatePublishNotice}</p>
      <fieldset className="portal-content-studio__choice-field is-wide">
        <legend>{copy.publishingAccounts}</legend>
        {options.length ? (
          <div className="portal-content-studio__multi-options">
            {options.map((option) => {
              const value = String(option.id)
              const checked = selected.includes(value)
              const disabled = !checked && selectedPlatforms.has(option.platform)
              return (
                <label key={option.id}>
                  <input
                    checked={checked}
                    disabled={disabled}
                    onChange={() =>
                      setSelected((current) =>
                        current.includes(value)
                          ? current.filter((entry) => entry !== value)
                          : [...current, value],
                      )
                    }
                    type="checkbox"
                  />
                  <span>{option.label}</span>
                  <small>{copy.platformLabels[option.platform]}</small>
                </label>
              )
            })}
          </div>
        ) : (
          <span>{copy.noPublishingAccounts}</span>
        )}
      </fieldset>
      <footer>
        <Button disabled={busy || selected.length === 0} onClick={() => void publish()}>
          {copy.immediatePublish}
        </Button>
      </footer>
    </div>
  )
}

function FactEditor({
  copy,
  onChange,
  sources,
  value,
}: {
  copy: Copy
  onChange: (value: ContentStudioSourceReference[]) => void
  sources: string[]
  value: ContentStudioSourceReference[]
}) {
  const update = (index: number, key: keyof ContentStudioSourceReference, next: string) =>
    onChange(value.map((item, current) => (current === index ? { ...item, [key]: next } : item)))
  return (
    <section className="portal-content-studio__facts-editor">
      <header>
        <h4>{copy.facts}</h4>
        <Button
          disabled={sources.length === 0}
          onClick={() => onChange([...value, { claim: '', source: sources[0] ?? '' }])}
          size="compact"
          variant="secondary"
        >
          <IconPlus aria-hidden="true" size={14} />
          {copy.addFact}
        </Button>
      </header>
      {value.map((fact, index) => {
        const available =
          fact.source && !sources.includes(fact.source) ? [fact.source, ...sources] : sources
        return (
          <div key={`${index}:${fact.claim}`}>
            <input
              maxLength={500}
              onChange={(event) => update(index, 'claim', event.target.value)}
              placeholder={copy.claim}
              value={fact.claim}
            />
            <select
              aria-label={copy.source}
              onChange={(event) => update(index, 'source', event.target.value)}
              value={fact.source}
            >
              <option value="">{copy.source}</option>
              {available.map((source) => (
                <option key={source} value={source}>
                  {source}
                </option>
              ))}
            </select>
            <Button
              onClick={() => onChange(value.filter((_, current) => current !== index))}
              size="compact"
              variant="ghost"
            >
              {copy.remove}
            </Button>
          </div>
        )
      })}
    </section>
  )
}
function MultiOptions({
  options,
  selected,
  toggle,
}: {
  options: ContentStudioSummary['options']['assets']
  selected: string[]
  toggle: (value: string) => void
}) {
  return (
    <div className="portal-content-studio__multi-options">
      {options.length ? (
        options.map((option) => (
          <label key={option.id}>
            <input
              checked={selected.includes(String(option.id))}
              onChange={() => toggle(String(option.id))}
              type="checkbox"
            />
            <span>{option.label}</span>
            {option.meta ? <small>{option.meta}</small> : null}
          </label>
        ))
      ) : (
        <span>—</span>
      )}
    </div>
  )
}
function Field({
  children,
  label,
  wide = false,
}: {
  children: React.ReactNode
  label: string
  wide?: boolean
}) {
  return (
    <label className={wide ? 'is-wide' : undefined}>
      <span>{label}</span>
      {children}
    </label>
  )
}
