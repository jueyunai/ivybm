'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useSearchParams } from 'next/navigation'
import {
  IconArrowLeft,
  IconArrowRight,
  IconBrandFacebook,
  IconBrandInstagram,
  IconBrandTiktok,
  IconBrandWhatsapp,
  IconCheck,
  IconClock,
  IconFileText,
  IconFilter,
  IconHeadset,
  IconInbox,
  IconLanguage,
  IconMessageCircle,
  IconRefresh,
  IconRobot,
  IconSend,
  IconSparkles,
  IconUser,
  IconUserCheck,
  IconWorld,
} from '@tabler/icons-react'

import type { PortalRole } from '@/admin-portal/core/modules/types'
import { usePortalPreferences } from '@/admin-portal/core/navigation/PortalPreferences'
import { Button, PortalState, StatusBadge, Surface, cn } from '@/admin-portal/core/ui'
import type {
  ChatMessage,
  ChatSession,
  ChatSessionList,
  ChatSessionSummary,
  HandoffStatus,
} from '@/modules/conversations/contracts'

import {
  ConversationClientError,
  createConversationIdempotencyKey,
  executeConversationCommand,
  fetchConversationDetail,
  fetchConversationList,
} from './conversationClient'

type StatusFilter = HandoffStatus | 'all'
type CommandName = 'operator-messages' | 'resolve' | 'take-over'
type ConversationSelection = {
  routeConversationId: string | null
  selectedId: number | string | null
}

const COPY = {
  zh: {
    all: '全部状态',
    assigned: '处理人',
    channel: '渠道',
    citations: '参考知识文档',
    description: '集中处理官网与各社媒渠道会话；接管、回复与解决均由权威服务端状态机驱动。',
    emptyDescription: '当前筛选条件下没有匹配的会话。',
    emptyTitle: '暂无会话',
    failedDescription: '会话服务读取失败，页面未伪装为空列表。',
    failedTitle: '统一会话暂时不可用',
    filterLabel: '会话状态',
    forbiddenDescription: '当前账号无权读取此会话，或会话已被重新分配。',
    loading: '正在加载会话…',
    locale: '语言',
    messagePlaceholder: '输入给客户的回复…',
    messages: '消息记录',
    moduleDisabledDescription: '统一会话模块尚未启用。',
    moduleDisabledTitle: '统一会话未启用',
    next: '下一页',
    noMessages: '这条会话暂无消息记录。',
    previous: '上一页',
    refresh: '刷新列表',
    reply: '发送回复',
    resolve: '解决会话',
    retry: '重试',
    selectDescription: '从左侧列表中选择一条会话以查看完整对话与操作。',
    selectTitle: '请选择会话',
    sending: '正在提交…',
    shortcutHint: '按 ⌘ + Enter 快速发送',
    status: {
      ai_active: 'AI 服务中',
      handoff_requested: '待接管',
      human_active: '人工处理中',
      resolved: '已解决',
    },
    takeOver: '接管会话',
    takeOverHint: '当前会话由 AI 自动服务。接管后将转由人工直接回复。',
    title: '统一会话',
    total: '条会话',
    unassigned: '未分配',
  },
  en: {
    all: 'All statuses',
    assigned: 'Assignee',
    channel: 'Channel',
    citations: 'Knowledge references',
    description:
      'Unified inbox for website and social conversations powered by the authoritative server workflow.',
    emptyDescription: 'No conversations match the current filter.',
    emptyTitle: 'No conversations',
    failedDescription:
      'The inbox could not be read. The failure is not presented as an empty list.',
    failedTitle: 'Conversation inbox unavailable',
    filterLabel: 'Conversation status',
    forbiddenDescription: 'This account cannot read the conversation, or it has been reassigned.',
    loading: 'Loading conversations…',
    locale: 'Language',
    messagePlaceholder: 'Write a reply to the customer…',
    messages: 'Message timeline',
    moduleDisabledDescription: 'The conversation module has not been enabled.',
    moduleDisabledTitle: 'Conversation module disabled',
    next: 'Next',
    noMessages: 'This conversation has no messages yet.',
    previous: 'Previous',
    refresh: 'Refresh',
    reply: 'Send reply',
    resolve: 'Resolve conversation',
    retry: 'Retry',
    selectDescription:
      'Select a conversation from the left to inspect its timeline and available actions.',
    selectTitle: 'Select a conversation',
    sending: 'Submitting…',
    shortcutHint: 'Press ⌘ + Enter to send',
    status: {
      ai_active: 'AI active',
      handoff_requested: 'Awaiting takeover',
      human_active: 'Human active',
      resolved: 'Resolved',
    },
    takeOver: 'Take over',
    takeOverHint: 'This conversation is currently handled by AI. Take over to reply directly.',
    title: 'Unified conversations',
    total: 'conversations',
    unassigned: 'Unassigned',
  },
} as const

const statusTone: Record<HandoffStatus, 'info' | 'neutral' | 'success' | 'warning'> = {
  ai_active: 'info',
  handoff_requested: 'warning',
  human_active: 'success',
  resolved: 'neutral',
}

const metricIcon: Record<HandoffStatus, ReactNode> = {
  ai_active: <IconSparkles aria-hidden="true" size={16} stroke={1.8} />,
  handoff_requested: <IconUserCheck aria-hidden="true" size={16} stroke={1.8} />,
  human_active: <IconHeadset aria-hidden="true" size={16} stroke={1.8} />,
  resolved: <IconCheck aria-hidden="true" size={16} stroke={1.8} />,
}

const messageAuthorMeta = {
  zh: {
    ai: { icon: IconSparkles, label: 'AI 助手' },
    operator: { icon: IconHeadset, label: '人工客服' },
    system: { icon: IconRobot, label: '系统通知' },
    visitor: { icon: IconUser, label: '客户' },
  },
  en: {
    ai: { icon: IconSparkles, label: 'AI Assistant' },
    operator: { icon: IconHeadset, label: 'Human Operator' },
    system: { icon: IconRobot, label: 'System Notice' },
    visitor: { icon: IconUser, label: 'Customer' },
  },
} as const

const channelLabel = (channel: ChatSessionSummary['channel']): string =>
  ({
    facebook: 'Facebook',
    instagram: 'Instagram',
    tiktok: 'TikTok',
    website: 'Website',
    whatsapp: 'WhatsApp',
  })[channel]

const renderChannelIcon = (channel: ChatSessionSummary['channel'], size = 16) => {
  switch (channel) {
    case 'facebook':
      return (
        <IconBrandFacebook
          aria-hidden="true"
          className="portal-conversations__channel-icon--facebook"
          size={size}
        />
      )
    case 'instagram':
      return (
        <IconBrandInstagram
          aria-hidden="true"
          className="portal-conversations__channel-icon--instagram"
          size={size}
        />
      )
    case 'tiktok':
      return (
        <IconBrandTiktok
          aria-hidden="true"
          className="portal-conversations__channel-icon--tiktok"
          size={size}
        />
      )
    case 'whatsapp':
      return (
        <IconBrandWhatsapp
          aria-hidden="true"
          className="portal-conversations__channel-icon--whatsapp"
          size={size}
        />
      )
    case 'website':
    default:
      return (
        <IconWorld
          aria-hidden="true"
          className="portal-conversations__channel-icon--website"
          size={size}
        />
      )
  }
}

const formatDate = (value: string | undefined, locale: 'en' | 'zh'): string => {
  if (!value) return '—'
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return '—'
  return new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en-GB', {
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    month: 'short',
  }).format(timestamp)
}

const messageTimestamp = (message: ChatMessage, locale: 'en' | 'zh') =>
  formatDate(message.createdAt, locale)

export function ConversationWorkspace({
  enabled,
  initialConversationId,
  role: _role,
}: {
  enabled: boolean
  initialConversationId?: string
  role: PortalRole
}) {
  const searchParams = useSearchParams()
  const { locale } = usePortalPreferences()
  const copy = COPY[locale]
  const routeConversationId = searchParams.get('conversation') ?? initialConversationId ?? null
  const [status, setStatus] = useState<StatusFilter>('all')
  const [page, setPage] = useState(1)
  const [list, setList] = useState<ChatSessionList | null>(null)
  const [selection, setSelection] = useState<ConversationSelection>({
    routeConversationId: null,
    selectedId: null,
  })
  const selectedId =
    selection.routeConversationId === routeConversationId
      ? selection.selectedId
      : routeConversationId
  const [selected, setSelected] = useState<ChatSession | null>(null)
  const [listLoading, setListLoading] = useState(enabled)
  const [detailLoading, setDetailLoading] = useState(false)
  const [listError, setListError] = useState<string | null>(null)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [activeCommand, setActiveCommand] = useState<{
    command: CommandName
    conversationId: string
  } | null>(null)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [listRefreshGeneration, setListRefreshGeneration] = useState(0)
  const [feedback, setFeedback] = useState<string | null>(null)
  const listRequest = useRef(0)
  const detailRequest = useRef(0)
  const listAbortRef = useRef<AbortController | null>(null)
  const detailAbortRef = useRef<AbortController | null>(null)
  const selectedIdRef = useRef(selectedId)
  const commandKeys = useRef(new Map<string, string>())

  useEffect(() => {
    selectedIdRef.current = selectedId
  }, [selectedId])

  const currentConversationId = selectedId ? String(selectedId) : ''
  const isSelectedSessionActive = selected !== null && String(selected.id) === currentConversationId
  const activeSession = isSelectedSessionActive ? selected : null
  const currentDraft = (currentConversationId && drafts[currentConversationId]) || ''
  const isCurrentCommandRunning =
    activeCommand !== null && activeCommand.conversationId === currentConversationId
  const currentCommandName = isCurrentCommandRunning ? activeCommand.command : null

  const loadList = useCallback(async () => {
    if (!enabled) return
    listAbortRef.current?.abort()
    const controller = new AbortController()
    listAbortRef.current = controller
    const requestID = ++listRequest.current
    setListLoading(true)
    setListError(null)
    try {
      const result = await fetchConversationList({
        page,
        signal: controller.signal,
        status,
      })
      if (requestID !== listRequest.current || controller.signal.aborted) return
      setList(result)
      setSelection((current) => {
        if (current.routeConversationId !== routeConversationId && routeConversationId) {
          return { routeConversationId, selectedId: routeConversationId }
        }
        const currentId =
          current.routeConversationId === routeConversationId
            ? current.selectedId
            : routeConversationId
        return {
          routeConversationId,
          selectedId:
            currentId && result.docs.some(({ id }) => String(id) === String(currentId))
              ? currentId
              : (result.docs[0]?.id ?? null),
        }
      })
    } catch (error) {
      if (requestID !== listRequest.current || controller.signal.aborted) return
      setListError(error instanceof Error ? error.message : copy.failedDescription)
    } finally {
      if (requestID === listRequest.current && !controller.signal.aborted) {
        setListLoading(false)
      }
    }
  }, [copy.failedDescription, enabled, page, routeConversationId, status])

  const loadDetail = useCallback(async () => {
    if (!enabled || selectedId === null) {
      detailAbortRef.current?.abort()
      setSelected(null)
      setDetailLoading(false)
      setDetailError(null)
      return
    }
    detailAbortRef.current?.abort()
    const controller = new AbortController()
    detailAbortRef.current = controller
    const requestID = ++detailRequest.current
    const targetId = String(selectedId)
    setDetailLoading(true)
    setDetailError(null)
    try {
      const result = await fetchConversationDetail(selectedId, { signal: controller.signal })
      if (
        requestID !== detailRequest.current ||
        controller.signal.aborted ||
        String(selectedIdRef.current) !== targetId
      ) {
        return
      }
      setSelected(result)
    } catch (error) {
      if (
        requestID !== detailRequest.current ||
        controller.signal.aborted ||
        String(selectedIdRef.current) !== targetId
      ) {
        return
      }
      setSelected(null)
      setDetailError(
        error instanceof ConversationClientError && error.code === 'forbidden'
          ? copy.forbiddenDescription
          : error instanceof Error
            ? error.message
            : copy.failedDescription,
      )
    } finally {
      if (
        requestID === detailRequest.current &&
        !controller.signal.aborted &&
        String(selectedIdRef.current) === targetId
      ) {
        setDetailLoading(false)
      }
    }
  }, [copy.failedDescription, copy.forbiddenDescription, enabled, selectedId])

  useEffect(() => {
    return () => {
      listAbortRef.current?.abort()
      detailAbortRef.current?.abort()
    }
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => void loadList(), 0)
    return () => clearTimeout(timer)
  }, [listRefreshGeneration, loadList])

  useEffect(() => {
    const timer = setTimeout(() => void loadDetail(), 0)
    return () => clearTimeout(timer)
  }, [loadDetail])

  const counts = useMemo(() => {
    const base: Record<HandoffStatus, number> = {
      ai_active: 0,
      handoff_requested: 0,
      human_active: 0,
      resolved: 0,
    }
    for (const item of list?.docs ?? []) base[item.handoffStatus] += 1
    return base
  }, [list])

  const runCommand = async (nextCommand: CommandName) => {
    if (!activeSession || activeCommand) return
    const targetConversationId = String(activeSession.id)
    const draftSnapshot = drafts[targetConversationId] || ''
    const text = draftSnapshot.trim()
    if (nextCommand === 'operator-messages' && !text) return
    const commandSignature = [nextCommand, targetConversationId, text].join(':')
    const stableKey =
      commandKeys.current.get(commandSignature) ??
      createConversationIdempotencyKey(nextCommand, targetConversationId)
    commandKeys.current.set(commandSignature, stableKey)
    setActiveCommand({ command: nextCommand, conversationId: targetConversationId })
    setFeedback(null)
    try {
      const result = await executeConversationCommand({
        command: nextCommand,
        id: targetConversationId,
        idempotencyKey: stableKey,
        ...(nextCommand === 'operator-messages' ? { text } : {}),
      })
      if (String(selectedIdRef.current) === targetConversationId) {
        setSelected(result)
      }
      commandKeys.current.delete(commandSignature)
      if (nextCommand === 'operator-messages') {
        setDrafts((prev) =>
          prev[targetConversationId] === draftSnapshot
            ? { ...prev, [targetConversationId]: '' }
            : prev,
        )
      }
      if (String(selectedIdRef.current) === targetConversationId) {
        setFeedback(
          nextCommand === 'take-over'
            ? copy.takeOver
            : nextCommand === 'resolve'
              ? copy.resolve
              : copy.reply,
        )
      }
      setListRefreshGeneration((current) => current + 1)
    } catch (error) {
      if (!(error instanceof ConversationClientError) || !error.retryable) {
        commandKeys.current.delete(commandSignature)
      }
      if (String(selectedIdRef.current) === targetConversationId) {
        setFeedback(error instanceof Error ? error.message : copy.failedDescription)
        await loadDetail()
      }
    } finally {
      setActiveCommand((current) =>
        current?.conversationId === targetConversationId ? null : current,
      )
    }
  }

  if (!enabled) {
    return (
      <main className="portal-page portal-conversations">
        <PortalState
          description={copy.moduleDisabledDescription}
          title={copy.moduleDisabledTitle}
          type="blocked"
        />
      </main>
    )
  }

  return (
    <main className="portal-page portal-conversations">
      <header className="portal-page__intro portal-conversations__intro">
        <div>
          <h2>{copy.title}</h2>
          <p>{copy.description}</p>
        </div>
        <Button aria-label={copy.refresh} onClick={() => void loadList()} variant="secondary">
          <IconRefresh aria-hidden="true" size={16} stroke={1.8} />
          {copy.refresh}
        </Button>
      </header>

      <section aria-label={copy.filterLabel} className="portal-conversations__metrics">
        {(Object.keys(copy.status) as HandoffStatus[]).map((key) => {
          const isActive = status === key
          return (
            <Surface
              as="article"
              className={cn(
                'portal-conversations__metric-card',
                `portal-conversations__metric-card--${statusTone[key]}`,
                isActive && 'is-active',
              )}
              key={key}
              onClick={() => {
                setStatus((current) => (current === key ? 'all' : key))
                setPage(1)
                setFeedback(null)
              }}
              role="button"
              tabIndex={0}
            >
              <div className="portal-conversations__metric-header">
                <span className="portal-conversations__metric-label">{copy.status[key]}</span>
                <span className="portal-conversations__metric-icon">{metricIcon[key]}</span>
              </div>
              <strong className="portal-conversations__metric-count">{counts[key]}</strong>
            </Surface>
          )
        })}
      </section>

      <Surface as="section" className="portal-conversations__toolbar">
        <label className="portal-conversations__toolbar-filter">
          <IconFilter aria-hidden="true" className="portal-conversations__toolbar-icon" size={15} />
          <span>{copy.filterLabel}</span>
          <select
            onChange={(event) => {
              setStatus(event.target.value as StatusFilter)
              setPage(1)
              setFeedback(null)
            }}
            value={status}
          >
            <option value="all">{copy.all}</option>
            {(Object.keys(copy.status) as HandoffStatus[]).map((key) => (
              <option key={key} value={key}>
                {copy.status[key]}
              </option>
            ))}
          </select>
        </label>
        <div className="portal-conversations__toolbar-meta">
          <span className="portal-conversations__count-badge">
            {list?.totalDocs ?? 0} {copy.total}
          </span>
        </div>
      </Surface>

      {listError ? (
        <PortalState
          action={<Button onClick={() => void loadList()}>{copy.retry}</Button>}
          description={`${copy.failedDescription} ${listError}`}
          title={copy.failedTitle}
          type="error"
        />
      ) : (
        <div className="portal-conversations__workspace">
          <Surface as="section" className="portal-conversations__inbox">
            <header className="portal-conversations__panel-heading">
              <div>
                <IconInbox aria-hidden="true" size={18} stroke={1.8} />
                <h3>{copy.title}</h3>
              </div>
              {list ? (
                <span>
                  {list.page} / {Math.max(list.totalPages, 1)}
                </span>
              ) : null}
            </header>
            {listLoading && !list ? (
              <PortalState description={copy.loading} title={copy.loading} type="loading" />
            ) : list?.docs.length ? (
              <ul className="portal-conversations__list">
                {list.docs.map((item) => (
                  <li key={String(item.id)}>
                    <button
                      aria-pressed={String(selectedId) === String(item.id)}
                      className={cn(
                        'portal-conversations__list-item',
                        String(selectedId) === String(item.id) && 'is-selected',
                      )}
                      onClick={() => {
                        setSelection({ routeConversationId, selectedId: item.id })
                        setFeedback(null)
                      }}
                      type="button"
                    >
                      <div className="portal-conversations__list-top">
                        <div className="portal-conversations__list-channel-badge">
                          {renderChannelIcon(item.channel, 14)}
                          <span>{channelLabel(item.channel)}</span>
                        </div>
                        <StatusBadge
                          className="portal-conversations__list-badge"
                          label={copy.status[item.handoffStatus]}
                          tone={statusTone[item.handoffStatus]}
                        />
                      </div>
                      <div className="portal-conversations__list-title">
                        <strong>#{String(item.id)}</strong>
                      </div>
                      <div className="portal-conversations__list-footer">
                        <span className="portal-conversations__list-locale">
                          <IconLanguage aria-hidden="true" size={12} />
                          {item.locale.toUpperCase()}
                        </span>
                        <time dateTime={item.lastMessageAt}>
                          <IconClock aria-hidden="true" size={12} />
                          {formatDate(item.lastMessageAt, locale)}
                        </time>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <PortalState
                description={copy.emptyDescription}
                title={copy.emptyTitle}
                type="empty"
              />
            )}
            {list && list.totalPages > 1 ? (
              <nav aria-label={copy.filterLabel} className="portal-conversations__pagination">
                <Button
                  disabled={page <= 1}
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                  size="compact"
                  variant="secondary"
                >
                  <IconArrowLeft aria-hidden="true" size={15} />
                  {copy.previous}
                </Button>
                <span>
                  {page} / {list.totalPages}
                </span>
                <Button
                  disabled={page >= list.totalPages}
                  onClick={() => setPage((current) => current + 1)}
                  size="compact"
                  variant="secondary"
                >
                  {copy.next}
                  <IconArrowRight aria-hidden="true" size={15} />
                </Button>
              </nav>
            ) : null}
          </Surface>

          <Surface as="section" className="portal-conversations__detail">
            {detailLoading && !activeSession ? (
              <PortalState description={copy.loading} title={copy.loading} type="loading" />
            ) : detailError ? (
              <PortalState
                action={<Button onClick={() => void loadDetail()}>{copy.retry}</Button>}
                description={detailError}
                title={copy.failedTitle}
                type="error"
              />
            ) : activeSession ? (
              <>
                <header className="portal-conversations__detail-heading">
                  <div className="portal-conversations__detail-lead">
                    <div
                      className={cn(
                        'portal-conversations__channel-avatar',
                        `is-${activeSession.channel}`,
                      )}
                    >
                      {renderChannelIcon(activeSession.channel, 20)}
                    </div>
                    <div className="portal-conversations__detail-title-group">
                      <h3>#{String(activeSession.id)}</h3>
                      <p className="portal-conversations__detail-sub">
                        <span>{channelLabel(activeSession.channel)}</span>
                        <span className="portal-conversations__dot">·</span>
                        <span>{activeSession.locale.toUpperCase()}</span>
                        {activeSession.assignedTo?.name ? (
                          <>
                            <span className="portal-conversations__dot">·</span>
                            <span>{activeSession.assignedTo.name}</span>
                          </>
                        ) : null}
                      </p>
                    </div>
                  </div>
                  <StatusBadge
                    label={copy.status[activeSession.handoffStatus]}
                    tone={statusTone[activeSession.handoffStatus]}
                  />
                </header>
                <dl className="portal-conversations__metadata">
                  <div className="portal-conversations__meta-chip">
                    <dt>{copy.channel}</dt>
                    <dd>
                      {renderChannelIcon(activeSession.channel, 13)}
                      {channelLabel(activeSession.channel)}
                    </dd>
                  </div>
                  <div className="portal-conversations__meta-chip">
                    <dt>{copy.locale}</dt>
                    <dd>
                      <IconLanguage aria-hidden="true" size={13} />
                      {activeSession.locale === 'ar' ? 'العربية (AR)' : 'English (EN)'}
                    </dd>
                  </div>
                  <div className="portal-conversations__meta-chip">
                    <dt>{copy.assigned}</dt>
                    <dd>
                      <IconHeadset aria-hidden="true" size={13} />
                      {activeSession.assignedTo?.name ??
                        activeSession.assignedTo?.id ??
                        copy.unassigned}
                    </dd>
                  </div>
                  <div className="portal-conversations__meta-chip">
                    <dt>Revision</dt>
                    <dd>v{activeSession.revision}</dd>
                  </div>
                </dl>
                {feedback ? (
                  <p className="portal-conversations__feedback" role="status">
                    {feedback}
                  </p>
                ) : null}
                <section aria-label={copy.messages} className="portal-conversations__timeline">
                  {activeSession.messages.length ? (
                    activeSession.messages.map((message) => {
                      const authorMeta = messageAuthorMeta[locale][message.author]
                      const AuthorIcon = authorMeta.icon

                      return (
                        <article
                          className={cn('portal-conversations__bubble', `is-${message.author}`)}
                          key={String(message.id)}
                        >
                          <header className="portal-conversations__bubble-header">
                            <div className="portal-conversations__bubble-author">
                              <span className="portal-conversations__author-avatar">
                                <AuthorIcon aria-hidden="true" size={13} />
                              </span>
                              <strong>{authorMeta.label}</strong>
                            </div>
                            <time dateTime={message.createdAt}>
                              {messageTimestamp(message, locale)}
                            </time>
                          </header>
                          <div className="portal-conversations__bubble-content">
                            <p>{message.content}</p>
                          </div>
                          {message.citations?.length ? (
                            <div className="portal-conversations__citations">
                              <span className="portal-conversations__citations-label">
                                <IconFileText aria-hidden="true" size={12} />
                                {copy.citations}
                              </span>
                              <ul>
                                {message.citations.map((citation) => (
                                  <li key={`${String(citation.documentId)}:${citation.version}`}>
                                    {citation.title} · v{citation.version}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          ) : null}
                        </article>
                      )
                    })
                  ) : (
                    <div className="portal-conversations__empty-messages">
                      <IconMessageCircle
                        aria-hidden="true"
                        className="portal-conversations__empty-icon"
                        size={32}
                        stroke={1.5}
                      />
                      <p>{copy.noMessages}</p>
                    </div>
                  )}
                </section>
                <footer className="portal-conversations__composer">
                  {activeSession.allowedActions.includes('take_over') ? (
                    <div className="portal-conversations__takeover-banner">
                      <div className="portal-conversations__takeover-info">
                        <IconUserCheck className="portal-conversations__takeover-icon" size={18} />
                        <p>{copy.takeOverHint}</p>
                      </div>
                      <Button
                        disabled={Boolean(activeCommand)}
                        onClick={() => void runCommand('take-over')}
                        variant="primary"
                      >
                        <IconUserCheck aria-hidden="true" size={16} />
                        {currentCommandName === 'take-over' ? copy.sending : copy.takeOver}
                      </Button>
                    </div>
                  ) : null}
                  {activeSession.allowedActions.includes('send_operator_message') ? (
                    <div className="portal-conversations__reply">
                      <label className="portal-conversations__reply-field">
                        <span className="portal-sr-only">{copy.reply}</span>
                        <textarea
                          maxLength={5000}
                          onChange={(event) => {
                            const value = event.target.value
                            if (currentConversationId) {
                              setDrafts((prev) => ({ ...prev, [currentConversationId]: value }))
                            }
                          }}
                          onKeyDown={(event) => {
                            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                              event.preventDefault()
                              if (currentDraft.trim() && !activeCommand) {
                                void runCommand('operator-messages')
                              }
                            }
                          }}
                          placeholder={copy.messagePlaceholder}
                          rows={3}
                          value={currentDraft}
                        />
                      </label>
                      <div className="portal-conversations__reply-actions">
                        <span className="portal-conversations__shortcut-hint">
                          {copy.shortcutHint}
                        </span>
                        <div className="portal-conversations__reply-buttons">
                          {activeSession.allowedActions.includes('resolve') ? (
                            <Button
                              disabled={Boolean(activeCommand)}
                              onClick={() => void runCommand('resolve')}
                              size="default"
                              variant="secondary"
                            >
                              <IconCheck aria-hidden="true" size={16} />
                              {currentCommandName === 'resolve' ? copy.sending : copy.resolve}
                            </Button>
                          ) : null}
                          <Button
                            disabled={Boolean(activeCommand) || !currentDraft.trim()}
                            onClick={() => void runCommand('operator-messages')}
                            size="default"
                            variant="primary"
                          >
                            <IconSend aria-hidden="true" size={16} />
                            {currentCommandName === 'operator-messages' ? copy.sending : copy.reply}
                          </Button>
                        </div>
                      </div>
                    </div>
                  ) : activeSession.allowedActions.includes('resolve') ? (
                    <div className="portal-conversations__standalone-resolve">
                      <Button
                        disabled={Boolean(activeCommand)}
                        onClick={() => void runCommand('resolve')}
                        variant="secondary"
                      >
                        <IconCheck aria-hidden="true" size={16} />
                        {currentCommandName === 'resolve' ? copy.sending : copy.resolve}
                      </Button>
                    </div>
                  ) : null}
                </footer>
              </>
            ) : (
              <PortalState
                description={copy.selectDescription}
                title={copy.selectTitle}
                type="empty"
              />
            )}
          </Surface>
        </div>
      )}
    </main>
  )
}
