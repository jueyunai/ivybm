'use client'

import {
  IconAlertTriangle,
  IconBrandFacebook,
  IconBrandInstagram,
  IconBrandLinkedin,
  IconBrandTiktok,
  IconChevronRight,
  IconExternalLink,
  IconPlayerPlay,
  IconRefresh,
  IconShieldCheck,
  IconTestPipe,
} from '@tabler/icons-react'
import Link from 'next/link'
import { type KeyboardEvent, useCallback, useEffect, useMemo, useState } from 'react'

import {
  PLATFORM_SIMULATION_CATALOG,
  type LocalizedText,
  type PlatformSimulationCatalogItem,
  type PlatformSimulationId,
  type PlatformSimulationResult,
} from '@/modules/platforms/simulationCatalog'

type Language = 'en' | 'zh'
type WorkspaceTab = 'blockers' | 'readiness' | 'simulations'

type ReadinessCapability = {
  capability: 'messaging-inbound' | 'publishing'
  implementation: 'blocked' | 'implemented'
  missing: string[]
  status: 'action-required' | 'blocked' | 'ready-for-controlled-test'
}

type ReadinessAccount = {
  accountKind: string
  externalAccountId?: null | string
  id: number | string
  name: string
  readiness: {
    capabilities: ReadinessCapability[]
    connection: {
      missing: string[]
      status: 'action-required' | 'ready-for-controlled-test'
    }
    family: 'linkedin' | 'meta' | 'tiktok'
  }
}

type PlatformDefinition = {
  accountKinds: string[]
  capabilities: Array<{
    label: LocalizedText
    source:
      | {
          capability: ReadinessCapability['capability']
          kind: 'readiness'
        }
      | {
          implementation: ReadinessCapability['implementation']
          kind: 'static'
          status: ReadinessCapability['status']
        }
  }>
  id: 'facebook' | 'instagram' | 'linkedin' | 'tiktok'
  name: string
  simulationId: PlatformSimulationId
}

const COPY = {
  en: {
    accountRecords: 'Account records',
    actionRequired: 'Action required',
    blocked: 'Blocked',
    blockers: 'Blockers',
    blockersTitle: 'External and upstream blockers',
    codeReady: 'Code ready',
    conditional: 'Conditional',
    connection: 'Connection',
    createAccount: 'Create account',
    description:
      'Account readiness, credential-free fixtures, and safe degradation in one workspace.',
    externalBlockers: 'Open blockers',
    failedLoad: 'Unable to load platform readiness.',
    failedRun: 'The simulation could not be completed.',
    manageAccount: 'Open account',
    manageAccounts: 'Manage accounts',
    noAccount: 'No account record',
    noRealAvailability: 'Real available',
    notRun: 'Select a scenario and run it.',
    readiness: 'Readiness',
    refresh: 'Refresh readiness',
    request: 'Request seam',
    run: 'Run simulation',
    running: 'Running',
    scenarios: 'Runnable scenarios',
    simulations: 'Mock lab',
    status: 'Status',
    title: 'Platform operations',
    viewResult: 'Open mock lab',
  },
  zh: {
    accountRecords: '账号记录',
    actionRequired: '需要处理',
    blocked: '受阻',
    blockers: '阻塞项',
    blockersTitle: '外部与上游阻塞',
    codeReady: '代码就绪',
    conditional: '条件可用',
    connection: '连接状态',
    createAccount: '创建账号',
    description: '集中查看账号预检、无凭据 fixture 演练和安全降级结果。',
    externalBlockers: '开放阻塞',
    failedLoad: '无法加载平台 readiness。',
    failedRun: '演练执行失败。',
    manageAccount: '打开账号',
    manageAccounts: '管理账号',
    noAccount: '尚无账号记录',
    noRealAvailability: '真实可用',
    notRun: '选择一个场景并运行。',
    readiness: '状态矩阵',
    refresh: '刷新状态',
    request: '请求 seam',
    run: '运行演练',
    running: '运行中',
    scenarios: '可运行场景',
    simulations: 'Mock 演练',
    status: '状态',
    title: '平台联调中心',
    viewResult: '进入演练',
  },
} as const

const PLATFORMS: PlatformDefinition[] = [
  {
    accountKinds: ['facebook-page'],
    capabilities: [
      {
        label: { en: 'Messenger inbound', zh: 'Messenger 入站' },
        source: { capability: 'messaging-inbound', kind: 'readiness' },
      },
      {
        label: { en: 'Photo publishing', zh: '图片发布' },
        source: { capability: 'publishing', kind: 'readiness' },
      },
    ],
    id: 'facebook',
    name: 'Facebook',
    simulationId: 'facebook-publishing',
  },
  {
    accountKinds: ['instagram-professional'],
    capabilities: [
      {
        label: { en: 'Instagram DM inbound', zh: 'Instagram DM 入站' },
        source: { capability: 'messaging-inbound', kind: 'readiness' },
      },
      {
        label: { en: 'Image publishing', zh: '图片发布' },
        source: { capability: 'publishing', kind: 'readiness' },
      },
    ],
    id: 'instagram',
    name: 'Instagram',
    simulationId: 'instagram-publishing',
  },
  {
    accountKinds: ['tiktok-business'],
    capabilities: [
      {
        label: { en: 'Webhook signature', zh: 'Webhook 验签' },
        source: {
          implementation: 'implemented',
          kind: 'static',
          status: 'ready-for-controlled-test',
        },
      },
      {
        label: { en: 'Business DM inbound', zh: '商业私信入站' },
        source: { capability: 'messaging-inbound', kind: 'readiness' },
      },
    ],
    id: 'tiktok',
    name: 'TikTok',
    simulationId: 'tiktok-signature',
  },
  {
    accountKinds: ['linkedin-member', 'linkedin-organization'],
    capabilities: [
      {
        label: { en: 'Assisted package', zh: '辅助发布包' },
        source: {
          implementation: 'implemented',
          kind: 'static',
          status: 'ready-for-controlled-test',
        },
      },
      {
        label: { en: 'Automatic publishing', zh: '自动发布' },
        source: { capability: 'publishing', kind: 'readiness' },
      },
    ],
    id: 'linkedin',
    name: 'LinkedIn',
    simulationId: 'linkedin-publishing',
  },
]

const BLOCKERS: Array<{
  detail: LocalizedText
  owner: LocalizedText
  title: LocalizedText
}> = [
  {
    detail: {
      en: 'PublishJobs / PublishLogs, migration, Payload registration, and generated types are not on main.',
      zh: 'PublishJobs / PublishLogs、migration、Payload 注册和生成类型尚未进入 main。',
    },
    owner: { en: 'Task 12 / jueyunai', zh: 'Task 12 / jueyunai' },
    title: { en: 'Publishing database adapter', zh: '发布数据库 adapter' },
  },
  {
    detail: {
      en: 'Page and professional assets, permissions, App Review, public callback, and controlled testing are required.',
      zh: '需要 Page/专业账号资产、权限、App Review、公开回调和受控测试。',
    },
    owner: { en: 'Client + Meta', zh: '客户 + Meta' },
    title: { en: 'Meta production authorization', zh: 'Meta 真实授权' },
  },
  {
    detail: {
      en: 'Official Business DM schema, regional eligibility, application authorization, and review are unavailable.',
      zh: '官方 Business DM schema、地区资格、应用授权和审核条件尚不具备。',
    },
    owner: { en: 'Client + TikTok', zh: '客户 + TikTok' },
    title: { en: 'TikTok DM connector', zh: 'TikTok 私信 connector' },
  },
  {
    detail: {
      en: 'A real publishing permission grant and controlled image upload/post test are still required.',
      zh: '仍需真实发布权限及受控的图片上传/发帖测试。',
    },
    owner: { en: 'Client + LinkedIn', zh: '客户 + LinkedIn' },
    title: { en: 'LinkedIn automatic publishing', zh: 'LinkedIn 自动发布' },
  },
  {
    detail: {
      en: 'Migration, Payload config, and shared contracts require the other developer to review before main.',
      zh: 'migration、Payload 配置和共享契约进入 main 前必须由另一位开发者 review。',
    },
    owner: { en: 'jueyunai', zh: 'jueyunai' },
    title: { en: 'Cross-developer review', zh: '跨开发者 Review' },
  },
]

const localize = (value: LocalizedText, language: Language) => value[language]

const PlatformIcon = ({ id }: { id: PlatformDefinition['id'] }) => {
  if (id === 'facebook') return <IconBrandFacebook aria-hidden="true" />
  if (id === 'instagram') return <IconBrandInstagram aria-hidden="true" />
  if (id === 'tiktok') return <IconBrandTiktok aria-hidden="true" />
  return <IconBrandLinkedin aria-hidden="true" />
}

const statusLabel = (status: string, language: Language) => {
  if (status === 'ready-for-controlled-test' || status === 'passed') {
    return language === 'en' ? 'Controlled test ready' : '可受控测试'
  }
  if (status === 'blocked') return COPY[language].blocked
  return COPY[language].actionRequired
}

const statusTone = (status: string) => {
  if (status === 'ready-for-controlled-test' || status === 'passed') return 'success'
  if (status === 'blocked') return 'danger'
  return 'warning'
}

export function PlatformOperationsClient({ language }: { language: Language }) {
  const copy = COPY[language]
  const [accounts, setAccounts] = useState<ReadinessAccount[]>([])
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('readiness')
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [selectedScenario, setSelectedScenario] = useState<PlatformSimulationId>(
    'meta-inbound-normalization',
  )
  const [runningScenario, setRunningScenario] = useState<PlatformSimulationId | null>(null)
  const [simulationError, setSimulationError] = useState(false)
  const [simulationResult, setSimulationResult] = useState<PlatformSimulationResult | null>(null)

  const loadReadiness = useCallback(async () => {
    setIsLoading(true)
    setLoadError(false)
    try {
      const response = await fetch('/api/platforms/readiness', {
        cache: 'no-store',
        credentials: 'same-origin',
      })
      if (!response.ok) throw new Error('readiness unavailable')
      const body = (await response.json()) as { accounts?: ReadinessAccount[] }
      setAccounts(Array.isArray(body.accounts) ? body.accounts : [])
    } catch {
      setLoadError(true)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    const timeout = window.setTimeout(() => void loadReadiness(), 0)
    return () => window.clearTimeout(timeout)
  }, [loadReadiness])

  const accountsByPlatform = useMemo(
    () =>
      new Map(
        PLATFORMS.map((platform) => [
          platform.id,
          accounts.filter((account) => platform.accountKinds.includes(account.accountKind)),
        ]),
      ),
    [accounts],
  )

  const runSimulation = async (scenarioId = selectedScenario) => {
    setSelectedScenario(scenarioId)
    setRunningScenario(scenarioId)
    setSimulationError(false)
    setSimulationResult(null)
    try {
      const response = await fetch('/api/platforms/simulations', {
        body: JSON.stringify({ scenarioId }),
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      })
      if (!response.ok) throw new Error('simulation unavailable')
      const body = (await response.json()) as { result?: PlatformSimulationResult }
      if (!body.result) throw new Error('simulation result missing')
      setSimulationResult(body.result)
    } catch {
      setSimulationError(true)
    } finally {
      setRunningScenario(null)
    }
  }

  const openSimulation = (scenarioId: PlatformSimulationId) => {
    setSelectedScenario(scenarioId)
    setSimulationResult(null)
    setSimulationError(false)
    setActiveTab('simulations')
  }

  const tabs: Array<[WorkspaceTab, string, typeof IconShieldCheck]> = [
    ['readiness', copy.readiness, IconShieldCheck],
    ['simulations', copy.simulations, IconTestPipe],
    ['blockers', copy.blockers, IconAlertTriangle],
  ]

  const moveTabFocus = (event: KeyboardEvent<HTMLButtonElement>, currentIndex: number) => {
    let nextIndex: number | null = null
    if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % tabs.length
    if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + tabs.length) % tabs.length
    if (event.key === 'Home') nextIndex = 0
    if (event.key === 'End') nextIndex = tabs.length - 1
    if (nextIndex === null) return

    event.preventDefault()
    const nextTab = tabs[nextIndex][0]
    setActiveTab(nextTab)
    document.getElementById(`platform-ops-tab-${nextTab}`)?.focus()
  }

  return (
    <main className="platform-ops" data-testid="platform-operations">
      <header className="platform-ops__header">
        <div>
          <p className="platform-ops__eyebrow">Task 13</p>
          <h1>{copy.title}</h1>
          <p>{copy.description}</p>
        </div>
        <div className="platform-ops__header-actions">
          <button
            aria-label={copy.refresh}
            className="platform-ops__icon-button"
            disabled={isLoading}
            onClick={() => void loadReadiness()}
            title={copy.refresh}
            type="button"
          >
            <IconRefresh aria-hidden="true" />
          </button>
          <Link className="platform-ops__button" href="/admin/collections/platform-accounts">
            {copy.manageAccounts}
            <IconExternalLink aria-hidden="true" />
          </Link>
        </div>
      </header>

      <section
        aria-label={language === 'en' ? 'Platform summary' : '平台摘要'}
        className="platform-ops__metrics"
      >
        <div>
          <span>{copy.accountRecords}</span>
          <strong>{isLoading ? '...' : accounts.length}</strong>
        </div>
        <div>
          <span>{copy.scenarios}</span>
          <strong>{PLATFORM_SIMULATION_CATALOG.length}</strong>
        </div>
        <div>
          <span>{copy.externalBlockers}</span>
          <strong>{BLOCKERS.length}</strong>
        </div>
        <div>
          <span>{copy.noRealAvailability}</span>
          <strong>0</strong>
        </div>
      </section>

      <div
        aria-label={language === 'en' ? 'Platform workspace views' : '平台工作区视图'}
        className="platform-ops__tabs"
        role="tablist"
      >
        {tabs.map(([tab, label, Icon], index) => (
          <button
            aria-controls={`platform-ops-panel-${tab}`}
            aria-selected={activeTab === tab}
            className={activeTab === tab ? 'is-active' : ''}
            id={`platform-ops-tab-${tab}`}
            key={tab}
            onKeyDown={(event) => moveTabFocus(event, index)}
            onClick={() => setActiveTab(tab)}
            role="tab"
            tabIndex={activeTab === tab ? 0 : -1}
            type="button"
          >
            <Icon aria-hidden="true" />
            {label}
          </button>
        ))}
      </div>

      <section
        aria-labelledby="platform-ops-tab-readiness"
        className="platform-ops__platform-grid"
        hidden={activeTab !== 'readiness'}
        id="platform-ops-panel-readiness"
        role="tabpanel"
      >
        {loadError ? (
          <p className="platform-ops__error" role="alert">
            {copy.failedLoad}
          </p>
        ) : null}
        {PLATFORMS.map((platform) => {
          const platformAccounts = accountsByPlatform.get(platform.id) ?? []
          const account = platformAccounts[0]
          const connectionStatus = account?.readiness.connection.status ?? 'action-required'
          return (
            <article
              className={`platform-ops-card platform-ops-card--${platform.id}`}
              key={platform.id}
            >
              <header className="platform-ops-card__header">
                <span className="platform-ops-card__brand">
                  <PlatformIcon id={platform.id} />
                </span>
                <div>
                  <h2>{platform.name}</h2>
                  <p>{account?.name ?? copy.noAccount}</p>
                </div>
                <span
                  className={`platform-ops-badge platform-ops-badge--${statusTone(connectionStatus)}`}
                >
                  {statusLabel(connectionStatus, language)}
                </span>
              </header>
              <dl className="platform-ops-card__rows">
                <div>
                  <dt>{copy.connection}</dt>
                  <dd>{account?.externalAccountId ?? copy.noAccount}</dd>
                </div>
                {platform.capabilities.map(({ label, source }) => {
                  const capability =
                    source.kind === 'static'
                      ? source
                      : account?.readiness.capabilities.find(
                          ({ capability: readinessCapability }) =>
                            readinessCapability === source.capability,
                        )
                  const capabilityStatus = capability?.status ?? 'blocked'
                  return (
                    <div key={label.en}>
                      <dt>{localize(label, language)}</dt>
                      <dd>
                        <span
                          className={`platform-ops-badge platform-ops-badge--${statusTone(capabilityStatus)}`}
                        >
                          {statusLabel(capabilityStatus, language)}
                        </span>
                        <small>
                          {capability?.implementation === 'implemented'
                            ? copy.codeReady
                            : copy.blocked}
                        </small>
                      </dd>
                    </div>
                  )
                })}
              </dl>
              <footer className="platform-ops-card__actions">
                <Link
                  href={
                    account
                      ? `/admin/collections/platform-accounts/${account.id}`
                      : '/admin/collections/platform-accounts/create'
                  }
                >
                  {account ? copy.manageAccount : copy.createAccount}
                  <IconChevronRight aria-hidden="true" />
                </Link>
                <button onClick={() => openSimulation(platform.simulationId)} type="button">
                  <IconPlayerPlay aria-hidden="true" />
                  {copy.viewResult}
                </button>
              </footer>
            </article>
          )
        })}
      </section>

      <section
        aria-labelledby="platform-ops-tab-simulations"
        className="platform-ops-lab"
        hidden={activeTab !== 'simulations'}
        id="platform-ops-panel-simulations"
        role="tabpanel"
      >
        <div aria-label={copy.scenarios} className="platform-ops-lab__scenarios">
          {PLATFORM_SIMULATION_CATALOG.map((scenario) => (
            <button
              aria-current={selectedScenario === scenario.id ? 'true' : undefined}
              className={selectedScenario === scenario.id ? 'is-active' : ''}
              key={scenario.id}
              onClick={() => {
                setSelectedScenario(scenario.id)
                setSimulationResult(null)
                setSimulationError(false)
              }}
              type="button"
            >
              <span>{localize(scenario.title, language)}</span>
              <small>{localize(scenario.description, language)}</small>
              <IconChevronRight aria-hidden="true" />
            </button>
          ))}
        </div>
        <div className="platform-ops-lab__result" data-testid="platform-simulation-result">
          <div className="platform-ops-lab__result-header">
            <div>
              <span>{copy.status}</span>
              <h2>
                {localize(
                  (
                    PLATFORM_SIMULATION_CATALOG.find(
                      ({ id }) => id === selectedScenario,
                    ) as PlatformSimulationCatalogItem
                  ).title,
                  language,
                )}
              </h2>
            </div>
            <button
              className="platform-ops__button"
              disabled={runningScenario !== null}
              onClick={() => void runSimulation()}
              type="button"
            >
              <IconPlayerPlay aria-hidden="true" />
              {runningScenario ? copy.running : copy.run}
            </button>
          </div>
          {simulationError ? (
            <p className="platform-ops__error" role="alert">
              {copy.failedRun}
            </p>
          ) : null}
          {!simulationResult && !simulationError ? (
            <p className="platform-ops-lab__empty">{copy.notRun}</p>
          ) : null}
          {simulationResult ? (
            <div className="platform-ops-lab__transcript">
              <p>{localize(simulationResult.summary, language)}</p>
              {simulationResult.request ? (
                <div className="platform-ops-lab__request">
                  <span>{copy.request}</span>
                  <code>
                    {simulationResult.request.method} {simulationResult.request.path}
                  </code>
                </div>
              ) : null}
              <ol>
                {simulationResult.steps.map((step, index) => (
                  <li key={`${step.label.en}-${index}`}>
                    <span
                      className={`platform-ops-step platform-ops-step--${step.status}`}
                      aria-hidden="true"
                    />
                    <div>
                      <strong>{localize(step.label, language)}</strong>
                      {step.detail ? <small>{localize(step.detail, language)}</small> : null}
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          ) : null}
        </div>
      </section>

      <section
        aria-labelledby="platform-ops-tab-blockers"
        className="platform-ops-blockers"
        hidden={activeTab !== 'blockers'}
        id="platform-ops-panel-blockers"
        role="tabpanel"
      >
        <header>
          <h2>{copy.blockersTitle}</h2>
          <span>{BLOCKERS.length}</span>
        </header>
        <ul>
          {BLOCKERS.map((item) => (
            <li key={item.title.en}>
              <IconAlertTriangle aria-hidden="true" />
              <div>
                <strong>{localize(item.title, language)}</strong>
                <p>{localize(item.detail, language)}</p>
              </div>
              <span>{localize(item.owner, language)}</span>
            </li>
          ))}
        </ul>
      </section>
    </main>
  )
}
