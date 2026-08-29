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
  ChatMessageStatus,
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
type ConversationFeedback = {
  conversationId: string
  message: string
  selectionEpoch: number
}

const LIVE_REFRESH_INTERVAL_MS = 5_000

const messageStatusRank: Record<ChatMessageStatus, number> = {
  pending: 0,
  failed: 1,
  sent: 2,
}

const mergeMessages = (current: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] => {
  const currentById = new Map(current.map((message) => [String(message.id), message]))
  const seen = new Set<string>()
  const merged = incoming.map((message) => {
    const key = String(message.id)
    const previous = currentById.get(key)
    seen.add(key)
    if (!previous) return message
    if (messageStatusRank[previous.status] > messageStatusRank[message.status]) return previous
    if (
      messageStatusRank[previous.status] === messageStatusRank[message.status] &&
      previous.errorCode &&
      !message.errorCode
    ) {
      return previous
    }
    return message
  })
  return [...merged, ...current.filter((message) => !seen.has(String(message.id)))]
}

/**
 * Merge a response without allowing an older snapshot to undo a newer one.
 * Conversation revision orders domain state; message status is merged
 * separately because asynchronous platform delivery can change it without
 * incrementing the conversation revision.
 */
export const mergeConversationSnapshots = (
  current: ChatSession | null,
  incoming: ChatSession,
): ChatSession => {
  if (!current || String(current.id) !== String(incoming.id)) return incoming
  if (current.revision > incoming.revision) return current
  if (current.revision === incoming.revision) {
    return { ...current, messages: mergeMessages(current.messages, incoming.messages) }
  }
  return { ...incoming, messages: mergeMessages(current.messages, incoming.messages) }
}

const COPY = {
  zh: {
    all: '全部状态',
    assigned: '处理人',
    channel: '渠道',
    citations: '参考知识文档',
    description: '集中查看并处理官网及各社媒渠道的客户咨询，支持 AI 自动接待、人工接管与多渠道直接回复。',
    emptyDescription: '当前筛选条件下没有匹配的会话。',
    emptyTitle: '暂无会话',
    failedDescription: '会话服务读取失败，请检查网络连接后刷新重试。',
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
    revision: '数据版本',
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
    versionPrefix: '版本 ',
  },
  en: {
    all: 'All statuses',
    assigned: 'Assignee',
    channel: 'Channel',
    citations: 'Knowledge references',
    description:
      'Unified inbox for website and social conversations. Inspect customer messages, take over from AI, and reply directly.',
    emptyDescription: 'No conversations match the current filter.',
    emptyTitle: 'No conversations',
    failedDescription:
      'The conversation inbox could not be loaded. Please check your connection and retry.',
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
    revision: 'Revision',
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
    versionPrefix: 'v',
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

const channelLabel = (channel: ChatSessionSummary['channel'], locale: 'en' | 'zh' = 'zh'): string => {
  if (locale === 'en') {
    return {
      facebook: 'Facebook',
      instagram: 'Instagram',
      tiktok: 'TikTok',
      website: 'Website',
      whatsapp: 'WhatsApp',
    }[channel]
  }
  return {
    facebook: 'Facebook',
    instagram: 'Instagram',
    tiktok: 'TikTok',
    website: '官方网站',
    whatsapp: 'WhatsApp',
  }[channel]
}

const formatSessionTitle = (
  id: string | number,
  locale: 'en' | 'zh' = 'zh',
  channel?: ChatSessionSummary['channel'],
): string => {
  const value = String(id)
  const shortId = value.slice(-6)
  if (channel && channel !== 'website') {
    return locale === 'zh'
      ? `${channelLabel(channel, locale)}客户 #${shortId}`
      : `${channelLabel(channel, locale)} customer #${shortId}`
  }
  if (channel === 'website' || value.startsWith('session-')) {
    return locale === 'zh' ? `官网访客 #${shortId}` : `Website visitor #${shortId}`
  }
  return `#${value}`
}

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
  const [activeCommands, setActiveCommands] = useState<Record<string, CommandName>>({})
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [listRefreshGeneration, setListRefreshGeneration] = useState(0)
  const [feedback, setFeedback] = useState<ConversationFeedback | null>(null)
  const listRequest = useRef(0)
  const detailRequest = useRef(0)
  const listAbortRef = useRef<AbortController | null>(null)
  const detailAbortRef = useRef<AbortController | null>(null)
  const terminalDetailErrorRef = useRef<string | null>(null)
  const selectedIdRef = useRef(selectedId)
  const selectionEpochRef = useRef(0)
  const [selectionEpoch, setSelectionEpoch] = useState(0)
  const commandKeys = useRef(new Map<string, string>())

  useEffect(() => {
    if (String(selectedIdRef.current) !== String(selectedId)) {
      selectionEpochRef.current += 1
      setSelectionEpoch(selectionEpochRef.current)
    }
    selectedIdRef.current = selectedId
  }, [selectedId])

  const currentConversationId = selectedId ? String(selectedId) : ''
  const isSelectedSessionActive = selected !== null && String(selected.id) === currentConversationId
  const activeSession = isSelectedSessionActive ? selected : null
  const currentDraft = (currentConversationId && drafts[currentConversationId]) || ''
  const currentCommandName = activeCommands[currentConversationId] ?? null
  const isCurrentCommandRunning = currentCommandName !== null

  const isCurrentSelection = useCallback(
    (targetConversationId: string, targetSelectionEpoch: number) =>
      String(selectedIdRef.current) === targetConversationId &&
      selectionEpochRef.current === targetSelectionEpoch,
    [],
  )
  const currentFeedback =
    feedback &&
    feedback.conversationId === currentConversationId &&
    feedback.selectionEpoch === selectionEpoch
      ? feedback.message
      : null

  const commitSelectedSession = useCallback(
    (result: ChatSession, targetConversationId: string, targetSelectionEpoch: number) => {
      if (String(selectedIdRef.current) !== targetConversationId) return
      setSelected((current) => {
        if (String(selectedIdRef.current) !== targetConversationId) return current
        if (!isCurrentSelection(targetConversationId, targetSelectionEpoch)) {
          if (current && result.revision < current.revision) return current
          return mergeConversationSnapshots(current, result)
        }
        return mergeConversationSnapshots(current, result)
      })
    },
   [isCurrentSelection],
 )

  const loadList = useCallback(async (options?: { isBackground?: boolean }) => {
    if (!enabled) return
    const isBackground = options?.isBackground ?? false
    listAbortRef.current?.abort()
   const controller = new AbortController()
   listAbortRef.current = controller
   const requestID = ++listRequest.current
   if (!isBackground) {
     setListLoading(true)
     setListError(null)
   }
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
       if (isBackground && currentId) {
         return {
           routeConversationId,
           selectedId: currentId,
         }
       }
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
     if (!isBackground) {
       setListError(error instanceof Error ? error.message : copy.failedDescription)
     }
   } finally {
     if (requestID === listRequest.current && !controller.signal.aborted && !isBackground) {
       setListLoading(false)
     }
   }
 }, [copy.failedDescription, enabled, page, routeConversationId, status])

 const loadDetail = useCallback(
   async (options?: { isBackground?: boolean }) => {
     const isBackground = options?.isBackground ?? false
   if (!enabled || selectedId === null) {
     detailAbortRef.current?.abort()
     setSelected(null)
     setDetailLoading(false)
     setDetailError(terminalDetailErrorRef.current)
     terminalDetailErrorRef.current = null
     return
   }
   detailAbortRef.current?.abort()
   const controller = new AbortController()
   detailAbortRef.current = controller
   const requestID = ++detailRequest.current
   const targetId = String(selectedId)
   const targetSelectionEpoch = selectionEpochRef.current
   if (!isBackground) {
     setDetailLoading(true)
     setDetailError(null)
   }
   let terminalError = false
   try {
     const result = await fetchConversationDetail(selectedId, { signal: controller.signal })
     if (
       requestID !== detailRequest.current ||
       controller.signal.aborted ||
       !isCurrentSelection(targetId, targetSelectionEpoch)
     ) {
       return
     }
     commitSelectedSession(result, targetId, targetSelectionEpoch)
   } catch (error) {
     if (
       requestID !== detailRequest.current ||
       controller.signal.aborted ||
       !isCurrentSelection(targetId, targetSelectionEpoch)
     ) {
       return
     }
    terminalError =
      error instanceof ConversationClientError &&
      (error.code === 'forbidden' || error.code === 'not_found')
    if (!isBackground || terminalError) {
      setSelected(null)
      const message =
        error instanceof ConversationClientError && error.code === 'forbidden'
          ? copy.forbiddenDescription
          : error instanceof ConversationClientError && error.code === 'not_found'
            ? copy.failedDescription
          : error instanceof Error
            ? error.message
            : copy.failedDescription
      terminalDetailErrorRef.current = message
      setDetailError(message)
      if (terminalError) {
        setSelection({ routeConversationId, selectedId: null })
      }
     }
   } finally {
     if (
       requestID === detailRequest.current &&
       !controller.signal.aborted &&
       isCurrentSelection(targetId, targetSelectionEpoch) &&
       (!isBackground || terminalError)
     ) {
       setDetailLoading(false)
     }
   }
 }, [
   commitSelectedSession,
   copy.failedDescription,
   copy.forbiddenDescription,
   enabled,
   isCurrentSelection,
   routeConversationId,
   selectedId,
   setSelection,
 ])

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

 // Live-refresh: visitor and AI messages must surface without a manual
 // refresh or an operator command. Paused while the tab is hidden.
 useEffect(() => {
   if (!enabled) return
   const tick = () => {
     if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
     void loadList({ isBackground: true })
     void loadDetail({ isBackground: true })
   }
   const onVisible = () => {
      if (document.visibilityState === 'visible') tick()
    }
    const timer = window.setInterval(tick, LIVE_REFRESH_INTERVAL_MS)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [enabled, loadDetail, loadList])

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
    if (!activeSession) return
    const targetConversationId = String(activeSession.id)
    if (activeCommands[targetConversationId]) return
    const targetSelectionEpoch = selectionEpochRef.current
    const draftSnapshot = drafts[targetConversationId] || ''
    const text = draftSnapshot.trim()
    if (nextCommand === 'operator-messages' && !text) return
    const commandSignature = [nextCommand, targetConversationId, text].join(':')
    const stableKey =
      commandKeys.current.get(commandSignature) ??
      createConversationIdempotencyKey(nextCommand, targetConversationId)
    commandKeys.current.set(commandSignature, stableKey)
    setActiveCommands((current) => ({ ...current, [targetConversationId]: nextCommand }))
    setFeedback(null)
    try {
      const result = await executeConversationCommand({
        command: nextCommand,
        id: targetConversationId,
        idempotencyKey: stableKey,
        ...(nextCommand === 'operator-messages' ? { text } : {}),
      })
      commitSelectedSession(result, targetConversationId, targetSelectionEpoch)
      commandKeys.current.delete(commandSignature)
      if (nextCommand === 'operator-messages') {
        setDrafts((prev) =>
          prev[targetConversationId] === draftSnapshot
            ? { ...prev, [targetConversationId]: '' }
            : prev,
        )
      }
      if (isCurrentSelection(targetConversationId, targetSelectionEpoch)) {
        setFeedback({
          conversationId: targetConversationId,
          message:
            nextCommand === 'take-over'
              ? copy.takeOver
              : nextCommand === 'resolve'
                ? copy.resolve
                : copy.reply,
          selectionEpoch: targetSelectionEpoch,
        })
      }
      setListRefreshGeneration((current) => current + 1)
    } catch (error) {
      if (error instanceof ConversationClientError && error.safeToRotateIdempotencyKey) {
        commandKeys.current.delete(commandSignature)
      }
      if (isCurrentSelection(targetConversationId, targetSelectionEpoch)) {
        setFeedback({
          conversationId: targetConversationId,
          message: error instanceof Error ? error.message : copy.failedDescription,
          selectionEpoch: targetSelectionEpoch,
        })
        await loadDetail()
      }
    } finally {
      setActiveCommands((current) => {
        if (current[targetConversationId] !== nextCommand) return current
        const next = { ...current }
        delete next[targetConversationId]
        return next
      })
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
                          <span>{channelLabel(item.channel, locale)}</span>
                        </div>
                        <StatusBadge
                          className="portal-conversations__list-badge"
                          label={copy.status[item.handoffStatus]}
                          tone={statusTone[item.handoffStatus]}
                        />
                      </div>
                      <div className="portal-conversations__list-title">
                        <strong>{formatSessionTitle(item.id, locale, item.channel)}</strong>
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
                      <h3>{formatSessionTitle(activeSession.id, locale, activeSession.channel)}</h3>
                      <p className="portal-conversations__detail-sub">
                        <span>{channelLabel(activeSession.channel, locale)}</span>
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
                      {channelLabel(activeSession.channel, locale)}
                    </dd>
                  </div>
                  <div className="portal-conversations__meta-chip">
                    <dt>{copy.locale}</dt>
                    <dd>
                      <IconLanguage aria-hidden="true" size={13} />
                      {activeSession.locale === 'ar'
                        ? 'العربية (AR)'
                        : activeSession.locale === 'en'
                          ? locale === 'zh'
                            ? '英语 (EN)'
                            : 'English (EN)'
                          : String(activeSession.locale).toUpperCase()}
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
                    <dt>{copy.revision}</dt>
                    <dd>v{activeSession.revision}</dd>
                  </div>
                </dl>
                {currentFeedback ? (
                  <p className="portal-conversations__feedback" role="status">
                    {currentFeedback}
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
                                    {citation.title} · {copy.versionPrefix}
                                    {citation.version}
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
                        disabled={isCurrentCommandRunning}
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
                              if (currentDraft.trim() && !isCurrentCommandRunning) {
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
                              disabled={isCurrentCommandRunning}
                              onClick={() => void runCommand('resolve')}
                              size="default"
                              variant="secondary"
                            >
                              <IconCheck aria-hidden="true" size={16} />
                              {currentCommandName === 'resolve' ? copy.sending : copy.resolve}
                            </Button>
                          ) : null}
                          <Button
                            disabled={isCurrentCommandRunning || !currentDraft.trim()}
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
                        disabled={isCurrentCommandRunning}
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
