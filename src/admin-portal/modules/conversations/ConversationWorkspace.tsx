'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  IconArrowLeft,
  IconArrowRight,
  IconCheck,
  IconInbox,
  IconMessageCircle,
  IconRefresh,
  IconSend,
  IconUserCheck,
} from '@tabler/icons-react'

import type { PortalRole } from '@/admin-portal/core/modules/types'
import { usePortalPreferences } from '@/admin-portal/core/navigation/PortalPreferences'
import { Button, PortalState, StatusBadge, Surface } from '@/admin-portal/core/ui'
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

const COPY = {
  zh: {
    all: '全部状态',
    assigned: '当前处理人',
    channel: '渠道',
    description: '集中处理官网与社媒会话；接管、回复和解决均由服务端状态机授权。',
    emptyDescription: '当前筛选条件下没有可处理的会话。',
    emptyTitle: '暂无会话',
    eyebrow: 'WORKSPACE / CONVERSATIONS',
    failedDescription: '会话服务读取失败，页面没有把故障伪装成空列表。',
    failedTitle: '统一会话暂时不可用',
    filterLabel: '会话状态',
    forbiddenDescription: '当前账号无权读取此会话，或会话已被重新分配。',
    loading: '正在加载会话',
    messagePlaceholder: '输入给客户的回复…',
    messages: '消息记录',
    moduleDisabledDescription: '统一会话模块尚未启用。',
    moduleDisabledTitle: '统一会话未启用',
    next: '下一页',
    noMessages: '这条会话还没有消息。',
    previous: '上一页',
    refresh: '刷新',
    reply: '发送回复',
    resolve: '解决会话',
    retry: '重试',
    selectDescription: '从左侧列表选择一条会话查看消息与可执行动作。',
    selectTitle: '选择会话',
    sending: '正在提交',
    status: {
      ai_active: 'AI 服务中',
      handoff_requested: '待接管',
      human_active: '人工处理中',
      resolved: '已解决',
    },
    takeOver: '接管会话',
    title: '统一会话',
    total: '条会话',
    unassigned: '未分配',
  },
  en: {
    all: 'All statuses',
    assigned: 'Assignee',
    channel: 'Channel',
    description:
      'Handle website and social conversations through the authoritative server workflow.',
    emptyDescription: 'No conversations match the current filter.',
    emptyTitle: 'No conversations',
    eyebrow: 'WORKSPACE / CONVERSATIONS',
    failedDescription:
      'The inbox could not be read. The failure is not presented as an empty list.',
    failedTitle: 'Conversation inbox unavailable',
    filterLabel: 'Conversation status',
    forbiddenDescription: 'This account cannot read the conversation, or it has been reassigned.',
    loading: 'Loading conversations',
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
    selectDescription: 'Select a conversation to inspect its timeline and available actions.',
    selectTitle: 'Select a conversation',
    sending: 'Submitting',
    status: {
      ai_active: 'AI active',
      handoff_requested: 'Awaiting takeover',
      human_active: 'Human active',
      resolved: 'Resolved',
    },
    takeOver: 'Take over',
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

const messageAuthor = {
  zh: { ai: 'AI', operator: '运营', system: '系统', visitor: '客户' },
  en: { ai: 'AI', operator: 'Operator', system: 'System', visitor: 'Customer' },
} as const

const channelLabel = (channel: ChatSessionSummary['channel']): string =>
  ({
    facebook: 'Facebook',
    instagram: 'Instagram',
    tiktok: 'TikTok',
    website: 'Website',
    whatsapp: 'WhatsApp',
  })[channel]

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
  role,
}: {
  enabled: boolean
  initialConversationId?: string
  role: PortalRole
}) {
  const { locale } = usePortalPreferences()
  const copy = COPY[locale]
  const [status, setStatus] = useState<StatusFilter>('all')
  const [page, setPage] = useState(1)
  const [list, setList] = useState<ChatSessionList | null>(null)
  const [selectedId, setSelectedId] = useState<number | string | null>(null)
  const [selected, setSelected] = useState<ChatSession | null>(null)
  const [listLoading, setListLoading] = useState(enabled)
  const [detailLoading, setDetailLoading] = useState(false)
  const [listError, setListError] = useState<string | null>(null)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [command, setCommand] = useState<CommandName | null>(null)
  const [replyText, setReplyText] = useState('')
  const [feedback, setFeedback] = useState<string | null>(null)
  const listRequest = useRef(0)
  const detailRequest = useRef(0)
  const commandKeys = useRef(new Map<string, string>())
  const requestedConversationId = useRef(initialConversationId ?? null)

  const loadList = useCallback(async () => {
    if (!enabled) return
    const requestID = ++listRequest.current
    setListLoading(true)
    setListError(null)
    try {
      const result = await fetchConversationList({ page, status })
      if (requestID !== listRequest.current) return
      setList(result)
      setSelectedId((current) => {
        const requested = requestedConversationId.current
        if (requested) {
          requestedConversationId.current = null
          return requested
        }
        if (current && result.docs.some(({ id }) => String(id) === String(current))) return current
        return result.docs[0]?.id ?? null
      })
    } catch (error) {
      if (requestID !== listRequest.current) return
      setListError(error instanceof Error ? error.message : copy.failedDescription)
    } finally {
      if (requestID === listRequest.current) setListLoading(false)
    }
  }, [copy.failedDescription, enabled, page, status])

  const loadDetail = useCallback(async () => {
    if (!enabled || selectedId === null) {
      setSelected(null)
      return
    }
    const requestID = ++detailRequest.current
    setDetailLoading(true)
    setDetailError(null)
    try {
      const result = await fetchConversationDetail(selectedId)
      if (requestID === detailRequest.current) setSelected(result)
    } catch (error) {
      if (requestID !== detailRequest.current) return
      setSelected(null)
      setDetailError(
        error instanceof ConversationClientError && error.code === 'forbidden'
          ? copy.forbiddenDescription
          : error instanceof Error
            ? error.message
            : copy.failedDescription,
      )
    } finally {
      if (requestID === detailRequest.current) setDetailLoading(false)
    }
  }, [copy.failedDescription, copy.forbiddenDescription, enabled, selectedId])

  useEffect(() => {
    const timer = setTimeout(() => void loadList(), 0)
    return () => clearTimeout(timer)
  }, [loadList])

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
    if (!selected || command) return
    const text = replyText.trim()
    if (nextCommand === 'operator-messages' && !text) return
    const commandSignature = [nextCommand, String(selected.id), text].join(':')
    const stableKey =
      commandKeys.current.get(commandSignature) ??
      createConversationIdempotencyKey(nextCommand, selected.id)
    commandKeys.current.set(commandSignature, stableKey)
    setCommand(nextCommand)
    setFeedback(null)
    try {
      const result = await executeConversationCommand({
        command: nextCommand,
        id: selected.id,
        idempotencyKey: stableKey,
        ...(nextCommand === 'operator-messages' ? { text } : {}),
      })
      setSelected(result)
      commandKeys.current.delete(commandSignature)
      if (nextCommand === 'operator-messages') setReplyText('')
      setFeedback(
        nextCommand === 'take-over'
          ? copy.takeOver
          : nextCommand === 'resolve'
            ? copy.resolve
            : copy.reply,
      )
      await loadList()
    } catch (error) {
      if (!(error instanceof ConversationClientError) || !error.retryable) {
        commandKeys.current.delete(commandSignature)
      }
      setFeedback(error instanceof Error ? error.message : copy.failedDescription)
      await loadDetail()
    } finally {
      setCommand(null)
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
          <p className="portal-page__eyebrow">{copy.eyebrow}</p>
          <h2>{copy.title}</h2>
          <p>{copy.description}</p>
        </div>
        <Button aria-label={copy.refresh} onClick={() => void loadList()} variant="secondary">
          <IconRefresh aria-hidden="true" size={16} stroke={1.8} />
          {copy.refresh}
        </Button>
      </header>

      <section aria-label={copy.filterLabel} className="portal-conversations__metrics">
        {(Object.keys(copy.status) as HandoffStatus[]).map((key) => (
          <Surface as="article" key={key}>
            <span>{copy.status[key]}</span>
            <strong>{counts[key]}</strong>
          </Surface>
        ))}
      </section>

      <Surface as="section" className="portal-conversations__toolbar">
        <label>
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
        <span>
          {list?.totalDocs ?? 0} {copy.total}
        </span>
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
                      className={String(selectedId) === String(item.id) ? 'is-selected' : undefined}
                      onClick={() => {
                        setSelectedId(item.id)
                        setFeedback(null)
                      }}
                      type="button"
                    >
                      <span className="portal-conversations__list-title">
                        <strong>#{String(item.id)}</strong>
                        <StatusBadge
                          label={copy.status[item.handoffStatus]}
                          tone={statusTone[item.handoffStatus]}
                        />
                      </span>
                      <span>
                        {channelLabel(item.channel)} · {item.locale.toUpperCase()}
                      </span>
                      <time dateTime={item.lastMessageAt}>
                        {formatDate(item.lastMessageAt, locale)}
                      </time>
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
            {detailLoading && !selected ? (
              <PortalState description={copy.loading} title={copy.loading} type="loading" />
            ) : detailError ? (
              <PortalState
                action={<Button onClick={() => void loadDetail()}>{copy.retry}</Button>}
                description={detailError}
                title={copy.failedTitle}
                type="error"
              />
            ) : selected ? (
              <>
                <header className="portal-conversations__detail-heading">
                  <div>
                    <IconMessageCircle aria-hidden="true" size={20} stroke={1.8} />
                    <div>
                      <h3>#{String(selected.id)}</h3>
                      <p>
                        {channelLabel(selected.channel)} · {selected.locale.toUpperCase()}
                      </p>
                    </div>
                  </div>
                  <StatusBadge
                    label={copy.status[selected.handoffStatus]}
                    tone={statusTone[selected.handoffStatus]}
                  />
                </header>
                <dl className="portal-conversations__metadata">
                  <div>
                    <dt>{copy.channel}</dt>
                    <dd>{channelLabel(selected.channel)}</dd>
                  </div>
                  <div>
                    <dt>{copy.assigned}</dt>
                    <dd>
                      {selected.assignedTo?.name ?? selected.assignedTo?.id ?? copy.unassigned}
                    </dd>
                  </div>
                  <div>
                    <dt>Revision</dt>
                    <dd>{selected.revision}</dd>
                  </div>
                  <div>
                    <dt>Role</dt>
                    <dd>{role}</dd>
                  </div>
                </dl>
                {feedback ? (
                  <p className="portal-conversations__feedback" role="status">
                    {feedback}
                  </p>
                ) : null}
                <section aria-label={copy.messages} className="portal-conversations__timeline">
                  {selected.messages.length ? (
                    selected.messages.map((message) => (
                      <article className={`is-${message.author}`} key={String(message.id)}>
                        <header>
                          <strong>{messageAuthor[locale][message.author]}</strong>
                          <time dateTime={message.createdAt}>
                            {messageTimestamp(message, locale)}
                          </time>
                        </header>
                        <p>{message.content}</p>
                        {message.citations?.length ? (
                          <ul>
                            {message.citations.map((citation) => (
                              <li key={`${String(citation.documentId)}:${citation.version}`}>
                                {citation.title} · v{citation.version}
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </article>
                    ))
                  ) : (
                    <p className="portal-conversations__empty-messages">{copy.noMessages}</p>
                  )}
                </section>
                <footer className="portal-conversations__composer">
                  {selected.allowedActions.includes('take_over') ? (
                    <Button
                      disabled={Boolean(command)}
                      onClick={() => void runCommand('take-over')}
                    >
                      <IconUserCheck aria-hidden="true" size={16} />
                      {command === 'take-over' ? copy.sending : copy.takeOver}
                    </Button>
                  ) : null}
                  {selected.allowedActions.includes('send_operator_message') ? (
                    <div className="portal-conversations__reply">
                      <label>
                        <span className="portal-sr-only">{copy.reply}</span>
                        <textarea
                          maxLength={5000}
                          onChange={(event) => setReplyText(event.target.value)}
                          placeholder={copy.messagePlaceholder}
                          rows={3}
                          value={replyText}
                        />
                      </label>
                      <Button
                        disabled={Boolean(command) || !replyText.trim()}
                        onClick={() => void runCommand('operator-messages')}
                      >
                        <IconSend aria-hidden="true" size={16} />
                        {command === 'operator-messages' ? copy.sending : copy.reply}
                      </Button>
                    </div>
                  ) : null}
                  {selected.allowedActions.includes('resolve') ? (
                    <Button
                      disabled={Boolean(command)}
                      onClick={() => void runCommand('resolve')}
                      variant="secondary"
                    >
                      <IconCheck aria-hidden="true" size={16} />
                      {command === 'resolve' ? copy.sending : copy.resolve}
                    </Button>
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
