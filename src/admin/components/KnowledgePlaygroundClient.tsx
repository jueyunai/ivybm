'use client'

import { useTranslation } from '@payloadcms/ui'
import { type FormEvent, useState } from 'react'

import { getAdminCopy } from '../i18n'

type PreviewResult =
  | {
      citations: Array<{ documentId: number | string; title: string; url?: string; version: string }>
      content: string
      model: string
      outcome: 'answer'
      promptVersion: number
      tokenUsage: { inputTokens: number; outputTokens?: number; totalTokens: number }
    }
  | { outcome: 'handoff'; reason: string }

export default function KnowledgePlaygroundClient() {
  const { i18n } = useTranslation()
  const copy = getAdminCopy(i18n.language).knowledge
  const [locale, setLocale] = useState<'ar' | 'en'>('en')
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [result, setResult] = useState<PreviewResult>()

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const normalized = query.trim()
    if (!normalized || busy) return
    setBusy(true)
    setError(undefined)
    setResult(undefined)
    try {
      const response = await fetch('/api/knowledge/preview', {
        body: JSON.stringify({ locale, query: normalized }),
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      })
      if (!response.ok) throw new Error(response.status === 429 ? copy.rateLimited : copy.previewFailed)
      setResult((await response.json()) as PreviewResult)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : copy.previewFailed)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="ops-knowledge-playground__grid">
      <form className="ops-knowledge-playground__form" onSubmit={(event) => void submit(event)}>
        <label htmlFor="knowledge-preview-locale">{copy.localeLabel}</label>
        <select
          id="knowledge-preview-locale"
          onChange={(event) => setLocale(event.target.value === 'ar' ? 'ar' : 'en')}
          value={locale}
        >
          <option value="en">English</option>
          <option value="ar">العربية</option>
        </select>
        <label htmlFor="knowledge-preview-query">{copy.queryLabel}</label>
        <textarea
          dir={locale === 'ar' ? 'rtl' : 'ltr'}
          id="knowledge-preview-query"
          maxLength={2_000}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={copy.queryPlaceholder}
          required
          rows={7}
          value={query}
        />
        <button className="ops-knowledge-button" disabled={busy || !query.trim()} type="submit">
          {busy ? copy.previewing : copy.preview}
        </button>
        {error ? <p className="ops-knowledge-feedback ops-knowledge-feedback--error" role="alert">{error}</p> : null}
      </form>

      <section aria-live="polite" className="ops-knowledge-playground__result">
        <h2>{copy.resultTitle}</h2>
        {!result ? <p className="ops-knowledge-playground__empty">{copy.resultEmpty}</p> : null}
        {result?.outcome === 'handoff' ? (
          <div className="ops-knowledge-preview-card ops-knowledge-preview-card--handoff">
            <strong>{copy.handoffTitle}</strong>
            <p>{copy.handoffReasons[result.reason] || copy.handoffDefault}</p>
          </div>
        ) : null}
        {result?.outcome === 'answer' ? (
          <div className="ops-knowledge-preview-card">
            <p className="ops-knowledge-preview-card__answer">{result.content}</p>
            <dl>
              <div><dt>{copy.modelLabel}</dt><dd>{result.model}</dd></div>
              <div><dt>{copy.promptVersionLabel}</dt><dd>v{result.promptVersion}</dd></div>
              <div><dt>{copy.tokensLabel}</dt><dd>{result.tokenUsage.totalTokens}</dd></div>
            </dl>
            <h3>{copy.citationsTitle}</h3>
            <ul>
              {result.citations.map((citation) => (
                <li key={`${citation.documentId}-${citation.version}`}>
                  <a href={`/admin/collections/knowledge-documents/${citation.documentId}`}>
                    {citation.title} · v{citation.version}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>
    </div>
  )
}
