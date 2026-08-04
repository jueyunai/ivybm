'use client'

import { IconRefresh } from '@tabler/icons-react'
import { useRouter } from 'next/navigation'

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
    actionRequired: 'Action required',
    actionOwner: 'Responsible owner',
    actionTitle: 'Next action',
    available: 'Available',
    blocked: 'Blocked',
    capability: 'Capability',
    connection: 'Connection',
    description: 'Credential-free readiness only. Complete the next action in the assigned system, then refresh this view.',
    empty: 'No platform accounts are configured yet.',
    forbidden: 'Only administrators can view platform readiness.',
    missing: 'Still required',
    moduleDisabled: 'Platform readiness is disabled for this environment.',
    nextStep: 'Next step',
    owners: {
      'account-owner': 'Account owner',
      administrator: 'Administrator',
      engineering: 'Engineering',
      platform: 'Platform provider',
    },
    requirements: {
      access_token: 'An access token is required.',
      access_token_expired: 'The access token has expired.',
      approval: 'Platform capability approval is required.',
      authorization: 'Complete the platform authorization flow.',
      credential_decryption: 'The configured credential cannot be verified by this environment.',
      external_account_id: 'An external account ID is required.',
      meta_account_allowlist: 'Add this account to the Meta webhook allowlist.',
      meta_app_secret: 'The Meta app secret must be configured in the restricted maintenance flow.',
      meta_verify_token: 'The Meta verification token must be configured in the restricted maintenance flow.',
      official_tiktok_dm_schema: 'TikTok DM has no supported official schema yet.',
      publishing_job_adapter: 'The publishing job adapter is not implemented.',
      refresh_token: 'A refresh token is required after the access token expires.',
      refresh_token_decryption: 'The configured refresh token cannot be verified by this environment.',
      tiktok_dm_api_eligibility: 'The TikTok account is not eligible for the DM API.',
    },
    steps: {
      'complete-authorization': 'Complete the authorization flow for this account.',
      'complete-tiktok-eligibility': 'Confirm the account and region are eligible for the TikTok DM API.',
      'configure-credentials': 'Configure or rotate credentials through the restricted maintenance flow.',
      'configure-meta-webhook': 'Configure the Meta webhook secret, verification token, and account allowlist.',
      'implement-publishing-adapter': 'Implement and verify the publishing job adapter before enabling this capability.',
      'monitor-available-capability': 'Keep monitoring the verified capability and record future failures in Operations.',
      'provide-external-account': 'Ask the account owner to provide the external account identifier.',
      'request-platform-approval': 'Submit or follow up on the platform approval required for this capability.',
      'run-controlled-test': 'Run the controlled test, record its result, then reassess readiness.',
      'wait-for-official-schema': 'Wait for the official TikTok DM schema before planning integration work.',
    },
    readyForTest: 'Ready for controlled test',
    refresh: 'Refresh',
    title: 'Platform status',
    unavailable: 'Platform readiness could not be loaded.',
  },
  zh: {
    account: '账号',
    actionRequired: '需要处理',
    actionOwner: '责任人',
    actionTitle: '下一步',
    available: '可用',
    blocked: '受阻',
    capability: '能力',
    connection: '连接状态',
    description: '这里只展示无凭据 readiness。请在责任系统完成下一步后刷新本页确认状态。',
    empty: '还没有配置平台账号。',
    forbidden: '只有管理员可以查看平台 readiness。',
    missing: '仍需满足',
    moduleDisabled: '当前环境未启用平台状态模块。',
    nextStep: '下一步',
    owners: {
      'account-owner': '账号所有者',
      administrator: '管理员',
      engineering: '开发团队',
      platform: '平台方',
    },
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
      refresh_token: '访问令牌过期后需要刷新令牌。',
      refresh_token_decryption: '当前环境无法验证已配置的刷新令牌。',
      tiktok_dm_api_eligibility: '该 TikTok 账号尚不具备私信 API 资格。',
    },
    steps: {
      'complete-authorization': '请完成该账号的平台授权流程。',
      'complete-tiktok-eligibility': '请确认账号和地区具备 TikTok 私信 API 资格。',
      'configure-credentials': '请通过受限维护流程配置或轮换凭据。',
      'configure-meta-webhook': '请配置 Meta Webhook 密钥、验证令牌和账号 allowlist。',
      'implement-publishing-adapter': '请先完成发布任务 adapter 的实现与验证，再启用此能力。',
      'monitor-available-capability': '请持续监控已验证能力，并在出现问题时通过异常中心处理。',
      'provide-external-account': '请让账号所有者提供外部账号标识。',
      'request-platform-approval': '请提交或跟进该能力所需的平台审核。',
      'run-controlled-test': '请执行受控测试并记录结果，然后重新评估 readiness。',
      'wait-for-official-schema': '请等待 TikTok 私信官方 schema 就绪后再计划集成。',
    },
    readyForTest: '可进行受控测试',
    refresh: '刷新',
    title: '平台状态',
    unavailable: '平台 readiness 暂时无法读取。',
  },
} as const

type PlatformCopy = (typeof messages)[keyof typeof messages]

const labelFor = (status: PlatformReadinessStatus, copy: PlatformCopy) =>
  status === 'available'
    ? copy.available
    :
  status === 'blocked'
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
  value === 'messaging-inbound' ? (copy.capability === '能力' ? '入站消息' : 'Inbound messaging') : copy.capability === '能力' ? '内容发布' : 'Publishing'

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

function AccountReadiness({ account, copy }: { account: PlatformReadinessAccountSummary; copy: PlatformCopy }) {
  const connection = account.readiness.connection

  return (
    <article className="portal-platforms__account">
      <header>
        <div>
          <p>{account.accountKind.replaceAll('-', ' ')}</p>
          <h3>{account.name}</h3>
          <small>{account.externalAccountId ? `#${account.externalAccountId}` : copy.account}</small>
        </div>
        <StatusBadge label={labelFor(connection.status, copy)} tone={toneFor(connection.status)} />
      </header>
      <section className="portal-platforms__connection">
        <strong>{copy.connection}</strong>
        {connection.missing.length ? (
          <ul>{connection.missing.map((requirement) => <li key={requirement}>{readableRequirement(requirement, copy)}</li>)}</ul>
        ) : <p>{copy.readyForTest}</p>}
        <ReadinessAction copy={copy} missing={connection.missing} status={connection.status} />
      </section>
      <section className="portal-platforms__capabilities">
        <h4>{copy.capability}</h4>
        {account.readiness.capabilities.map((capability) => (
          <div key={capability.capability}>
            <div>
              <strong>{readableCapability(capability.capability, copy)}</strong>
              <StatusBadge label={labelFor(capability.status, copy)} tone={toneFor(capability.status)} />
            </div>
            {capability.missing.length ? (
              <p><span>{copy.missing}:</span> {capability.missing.map((requirement) => readableRequirement(requirement, copy)).join(' ')}</p>
            ) : <p>{labelFor(capability.status, copy)}</p>}
            <ReadinessAction copy={copy} missing={capability.missing} status={capability.status} />
          </div>
        ))}
      </section>
    </article>
  )
}

export function PlatformReadinessPage({
  pageState,
  summary,
}: {
  pageState: PlatformReadinessPageState | 'read-failed'
  summary: PlatformReadinessSummary | null
}) {
  const router = useRouter()
  const { locale } = usePortalPreferences()
  const copy = messages[locale]

  if (pageState !== 'available' || !summary) {
    const type = pageState === 'forbidden' ? 'forbidden' : pageState === 'read-failed' ? 'error' : 'blocked'
    const description = pageState === 'forbidden' ? copy.forbidden : pageState === 'read-failed' ? copy.unavailable : copy.moduleDisabled
    return <main className="portal-page portal-platforms"><PortalState description={description} title={copy.title} type={type} /></main>
  }

  return (
    <main className="portal-page portal-platforms">
      <header className="portal-page__intro portal-platforms__intro">
        <div>
          <p className="portal-page__eyebrow">OPERATIONS / READINESS</p>
          <h2>{copy.title}</h2>
          <p>{copy.description}</p>
        </div>
        <Button onClick={() => router.refresh()} variant="secondary">
          <IconRefresh aria-hidden="true" size={16} />
          {copy.refresh}
        </Button>
      </header>
      {summary.accounts.length ? (
        <section className="portal-platforms__grid">
          {summary.accounts.map((account) => <AccountReadiness account={account} copy={copy} key={account.id} />)}
        </section>
      ) : (
        <Surface as="section"><PortalState description={copy.empty} title={copy.empty} type="empty" /></Surface>
      )}
    </main>
  )
}
