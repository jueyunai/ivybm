'use client'

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react'

import Image from 'next/image'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  IconArrowLeft,
  IconArrowRight,
  IconBrandFacebook,
  IconBrandInstagram,
  IconBrandLinkedin,
  IconBuilding,
  IconCheck,
  IconChecks,
  IconExternalLink,
  IconFile,
  IconFileDownload,
  IconFileTypePdf,
  IconGridDots,
  IconPhoto,
  IconPlus,
  IconSearch,
  IconRefresh,
  IconRuler,
  IconSend,
  IconShieldCheck,
  IconSparkles,
  IconTrash,
  IconTruckDelivery,
  IconUpload,
  IconZoomIn,
} from '@tabler/icons-react'

import { usePortalCommandKey } from '@/admin-portal/core/commands/usePortalCommandKey'
import { usePortalPreferences } from '@/admin-portal/core/navigation/PortalPreferences'
import type {
  PortalNavigateActiveDetail,
  PortalSidebarNavigateDetail,
} from '@/admin-portal/core/navigation/PortalSidebar'
import {
  Button,
  ConfirmDialog,
  ModalDialog,
  PortalState,
  SearchInput,
  StatusBadge,
  Surface,
  UiSelect,
} from '@/admin-portal/core/ui'

import type {
  ContentStudioItem,
  ContentStudioOption,
  ContentStudioPageData,
  ContentStudioQuery,
  ContentStudioSourceReference,
  ContentStudioSummary,
} from './getContentStudioPage'
import { formatScheduledAt } from './formatScheduledAt'
import { getContentStudioMessages } from './messages'

const buildStudioHref = (query?: Partial<ContentStudioQuery>, page = 1): string => {
  const params = new URLSearchParams()
  const q = query?.q?.trim()
  const status = query?.status?.trim()
  const platform = query?.platform?.trim()
  if (q) params.set('q', q)
  if (status && status !== 'all') params.set('status', status)
  if (platform && platform !== 'all') params.set('platform', platform)
  if (page > 1) params.set('page', String(page))
  const search = params.toString()
  return search ? `/dashboard/content-studio?${search}` : '/dashboard/content-studio'
}

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
  type ActiveAction = 'create' | 'edit' | 'generator' | 'publish-now' | 'review' | 'schedule' | null
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [activeAction, setActiveAction] = useState<ActiveAction>(null)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [isDirty, setIsDirty] = useState(false)
  const [editorBusy, setEditorBusy] = useState(false)
  const editorBusyRef = useRef(editorBusy)
  useEffect(() => {
    editorBusyRef.current = editorBusy
  }, [editorBusy])
  type PendingTransition = { commit: () => void; onCancel?: () => void }
  const [pendingTransition, setPendingTransition] = useState<PendingTransition | null>(null)
  const isDirtyRef = useRef(isDirty)
  useEffect(() => {
    isDirtyRef.current = isDirty
  }, [isDirty])

  const closeAction = useCallback(() => {
    setActiveAction(null)
    setIsDirty(false)
  }, [setActiveAction, setIsDirty])

  const requestTransition = useCallback(
    (action: () => void, onCancel?: () => void) => {
      if (editorBusyRef.current) return
      if (isDirtyRef.current) {
        setPendingTransition({ commit: action, onCancel })
      } else {
        action()
      }
    },
    [setPendingTransition],
  )
  const [isRefreshing, startRefresh] = useTransition()
  const studioHistoryIdxRef = useRef<number | null>(null)
  const isRestoringHistoryRef = useRef(false)
  const isBypassingHistoryRef = useRef(false)

  useEffect(() => {
    studioHistoryIdxRef.current = getHistoryCurrentIndex(window.history.state)
  }, [])

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

  useEffect(() => {
    if (!isDirty && !editorBusy) return

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
    }

    const handlePopState = (event: PopStateEvent) => {
      if (isBypassingHistoryRef.current) {
        isBypassingHistoryRef.current = false
        return
      }
      if (isRestoringHistoryRef.current) {
        isRestoringHistoryRef.current = false
        return
      }
      if (!editorBusyRef.current && !isDirtyRef.current) {
        return
      }

      const destIdx = getHistoryCurrentIndex(event.state)
      const studioIdx = studioHistoryIdxRef.current
      const wentForward =
        destIdx !== null && studioIdx !== null ? destIdx > studioIdx : false

      // Restore position immediately so user remains in Content Studio
      isRestoringHistoryRef.current = true
      if (wentForward) {
        window.history.back()
      } else {
        window.history.forward()
      }

      if (editorBusyRef.current) {
        // While busy, block navigation without opening prompt
        return
      }

      if (isDirtyRef.current) {
        setPendingTransition({
          commit: () => {
            isBypassingHistoryRef.current = true
            closeAction()
            if (wentForward) {
              window.history.forward()
            } else {
              window.history.back()
            }
          },
          onCancel: () => {
            // Cancel stays in Content Studio with current edits intact
          },
        })
      }
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    window.addEventListener('popstate', handlePopState)
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload)
      window.removeEventListener('popstate', handlePopState)
    }
  }, [isDirty, editorBusy, closeAction])

  useEffect(() => {
    const handleSidebarNavigate = (event: Event) => {
      const customEvent = event as CustomEvent<PortalSidebarNavigateDetail>
      const targetHref = customEvent.detail?.href
      const closeNav = customEvent.detail?.onClose
      if (!targetHref) return

      if (editorBusyRef.current) {
        event.preventDefault()
        closeNav?.()
        return
      }

      if (isDirtyRef.current) {
        event.preventDefault()
        closeNav?.()
        setPendingTransition({
          commit: () => {
            setIsDirty(false)
            setActiveAction(null)
            if (targetHref === '/dashboard/content-studio') {
              setFeedback(null)
            } else {
              router.push(targetHref)
            }
          },
        })
      } else if (targetHref === '/dashboard/content-studio') {
        closeNav?.()
        setActiveAction(null)
        setFeedback(null)
      }
    }

    window.addEventListener('portal:sidebar-navigate', handleSidebarNavigate)
    return () => window.removeEventListener('portal:sidebar-navigate', handleSidebarNavigate)
  }, [router])

  useEffect(() => {
    const handleActiveNav = (event: Event) => {
      const customEvent = event as CustomEvent<PortalNavigateActiveDetail>
      if (customEvent.detail?.href === '/dashboard/content-studio' && !isDirtyRef.current) {
        setActiveAction(null)
        setFeedback(null)
      }
    }
    window.addEventListener('portal:navigate-active', handleActiveNav)
    return () => window.removeEventListener('portal:navigate-active', handleActiveNav)
  }, [])

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
    closeAction()
    setFeedback(message)
    startRefresh(() => router.refresh())
  }

  const updateFilters = (name: 'status' | 'platform', value: string) => {
    if (editorBusyRef.current) return
    const targetUrl = buildStudioHref({
      ...summary?.query,
      [name]: value,
    })
    requestTransition(() => {
      closeAction()
      router.push(targetUrl)
    })
  }

  const handleFilterSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (editorBusyRef.current) return
    const formData = new FormData(event.currentTarget)
    const targetUrl = buildStudioHref({
      platform:
        (formData.get('platform')?.toString().trim() as ContentStudioQuery['platform']) || 'all',
      q: formData.get('q')?.toString().trim() || '',
      status: (formData.get('status')?.toString().trim() as ContentStudioQuery['status']) || 'all',
    })
    requestTransition(() => {
      closeAction()
      router.push(targetUrl)
    })
  }

  return (
    <main className="portal-page portal-content-studio">
      <header className="portal-page__intro portal-content-studio__intro">
        <div>
          <h2>{copy.title}</h2>
          <p>{summary.publishingEnabled ? copy.automaticNotice : copy.publishingUnavailable}</p>
        </div>
        <div className="portal-content-studio__intro-actions">
          <Button
            disabled={editorBusy}
            onClick={() => {
              if (activeAction === 'generator' || editorBusy) return
              requestTransition(() => {
                setActiveAction('generator')
                setFeedback(null)
              })
            }}
            variant="secondary"
          >
            <IconSparkles aria-hidden="true" size={16} />
            {copy.generate}
          </Button>
          <Button
            disabled={editorBusy}
            onClick={() => {
              if (activeAction === 'create' || editorBusy) return
              requestTransition(() => {
                setActiveAction('create')
                setFeedback(null)
              })
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
        <form action="/dashboard/content-studio" method="get" onSubmit={handleFilterSubmit}>
          <div className="portal-content-studio__filter-item">
            <span className="portal-content-studio__filter-label">{copy.titleField}</span>
            <SearchInput defaultValue={summary.query.q} name="q" placeholder={copy.titleField} />
          </div>
          <div className="portal-content-studio__filter-item">
            <span className="portal-content-studio__filter-label">{copy.status}</span>
            <UiSelect
              ariaLabel={copy.status}
              name="status"
              onChange={(val) => updateFilters('status', val)}
              options={[
                { value: 'all', label: copy.allStatus },
                ...(['draft', 'review', 'approved'] as const).map((status) => ({
                  value: status,
                  label: copy.statusLabels[status],
                })),
              ]}
              value={summary.query.status}
            />
          </div>
          <div className="portal-content-studio__filter-item">
            <span className="portal-content-studio__filter-label">{copy.platform}</span>
            <UiSelect
              ariaLabel={copy.platform}
              name="platform"
              onChange={(val) => updateFilters('platform', val)}
              options={[
                { value: 'all', label: copy.allPlatforms },
                ...(['facebook', 'instagram', 'linkedin'] as const).map((platform) => ({
                  value: platform,
                  label: copy.platformLabels[platform],
                })),
              ]}
              value={summary.query.platform}
            />
          </div>
          <div className="portal-content-studio__filter-actions">
            <Button disabled={editorBusy} size="compact" type="submit">
              <IconSearch aria-hidden="true" size={15} stroke={1.8} />
              {copy.filter}
            </Button>
            <Button asChild disabled={editorBusy} size="compact" variant="ghost">
              <Link
                href="/dashboard/content-studio"
                onClick={(event) => {
                  if (editorBusyRef.current) {
                    event.preventDefault()
                    return
                  }
                  if (isDirtyRef.current) {
                    event.preventDefault()
                    requestTransition(() => {
                      closeAction()
                      router.push('/dashboard/content-studio')
                    })
                  } else {
                    closeAction()
                  }
                }}
              >
                {copy.resetFilters}
              </Link>
            </Button>
          </div>
        </form>
      </Surface>
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
                    aria-pressed={
                      activeAction !== 'create' &&
                      activeAction !== 'generator' &&
                      selected?.id === item.id
                    }
                    className={
                      activeAction !== 'create' &&
                      activeAction !== 'generator' &&
                      selected?.id === item.id
                        ? 'is-selected'
                        : undefined
                    }
                    onClick={() => {
                      if (editorBusyRef.current) return
                      requestTransition(() => {
                        setSelectedId(item.id)
                        closeAction()
                        setFeedback(null)
                      })
                    }}
                    type="button"
                  >
                    <strong>{item.title}</strong>
                    <span>
                      {copy.platformLabels[item.platform]} · {item.contentLocale.toUpperCase()} ·{' '}
                      {copy.updatedAt} {formatScheduledAt(item.updatedAt)}
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
              onNavigate={(targetUrl) => {
                if (editorBusyRef.current) return
                requestTransition(() => {
                  closeAction()
                  router.push(targetUrl)
                })
              }}
              query={summary.query}
              page={summary.pagination.page}
              totalPages={summary.pagination.totalPages}
            />
          ) : null}
        </Surface>

        {activeAction === 'generator' ? (
          <Surface
            as="section"
            className="portal-content-studio__editor portal-content-studio__editor--drawer"
          >
            <GenerateDraftEditor
              copy={copy}
              drafts={summary.items.filter((item) => item.status === 'draft')}
              onBusyChange={setEditorBusy}
              onClose={closeAction}
              onDirtyChange={setIsDirty}
              onDone={onDone}
              options={summary.options}
              selectedDraftId={selected?.status === 'draft' ? selected.id : null}
            />
          </Surface>
        ) : activeAction === 'create' || (activeAction === 'edit' && selected) ? (
          <Surface
            as="section"
            className="portal-content-studio__editor portal-content-studio__editor--drawer"
          >
            <DraftEditor
              key={`${activeAction}:${activeAction === 'edit' ? String(selected?.id ?? 'none') : 'new'}`}
              copy={copy}
              item={activeAction === 'edit' ? selected : null}
              onBusyChange={setEditorBusy}
              options={summary.options}
              onClose={closeAction}
              onDirtyChange={setIsDirty}
              onDone={onDone}
            />
          </Surface>
        ) : activeAction === 'review' && selected ? (
          <Surface
            as="section"
            className="portal-content-studio__editor portal-content-studio__editor--drawer"
          >
            <ReviewEditor copy={copy} item={selected} onClose={closeAction} onDone={onDone} />
          </Surface>
        ) : activeAction === 'schedule' && selected ? (
          <Surface
            as="section"
            className="portal-content-studio__editor portal-content-studio__editor--drawer"
          >
            <ScheduleEditor copy={copy} item={selected} onClose={closeAction} onDone={onDone} />
          </Surface>
        ) : activeAction === 'publish-now' && selected ? (
          <Surface
            as="section"
            className="portal-content-studio__editor portal-content-studio__editor--drawer"
          >
            <PublishNowEditor
              copy={copy}
              item={selected}
              onClose={closeAction}
              onDone={onDone}
              options={summary.options.platformAccounts}
            />
          </Surface>
        ) : (
          <Surface as="section" className="portal-content-studio__detail">
            {selected ? (
              <ContentDetail
                copy={copy}
                disabled={isRefreshing}
                item={selected}
                onDelete={() => onDone(copy.feedback)}
                onEdit={() => {
                  setActiveAction('edit')
                  setFeedback(null)
                }}
                onReview={() => {
                  setActiveAction('review')
                  setFeedback(null)
                }}
                onPublish={() => {
                  setActiveAction('publish-now')
                  setFeedback(null)
                }}
                onRefresh={refreshPublicationResults}
                publishingAvailable={
                  summary.publishingEnabled && summary.options.platformAccounts.length > 0
                }
                onSubmitToReview={() => onDone(copy.readyForReview)}
              />
            ) : (
              <PortalState description={copy.empty} title={copy.empty} type="empty" />
            )}
          </Surface>
        )}
      </div>
      <ConfirmDialog
        cancelLabel={copy.keepDraft}
        confirmLabel={copy.discardAndSwitch}
        description={copy.unsavedChangesDescription}
        onConfirm={() => {
          setIsDirty(false)
          const target = pendingTransition
          setPendingTransition(null)
          target?.commit()
        }}
        onOpenChange={(open) => {
          if (!open) {
            const target = pendingTransition
            setPendingTransition(null)
            target?.onCancel?.()
          }
        }}
        open={pendingTransition !== null}
        title={copy.unsavedChangesTitle}
        variant="danger"
      />
    </main>
  )
}

type Copy = ReturnType<typeof getContentStudioMessages>

const QUICK_INTENT_ICONS = {
  ceiling: IconBuilding,
  mockup: IconRuler,
  perforation: IconGridDots,
  shipment: IconTruckDelivery,
} as const

const tone = (status: ContentStudioItem['status']): 'info' | 'neutral' | 'success' | 'warning' =>
  status === 'approved' ? 'success' : status === 'review' ? 'info' : 'warning'
const request = async (
  url: string,
  method: 'DELETE' | 'PATCH' | 'POST',
  body: Record<string, unknown>,
  onResponse?: () => void,
  idempotencyKey?: string,
) => {
  const response = await fetch(url, {
    body: JSON.stringify(body),
    credentials: 'same-origin',
    headers: {
      'content-type': 'application/json',
      'Idempotency-Key':
        idempotencyKey ??
        (typeof body.idempotencyKey === 'string'
          ? body.idempotencyKey
          : `portal-content-studio:${crypto.randomUUID()}`),
    },
    method,
  })
  const data = (await response.json()) as { error?: { message?: string } }
  onResponse?.()
  if (!response.ok) throw new Error(data.error?.message || 'Request failed')
  return data
}

function Pagination({
  copy,
  onNavigate,
  page,
  query,
  totalPages,
}: {
  copy: Copy
  onNavigate?: (url: string) => void
  page: number
  query: ContentStudioQuery
  totalPages: number
}) {
  const prevUrl = buildStudioHref(query, page - 1)
  const nextUrl = buildStudioHref(query, page + 1)
  const handlePageClick = (url: string) => (event: React.MouseEvent<HTMLAnchorElement>) => {
    if (onNavigate) {
      event.preventDefault()
      onNavigate(url)
    }
  }

  return (
    <nav className="portal-content-studio__pagination">
      <Button asChild disabled={page <= 1} size="compact" variant="secondary">
        <Link href={prevUrl} onClick={handlePageClick(prevUrl)}>
          <IconArrowLeft aria-hidden="true" size={15} />
          {copy.previous}
        </Link>
      </Button>
      <span>
        {page} / {totalPages}
      </span>
      <Button asChild disabled={page >= totalPages} size="compact" variant="secondary">
        <Link href={nextUrl} onClick={handlePageClick(nextUrl)}>
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
  onSubmitToReview: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [previewAsset, setPreviewAsset] = useState<ContentStudioItem['assets'][number] | null>(null)
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
          {item.assets.length ? (
            <ul className="portal-content-studio__asset-relations">
              {item.assets.map((asset) => {
                const canPreview = Boolean(asset.previewUrl)
                return (
                  <li key={asset.id}>
                    {canPreview ? (
                      <button
                        aria-label={`${copy.zoomAsset}: ${asset.label}`}
                        className="portal-content-studio__asset-thumb-btn"
                        onClick={() => setPreviewAsset(asset)}
                        title={copy.zoomAsset}
                        type="button"
                      >
                        <AssetThumbnail option={asset} />
                        <span className="portal-content-studio__asset-zoom-badge">
                          <IconZoomIn aria-hidden="true" size={16} stroke={2} />
                        </span>
                      </button>
                    ) : (
                      <AssetThumbnail option={asset} />
                    )}
                    <span title={asset.label}>{asset.label}</span>
                  </li>
                )
              })}
            </ul>
          ) : (
            <p>—</p>
          )}
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
          <h4>{copy.publishJobsTitle}</h4>
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
            <Button disabled={busy || disabled} onClick={() => void submit()} size="compact">
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
              variant="danger"
            >
              <IconTrash aria-hidden="true" size={15} />
              {copy.delete}
            </Button>
          )
        ) : null}
      </footer>
      {previewAsset ? (
        <ModalDialog
          closeLabel={copy.close}
          maxWidth="760px"
          onOpenChange={(open) => {
            if (!open) setPreviewAsset(null)
          }}
          open={Boolean(previewAsset)}
          title={previewAsset.label || copy.assets}
        >
          <div className="portal-content-studio__asset-lightbox">
            {previewAsset.previewUrl && previewAsset.meta?.startsWith('image/') ? (
              <div className="portal-content-studio__asset-lightbox-img-wrap">
                <Image
                  alt={previewAsset.label}
                  className="portal-content-studio__asset-lightbox-img"
                  height={800}
                  src={previewAsset.previewUrl}
                  unoptimized
                  width={1200}
                />
              </div>
            ) : previewAsset.previewUrl && previewAsset.meta === 'application/pdf' ? (
              <div className="portal-content-studio__asset-lightbox-doc">
                <IconFileTypePdf aria-hidden="true" size={48} stroke={1.5} />
                <p>{previewAsset.label}</p>
              </div>
            ) : (
              <p className="portal-muted">—</p>
            )}
            {previewAsset.previewUrl ? (
              <footer className="portal-content-studio__asset-lightbox-footer">
                <Button asChild size="compact" variant="secondary">
                  <a href={previewAsset.previewUrl} rel="noreferrer" target="_blank">
                    <IconExternalLink aria-hidden="true" size={14} stroke={1.8} />
                    {copy.openOriginal}
                  </a>
                </Button>
              </footer>
            ) : null}
          </div>
        </ModalDialog>
      ) : null}
    </>
  )
}

const MAX_UPLOAD_FILE_COUNT = 3
const MAX_UPLOAD_FILE_SIZE = 8 * 1024 * 1024
const UPLOAD_IMAGE_MIME_TYPES = new Set(['image/avif', 'image/jpeg', 'image/png', 'image/webp'])
const UPLOAD_IMAGE_EXTENSION = /\.(?:avif|jpe?g|png|webp)$/i

async function uploadMediaAsset(file: File): Promise<ContentStudioOption> {
  const form = new FormData()
  form.set('alt', file.name.replace(/\.[^/.]+$/, ''))
  form.set('source', 'Content Studio')
  form.set('isPublic', 'false')
  form.set('file', file)
  const createKey = `portal-media:content-studio:${crypto.randomUUID()}`
  const response = await fetch('/api/portal/media', {
    body: form,
    headers: { 'Idempotency-Key': createKey },
    method: 'POST',
  })
  if (!response.ok) {
    let msg = 'Failed to upload media'
    try {
      const errJson = (await response.json()) as { error?: { message?: unknown } }
      if (typeof errJson.error?.message === 'string') msg = errJson.error.message
    } catch {}
    throw new Error(msg)
  }
  const body = (await response.json()) as {
    result?: {
      alt?: string
      filename?: string
      id: number | string
      mimeType?: null | string
      previewUrl?: null | string
    }
  }
  if (!body.result || !body.result.id) {
    throw new Error('Invalid media upload response')
  }
  return {
    id: Number(body.result.id),
    label: body.result.alt || body.result.filename || `#${body.result.id}`,
    meta: body.result.mimeType ?? undefined,
    previewUrl: body.result.previewUrl ?? undefined,
  }
}

function useAssetUploader({
  copy,
  initialAssets,
  onAssetsUploaded,
}: {
  copy: Copy
  initialAssets: ContentStudioOption[]
  onAssetsUploaded: (newIds: string[]) => void
}) {
  const [uploadedAssets, setUploadedAssets] = useState<ContentStudioOption[]>([])
  const [uploadBusy, setUploadBusy] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)

  const combinedAssets = useMemo(() => {
    const existingIds = new Set(initialAssets.map((a) => a.id))
    const extras = uploadedAssets.filter((a) => !existingIds.has(a.id))
    return [...extras, ...initialAssets]
  }, [initialAssets, uploadedAssets])

  const handleUpload = async (files: FileList | File[]) => {
    if (files.length > MAX_UPLOAD_FILE_COUNT) {
      setUploadError(copy.uploadCountExceeded)
      return
    }
    const list = Array.from(files).filter(
      (file) => UPLOAD_IMAGE_MIME_TYPES.has(file.type) || UPLOAD_IMAGE_EXTENSION.test(file.name),
    )
    if (list.length === 0) return

    if (list.length > MAX_UPLOAD_FILE_COUNT) {
      setUploadError(copy.uploadCountExceeded)
      return
    }

    for (const f of list) {
      if (f.size > MAX_UPLOAD_FILE_SIZE) {
        setUploadError(copy.uploadSizeExceeded)
        return
      }
    }

    setUploadBusy(true)
    setUploadError(null)
    try {
      const newItems: ContentStudioOption[] = []
      for (const f of list) {
        const item = await uploadMediaAsset(f)
        newItems.push(item)
      }
      setUploadedAssets((curr) => [...newItems, ...curr])
      const newIds = newItems.map((item) => String(item.id))
      onAssetsUploaded(newIds)
    } catch (caught) {
      setUploadError(caught instanceof Error ? caught.message : copy.uploadFailed)
    } finally {
      setUploadBusy(false)
    }
  }

  return {
    combinedAssets,
    handleUpload,
    uploadBusy,
    uploadError,
  }
}

function DraftEditor({
  copy,
  item,
  onBusyChange,
  onClose,
  onDirtyChange,
  onDone,
  options,
}: {
  copy: Copy
  item: ContentStudioItem | null
  onBusyChange?: (busy: boolean) => void
  onClose: () => void
  onDirtyChange?: (dirty: boolean) => void
  onDone: (message: string) => void
  options: ContentStudioSummary['options']
}) {
  const initial = useMemo<{
    assets: string[]
    body: string
    contentLocale: 'ar' | 'en'
    contentType: ContentStudioItem['contentType']
    knowledgeSources: string[]
    platform: ContentStudioItem['platform']
    sourceReferences: ContentStudioSourceReference[]
    title: string
  }>(
    () => ({
      assets: item?.assets.map((asset) => String(asset.id)) ?? [],
      body: item?.body ?? '',
      contentLocale: item?.contentLocale ?? 'en',
      contentType: item?.contentType ?? 'post',
      knowledgeSources: item?.knowledgeSources.map((source) => String(source.id)) ?? [],
      platform: item?.platform ?? 'linkedin',
      sourceReferences: (item?.sourceReferences ?? []).map((reference, index) => ({
        ...reference,
        id: reference.id ?? `existing:${index}`,
      })),
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

  const toggleAsset = (value: string) => {
    const nextAssets = form.assets.includes(value)
      ? form.assets.filter((id) => id !== value)
      : [...form.assets, value]
    if (nextAssets.length > MAX_UPLOAD_FILE_COUNT) {
      setError(copy.uploadCountExceeded)
      return
    }
    setError(null)
    setForm((current) => ({
      ...current,
      assets: nextAssets,
      contentType: nextAssets.length >= 2 ? 'carousel' : 'post',
    }))
  }

  const { combinedAssets, handleUpload, uploadBusy, uploadError } = useAssetUploader({
    copy,
    initialAssets: options.assets,
    onAssetsUploaded: (newIds) => {
      setForm((current) => {
        return {
          ...current,
          assets: newIds,
          contentType: newIds.length >= 2 ? 'carousel' : 'post',
        }
      })
    },
  })

  const editorBusy = busy || uploadBusy
  useEffect(() => {
    onBusyChange?.(editorBusy)
    return () => onBusyChange?.(false)
  }, [editorBusy, onBusyChange])

  const isDirty = useMemo(() => {
    return (
      form.title !== initial.title ||
      form.body !== initial.body ||
      form.platform !== initial.platform ||
      form.contentLocale !== initial.contentLocale ||
      form.contentType !== initial.contentType ||
      JSON.stringify(form.assets) !== JSON.stringify(initial.assets) ||
      JSON.stringify(form.knowledgeSources) !== JSON.stringify(initial.knowledgeSources) ||
      JSON.stringify(form.sourceReferences) !== JSON.stringify(initial.sourceReferences)
    )
  }, [form, initial])

  useEffect(() => {
    onDirtyChange?.(isDirty)
    return () => onDirtyChange?.(false)
  }, [isDirty, onDirtyChange])

  const save = async () => {
    if (editorBusy) return
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
      onDirtyChange?.(false)
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
        <Button disabled={editorBusy} onClick={onClose} size="compact" variant="ghost">
          {copy.cancel}
        </Button>
      </header>
      {error ? <p role="alert">{error}</p> : null}
      <div className="portal-content-studio__form-grid">
        <Field label={copy.titleField} required>
          <input
            disabled={editorBusy}
            maxLength={180}
            onChange={(event) => update('title', event.target.value)}
            value={form.title}
          />
        </Field>
        <Field label={copy.platform} required>
          <UiSelect
            ariaLabel={copy.platform}
            disabled={editorBusy}
            onChange={(val) => update('platform', val as typeof form.platform)}
            options={(['facebook', 'instagram', 'linkedin'] as const).map((platform) => ({
              label: copy.platformLabels[platform],
              value: platform,
            }))}
            value={form.platform}
          />
        </Field>
        <Field label={copy.locale} required>
          <UiSelect
            ariaLabel={copy.locale}
            disabled={editorBusy}
            onChange={(val) => update('contentLocale', val as typeof form.contentLocale)}
            options={[
              { label: 'EN', value: 'en' },
              { label: 'AR', value: 'ar' },
            ]}
            value={form.contentLocale}
          />
        </Field>
        <Field label={copy.type}>
          <UiSelect
            ariaLabel={copy.type}
            disabled={editorBusy}
            onChange={(val) => update('contentType', val as typeof form.contentType)}
            options={(['post', 'carousel', 'long-form'] as const).map((type) => ({
              label: copy.typeLabels[type],
              value: type,
            }))}
            value={form.contentType}
          />
        </Field>
        <Field label={copy.body} required wide>
          <textarea
            dir={form.contentLocale === 'ar' ? 'rtl' : undefined}
            disabled={editorBusy}
            maxLength={30_000}
            onChange={(event) => update('body', event.target.value)}
            rows={10}
            value={form.body}
          />
        </Field>
        <Field label={copy.assets} wide>
          <MultiOptions
            assetPreviews
            disabled={editorBusy}
            onUpload={handleUpload}
            options={combinedAssets}
            selected={form.assets}
            toggle={toggleAsset}
            uploadBusy={uploadBusy}
            uploadPrompt={copy.uploadPrompt}
            uploadTitle={uploadBusy ? copy.uploadingMedia : copy.uploadMedia}
          />
          {uploadError ? (
            <p className="portal-content-studio__upload-error" role="alert">
              {uploadError}
            </p>
          ) : null}
        </Field>
        <Field label={copy.knowledge} wide>
          <MultiOptions
            disabled={editorBusy}
            emptyMessage={copy.noKnowledgeOptions}
            options={options.knowledgeSources}
            selected={form.knowledgeSources}
            toggle={(id) =>
              setForm((current) => ({
                ...current,
                knowledgeSources: current.knowledgeSources.includes(id)
                  ? current.knowledgeSources.filter((item) => item !== id)
                  : [...current.knowledgeSources, id],
              }))
            }
          />
        </Field>
      </div>
      <FactEditor
        copy={copy}
        disabled={editorBusy}
        onChange={(sourceReferences) => update('sourceReferences', sourceReferences)}
        sources={selectedSources}
        value={form.sourceReferences}
      />
      <footer>
        <Button disabled={editorBusy} onClick={() => void save()}>
          {item ? copy.save : copy.create}
        </Button>
      </footer>
    </div>
  )
}

function FactEditor({
  copy,
  disabled = false,
  onChange,
  sources,
  value,
}: {
  copy: Copy
  disabled?: boolean
  onChange: (value: ContentStudioSourceReference[]) => void
  sources: string[]
  value: ContentStudioSourceReference[]
}) {
  const update = (index: number, key: 'claim' | 'source', next: string) =>
    onChange(value.map((item, current) => (current === index ? { ...item, [key]: next } : item)))
  return (
    <section className="portal-content-studio__facts-editor">
      <header>
        <h4>{copy.facts}</h4>
        <Button
          disabled={disabled || sources.length === 0}
          onClick={() =>
            onChange([...value, { claim: '', id: crypto.randomUUID(), source: sources[0] ?? '' }])
          }
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
          <div key={fact.id ?? `existing:${index}`}>
            <input
              disabled={disabled}
              maxLength={500}
              onChange={(event) => update(index, 'claim', event.target.value)}
              placeholder={copy.claim}
              value={fact.claim}
            />
            <UiSelect
              ariaLabel={copy.source}
              disabled={disabled}
              onChange={(next) => update(index, 'source', next)}
              options={[
                { label: copy.source, value: '' },
                ...available.map((source) => ({ label: source, value: source })),
              ]}
              value={fact.source}
            />
            <Button
              disabled={disabled}
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

const PLATFORMS_STORAGE_KEY = 'ivybm:content-studio:selected-platforms'
const GENERATION_BATCH_STORAGE_KEY = 'ivybm:content-studio:active-generation-batch'

function getHistoryCurrentIndex(state?: unknown): number | null {
  if (state && typeof state === 'object') {
    const s = state as Record<string, unknown>
    if (typeof s.idx === 'number') return s.idx
    if (typeof s.__ivybm_idx__ === 'number') return s.__ivybm_idx__
  }
  if (
    typeof window !== 'undefined' &&
    'navigation' in window &&
    (window as unknown as { navigation?: { currentEntry?: { index?: number } } }).navigation
      ?.currentEntry?.index !== undefined
  ) {
    return (window as unknown as { navigation: { currentEntry: { index: number } } }).navigation
      .currentEntry.index
  }
  if (typeof window !== 'undefined' && typeof window.history === 'object') {
    try {
      const symbols = Object.getOwnPropertySymbols(window.history)
      for (const sym of symbols) {
        const impl = (
          window.history as unknown as Record<
            symbol,
            { _window?: { _sessionHistory?: { _currentIndex?: number } } }
          >
        )[sym]
        const sh = impl?._window?._sessionHistory
        if (typeof sh?._currentIndex === 'number') {
          return sh._currentIndex
        }
      }
    } catch {
      // ignore
    }
  }
  return null
}

const VALID_PLATFORMS: Array<ContentStudioItem['platform']> = ['facebook', 'instagram', 'linkedin']
const DEFAULT_PLATFORMS: Array<ContentStudioItem['platform']> = ['linkedin']

type GenerationBatch = {
  fingerprint: string
  generatedAssets: string[]
  id: string
  succeededPlatforms: Array<ContentStudioItem['platform']>
}

function readStoredGenerationBatch(fingerprint: string): GenerationBatch | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.sessionStorage.getItem(GENERATION_BATCH_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as GenerationBatch
    if (parsed && parsed.fingerprint === fingerprint && typeof parsed.id === 'string') {
      return parsed
    }
    return null
  } catch {
    return null
  }
}

function persistGenerationBatch(batch: GenerationBatch | null): void {
  if (typeof window === 'undefined') return
  try {
    if (batch) {
      window.sessionStorage.setItem(GENERATION_BATCH_STORAGE_KEY, JSON.stringify(batch))
    } else {
      window.sessionStorage.removeItem(GENERATION_BATCH_STORAGE_KEY)
    }
  } catch {
    // ignore storage quota / access errors
  }
}

function readStoredPlatforms(): Array<ContentStudioItem['platform']> | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(PLATFORMS_STORAGE_KEY)
    if (raw === null) return null
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return null
    return parsed.filter((item): item is ContentStudioItem['platform'] =>
      VALID_PLATFORMS.includes(item as ContentStudioItem['platform']),
    )
  } catch {
    return null
  }
}

function persistPlatforms(platforms: Array<ContentStudioItem['platform']>): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(PLATFORMS_STORAGE_KEY, JSON.stringify(platforms))
  } catch {
    // ignore storage quota / access errors
  }
}

function GenerateDraftEditor({
  copy,
  drafts,
  onBusyChange,
  onClose,
  onDirtyChange,
  onDone,
  options,
  selectedDraftId,
}: {
  copy: Copy
  drafts: ContentStudioItem[]
  onBusyChange?: (busy: boolean) => void
  onClose: () => void
  onDirtyChange?: (dirty: boolean) => void
  onDone: (message: string) => void
  options: ContentStudioSummary['options']
  selectedDraftId: null | number
}) {
  const [mode, setMode] = useState<'copy' | 'image'>('copy')
  const [imageDirty, setImageDirty] = useState(false)
  const [imageBusy, setImageBusy] = useState(false)
  const [pendingModeTransition, setPendingModeTransition] = useState<(() => void) | null>(null)
  const [imageEditorResetKey, setImageEditorResetKey] = useState(0)
  const generationEpochRef = useRef(0)
  const formRevisionRef = useRef(0)
  useEffect(() => {
    return () => {
      generationEpochRef.current += 1
    }
  }, [])
  const batchRef = useRef<GenerationBatch | null>(null)
  const [form, setForm] = useState(() => ({
    assets: [] as string[],
    autoGenerateImage: false,
    brief: '',
    contentLocale: 'en' as 'ar' | 'en',
    contentType: 'post' as ContentStudioItem['contentType'],
    knowledgeSources: [] as string[],
    platforms: readStoredPlatforms() ?? [...DEFAULT_PLATFORMS],
  }))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [generationProgress, setGenerationProgress] = useState<string | null>(null)

  const { combinedAssets, handleUpload, uploadBusy, uploadError } = useAssetUploader({
    copy,
    initialAssets: options.assets,
    onAssetsUploaded: (newIds) => {
      formRevisionRef.current += 1
      setForm((current) => {
        return {
          ...current,
          assets: newIds,
          contentType: newIds.length >= 2 ? 'carousel' : 'post',
        }
      })
    },
  })

  const editorBusy = busy || imageBusy || uploadBusy
  useEffect(() => {
    onBusyChange?.(editorBusy)
    return () => onBusyChange?.(false)
  }, [editorBusy, onBusyChange])

  const copyDirty =
    form.brief.trim().length > 0 ||
    form.assets.length > 0 ||
    form.knowledgeSources.length > 0 ||
    form.contentLocale !== 'en' ||
    form.autoGenerateImage !== false ||
    form.contentType !== 'post'

  const isDirty = copyDirty || imageDirty
  const currentModeDirty = mode === 'image' ? imageDirty : copyDirty

  const requestModeChange = (targetMode: 'copy' | 'image') => {
    if (mode === targetMode || editorBusy) return
    if (currentModeDirty) {
      setPendingModeTransition(() => () => {
        generationEpochRef.current += 1
        setBusy(false)
        setError(null)
        setGenerationProgress(null)
        if (mode === 'copy') {
          formRevisionRef.current += 1
          batchRef.current = null
          persistGenerationBatch(null)
          setForm((current) => ({
            ...current,
            assets: [],
            autoGenerateImage: false,
            brief: '',
            contentLocale: 'en',
            contentType: 'post',
            knowledgeSources: [],
          }))
        } else {
          setImageDirty(false)
          setImageEditorResetKey((k) => k + 1)
        }
        setMode(targetMode)
      })
    } else {
      setError(null)
      setGenerationProgress(null)
      setMode(targetMode)
    }
  }

  useEffect(() => {
    onDirtyChange?.(isDirty)
    return () => onDirtyChange?.(false)
  }, [isDirty, onDirtyChange])

  useEffect(() => {
    persistPlatforms(form.platforms)
  }, [form.platforms])

  const update = <Key extends keyof typeof form>(key: Key, value: (typeof form)[Key]) => {
    formRevisionRef.current += 1
    setForm((current) => ({ ...current, [key]: value }))
  }
  const toggle = (key: 'assets' | 'knowledgeSources', value: string) => {
    formRevisionRef.current += 1
    if (key === 'assets') {
      const nextAssets = form.assets.includes(value)
        ? form.assets.filter((id) => id !== value)
        : [...form.assets, value]
      if (nextAssets.length > MAX_UPLOAD_FILE_COUNT) {
        setError(copy.uploadCountExceeded)
        return
      }
      setError(null)
      setForm((current) => ({
        ...current,
        assets: nextAssets,
        contentType: nextAssets.length >= 2 ? 'carousel' : 'post',
      }))
      return
    }
    setForm((current) => {
      const nextValues = current[key].includes(value)
        ? current[key].filter((id) => id !== value)
        : [...current[key], value]
      return { ...current, [key]: nextValues }
    })
  }
  const togglePlatform = (platform: ContentStudioItem['platform']) => {
    formRevisionRef.current += 1
    setForm((current) => {
      const exists = current.platforms.includes(platform)
      const nextPlatforms = exists
        ? current.platforms.filter((p) => p !== platform)
        : [...current.platforms, platform]
      return { ...current, platforms: nextPlatforms }
    })
  }
  const selectAllPlatforms = () => {
    formRevisionRef.current += 1
    const all: Array<ContentStudioItem['platform']> = ['facebook', 'instagram', 'linkedin']
    setForm((current) => ({
      ...current,
      platforms: all,
    }))
  }
  const clearPlatforms = () => {
    formRevisionRef.current += 1
    setForm((current) => ({
      ...current,
      platforms: [],
    }))
  }
  const canGenerate =
    (form.assets.length > 0 || form.brief.trim().length > 0) &&
    form.platforms.length > 0 &&
    !editorBusy
  const generate = async () => {
    if (!canGenerate || editorBusy) return
    const currentEpoch = ++generationEpochRef.current
    const currentRevision = formRevisionRef.current
    setBusy(true)
    setError(null)
    try {
      const targetPlatforms = form.platforms
      const total = targetPlatforms.length
      const fingerprint = JSON.stringify({
        assets: form.assets,
        autoGenerateImage: form.autoGenerateImage,
        brief: form.brief.trim(),
        contentLocale: form.contentLocale,
        contentType: form.contentType,
        knowledgeSources: form.knowledgeSources,
        platforms: targetPlatforms,
      })
      let batch = batchRef.current ?? readStoredGenerationBatch(fingerprint)
      if (!batch || batch.fingerprint !== fingerprint) {
        batch = {
          fingerprint,
          generatedAssets: form.assets,
          id: crypto.randomUUID(),
          succeededPlatforms: [],
        }
        batchRef.current = batch
        persistGenerationBatch(batch)
      } else {
        batchRef.current = batch
      }
      let generatedAssets = batch.generatedAssets
      for (let i = 0; i < total; i++) {
        const platform = targetPlatforms[i]
        if (batch.succeededPlatforms.includes(platform)) continue
        const label = copy.platformLabels[platform]
        if (total > 1) {
          setGenerationProgress(
            copy.generatingProgress
              .replace('{current}', String(i + 1))
              .replace('{total}', String(total))
              .replace('{platform}', label),
          )
        }
        const payload = {
          ...form,
          assets: generatedAssets,
          autoGenerateImage: generatedAssets.length > 0 ? false : form.autoGenerateImage,
          platform,
        }
        const idempotencyKey = `portal-content-studio:generate:${batch.id}:${platform}`
        const res = await request('/api/portal/content-studio/generate', 'POST', {
          ...payload,
          idempotencyKey,
        })
        if (
          generationEpochRef.current !== currentEpoch ||
          formRevisionRef.current !== currentRevision
        ) {
          return
        }

        batch.succeededPlatforms.push(platform)
        if (
          generatedAssets.length === 0 &&
          res &&
          typeof res === 'object' &&
          'content' in res &&
          res.content &&
          typeof res.content === 'object' &&
          'assets' in res.content &&
          Array.isArray(res.content.assets) &&
          res.content.assets.length > 0
        ) {
          generatedAssets = (res.content.assets as unknown[])
            .map((id) => (typeof id === 'number' || typeof id === 'string' ? String(id) : ''))
            .filter(Boolean)
          batch.generatedAssets = generatedAssets
        }
        persistGenerationBatch(batch)
      }
      if (
        generationEpochRef.current !== currentEpoch ||
        formRevisionRef.current !== currentRevision
      ) {
        return
      }
      batchRef.current = null
      persistGenerationBatch(null)
      onDirtyChange?.(false)
      onDone(
        total > 1
          ? copy.generationMultiComplete.replace('{count}', String(total))
          : copy.generationComplete,
      )
    } catch (caught) {
      if (
        generationEpochRef.current !== currentEpoch ||
        formRevisionRef.current !== currentRevision
      ) {
        return
      }
      setError(caught instanceof Error ? caught.message : copy.unknown)
    } finally {
      if (generationEpochRef.current === currentEpoch) {
        setBusy(false)
        setGenerationProgress(null)
      }
    }
  }
  return (
    <div className="portal-content-studio__form">
      <header>
        <div>
          <IconSparkles aria-hidden="true" size={18} />
          <h3>{copy.generate}</h3>
        </div>
        <Button disabled={editorBusy} onClick={onClose} size="compact" variant="ghost">
          {copy.cancel}
        </Button>
      </header>
      {error ? <p role="alert">{error}</p> : null}
      <div aria-label={copy.generationMode} className="portal-content-studio__generation-modes">
        <Button
          aria-pressed={mode === 'copy'}
          disabled={editorBusy}
          onClick={() => requestModeChange('copy')}
          size="compact"
          variant={mode === 'copy' ? 'primary' : 'ghost'}
        >
          {copy.copyGeneration}
        </Button>
        <Button
          aria-pressed={mode === 'image'}
          disabled={editorBusy}
          onClick={() => requestModeChange('image')}
          size="compact"
          variant={mode === 'image' ? 'primary' : 'ghost'}
        >
          {copy.imageGeneration}
        </Button>
      </div>
      {mode === 'image' ? (
        <ImageGenerationEditor
          copy={copy}
          drafts={drafts}
          key={imageEditorResetKey}
          onBusyChange={setImageBusy}
          onDirtyChange={setImageDirty}
          onDone={onDone}
          options={options}
          selectedDraftId={selectedDraftId}
        />
      ) : (
        <>
          <p className="portal-content-studio__generation-note">{copy.generationDescription}</p>
          <div className="portal-content-studio__intent-section">
            <div className="portal-content-studio__intent-meta">
              <span className="portal-content-studio__intent-label">{copy.quickIntentsLabel}</span>
              <span className="portal-content-studio__intent-hint">{copy.quickIntentsHint}</span>
            </div>
            <div className="portal-content-studio__intent-capsules">
              {(['shipment', 'ceiling', 'perforation', 'mockup'] as const).map((intentKey) => {
                const IntentIcon = QUICK_INTENT_ICONS[intentKey]
                return (
                  <button
                    className="portal-content-studio__capsule"
                    disabled={editorBusy}
                    key={intentKey}
                    onClick={() => update('brief', copy.quickIntentDescriptions[intentKey])}
                    type="button"
                  >
                    <IntentIcon aria-hidden="true" size={15} stroke={1.8} />
                    {copy.quickIntents[intentKey]}
                  </button>
                )
              })}
            </div>
          </div>
          <div className="portal-content-studio__form-grid">
            <Field label={copy.brief} required wide>
              <textarea
                disabled={editorBusy}
                maxLength={2000}
                onChange={(event) => update('brief', event.target.value)}
                placeholder={
                  form.assets.length > 0
                    ? copy.briefPlaceholderWithImages
                    : copy.briefPlaceholderGeneral
                }
                rows={4}
                value={form.brief}
              />
            </Field>
            <Field as="div" label={copy.platforms} required wide>
              <div className="portal-content-studio__platform-header">
                <span className="portal-content-studio__platform-hint">{copy.platformsHint}</span>
                <div className="portal-content-studio__platform-actions">
                  <button
                    className="portal-content-studio__platform-link"
                    disabled={editorBusy}
                    onClick={selectAllPlatforms}
                    type="button"
                  >
                    {copy.platformsSelectAll}
                  </button>
                  <span>·</span>
                  <button
                    className="portal-content-studio__platform-link"
                    disabled={editorBusy}
                    onClick={clearPlatforms}
                    type="button"
                  >
                    {copy.platformsClear}
                  </button>
                </div>
              </div>
              <div className="portal-content-studio__platform-grid">
                {[
                  { icon: IconBrandFacebook, key: 'facebook' as const },
                  { icon: IconBrandInstagram, key: 'instagram' as const },
                  { icon: IconBrandLinkedin, key: 'linkedin' as const },
                ].map(({ icon: BrandIcon, key }) => {
                  const selected = form.platforms.includes(key)
                  return (
                    <button
                      aria-pressed={selected}
                      className={`portal-content-studio__platform-card ${selected ? 'is-selected' : ''}`}
                      disabled={editorBusy}
                      key={key}
                      onClick={() => togglePlatform(key)}
                      type="button"
                    >
                      <BrandIcon aria-hidden="true" size={18} />
                      <span className="portal-content-studio__platform-card-name">
                        {copy.platformLabels[key]}
                      </span>
                      {selected ? (
                        <span className="portal-content-studio__platform-card-check">
                          <IconCheck aria-hidden="true" size={14} />
                        </span>
                      ) : null}
                    </button>
                  )
                })}
              </div>
            </Field>
            <Field label={copy.locale} required>
              <UiSelect
                ariaLabel={copy.locale}
                disabled={editorBusy}
                onChange={(val) => update('contentLocale', val as typeof form.contentLocale)}
                options={[
                  { label: 'English (EN)', value: 'en' },
                  { label: 'Arabic / العربية (AR)', value: 'ar' },
                ]}
                value={form.contentLocale}
              />
            </Field>
            <Field label={copy.assets} wide>
              <MultiOptions
                assetPreviews
                disabled={editorBusy}
                onUpload={handleUpload}
                options={combinedAssets}
                selected={form.assets}
                toggle={(value) => toggle('assets', value)}
                uploadBusy={uploadBusy}
                uploadPrompt={copy.uploadPrompt}
                uploadTitle={uploadBusy ? copy.uploadingMedia : copy.uploadMedia}
              />
              {uploadError ? (
                <p className="portal-content-studio__upload-error" role="alert">
                  {uploadError}
                </p>
              ) : null}
              {form.assets.length === 0 ? (
                <label className="portal-content-studio__auto-image-toggle">
                  <input
                    checked={form.autoGenerateImage}
                    disabled={editorBusy}
                    onChange={(event) => update('autoGenerateImage', event.target.checked)}
                    type="checkbox"
                  />
                  <span>{copy.autoGenerateImage}</span>
                </label>
              ) : (
                <p className="portal-content-studio__format-notice">{copy.inferredFormatNotice}</p>
              )}
            </Field>
            <Field label={copy.knowledge} wide>
              <span className="portal-content-studio__field-hint">{copy.knowledgeHint}</span>
              <MultiOptions
                disabled={editorBusy}
                emptyMessage={copy.noKnowledgeOptions}
                options={options.knowledgeSources}
                selected={form.knowledgeSources}
                toggle={(value) => toggle('knowledgeSources', value)}
              />
            </Field>
          </div>
          <footer>
            <div className="portal-content-studio__safety-notice">
              <IconShieldCheck aria-hidden="true" size={15} />
              <span>{copy.generationSafetyNotice}</span>
            </div>
            <Button disabled={editorBusy || !canGenerate} onClick={() => void generate()}>
              <IconSparkles aria-hidden="true" size={16} />
              {busy
                ? (generationProgress ?? copy.generating)
                : form.platforms.length > 0
                  ? copy.generateForPlatforms(form.platforms.length)
                  : copy.generate}
            </Button>
          </footer>
        </>
      )}
      <ConfirmDialog
        cancelLabel={copy.keepDraft}
        confirmLabel={copy.discardAndSwitch}
        description={copy.unsavedChangesDescription}
        onConfirm={() => {
          const commit = pendingModeTransition
          setPendingModeTransition(null)
          commit?.()
        }}
        onOpenChange={(open) => {
          if (!open) setPendingModeTransition(null)
        }}
        open={pendingModeTransition !== null}
        title={copy.unsavedChangesTitle}
        variant="danger"
      />
    </div>
  )
}

type GeneratedImage = {
  id: number
  previewUrl: string
  revisedPrompt: null | string
}

function ImageGenerationEditor({
  copy,
  drafts,
  onBusyChange,
  onDirtyChange,
  onDone,
  options,
  selectedDraftId,
}: {
  copy: Copy
  drafts: ContentStudioItem[]
  onBusyChange?: (busy: boolean) => void
  onDirtyChange?: (dirty: boolean) => void
  onDone: (message: string) => void
  options: ContentStudioSummary['options']
  selectedDraftId: null | number
}) {
  const imageOptions = options.assets.filter((asset) => asset.meta?.startsWith('image/'))
  const generateCommand = usePortalCommandKey('portal-content-studio:image-generate')
  const uploadCommand = usePortalCommandKey('portal-content-studio:image-upload')
  const adoptCommand = usePortalCommandKey('portal-content-studio:image-adopt')
  const [prompt, setPrompt] = useState('')
  const [size, setSize] = useState<'1024x1024' | '1024x1536' | '1536x1024'>('1024x1024')
  const [referenceMediaId, setReferenceMediaId] = useState<number | null>(null)
  const [uploadedReference, setUploadedReference] = useState<
    ContentStudioSummary['options']['assets'][number] | null
  >(null)
  const [referenceFile, setReferenceFile] = useState<File | null>(null)
  const [targetDraftId, setTargetDraftId] = useState<number | null>(
    selectedDraftId ?? drafts[0]?.id ?? null,
  )
  const [generated, setGenerated] = useState<GeneratedImage | null>(null)
  const [busy, setBusy] = useState<'adopt' | 'generate' | 'upload' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const operationEpochRef = useRef(0)
  const formRevisionRef = useRef(0)
  useEffect(() => {
    return () => {
      operationEpochRef.current += 1
    }
  }, [])

  useEffect(() => {
    onBusyChange?.(busy !== null)
    return () => onBusyChange?.(false)
  }, [busy, onBusyChange])

  const isDirty =
    prompt.trim().length > 0 ||
    size !== '1024x1024' ||
    referenceMediaId !== null ||
    uploadedReference !== null ||
    referenceFile !== null ||
    generated !== null

  useEffect(() => {
    onDirtyChange?.(isDirty)
    return () => onDirtyChange?.(false)
  }, [isDirty, onDirtyChange])

  const references = uploadedReference
    ? [uploadedReference, ...imageOptions.filter((asset) => asset.id !== uploadedReference.id)]
    : imageOptions
  const reference = references.find((asset) => asset.id === referenceMediaId) ?? null
  const targetDraft = drafts.find((draft) => draft.id === targetDraftId) ?? null

  const upload = async () => {
    if (!referenceFile || busy !== null) return
    const currentEpoch = ++operationEpochRef.current
    const currentRevision = formRevisionRef.current
    setBusy('upload')
    setError(null)
    const fingerprint = JSON.stringify({
      alt: prompt.trim() || referenceFile.name,
      lastModified: referenceFile.lastModified,
      name: referenceFile.name,
      size: referenceFile.size,
      type: referenceFile.type,
    })
    const key = uploadCommand.key(fingerprint)
    try {
      if (
        !['image/jpeg', 'image/png', 'image/webp'].includes(referenceFile.type) ||
        referenceFile.size > 8 * 1024 * 1024
      ) {
        throw new Error(copy.referenceInvalid)
      }
      const form = new FormData()
      form.set('alt', prompt.trim() || referenceFile.name)
      form.set('source', 'Content Studio protected reference upload')
      form.set('isPublic', 'false')
      form.set('file', referenceFile)
      const response = await fetch('/api/portal/media', {
        body: form,
        headers: { 'Idempotency-Key': key },
        method: 'POST',
      })
      const body = (await response.json()) as {
        error?: { message?: string }
        result?: { id?: number; mimeType?: null | string; previewUrl?: null | string }
      }
      if (!response.ok || typeof body.result?.id !== 'number') {
        uploadCommand.receivedResponse(key)
        throw new Error(body.error?.message || copy.unknown)
      }
      uploadCommand.receivedResponse(key)
      if (
        operationEpochRef.current !== currentEpoch ||
        formRevisionRef.current !== currentRevision
      ) {
        return
      }

      const uploaded = {
        id: body.result.id,
        label: referenceFile.name,
        meta: body.result.mimeType ?? referenceFile.type,
        ...(body.result.previewUrl ? { previewUrl: body.result.previewUrl } : {}),
      }
      formRevisionRef.current += 1
      setUploadedReference(uploaded)
      setReferenceMediaId(uploaded.id)
    } catch (caught) {
      if (
        operationEpochRef.current !== currentEpoch ||
        formRevisionRef.current !== currentRevision
      ) {
        return
      }
      setError(caught instanceof Error ? caught.message : copy.unknown)
    } finally {
      if (operationEpochRef.current === currentEpoch) {
        setBusy(null)
      }
    }
  }

  const generate = async () => {
    if (busy !== null) return
    const currentEpoch = ++operationEpochRef.current
    const currentRevision = formRevisionRef.current
    const input = { prompt: prompt.trim(), referenceMediaId, size }
    const key = generateCommand.key(JSON.stringify(input))
    setBusy('generate')
    setError(null)
    try {
      const response = await fetch('/api/portal/content-studio/generate-image', {
        body: JSON.stringify(input),
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json', 'Idempotency-Key': key },
        method: 'POST',
      })
      const body = (await response.json()) as {
        error?: { code?: string; message?: string }
        media?: { id?: number; previewUrl?: null | string }
        revisedPrompt?: null | string
      }
      if (!response.ok) {
        if (body.error?.code !== 'portal-command-result-unknown') {
          generateCommand.receivedResponse(key)
        }
        throw new Error(body.error?.message || copy.unknown)
      }
      if (typeof body.media?.id !== 'number' || !body.media.previewUrl) {
        throw new Error(copy.imagePreviewUnavailable)
      }
      generateCommand.receivedResponse(key)
      if (
        operationEpochRef.current !== currentEpoch ||
        formRevisionRef.current !== currentRevision
      ) {
        return
      }

      setGenerated({
        id: body.media.id,
        previewUrl: body.media.previewUrl,
        revisedPrompt: body.revisedPrompt ?? null,
      })
    } catch (caught) {
      if (
        operationEpochRef.current !== currentEpoch ||
        formRevisionRef.current !== currentRevision
      ) {
        return
      }
      setError(caught instanceof Error ? caught.message : copy.unknown)
    } finally {
      if (operationEpochRef.current === currentEpoch) {
        setBusy(null)
      }
    }
  }

  const adopt = async () => {
    if (!generated || !targetDraft || busy !== null) return
    const currentEpoch = ++operationEpochRef.current
    const currentRevision = formRevisionRef.current
    const input = { action: 'adopt-image', mediaId: generated.id, updatedAt: targetDraft.updatedAt }
    const key = adoptCommand.key(JSON.stringify({ id: targetDraft.id, ...input }))
    setBusy('adopt')
    setError(null)
    try {
      await request(
        `/api/portal/content-studio/${targetDraft.id}`,
        'POST',
        input,
        () => adoptCommand.receivedResponse(key),
        key,
      )
      if (
        operationEpochRef.current !== currentEpoch ||
        formRevisionRef.current !== currentRevision
      ) {
        return
      }

      onDirtyChange?.(false)
      onDone(copy.imageAdopted)
    } catch (caught) {
      if (
        operationEpochRef.current !== currentEpoch ||
        formRevisionRef.current !== currentRevision
      ) {
        return
      }
      setError(caught instanceof Error ? caught.message : copy.unknown)
    } finally {
      if (operationEpochRef.current === currentEpoch) {
        setBusy(null)
      }
    }
  }

  return (
    <section className="portal-content-studio__image-editor">
      {error ? <p role="alert">{error}</p> : null}
      <p className="portal-content-studio__generation-note">{copy.imageGenerationDescription}</p>
      <div className="portal-content-studio__form-grid">
        <Field label={copy.imagePrompt} wide>
          <textarea
            disabled={busy !== null}
            maxLength={2000}
            onChange={(event) => {
              formRevisionRef.current += 1
              setPrompt(event.target.value)
              setGenerated(null)
            }}
            rows={5}
            value={prompt}
          />
        </Field>
        <Field label={copy.imageSize}>
          <UiSelect
            ariaLabel={copy.imageSize}
            disabled={busy !== null}
            onChange={(val) => {
              formRevisionRef.current += 1
              setSize(val as typeof size)
              setGenerated(null)
            }}
            options={[
              { label: '1024 × 1024', value: '1024x1024' },
              { label: '1536 × 1024', value: '1536x1024' },
              { label: '1024 × 1536', value: '1024x1536' },
            ]}
            value={size}
          />
        </Field>
        <Field label={copy.referenceAsset}>
          <UiSelect
            ariaLabel={copy.referenceAsset}
            disabled={busy !== null}
            onChange={(val) => {
              formRevisionRef.current += 1
              setReferenceMediaId(val ? Number(val) : null)
              setGenerated(null)
            }}
            options={[
              { label: copy.noReference, value: '' },
              ...references.map((asset) => ({ label: asset.label, value: String(asset.id) })),
            ]}
            value={referenceMediaId ? String(referenceMediaId) : ''}
          />
        </Field>
        <div className="portal-content-studio__upload-field is-wide">
          <label htmlFor="content-studio-reference-upload">{copy.uploadReference}</label>
          <div className="portal-content-studio__image-upload">
            <input
              accept="image/avif,image/jpeg,image/png,image/webp"
              disabled={busy !== null}
              id="content-studio-reference-upload"
              onChange={(event) => {
                formRevisionRef.current += 1
                setReferenceFile(event.target.files?.[0] ?? null)
              }}
              type="file"
            />
            <Button
              disabled={busy !== null || !referenceFile}
              onClick={() => void upload()}
              size="compact"
              variant="secondary"
            >
              <IconUpload aria-hidden="true" size={15} />
              {copy.uploadReference}
            </Button>
          </div>
        </div>
      </div>
      {reference?.previewUrl ? (
        <div className="portal-content-studio__image-preview is-reference">
          <Image
            alt={copy.referencePreview}
            height={240}
            src={reference.previewUrl}
            unoptimized
            width={320}
          />
        </div>
      ) : null}
      <footer>
        <Button disabled={busy !== null || !prompt.trim()} onClick={() => void generate()}>
          <IconSparkles aria-hidden="true" size={16} />
          {copy.generateImage}
        </Button>
      </footer>
      {generated ? (
        <section className="portal-content-studio__generated-image">
          <div className="portal-content-studio__image-preview">
            <Image
              alt={copy.generatedPreview}
              height={512}
              src={generated.previewUrl}
              unoptimized
              width={512}
            />
          </div>
          {generated.revisedPrompt ? <p>{generated.revisedPrompt}</p> : null}
          <Field label={copy.targetDraft}>
            <UiSelect
              ariaLabel={copy.targetDraft}
              disabled={busy !== null}
              onChange={(val) => setTargetDraftId(val ? Number(val) : null)}
              options={[
                { label: copy.selectDraft, value: '' },
                ...drafts.map((draft) => ({ label: draft.title, value: String(draft.id) })),
              ]}
              value={targetDraftId ? String(targetDraftId) : ''}
            />
          </Field>
          <Button disabled={busy !== null || !targetDraft} onClick={() => void adopt()}>
            {copy.adoptImage}
          </Button>
        </section>
      ) : null}
    </section>
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

function AssetThumbnail({ option }: { option: ContentStudioSummary['options']['assets'][number] }) {
  const [failed, setFailed] = useState(false)
  const isImage = option.meta?.startsWith('image/') === true
  const isPDF = option.meta === 'application/pdf'

  return (
    <span
      aria-hidden="true"
      className={`portal-content-studio__asset-thumb ${isPDF ? 'is-pdf' : isImage ? 'is-image' : 'is-file'}`}
    >
      {isImage && option.previewUrl && !failed ? (
        <Image
          alt=""
          fill
          onError={() => setFailed(true)}
          sizes="96px"
          src={option.previewUrl}
          unoptimized
        />
      ) : isPDF ? (
        <IconFileTypePdf size={26} stroke={1.5} />
      ) : isImage ? (
        <IconPhoto size={26} stroke={1.5} />
      ) : (
        <IconFile size={26} stroke={1.5} />
      )}
    </span>
  )
}

function MultiOptions({
  assetPreviews = false,
  disabled = false,
  emptyMessage,
  onUpload,
  options,
  selected,
  toggle,
  uploadBusy = false,
  uploadPrompt,
  uploadTitle,
}: {
  assetPreviews?: boolean
  disabled?: boolean
  emptyMessage?: string
  onUpload?: (files: FileList | File[]) => Promise<void>
  options:
    ContentStudioSummary['options']['assets'] | ContentStudioSummary['options']['knowledgeSources']
  selected: string[]
  toggle: (value: string) => void
  uploadBusy?: boolean
  uploadPrompt?: string
  uploadTitle?: string
}) {
  const [isDragOver, setIsDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleDragOver = (event: React.DragEvent) => {
    event.preventDefault()
    event.stopPropagation()
    if (!uploadBusy && !disabled) setIsDragOver(true)
  }

  const handleDragLeave = (event: React.DragEvent) => {
    event.preventDefault()
    event.stopPropagation()
    setIsDragOver(false)
  }

  const handleDrop = (event: React.DragEvent) => {
    event.preventDefault()
    event.stopPropagation()
    setIsDragOver(false)
    if (uploadBusy || disabled || !onUpload) return
    const files = event.dataTransfer.files
    if (files && files.length > 0) {
      void onUpload(files)
    }
  }

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files
    if (files && files.length > 0 && onUpload && !disabled) {
      void onUpload(files)
    }
    event.target.value = ''
  }

  return (
    <div
      className={`portal-content-studio__multi-options${assetPreviews ? ' is-assets' : ''}${disabled ? ' is-disabled' : ''}`}
    >
      {assetPreviews && onUpload ? (
        <label
          className={`portal-content-studio__asset-upload-card${uploadBusy ? ' is-busy' : ''}${isDragOver ? ' is-drag-over' : ''}${disabled ? ' is-disabled' : ''}`}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
        >
          <input
            accept="image/avif,image/jpeg,image/png,image/webp"
            disabled={disabled || uploadBusy}
            onChange={handleFileChange}
            ref={fileInputRef}
            style={{ display: 'none' }}
            multiple
            type="file"
          />
          <div className="portal-content-studio__asset-upload-inner">
            <IconUpload aria-hidden="true" size={20} stroke={1.8} />
            {uploadTitle ? (
              <span className="portal-content-studio__asset-upload-title">{uploadTitle}</span>
            ) : null}
            {uploadPrompt ? (
              <small className="portal-content-studio__asset-upload-prompt">{uploadPrompt}</small>
            ) : null}
          </div>
        </label>
      ) : null}
      {options.length ? (
        options.map((option) => {
          const checked = selected.includes(String(option.id))
          return (
            <label
              className={`${assetPreviews ? 'portal-content-studio__asset-option' : ''}${checked ? ' is-selected' : ''}${disabled ? ' is-disabled' : ''}`}
              key={option.id}
            >
              <input
                aria-label={option.label}
                checked={checked}
                disabled={disabled}
                onChange={() => !disabled && toggle(String(option.id))}
                type="checkbox"
              />
              {assetPreviews ? <AssetThumbnail option={option} /> : null}
              <span
                className={
                  assetPreviews
                    ? 'portal-content-studio__asset-copy'
                    : 'portal-content-studio__option-text'
                }
              >
                <span title={option.label}>{option.label}</span>
                {option.meta ? <small>{option.meta}</small> : null}
              </span>
            </label>
          )
        })
      ) : assetPreviews && onUpload ? null : (
        <span className="portal-content-studio__empty-options">{emptyMessage ?? '—'}</span>
      )}
    </div>
  )
}
function Field({
  as: Component = 'label',
  children,
  className,
  label,
  required = false,
  wide = false,
}: {
  as?: 'div' | 'label'
  children: React.ReactNode
  className?: string
  label: string
  required?: boolean
  wide?: boolean
}) {
  return (
    <Component className={`portal-field ${wide ? 'is-wide' : ''} ${className ?? ''}`.trim()}>
      <span>
        {required ? <span aria-hidden="true" className="portal-required" /> : null}
        {label}
      </span>
      {children}
    </Component>
  )
}
