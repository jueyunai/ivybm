'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

export default function FeishuDisconnectButton({
  connectionId,
  connectionName,
}: {
  connectionId: number | string
  connectionName: string
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<
    { kind: 'error' | 'success'; text: string } | undefined
  >()

  const disconnect = async () => {
    if (busy) return
    if (!window.confirm(`确定要断开“${connectionName}”吗？断开后将停止线索同步和通知。`)) return

    setBusy(true)
    setFeedback(undefined)
    try {
      const response = await fetch('/api/integrations/feishu/disconnect', {
        body: JSON.stringify({ connectionId }),
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      })
      if (!response.ok) throw new Error('disconnect_failed')
      setFeedback({ kind: 'success', text: '飞书连接已断开，相关同步映射已停用。' })
      router.refresh()
    } catch {
      setFeedback({ kind: 'error', text: '断开失败，连接状态未改变，请稍后重试。' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <button aria-busy={busy} disabled={busy} onClick={() => void disconnect()} type="button">
        {busy ? '正在断开…' : '断开飞书连接'}
      </button>
      {feedback ? (
        <p role={feedback.kind === 'error' ? 'alert' : 'status'}>{feedback.text}</p>
      ) : null}
    </div>
  )
}
