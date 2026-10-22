'use client'

import { useEffect, useState } from 'react'

import type { PortalLocale } from '../i18n/types'
import { Button } from '../ui/Button'
import { PortalState } from '../ui/PortalState'

const REFRESH_INTERVAL_MS = 30 * 60 * 1000
const RETRY_INTERVAL_MS = 60 * 1000
const REQUEST_TIMEOUT_MS = 15 * 1000
const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'input', 'scroll'] as const

export function PortalSessionKeeper({
  fetcher = globalThis.fetch,
  locale,
}: {
  fetcher?: typeof fetch
  locale: PortalLocale
}) {
  const [expired, setExpired] = useState(false)

  useEffect(() => {
    let disposed = false
    let pending = false
    let invalidSession = false
    let lastActivityAt = Date.now()
    let nextRefreshAt = 0
    let controller: AbortController | null = null

    const refresh = async (retryInvalidSession = false) => {
      const now = Date.now()
      if (
        disposed ||
        pending ||
        document.visibilityState !== 'visible' ||
        (invalidSession && !retryInvalidSession) ||
        now - lastActivityAt >= REFRESH_INTERVAL_MS ||
        now < nextRefreshAt
      )
        return

      pending = true
      nextRefreshAt = now + RETRY_INTERVAL_MS
      controller = new AbortController()
      const timeout = window.setTimeout(() => controller?.abort(), REQUEST_TIMEOUT_MS)

      try {
        const response = await fetcher('/api/users/refresh-token', {
          cache: 'no-store',
          credentials: 'same-origin',
          method: 'POST',
          signal: controller.signal,
        })
        if (disposed) return

        if (response.status === 401 || response.status === 403) {
          invalidSession = true
          setExpired(true)
        } else if (response.ok) {
          invalidSession = false
          setExpired(false)
          nextRefreshAt = Date.now() + REFRESH_INTERVAL_MS
        }
      } catch {
        // Transient failures retry on the next check without redirecting or losing input.
      } finally {
        window.clearTimeout(timeout)
        controller = null
        pending = false
      }
    }

    const onActivity = () => {
      if (document.visibilityState !== 'visible') return
      lastActivityAt = Date.now()
      void refresh()
    }
    const onResume = () => {
      if (document.visibilityState !== 'visible') return
      lastActivityAt = Date.now()
      if (invalidSession) nextRefreshAt = 0
      void refresh(true)
    }

    const listenerOptions = { capture: true, passive: true }
    for (const event of ACTIVITY_EVENTS) {
      document.addEventListener(event, onActivity, listenerOptions)
    }
    document.addEventListener('visibilitychange', onResume)
    window.addEventListener('focus', onResume)
    window.addEventListener('online', onResume)
    const interval = window.setInterval(() => void refresh(), RETRY_INTERVAL_MS)
    void refresh()

    return () => {
      disposed = true
      window.clearInterval(interval)
      controller?.abort()
      for (const event of ACTIVITY_EVENTS) {
        document.removeEventListener(event, onActivity, true)
      }
      document.removeEventListener('visibilitychange', onResume)
      window.removeEventListener('focus', onResume)
      window.removeEventListener('online', onResume)
    }
  }, [fetcher])

  if (!expired) return null

  return (
    <PortalState
      action={
        <Button asChild size="compact">
          <a href="/dashboard/login" rel="noopener noreferrer" target="_blank">
            {locale === 'zh' ? '在新标签页重新登录' : 'Sign in in a new tab'}
          </a>
        </Button>
      }
      description={
        locale === 'zh'
          ? '未保存内容仍保留在当前页面。请使用当前账号重新登录，返回后再次保存；请勿刷新或关闭此页。'
          : 'Your unsaved work is still on this page. Sign in with the same account, then return and save again. Keep this page open without reloading.'
      }
      title={locale === 'zh' ? '登录状态已失效' : 'Your session has expired'}
      type="error"
    />
  )
}
