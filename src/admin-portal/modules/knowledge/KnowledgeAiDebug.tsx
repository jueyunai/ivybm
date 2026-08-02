'use client'

import { useState } from 'react'

import { IconPlayerPlay, IconTerminal2 } from '@tabler/icons-react'

import { usePortalPreferences } from '@/admin-portal/core/navigation/PortalPreferences'
import { Button } from '@/admin-portal/core/ui'

const copy = {
  en: {
    error: 'AI debug is currently unavailable.',
    input: 'Debug prompt',
    result: 'Safe result',
    run: 'Run debug',
    running: 'Running...',
    title: 'AI debug',
  },
  zh: {
    error: 'AI 调试当前不可用。',
    input: '调试输入',
    result: '安全结果',
    run: '运行调试',
    running: '运行中…',
    title: 'AI 调试',
  },
} as const

export function KnowledgeAiDebug() {
  const { locale } = usePortalPreferences()
  const text = copy[locale]
  const [prompt, setPrompt] = useState('')
  const [result, setResult] = useState('')
  const [error, setError] = useState('')
  const [running, setRunning] = useState(false)

  const run = async () => {
    setRunning(true)
    setError('')
    setResult('')
    try {
      const response = await fetch('/api/portal/knowledge/ai-debug', {
        body: JSON.stringify({ prompt }),
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': `portal-knowledge-ai:${crypto.randomUUID()}`,
        },
        method: 'POST',
      })
      const body = (await response.json()) as {
        error?: { message?: unknown }
        result?: { text?: unknown; usage?: { totalTokens?: unknown } }
      }
      if (!response.ok) {
        throw new Error(typeof body.error?.message === 'string' ? body.error.message : text.error)
      }
      const output = typeof body.result?.text === 'string' ? body.result.text : ''
      const totalTokens = body.result?.usage?.totalTokens
      setResult(typeof totalTokens === 'number' ? `${output}\n\nTokens: ${totalTokens}` : output)
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
      </header>
      <label>
        <span>{text.input}</span>
        <textarea
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
      {result ? (
        <div className="portal-knowledge-ai-debug__result">
          <span>{text.result}</span>
          <pre>{result}</pre>
        </div>
      ) : null}
    </section>
  )
}
