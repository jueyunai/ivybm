'use client'

import { useAuth, useDocumentInfo, useFormModified, useTranslation } from '@payloadcms/ui'
import { useCallback, useEffect, useRef, useState } from 'react'

import { getKnowledgeIndexActionState } from '../knowledge/getKnowledgeIndexActionState'
import { getAdminCopy } from '../i18n'

type IndexResponse = {
  error?: { code?: string }
  jobId?: number
  state?: 'created' | 'duplicate'
  status?: string
}

type KnowledgeDocumentSnapshot = {
  indexStatus?: string
  reviewStatus?: string
}

const TERMINAL_INDEX_STATUSES = new Set(['failed', 'ready'])

export default function KnowledgeIndexActions() {
  const { user } = useAuth()
  const { data, id, setData } = useDocumentInfo()
  const latestData = useRef(data)
  const isModified = useFormModified()
  const { i18n } = useTranslation()
  const copy = getAdminCopy(i18n.language).knowledge
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<
    | { jobId?: number; kind: 'error' | 'info' | 'success'; text: string }
    | undefined
  >()

  useEffect(() => {
    latestData.current = data
  }, [data])

  const indexStatus = data?.indexStatus
  const reviewStatus = data?.reviewStatus
  const role = user && typeof user === 'object' && 'role' in user ? user.role : undefined
  const state = getKnowledgeIndexActionState({
    hasDocument: id !== undefined && id !== null,
    indexStatus,
    isModified,
    reviewStatus,
    role,
  })

  const refreshDocument = useCallback(async () => {
    if (!id) throw new Error('document_refresh_failed')
    const response = await fetch(`/api/knowledge-documents/${id}?depth=0`, {
      cache: 'no-store',
      credentials: 'same-origin',
    })
    if (!response.ok) throw new Error('document_refresh_failed')
    const document = (await response.json()) as KnowledgeDocumentSnapshot
    setData({ ...latestData.current, ...document })
    return document
  }, [id, setData])

  useEffect(() => {
    if (!busy || !id) return
    let cancelled = false
    let remaining = 20
    let timer: ReturnType<typeof setTimeout> | undefined

    async function tick() {
      try {
        const document = await refreshDocument()
        if (cancelled) return
        if (document.indexStatus && TERMINAL_INDEX_STATUSES.has(document.indexStatus)) {
          setBusy(false)
          setFeedback({
            kind: document.indexStatus === 'ready' ? 'success' : 'error',
            text: document.indexStatus === 'ready' ? copy.indexReady : copy.indexFailed,
          })
          return
        }
        remaining -= 1
        if (remaining < 1) {
          setBusy(false)
          setFeedback({ kind: 'info', text: copy.pollingTimedOut })
          return
        }
        timer = setTimeout(() => void tick(), 1_500)
      } catch {
        if (cancelled) return
        setBusy(false)
        setFeedback({ kind: 'error', text: copy.refreshFailed })
      }
    }

    timer = setTimeout(() => void tick(), 500)
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [
    busy,
    copy.indexFailed,
    copy.indexReady,
    copy.pollingTimedOut,
    copy.refreshFailed,
    id,
    refreshDocument,
  ])

  const submitIndex = async () => {
    if (!id || !state.enabled || busy) return
    setBusy(true)
    setFeedback(undefined)
    try {
      const response = await fetch(`/api/knowledge/documents/${id}/index`, {
        credentials: 'same-origin',
        method: 'POST',
      })
      const result = (await response.json()) as IndexResponse
      if (!response.ok) {
        const message =
          result.error?.code === 'knowledge_not_reviewed'
            ? copy.reviewRequired
            : result.error?.code === 'knowledge_index_rate_limited'
              ? copy.rateLimited
              : copy.submitFailed
        throw new Error(message)
      }
      setFeedback({
        jobId: result.jobId,
        kind: 'info',
        text: result.state === 'duplicate' ? copy.jobAlreadyQueued : copy.jobQueued,
      })
      setData({ ...latestData.current, indexStatus: 'processing' })
    } catch (error) {
      setBusy(false)
      setFeedback({
        kind: 'error',
        text: error instanceof Error ? error.message : copy.submitFailed,
      })
    }
  }

  const actionLabel =
    state.action === 'processing'
      ? copy.processing
      : state.action === 'retry'
          ? copy.retry
          : state.action === 'reindex'
            ? copy.reindex
            : copy.submitIndex
  const reason = state.reason ? copy.indexReasons[state.reason] : undefined

  return (
    <section className="ops-knowledge-index" data-testid="knowledge-index-actions">
      <div>
        <strong>{copy.indexTitle}</strong>
        <p>{busy ? copy.waitingForWorker : reason || copy.indexDescription}</p>
      </div>
      <div className="ops-knowledge-index__controls">
        {feedback ? (
          <p className={`ops-knowledge-feedback ops-knowledge-feedback--${feedback.kind}`} role="status">
            {feedback.text}
            {feedback.jobId ? (
              <a href={`/admin/collections/jobs/${feedback.jobId}`}> {copy.openJob}</a>
            ) : null}
          </p>
        ) : null}
        <button
          className="ops-knowledge-button"
          disabled={!state.enabled || busy}
          onClick={() => void submitIndex()}
          type="button"
        >
          {busy ? copy.processing : actionLabel}
        </button>
      </div>
    </section>
  )
}
