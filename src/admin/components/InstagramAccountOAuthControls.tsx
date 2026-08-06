'use client'

import { useDocumentInfo, useTranslation } from '@payloadcms/ui'
import { useEffect, useMemo, useRef, useState } from 'react'

import { getAdminLocale, type AdminLocale } from '../i18n'

type InstagramOAuthTone = 'error' | 'success'

type InstagramOAuthResultMessage = {
  message: string
  tone: InstagramOAuthTone
}

const RESULT_COPY: Record<AdminLocale, Record<string, InstagramOAuthResultMessage>> = {
  en: {
    account_changed: {
      message: 'The saved Instagram account changed during authorization. Start again.',
      tone: 'error',
    },
    account_not_found: {
      message: 'The Instagram platform account no longer exists.',
      tone: 'error',
    },
    authentication_required: {
      message: 'Sign in again before connecting Instagram.',
      tone: 'error',
    },
    connected: {
      message: 'The Instagram account was connected successfully.',
      tone: 'success',
    },
    disconnected: {
      message: 'The Instagram credentials were removed.',
      tone: 'success',
    },
    forbidden: {
      message: 'Only an administrator can connect Instagram.',
      tone: 'error',
    },
    identity_mismatch: {
      message: 'The authorized Instagram account does not match this record.',
      tone: 'error',
    },
    identity_verification_failed: {
      message: 'Instagram could not verify the selected professional account. Try again later.',
      tone: 'error',
    },
    invalid_transaction: {
      message: 'The authorization request expired. Start the connection again.',
      tone: 'error',
    },
    provider_denied: {
      message: 'Instagram authorization was cancelled or denied.',
      tone: 'error',
    },
    required_permission_missing: {
      message: 'Instagram did not grant every permission required for this account.',
      tone: 'error',
    },
    state_mismatch: {
      message: 'The Instagram authorization security check failed. Start again.',
      tone: 'error',
    },
    token_exchange_failed: {
      message: 'Instagram could not complete the token exchange. Try again later.',
      tone: 'error',
    },
    unavailable: {
      message: 'Instagram OAuth is not configured on this server.',
      tone: 'error',
    },
  },
  zh: {
    account_changed: {
      message: '授权期间账号记录发生变化，请重新开始。',
      tone: 'error',
    },
    account_not_found: {
      message: '对应的平台账号记录已不存在。',
      tone: 'error',
    },
    authentication_required: {
      message: '请重新登录后台后再连接 Instagram。',
      tone: 'error',
    },
    connected: {
      message: 'Instagram 账号已成功连接。',
      tone: 'success',
    },
    disconnected: {
      message: 'Instagram 授权凭据已清除。',
      tone: 'success',
    },
    forbidden: {
      message: '只有管理员可以连接 Instagram。',
      tone: 'error',
    },
    identity_mismatch: {
      message: '授权的 Instagram 账号与当前记录不一致。',
      tone: 'error',
    },
    identity_verification_failed: {
      message: 'Instagram 暂时无法确认所选专业账号，请稍后重试。',
      tone: 'error',
    },
    invalid_transaction: {
      message: '授权请求已过期，请重新连接。',
      tone: 'error',
    },
    provider_denied: {
      message: 'Instagram 授权已取消或被拒绝。',
      tone: 'error',
    },
    required_permission_missing: {
      message: 'Instagram 没有授予该账号所需的全部权限。',
      tone: 'error',
    },
    state_mismatch: {
      message: 'Instagram 授权安全校验失败，请重新连接。',
      tone: 'error',
    },
    token_exchange_failed: {
      message: 'Instagram Token 交换失败，请稍后重试。',
      tone: 'error',
    },
    unavailable: {
      message: '当前服务器尚未完成 Instagram OAuth 配置。',
      tone: 'error',
    },
  },
}

const LABELS: Record<
  AdminLocale,
  {
    cancel: string
    confirm: string
    confirmDisconnect: string
    connect: string
    disconnect: string
    disconnectFailed: string
    disconnecting: string
    reauthorize: string
  }
> = {
  en: {
    cancel: 'Cancel',
    confirm: 'Remove the current Instagram token?',
    confirmDisconnect: 'Confirm disconnect',
    connect: 'Connect Instagram',
    disconnect: 'Disconnect',
    disconnectFailed: 'The Instagram credentials could not be removed.',
    disconnecting: 'Disconnecting…',
    reauthorize: 'Re-authorize',
  },
  zh: {
    cancel: '取消',
    confirm: '确定清除当前 Instagram Token？',
    confirmDisconnect: '确认断开',
    connect: '连接 Instagram',
    disconnect: '断开授权',
    disconnectFailed: 'Instagram 授权凭据清除失败。',
    disconnecting: '正在断开…',
    reauthorize: '重新授权',
  },
}

export const getInstagramOAuthResultMessage = (
  result: string,
  locale: AdminLocale,
): InstagramOAuthResultMessage | undefined => RESULT_COPY[locale][result]

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}

const currentResult = (): string =>
  typeof window === 'undefined'
    ? ''
    : new URLSearchParams(window.location.search).get('instagramOAuth') || ''

export default function InstagramAccountOAuthControls() {
  const { collectionSlug, data, id, initialData } = useDocumentInfo()
  const { i18n } = useTranslation()
  const locale = getAdminLocale(i18n.language)
  const labels = LABELS[locale]
  const documentData = asRecord(data || initialData)
  const authorization = asRecord(documentData.authorization)
  const accountKind = documentData.accountKind
  const isInstagramAccount =
    collectionSlug === 'platform-accounts' && accountKind === 'instagram-professional'
  const initialConnected =
    authorization.state === 'connected' && authorization.accessTokenConfigured === true
  const [connected, setConnected] = useState(initialConnected)
  const [confirming, setConfirming] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)
  const [result, setResult] = useState(currentResult)
  const confirmButtonRef = useRef<HTMLButtonElement>(null)
  const disconnectButtonRef = useRef<HTMLButtonElement>(null)
  const resultMessage = useMemo(() => getInstagramOAuthResultMessage(result, locale), [locale, result])

  useEffect(() => {
    if (confirming) confirmButtonRef.current?.focus()
  }, [confirming])

  if (!isInstagramAccount || id === undefined || id === null) return null

  const accountId = String(id)
  const connectHref = `/api/platforms/instagram/oauth/start?accountId=${encodeURIComponent(accountId)}`

  const disconnect = async () => {
    if (disconnecting) return
    setDisconnecting(true)
    setResult('')
    try {
      const response = await fetch('/api/platforms/instagram/oauth/disconnect', {
        body: JSON.stringify({ accountId: Number(accountId) }),
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      })
      if (!response.ok) throw new Error('disconnect failed')
      setConnected(false)
      setConfirming(false)
      setResult('disconnected')
      const target = `${window.location.pathname}?instagramOAuth=disconnected`
      window.history.replaceState({}, '', target)
    } catch {
      setResult('disconnect_failed')
    } finally {
      setDisconnecting(false)
    }
  }

  const cancelDisconnect = () => {
    setConfirming(false)
    requestAnimationFrame(() => disconnectButtonRef.current?.focus())
  }

  const effectiveMessage =
    result === 'disconnect_failed'
      ? { message: labels.disconnectFailed, tone: 'error' as const }
      : resultMessage

  return (
    <div className="ops-instagram-oauth" data-testid="instagram-account-oauth-controls">
      {effectiveMessage ? (
        <p
          className={`ops-instagram-oauth__message ops-instagram-oauth__message--${effectiveMessage.tone}`}
          role={effectiveMessage.tone === 'error' ? 'alert' : 'status'}
        >
          {effectiveMessage.message}
        </p>
      ) : null}
      <a className="ops-instagram-oauth__primary" href={connectHref}>
        {connected ? labels.reauthorize : labels.connect}
      </a>
      {connected && !confirming ? (
        <button
          className="ops-instagram-oauth__secondary"
          onClick={() => setConfirming(true)}
          ref={disconnectButtonRef}
          type="button"
        >
          {labels.disconnect}
        </button>
      ) : null}
      {connected && confirming ? (
        <div
          aria-labelledby="instagram-oauth-disconnect-confirm"
          className="ops-instagram-oauth__confirm"
          role="group"
        >
          <span id="instagram-oauth-disconnect-confirm">{labels.confirm}</span>
          <button
            disabled={disconnecting}
            onClick={disconnect}
            ref={confirmButtonRef}
            type="button"
          >
            {disconnecting ? labels.disconnecting : labels.confirmDisconnect}
          </button>
          <button disabled={disconnecting} onClick={cancelDisconnect} type="button">
            {labels.cancel}
          </button>
        </div>
      ) : null}
    </div>
  )
}
