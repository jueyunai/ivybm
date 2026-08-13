'use client'

import { useEffect, useMemo, useRef, useState } from 'react'

import { IconPlus, IconRefresh } from '@tabler/icons-react'
import { useRouter, useSearchParams } from 'next/navigation'

import { usePortalPreferences } from '@/admin-portal/core/navigation/PortalPreferences'
import { Button, PortalState, StatusBadge, Surface } from '@/admin-portal/core/ui'
import {
  getPlatformReadinessAction,
  type PlatformAccountCapability,
  type PlatformReadinessActionCode,
  type PlatformReadinessActionOwner,
  type PlatformReadinessRequirement,
  type PlatformReadinessStatus,
} from '@/modules/platforms/readiness'

import type {
  PlatformReadinessAccountSummary,
  PlatformReadinessPageState,
  PlatformReadinessSummary,
} from './getPlatformReadiness'

const messages = {
  en: {
    account: 'Account',
    accountKind: 'Platform',
    accountKindPlaceholder: 'Select platform type',
    actionRequired: 'Action required',
    actionOwner: 'Responsible owner',
    actionTitle: 'Next action',
    addAccount: 'Add account',
    available: 'Available',
    blocked: 'Blocked',
    cancel: 'Cancel',
    capability: 'Capability',
    connect: 'Connect',
    connection: 'Connection',
    confirmDelete: 'Delete this account?',
    confirmDeleteDescription:
      'This cannot be undone. Disconnect the account first if it is connected.',
    confirmDisconnect: 'Confirm disconnect',
    confirmDisconnectDescription: 'This will remove the provider token and stop publishing.',
    delete: 'Delete',
    deleteAccount: 'Delete account',
    deleteFailed: 'Delete failed. Refresh the page and try again.',
    description:
      'Create and manage platform accounts, connect OAuth, and review readiness without entering the restricted maintenance area.',
    disconnect: 'Disconnect',
    disconnectFailed: 'Disconnect failed.',
    disconnecting: 'Disconnecting…',
    edit: 'Edit',
    editAccount: 'Edit account',
    empty: 'No platform accounts are configured yet.',
    externalAccountId: 'External account ID',
    externalAccountIdHelp:
      'Provider-side identifier (Page ID, professional account ID, member ID, or organization ID).',
    forbidden: 'Only administrators can view platform readiness.',
    missing: 'Still required',
    moduleDisabled: 'Platform readiness is disabled for this environment.',
    name: 'Display name',
    nextStep: 'Next step',
    notes: 'Notes',
    oauthResults: {
      account_changed: {
        message: 'The account changed during authorization. Start again.',
        tone: 'error' as const,
      },
      account_not_found: {
        message: 'The platform account no longer exists.',
        tone: 'error' as const,
      },
      authentication_required: {
        message: 'Sign in again before connecting.',
        tone: 'error' as const,
      },
      connected: { message: 'Account connected successfully.', tone: 'success' as const },
      disconnected: { message: 'Account disconnected.', tone: 'success' as const },
      forbidden: { message: 'Only an administrator can connect accounts.', tone: 'error' as const },
      identity_mismatch: {
        message: 'The authorized identity does not match this record.',
        tone: 'error' as const,
      },
      identity_verification_failed: {
        message: 'The provider could not verify the selected identity. Try again later.',
        tone: 'error' as const,
      },
      invalid_transaction: {
        message: 'The authorization request expired. Start again.',
        tone: 'error' as const,
      },
      provider_denied: {
        message: 'Authorization was cancelled or denied.',
        tone: 'error' as const,
      },
      required_permission_missing: {
        message: 'The provider did not grant every permission required for this account.',
        tone: 'error' as const,
      },
      state_mismatch: {
        message: 'The authorization security check failed. Start again.',
        tone: 'error' as const,
      },
      token_exchange_failed: {
        message: 'Token exchange failed. Try again later.',
        tone: 'error' as const,
      },
      unavailable: { message: 'OAuth is not configured on this server.', tone: 'error' as const },
    },
    owners: {
      'account-owner': 'Account owner',
      administrator: 'Administrator',
      engineering: 'Engineering',
      platform: 'Platform provider',
    },
    reauthorize: 'Re-authorize',
    requirements: {
      access_token: 'An access token is required.',
      access_token_expired: 'The access token has expired.',
      approval: 'Platform capability approval is required.',
      authorization: 'Complete the platform authorization flow.',
      credential_decryption: 'The configured credential cannot be verified by this environment.',
      external_account_id: 'An external account ID is required.',
      meta_account_allowlist: 'Add this account to the Meta webhook allowlist.',
      meta_app_secret: 'The Meta app secret must be configured in the restricted maintenance flow.',
      meta_verify_token:
        'The Meta verification token must be configured in the restricted maintenance flow.',
      official_tiktok_dm_schema: 'TikTok DM has no supported official schema yet.',
      publishing_job_adapter: 'The publishing job adapter is not implemented.',
      publishing_disabled: 'The controlled publishing kill switch is disabled.',
      publishing_runtime_configuration:
        'The server publishing runtime configuration is incomplete.',
      refresh_token: 'A refresh token is required after the access token expires.',
      refresh_token_decryption:
        'The configured refresh token cannot be verified by this environment.',
      tiktok_dm_api_eligibility: 'The TikTok account is not eligible for the DM API.',
    },
    save: 'Save',
    saving: 'Saving…',
    errors: {
      account_has_publication_history:
        'This account has publication history and cannot be deleted.',
      account_not_disconnected: 'Disconnect this account before deleting it.',
      duplicate_account: 'This provider account is already configured.',
      forbidden: 'You are not allowed to perform this action.',
      identity_change_requires_credential_rotation:
        'Disconnect the account before changing its provider identity.',
      invalid_external_account_id: 'Enter a valid provider account ID.',
      invalid_name: 'Enter a valid display name.',
      invalid_notes: 'Notes are too long.',
      no_changes: 'No changes were detected.',
      stale_revision: 'This account changed in another session. Refresh before trying again.',
      unknown: 'The request failed. Refresh the page and try again.',
    },
    steps: {
      'complete-authorization': 'Complete the authorization flow for this account.',
      'complete-tiktok-eligibility':
        'Confirm the account and region are eligible for the TikTok DM API.',
      'configure-credentials':
        'Configure or rotate credentials through the restricted maintenance flow.',
      'configure-meta-webhook':
        'Configure the Meta webhook secret, verification token, and account allowlist.',
      'configure-publishing-runtime':
        'Complete the restricted publishing runtime configuration before the controlled test.',
      'implement-publishing-adapter':
        'Implement and verify the publishing job adapter before enabling this capability.',
      'monitor-available-capability':
        'Keep monitoring the verified capability and record future failures in Operations.',
      'provide-external-account':
        'Ask the account owner to provide the external account identifier.',
      'request-platform-approval':
        'Submit or follow up on the platform approval required for this capability.',
      'run-controlled-test': 'Run the controlled test, record its result, then reassess readiness.',
      'wait-for-official-schema':
        'Wait for the official TikTok DM schema before planning integration work.',
    },
    readyForTest: 'Ready for controlled test',
    refresh: 'Refresh',
    saveFailed: 'Save failed.',
    title: 'Platform accounts',
    unavailable: 'Platform readiness could not be loaded.',
  },
  zh: {
    account: '账号',
    accountKind: '平台类型',
    accountKindPlaceholder: '选择平台类型',
    actionRequired: '需要处理',
    actionOwner: '责任人',
    actionTitle: '下一步',
    addAccount: '添加账号',
    available: '可用',
    blocked: '受阻',
    cancel: '取消',
    capability: '能力',
    connect: '连接',
    connection: '连接状态',
    confirmDelete: '确定删除该账号？',
    confirmDeleteDescription: '删除后无法恢复。如果账号仍处连接状态，请先断开授权。',
    confirmDisconnect: '确认断开',
    confirmDisconnectDescription: '这将清除平台 Token 并停止发布。',
    delete: '删除',
    deleteAccount: '删除账号',
    deleteFailed: '删除失败，请刷新页面后重试。',
    description: '在本页管理平台账号、完成 OAuth 授权并查看 readiness，无需进入受限维护后台。',
    disconnect: '断开授权',
    disconnectFailed: '断开授权失败。',
    disconnecting: '正在断开…',
    edit: '编辑',
    editAccount: '编辑账号',
    empty: '还没有配置平台账号。',
    externalAccountId: '外部账号 ID',
    externalAccountIdHelp: '提供商标识（Page ID、专业账号 ID、成员 ID 或组织 ID）。',
    forbidden: '只有管理员可以查看平台 readiness。',
    missing: '仍需满足',
    moduleDisabled: '当前环境未启用平台状态模块。',
    name: '显示名称',
    nextStep: '下一步',
    notes: '备注',
    oauthResults: {
      account_changed: {
        message: '授权期间账号记录发生变化，请重新开始。',
        tone: 'error' as const,
      },
      account_not_found: { message: '对应的平台账号记录已不存在。', tone: 'error' as const },
      authentication_required: { message: '请重新登录后台后再连接。', tone: 'error' as const },
      connected: { message: '账号已成功连接。', tone: 'success' as const },
      disconnected: { message: '账号已断开授权。', tone: 'success' as const },
      forbidden: { message: '只有管理员可以连接账号。', tone: 'error' as const },
      identity_mismatch: { message: '授权的身份与当前记录不一致。', tone: 'error' as const },
      identity_verification_failed: {
        message: '平台暂时无法确认所选身份，请稍后重试。',
        tone: 'error' as const,
      },
      invalid_transaction: { message: '授权请求已过期，请重新连接。', tone: 'error' as const },
      provider_denied: { message: '授权已取消或被拒绝。', tone: 'error' as const },
      required_permission_missing: {
        message: '平台没有授予该账号所需的全部权限。',
        tone: 'error' as const,
      },
      state_mismatch: { message: '授权安全校验失败，请重新连接。', tone: 'error' as const },
      token_exchange_failed: { message: 'Token 交换失败，请稍后重试。', tone: 'error' as const },
      unavailable: { message: '当前服务器尚未完成 OAuth 配置。', tone: 'error' as const },
    },
    owners: {
      'account-owner': '账号所有者',
      administrator: '管理员',
      engineering: '开发团队',
      platform: '平台方',
    },
    reauthorize: '重新授权',
    requirements: {
      access_token: '需要配置访问令牌。',
      access_token_expired: '访问令牌已过期。',
      approval: '需要通过平台能力审核。',
      authorization: '需要完成平台授权流程。',
      credential_decryption: '当前环境无法验证已配置的凭据。',
      external_account_id: '需要提供外部账号 ID。',
      meta_account_allowlist: '需要将该账号加入 Meta Webhook allowlist。',
      meta_app_secret: '需要通过受限维护流程配置 Meta 应用密钥。',
      meta_verify_token: '需要通过受限维护流程配置 Meta 验证令牌。',
      official_tiktok_dm_schema: 'TikTok 私信尚无可支持的官方 schema。',
      publishing_job_adapter: '发布任务 adapter 尚未实现。',
      publishing_disabled: '受控发布 kill switch 当前未启用。',
      publishing_runtime_configuration: '服务端发布运行时配置尚未完整。',
      refresh_token: '访问令牌过期后需要刷新令牌。',
      refresh_token_decryption: '当前环境无法验证已配置的刷新令牌。',
      tiktok_dm_api_eligibility: '该 TikTok 账号尚不具备私信 API 资格。',
    },
    save: '保存',
    saving: '保存中…',
    errors: {
      account_has_publication_history: '该账号已有发布历史，不能删除。',
      account_not_disconnected: '请先断开该账号的授权，再执行删除。',
      duplicate_account: '该平台账号已经配置。',
      forbidden: '当前账号无权执行此操作。',
      identity_change_requires_credential_rotation: '请先断开授权，再修改平台账号标识。',
      invalid_external_account_id: '请输入有效的平台账号 ID。',
      invalid_name: '请输入有效的显示名称。',
      invalid_notes: '备注内容过长。',
      no_changes: '没有检测到修改。',
      stale_revision: '该账号已在其他会话中更新，请刷新页面后重试。',
      unknown: '请求失败，请刷新页面后重试。',
    },
    steps: {
      'complete-authorization': '请完成该账号的平台授权流程。',
      'complete-tiktok-eligibility': '请确认账号和地区具备 TikTok 私信 API 资格。',
      'configure-credentials': '请通过受限维护流程配置或轮换凭据。',
      'configure-meta-webhook': '请配置 Meta Webhook 密钥、验证令牌和账号 allowlist。',
      'configure-publishing-runtime': '请先通过受限维护流程补齐发布运行时配置，再进行受控测试。',
      'implement-publishing-adapter': '请先完成发布任务 adapter 的实现与验证，再启用此能力。',
      'monitor-available-capability': '请持续监控已验证能力，并在出现问题时通过异常中心处理。',
      'provide-external-account': '请让账号所有者提供外部账号标识。',
      'request-platform-approval': '请提交或跟进该能力所需的平台审核。',
      'run-controlled-test': '请执行受控测试并记录结果，然后重新评估 readiness。',
      'wait-for-official-schema': '请等待 TikTok 私信官方 schema 就绪后再计划集成。',
    },
    readyForTest: '可进行受控测试',
    refresh: '刷新',
    saveFailed: '保存失败。',
    title: '平台账号',
    unavailable: '平台 readiness 暂时无法读取。',
  },
} as const

type PlatformCopy = (typeof messages)[keyof typeof messages]

const labelFor = (status: PlatformReadinessStatus, copy: PlatformCopy) =>
  status === 'available'
    ? copy.available
    : status === 'blocked'
      ? copy.blocked
      : status === 'ready-for-controlled-test'
        ? copy.readyForTest
        : copy.actionRequired

const toneFor = (status: PlatformReadinessStatus) =>
  status === 'blocked'
    ? ('danger' as const)
    : status === 'available' || status === 'ready-for-controlled-test'
      ? ('success' as const)
      : ('warning' as const)

const readableRequirement = (value: PlatformReadinessRequirement, copy: PlatformCopy): string =>
  copy.requirements[value]

const readableCapability = (value: PlatformAccountCapability, copy: PlatformCopy): string =>
  value === 'messaging-inbound'
    ? copy.capability === '能力'
      ? '入站消息'
      : 'Inbound messaging'
    : copy.capability === '能力'
      ? '内容发布'
      : 'Publishing'

function ReadinessAction({
  copy,
  missing,
  status,
}: {
  copy: PlatformCopy
  missing: readonly PlatformReadinessRequirement[]
  status: PlatformReadinessStatus
}) {
  const action = getPlatformReadinessAction({ missing, status })

  return (
    <dl className="portal-platforms__action">
      <div>
        <dt>{copy.actionOwner}</dt>
        <dd>{copy.owners[action.owner as PlatformReadinessActionOwner]}</dd>
      </div>
      <div>
        <dt>{copy.actionTitle}</dt>
        <dd>{copy.steps[action.code as PlatformReadinessActionCode]}</dd>
      </div>
    </dl>
  )
}

const accountKindOptions: Array<{
  kind: 'facebook-page' | 'instagram-professional' | 'linkedin-member' | 'linkedin-organization'
  labelEn: string
  labelZh: string
}> = [
  { kind: 'facebook-page', labelEn: 'Facebook Page', labelZh: 'Facebook 主页' },
  {
    kind: 'instagram-professional',
    labelEn: 'Instagram Professional',
    labelZh: 'Instagram 专业账号',
  },
  { kind: 'linkedin-member', labelEn: 'LinkedIn Member', labelZh: 'LinkedIn 个人' },
  { kind: 'linkedin-organization', labelEn: 'LinkedIn Organization', labelZh: 'LinkedIn 组织' },
]

const accountKindLabel = (kind: string, locale: keyof typeof messages): string => {
  const option = accountKindOptions.find((option) => option.kind === kind)
  if (!option) return kind.replaceAll('-', ' ')
  return locale === 'zh' ? option.labelZh : option.labelEn
}

const oauthPaths = (accountKind: string): { disconnect: string; start: string } | undefined => {
  if (accountKind === 'facebook-page') {
    return {
      disconnect: '/api/platforms/meta/oauth/disconnect',
      start: '/api/platforms/meta/oauth/start',
    }
  }
  if (accountKind === 'instagram-professional') {
    return {
      disconnect: '/api/platforms/instagram/oauth/disconnect',
      start: '/api/platforms/instagram/oauth/start',
    }
  }
  if (accountKind === 'linkedin-member' || accountKind === 'linkedin-organization') {
    return {
      disconnect: '/api/platforms/linkedin/oauth/disconnect',
      start: '/api/platforms/linkedin/oauth/start',
    }
  }
  return undefined
}

function AccountReadiness({
  account,
  copy,
}: {
  account: PlatformReadinessAccountSummary
  copy: PlatformCopy
}) {
  const connection = account.readiness.connection

  return (
    <div className="portal-platforms__readiness">
      <div>
        <strong>{copy.connection}</strong>
        <StatusBadge label={labelFor(connection.status, copy)} tone={toneFor(connection.status)} />
      </div>
      {connection.missing.length ? (
        <ul>
          {connection.missing.map((requirement) => (
            <li key={requirement}>{readableRequirement(requirement, copy)}</li>
          ))}
        </ul>
      ) : (
        <p>{copy.readyForTest}</p>
      )}
      <ReadinessAction copy={copy} missing={connection.missing} status={connection.status} />
      <div className="portal-platforms__capabilities-list">
        {account.readiness.capabilities.map((capability) => (
          <div key={capability.capability}>
            <div>
              <strong>{readableCapability(capability.capability, copy)}</strong>
              <StatusBadge
                label={labelFor(capability.status, copy)}
                tone={toneFor(capability.status)}
              />
            </div>
            {capability.missing.length ? (
              <p>
                <span>{copy.missing}:</span>{' '}
                {capability.missing
                  .map((requirement) => readableRequirement(requirement, copy))
                  .join(' ')}
              </p>
            ) : null}
            <ReadinessAction copy={copy} missing={capability.missing} status={capability.status} />
          </div>
        ))}
      </div>
    </div>
  )
}

function ConfirmDialog({
  busy,
  cancelLabel,
  confirmLabel,
  description,
  id,
  onCancel,
  onConfirm,
  title,
}: {
  busy: boolean
  cancelLabel: string
  confirmLabel: string
  description: string
  id: string
  onCancel: () => void
  onConfirm: () => void
  title: string
}) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const confirmRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null
    confirmRef.current?.focus()
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) {
        event.preventDefault()
        onCancel()
        return
      }
      if (event.key !== 'Tab') return
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled)')
      if (!focusable?.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      previouslyFocused?.focus()
    }
  }, [busy, onCancel])

  return (
    <div className="portal-platforms__dialog-backdrop">
      <div
        aria-describedby={`${id}-description`}
        aria-labelledby={`${id}-title`}
        aria-modal="true"
        className="portal-platforms__confirm"
        ref={dialogRef}
        role="alertdialog"
      >
        <p id={`${id}-title`}>{title}</p>
        <p id={`${id}-description`}>{description}</p>
        <div className="portal-platforms__form-actions">
          <Button disabled={busy} onClick={onConfirm} ref={confirmRef} variant="danger">
            {confirmLabel}
          </Button>
          <Button disabled={busy} onClick={onCancel} variant="secondary">
            {cancelLabel}
          </Button>
        </div>
      </div>
    </div>
  )
}

export function PlatformReadinessPage({
  accounts: initialAccounts,
  pageState,
  summary,
}: {
  accounts: PlatformReadinessAccountSummary[]
  pageState: PlatformReadinessPageState | 'read-failed'
  summary: PlatformReadinessSummary | null
}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { locale } = usePortalPreferences()
  const copy = messages[locale]

  const [isAdding, setIsAdding] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [disconnectingId, setDisconnectingId] = useState<number | null>(null)
  const [deletingId, setDeletingId] = useState<number | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const accounts = summary?.accounts ?? initialAccounts

  const oauthResult = useMemo(() => {
    const results = [
      searchParams.get('metaOAuth'),
      searchParams.get('instagramOAuth'),
      searchParams.get('linkedinOAuth'),
    ].filter(Boolean)
    return (results[0] as string | undefined) ?? null
  }, [searchParams])

  const oauthMessage = useMemo(() => {
    if (!oauthResult) return null
    return (
      copy.oauthResults[oauthResult as keyof typeof copy.oauthResults] ?? {
        message: copy.errors.unknown,
        tone: 'error',
      }
    )
  }, [copy, oauthResult])

  const authorizedAccountIds = useMemo(
    () =>
      new Set(
        accounts
          .filter(
            (account) =>
              account.authorization.accessTokenConfigured ||
              account.authorization.refreshTokenConfigured ||
              account.authorization.state === 'connected' ||
              account.authorization.state === 'expired',
          )
          .map((account) => account.id),
      ),
    [accounts],
  )

  const errorMessage = (code: string): string =>
    copy.errors[code as keyof typeof copy.errors] ?? copy.errors.unknown

  if (pageState !== 'available' || !summary) {
    const type =
      pageState === 'forbidden' ? 'forbidden' : pageState === 'read-failed' ? 'error' : 'blocked'
    const description =
      pageState === 'forbidden'
        ? copy.forbidden
        : pageState === 'read-failed'
          ? copy.unavailable
          : copy.moduleDisabled
    return (
      <main className="portal-page portal-platforms">
        <PortalState description={description} title={copy.title} type={type} />
      </main>
    )
  }

  const handleAdd = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setFormError(null)
    setIsSubmitting(true)
    const formData = new FormData(event.currentTarget)
    const body = {
      accountKind: formData.get('accountKind'),
      externalAccountId: formData.get('externalAccountId') || null,
      name: formData.get('name'),
      notes: formData.get('notes') || null,
    }
    try {
      const response = await fetch('/api/platforms/accounts', {
        body: JSON.stringify(body),
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      })
      if (!response.ok) {
        const result = await response.json().catch(() => ({ error: { code: 'unknown' } }))
        throw new Error(result.error?.code ?? 'unknown')
      }
      setIsAdding(false)
      router.refresh()
    } catch (error) {
      setFormError(errorMessage(error instanceof Error ? error.message : 'unknown'))
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleEdit = async (event: React.FormEvent<HTMLFormElement>, accountId: number) => {
    event.preventDefault()
    setFormError(null)
    setIsSubmitting(true)
    const formData = new FormData(event.currentTarget)
    const account = accounts.find((item) => item.id === accountId)
    const body = {
      authorizationRevision: account?.authorizationRevision,
      externalAccountId: formData.get('externalAccountId') || null,
      name: formData.get('name'),
      notes: formData.get('notes') || null,
    }
    try {
      const response = await fetch(`/api/platforms/accounts/${accountId}`, {
        body: JSON.stringify(body),
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        method: 'PATCH',
      })
      if (!response.ok) {
        const result = await response.json().catch(() => ({ error: { code: 'unknown' } }))
        throw new Error(result.error?.code ?? 'unknown')
      }
      setEditingId(null)
      router.refresh()
    } catch (error) {
      setFormError(errorMessage(error instanceof Error ? error.message : 'unknown'))
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleDisconnect = async (accountId: number) => {
    const account = accounts.find((item) => item.id === accountId)
    if (!account) return
    const paths = oauthPaths(account.accountKind)
    if (!paths) {
      setFormError(copy.disconnectFailed)
      setDisconnectingId(null)
      return
    }
    setDisconnectingId(accountId)
    setFormError(null)
    setIsSubmitting(true)
    try {
      const response = await fetch(paths.disconnect, {
        body: JSON.stringify({
          accountId,
          authorizationRevision: account.authorizationRevision,
        }),
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      })
      if (!response.ok) {
        const result = await response.json().catch(() => ({ error: { code: 'unknown' } }))
        throw new Error(result.error?.code ?? 'unknown')
      }
      setDisconnectingId(null)
      router.refresh()
    } catch (error) {
      setFormError(
        error instanceof Error && error.message !== 'unknown'
          ? errorMessage(error.message)
          : copy.disconnectFailed,
      )
      setDisconnectingId(null)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleDelete = async (accountId: number) => {
    const account = accounts.find((item) => item.id === accountId)
    if (!account) return
    setDeletingId(accountId)
    setFormError(null)
    setIsSubmitting(true)
    try {
      const response = await fetch(`/api/platforms/accounts/${accountId}`, {
        body: JSON.stringify({ authorizationRevision: account.authorizationRevision }),
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        method: 'DELETE',
      })
      if (!response.ok) {
        const result = await response.json().catch(() => ({ error: { code: 'unknown' } }))
        throw new Error(result.error?.code ?? 'unknown')
      }
      setDeletingId(null)
      router.refresh()
    } catch (error) {
      setFormError(
        error instanceof Error && error.message !== 'unknown'
          ? errorMessage(error.message)
          : copy.deleteFailed,
      )
      setDeletingId(null)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <main className="portal-page portal-platforms">
      <header className="portal-page__intro portal-platforms__intro">
        <div>
          <p className="portal-page__eyebrow">OPERATIONS / READINESS</p>
          <h2>{copy.title}</h2>
          <p>{copy.description}</p>
        </div>
        <div className="portal-platforms__actions">
          <Button onClick={() => router.refresh()} variant="secondary">
            <IconRefresh aria-hidden="true" size={16} />
            {copy.refresh}
          </Button>
          <Button onClick={() => setIsAdding(true)}>
            <IconPlus aria-hidden="true" size={16} />
            {copy.addAccount}
          </Button>
        </div>
      </header>

      {oauthMessage ? (
        <div
          className={`portal-platforms__oauth-message portal-platforms__oauth-message--${oauthMessage.tone}`}
          role={oauthMessage.tone === 'error' ? 'alert' : 'status'}
        >
          {oauthMessage.message}
        </div>
      ) : null}

      {formError ? (
        <div className="portal-platforms__form-error" role="alert">
          {formError === 'disconnect_failed' ? copy.disconnectFailed : formError}
        </div>
      ) : null}

      {isAdding ? (
        <Surface as="section" className="portal-platforms__form">
          <h3>{copy.addAccount}</h3>
          <form onSubmit={handleAdd}>
            <label>
              {copy.name}
              <input name="name" required type="text" />
            </label>
            <label>
              {copy.accountKind}
              <select name="accountKind" required>
                <option value="">{copy.accountKindPlaceholder}</option>
                {accountKindOptions.map((option) => (
                  <option key={option.kind} value={option.kind}>
                    {locale === 'zh' ? option.labelZh : option.labelEn}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {copy.externalAccountId}
              <input name="externalAccountId" type="text" />
              <small>{copy.externalAccountIdHelp}</small>
            </label>
            <label>
              {copy.notes}
              <textarea name="notes" rows={3} />
            </label>
            <div className="portal-platforms__form-actions">
              <Button disabled={isSubmitting} type="submit">
                {isSubmitting ? copy.saving : copy.save}
              </Button>
              <Button
                disabled={isSubmitting}
                onClick={() => setIsAdding(false)}
                variant="secondary"
              >
                {copy.cancel}
              </Button>
            </div>
          </form>
        </Surface>
      ) : null}

      {summary.accounts.length ? (
        <section className="portal-platforms__grid">
          {summary.accounts.map((account) => {
            const paths = oauthPaths(account.accountKind)
            return (
              <Surface as="article" className="portal-platforms__account" key={account.id}>
                <header>
                  <div>
                    <p>{accountKindLabel(account.accountKind, locale)}</p>
                    <h3>{account.name}</h3>
                    <small>
                      {account.externalAccountId ? `#${account.externalAccountId}` : copy.account}
                    </small>
                  </div>
                  <div className="portal-platforms__account-actions">
                    {paths && authorizedAccountIds.has(account.id) ? (
                      <>
                        <Button asChild size="compact" variant="secondary">
                          <a href={`${paths.start}?accountId=${account.id}`}>{copy.reauthorize}</a>
                        </Button>
                        <Button
                          disabled={disconnectingId === account.id}
                          onClick={() => {
                            setDeletingId(null)
                            setDisconnectingId(account.id)
                          }}
                          size="compact"
                          variant="danger"
                        >
                          {copy.disconnect}
                        </Button>
                      </>
                    ) : paths ? (
                      <Button asChild size="compact" variant="primary">
                        <a href={`${paths.start}?accountId=${account.id}`}>{copy.connect}</a>
                      </Button>
                    ) : null}
                    <Button
                      disabled={editingId === account.id}
                      onClick={() => setEditingId(account.id)}
                      size="compact"
                      variant="ghost"
                    >
                      {copy.edit}
                    </Button>
                    <Button
                      disabled={deletingId === account.id}
                      onClick={() => {
                        setDisconnectingId(null)
                        setDeletingId(account.id)
                      }}
                      size="compact"
                      variant="ghost"
                    >
                      {copy.delete}
                    </Button>
                  </div>
                </header>

                {editingId === account.id ? (
                  <form onSubmit={(event) => handleEdit(event, account.id)}>
                    <label>
                      {copy.name}
                      <input defaultValue={account.name} name="name" required type="text" />
                    </label>
                    <label>
                      {copy.externalAccountId}
                      <input
                        defaultValue={account.externalAccountId ?? ''}
                        name="externalAccountId"
                        type="text"
                      />
                      <small>{copy.externalAccountIdHelp}</small>
                    </label>
                    <label>
                      {copy.notes}
                      <textarea defaultValue={account.notes ?? ''} name="notes" rows={3} />
                    </label>
                    <div className="portal-platforms__form-actions">
                      <Button disabled={isSubmitting} type="submit">
                        {isSubmitting ? copy.saving : copy.save}
                      </Button>
                      <Button
                        disabled={isSubmitting}
                        onClick={() => setEditingId(null)}
                        variant="secondary"
                      >
                        {copy.cancel}
                      </Button>
                    </div>
                  </form>
                ) : null}

                {disconnectingId === account.id ? (
                  <ConfirmDialog
                    busy={isSubmitting}
                    cancelLabel={copy.cancel}
                    confirmLabel={isSubmitting ? copy.disconnecting : copy.confirmDisconnect}
                    description={copy.confirmDisconnectDescription}
                    id={`platform-disconnect-${account.id}`}
                    onCancel={() => setDisconnectingId(null)}
                    onConfirm={() => void handleDisconnect(account.id)}
                    title={copy.confirmDisconnect}
                  />
                ) : null}

                {deletingId === account.id ? (
                  <ConfirmDialog
                    busy={isSubmitting}
                    cancelLabel={copy.cancel}
                    confirmLabel={isSubmitting ? copy.saving : copy.deleteAccount}
                    description={copy.confirmDeleteDescription}
                    id={`platform-delete-${account.id}`}
                    onCancel={() => setDeletingId(null)}
                    onConfirm={() => void handleDelete(account.id)}
                    title={copy.confirmDelete}
                  />
                ) : null}

                <AccountReadiness account={account} copy={copy} />
              </Surface>
            )
          })}
        </section>
      ) : (
        <Surface as="section">
          <PortalState description={copy.empty} title={copy.empty} type="empty" />
        </Surface>
      )}
    </main>
  )
}
