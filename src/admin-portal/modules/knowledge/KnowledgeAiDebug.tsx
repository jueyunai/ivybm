'use client'

import { useState } from 'react'

import { IconPlayerPlay, IconSparkles, IconTerminal2 } from '@tabler/icons-react'

import { usePortalCommandKey } from '@/admin-portal/core/commands/usePortalCommandKey'
import { usePortalPreferences } from '@/admin-portal/core/navigation/PortalPreferences'
import { Button } from '@/admin-portal/core/ui'

import type { KnowledgeAiDebugResult } from './knowledgeAiDebugCommand'

const copy = {
  en: {
    citations: 'Cited knowledge:',
    error: 'AI debug is currently unavailable.',
    handoff: 'Handoff triggered',
    handoffReason: {
      high_risk_topic: 'The request requires human review.',
      qualification_incomplete: 'The request needs more qualification details.',
      reviewed_knowledge_unavailable: 'Reviewed knowledge is unavailable.',
    },
    handoffReasonUnknown: 'A human review is required.',
    input: 'Debug prompt',
    knowledgeLanguage: 'Knowledge language',
    localeArabic: 'Arabic',
    localeEnglish: 'English',
    promptVersion: 'Prompt',
    result: 'Safe result',
    run: 'Run debug',
    running: 'Running...',
    title: 'AI debug',
    tokens: 'Tokens',
  },
  zh: {
    citations: '命中与引用知识：',
    error: 'AI 调试当前不可用。',
    handoff: '已触发转人工',
    handoffReason: {
      high_risk_topic: '该请求需要人工审核。',
      qualification_incomplete: '该请求仍需补充资格信息。',
      reviewed_knowledge_unavailable: '暂无可用的已审核知识。',
    },
    handoffReasonUnknown: '该请求需要转交人工处理。',
    input: '调试输入',
    knowledgeLanguage: '知识语言',
    localeArabic: '阿拉伯语',
    localeEnglish: '英语',
    promptVersion: 'Prompt 版本',
    result: '安全结果',
    run: '运行调试',
    running: '运行中…',
    title: 'AI 调试',
    tokens: 'Token 消耗',
  },
} as const

export function KnowledgeAiDebug() {
  const { locale } = usePortalPreferences()
  const text = copy[locale]
  const [prompt, setPrompt] = useState('')
  const [knowledgeLocale, setKnowledgeLocale] = useState<'ar' | 'en'>('en')
  const [debugResult, setDebugResult] = useState<KnowledgeAiDebugResult | null>(null)
  const [result, setResult] = useState('')
  const [error, setError] = useState('')
  const [running, setRunning] = useState(false)
  const commandKey = usePortalCommandKey('portal-knowledge-ai')
  const citations = Array.from(
    new Map(
      (debugResult?.citations ?? []).map((citation) => [
        `${String(citation.documentId)}:${citation.version}`,
        citation,
      ]),
    ).values(),
  )

  const run = async () => {
    setRunning(true)
    setError('')
    setResult('')
    setDebugResult(null)
    try {
      const fingerprint = JSON.stringify({ locale: knowledgeLocale, prompt })
      const idempotencyKey = commandKey.key(fingerprint)
      const response = await fetch('/api/portal/knowledge/ai-debug', {
        body: fingerprint,
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
        },
        method: 'POST',
      })
      const body = (await response.json()) as {
        error?: { message?: unknown }
        result?: KnowledgeAiDebugResult
      }
      commandKey.receivedResponse(idempotencyKey)
      if (!response.ok) {
        throw new Error(typeof body.error?.message === 'string' ? body.error.message : text.error)
      }
      const data = body.result
      setDebugResult(data ?? null)
      if (data?.outcome === 'handoff') return
      const output = typeof data?.text === 'string' ? data.text : ''
      const totalTokens = data?.usage?.totalTokens
      setResult(
        typeof totalTokens === 'number' ? `${output}\n\n${text.tokens}: ${totalTokens}` : output,
      )
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : text.error)
    } finally {
      setRunning(false)
    }
  }

  return (
    <section className="portal-knowledge-ai-debug" aria-label={text.title}>
      <header>
        <IconTerminal2 aria-hidden="true" size={16} />
        <strong>{text.title}</strong>
        {debugResult?.promptVersion ? (
          <span style={{ fontSize: '10px', marginLeft: 'auto', opacity: 0.8 }}>
            <IconSparkles
              aria-hidden="true"
              size={12}
              style={{ display: 'inline', marginRight: '2px', verticalAlign: '-1px' }}
            />
            {text.promptVersion} v{debugResult.promptVersion}
          </span>
        ) : null}
      </header>
      <label>
        <span>{text.knowledgeLanguage}</span>
        <select
          disabled={running}
          onChange={(event) => setKnowledgeLocale(event.target.value === 'ar' ? 'ar' : 'en')}
          value={knowledgeLocale}
        >
          <option value="en">{text.localeEnglish}</option>
          <option value="ar">{text.localeArabic}</option>
        </select>
      </label>
      <label>
        <span>{text.input}</span>
        <textarea
          disabled={running}
          dir={knowledgeLocale === 'ar' ? 'rtl' : 'ltr'}
          maxLength={4000}
          onChange={(event) => setPrompt(event.target.value)}
          rows={4}
          value={prompt}
        />
      </label>
      <Button
        disabled={running || !prompt.trim()}
        onClick={() => void run()}
        size="compact"
        variant="secondary"
      >
        <IconPlayerPlay aria-hidden="true" size={14} />
        {running ? text.running : text.run}
      </Button>
      {error ? (
        <p className="is-error" role="alert">
          {error}
        </p>
      ) : null}
      {debugResult?.outcome === 'handoff' ? (
        <div className="portal-knowledge-ai-debug__result" role="status">
          <span>{text.handoff}</span>
          <p>
            {text.handoffReason[debugResult.reason as keyof (typeof text)['handoffReason']] ??
              text.handoffReasonUnknown}
          </p>
        </div>
      ) : null}
      {result ? (
        <div className="portal-knowledge-ai-debug__result" role="status">
          <span>{text.result}</span>
          <pre dir={knowledgeLocale === 'ar' ? 'rtl' : 'ltr'}>{result}</pre>
          {citations.length > 0 ? (
            <div
              className="portal-knowledge-ai-debug__citations"
              dir={knowledgeLocale === 'ar' ? 'rtl' : 'ltr'}
            >
              <strong>{text.citations}</strong>
              <ul>
                {citations.map((c) => (
                  <li key={`${String(c.documentId)}:${c.version}`}>
                    {c.title} (v{c.version})
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
