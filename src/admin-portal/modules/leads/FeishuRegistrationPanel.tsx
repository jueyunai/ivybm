'use client'

import { useEffect, useState } from 'react'
import { IconExternalLink, IconQrcode, IconRefresh, IconUnlink } from '@tabler/icons-react'
import { useRouter, useSearchParams } from 'next/navigation'
import { QRCodeSVG } from 'qrcode.react'

import { usePortalPreferences } from '@/admin-portal/core/navigation/PortalPreferences'
import { Button, StatusBadge, Surface } from '@/admin-portal/core/ui'
import type { FeishuRegistrationDTO } from '@/modules/feishu/appRegistration'

type Connection = {
  baseURL?: null | string
  credentialsUsable: boolean
  id: number
  name: string
  status: 'connected' | 'disconnected' | 'error' | 'provisioning' | 'reconnect_required'
}

const copy = {
  zh: {
    authorize: '继续授权',
    blocked: '扫码连接暂未启用，请联系管理员完成服务器配置。',
    connect: '扫码连接飞书',
    connected: '已连接',
    connecting: '正在准备二维码…',
    description: '无需创建应用或填写密钥。飞书管理员扫码确认后，系统会自动创建客户表并开始同步。',
    disconnect: '断开连接',
    error: '飞书连接没有完成，请重试。',
    expiredAuthorization: '授权链接已过期，请重新发起并在十分钟内完成手机确认。',
    expired: '二维码已过期，请重新生成。',
    open: '打开飞书客户表',
    openConfirm: '在飞书中确认',
    provisioning: '正在自动创建客户表',
    qrHelp: '请使用飞书扫码，或在当前设备打开确认链接。二维码十分钟内有效。',
    reconnect: '需要重新授权',
    retry: '重新生成二维码',
    title: '飞书 CRM',
  },
  en: {
    authorize: 'Continue authorization',
    blocked: 'QR connection is not enabled. Ask an administrator to finish server setup.',
    connect: 'Connect Feishu by QR',
    connected: 'Connected',
    connecting: 'Preparing QR code…',
    description:
      'No app creation or secrets to copy. An administrator scans once and IVYBM creates the CRM Base automatically.',
    disconnect: 'Disconnect',
    error: 'The Feishu connection did not complete. Please retry.',
    expiredAuthorization:
      'The authorization link expired. Start again and confirm on your phone within ten minutes.',
    expired: 'The QR code expired. Generate a new one.',
    open: 'Open Feishu CRM Base',
    openConfirm: 'Confirm in Feishu',
    provisioning: 'Creating the CRM Base',
    qrHelp:
      'Scan with Feishu or open the confirmation link on this device. The QR code is valid for ten minutes.',
    reconnect: 'Authorization required',
    retry: 'Generate a new QR code',
    title: 'Feishu CRM',
  },
} as const

export function FeishuRegistrationPanel({ enabled }: { enabled: boolean }) {
  const { locale } = usePortalPreferences()
  const router = useRouter()
  const searchParams = useSearchParams()
  const text = copy[locale]
  const [connection, setConnection] = useState<Connection | null>(null)
  const [registration, setRegistration] = useState<FeishuRegistrationDTO | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const callbackResult = searchParams.get('feishu')
  const callbackError =
    callbackResult === 'invalid_state'
      ? text.expiredAuthorization
      : callbackResult === 'failed' ||
          callbackResult === 'denied' ||
          callbackResult === 'missing_code'
        ? text.error
        : null

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    let timer: number | undefined
    const pollConnection = (): void => {
      void loadConnection().catch(() => {
        if (!cancelled) setError(text.error)
      })
    }
    const loadConnection = async (): Promise<void> => {
      const response = await fetch('/api/integrations/feishu/status', {
        cache: 'no-store',
        credentials: 'same-origin',
      })
      if (!response.ok || cancelled) return
      const body = (await response.json()) as { connections?: Connection[] }
      const next = body.connections?.[0] ?? null
      setConnection(next)
      if (!cancelled && next?.status === 'provisioning') {
        timer = window.setTimeout(pollConnection, 1_500)
      }
    }
    pollConnection()
    return () => {
      cancelled = true
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [enabled, text.error])

  useEffect(() => {
    if (
      !registration ||
      !['pending', 'registering', 'qr_ready', 'configuring'].includes(registration.status)
    ) {
      return
    }
    const timer = window.setInterval(() => {
      void fetch(`/api/portal/feishu/registration/${registration.id}`, {
        cache: 'no-store',
        credentials: 'same-origin',
      })
        .then(async (response) => {
          if (!response.ok) throw new Error('registration_status_failed')
          return (await response.json()) as { registration: FeishuRegistrationDTO }
        })
        .then(({ registration: next }) => {
          setRegistration(next)
          if (next.status === 'authorization_ready' && next.authorizeURL) {
            window.location.assign(next.authorizeURL)
          }
        })
        .catch(() => setError(text.error))
    }, 1_500)
    return () => window.clearInterval(timer)
  }, [registration, text.error])

  const start = async () => {
    setBusy(true)
    setError(null)
    if (callbackResult) {
      const nextSearchParams = new URLSearchParams(searchParams)
      nextSearchParams.delete('feishu')
      const query = nextSearchParams.toString()
      router.replace(query ? `/dashboard/leads?${query}` : '/dashboard/leads', { scroll: false })
    }
    try {
      const response = await fetch('/api/portal/feishu/registration', {
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      })
      const body = (await response.json()) as {
        error?: { message?: string }
        registration?: FeishuRegistrationDTO
      }
      if (!response.ok || !body.registration) throw new Error(body.error?.message || text.error)
      setRegistration(body.registration)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : text.error)
    } finally {
      setBusy(false)
    }
  }

  const disconnect = async () => {
    if (!connection) return
    setBusy(true)
    setError(null)
    try {
      const response = await fetch('/api/integrations/feishu/disconnect', {
        body: JSON.stringify({ connectionId: connection.id }),
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      })
      if (!response.ok) throw new Error(text.error)
      setConnection({ ...connection, credentialsUsable: false, status: 'disconnected' })
      setRegistration(null)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : text.error)
    } finally {
      setBusy(false)
    }
  }

  const connected = connection?.status === 'connected'
  const provisioning = connection?.status === 'provisioning'
  const canRetry = registration && ['cancelled', 'expired', 'failed'].includes(registration.status)

  return (
    <Surface as="section" className="portal-feishu-registration">
      <header>
        <div>
          <p className="portal-page__eyebrow">AUTOMATION / FEISHU</p>
          <h3>{text.title}</h3>
          <p>{text.description}</p>
        </div>
        <StatusBadge
          label={
            connected
              ? text.connected
              : provisioning
                ? text.provisioning
                : connection?.status === 'reconnect_required'
                  ? text.reconnect
                  : enabled
                    ? text.connect
                    : text.blocked
          }
          tone={connected ? 'success' : provisioning ? 'info' : 'warning'}
        />
      </header>

      {!enabled ? <p className="portal-feishu-registration__notice">{text.blocked}</p> : null}
      {error || callbackError ? (
        <p className="portal-feishu-registration__error" role="alert">
          {error ?? callbackError}
        </p>
      ) : null}

      {registration?.status === 'qr_ready' && registration.qrURL ? (
        <div className="portal-feishu-registration__qr">
          <QRCodeSVG
            aria-label={text.connect}
            marginSize={2}
            size={176}
            value={registration.qrURL}
          />
          <div>
            <p>{text.qrHelp}</p>
            <Button asChild variant="secondary">
              <a href={registration.qrURL} rel="noreferrer" target="_blank">
                <IconExternalLink aria-hidden="true" size={16} />
                {text.openConfirm}
              </a>
            </Button>
          </div>
        </div>
      ) : null}

      {registration?.status === 'authorization_ready' && registration.authorizeURL ? (
        <Button asChild>
          <a href={registration.authorizeURL}>
            <IconExternalLink aria-hidden="true" size={16} />
            {text.authorize}
          </a>
        </Button>
      ) : null}

      {registration?.status === 'pending' ||
      registration?.status === 'registering' ||
      registration?.status === 'configuring' ? (
        <p className="portal-feishu-registration__notice" role="status">
          {text.connecting}
        </p>
      ) : null}
      {canRetry ? (
        <p className="portal-feishu-registration__notice" role="status">
          {registration.status === 'expired' ? text.expired : text.error}
        </p>
      ) : null}

      <footer>
        {connected && connection?.baseURL ? (
          <Button asChild>
            <a href={connection.baseURL} rel="noreferrer" target="_blank">
              <IconExternalLink aria-hidden="true" size={16} />
              {text.open}
            </a>
          </Button>
        ) : null}
        {enabled && !connected && !provisioning && registration?.status !== 'qr_ready' ? (
          <Button disabled={busy} onClick={() => void start()}>
            {canRetry ? (
              <IconRefresh aria-hidden="true" size={16} />
            ) : (
              <IconQrcode aria-hidden="true" size={16} />
            )}
            {canRetry ? text.retry : text.connect}
          </Button>
        ) : null}
        {connection && connection.status !== 'disconnected' ? (
          <Button disabled={busy} onClick={() => void disconnect()} variant="ghost">
            <IconUnlink aria-hidden="true" size={16} />
            {text.disconnect}
          </Button>
        ) : null}
      </footer>
    </Surface>
  )
}
