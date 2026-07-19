'use client'

import {
  IconArrowUp,
  IconMessageCircle2,
  IconRefresh,
  IconUser,
  IconX,
} from '@tabler/icons-react'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { chatCommandKey, createBrowserChatService } from '@/components/chat/service'
import { getWebsiteCopy, type Locale } from '@/lib/i18n'
import type {
  ChatAllowedAction,
  ChatMessage,
  ChatSession,
  RequestHandoffInput,
  RetryChatMessageInput,
  SendChatMessageInput,
  StartChatSessionInput,
} from '@/modules/conversations/contracts'
import { ChatServiceError } from '@/modules/conversations/contracts'

type VisitorChatService = Pick<
  ReturnType<typeof createBrowserChatService>,
  'getSession' | 'requestHandoff' | 'retryMessage' | 'sendMessage' | 'startSession'
>

type WidgetStatus = 'error' | 'idle' | 'loading' | 'sending'

type ChatWidgetProps = {
  locale: Locale
  service?: VisitorChatService
}

type FailedChatAttempt = {
  idempotencyKey: string
  message: ChatMessage
  retryable: boolean
}

const getErrorMessage = (
  error: unknown,
  copy: ReturnType<typeof getWebsiteCopy>['chat'],
): string => {
  if (!(error instanceof ChatServiceError)) return copy.unavailable
  return error.code === 'rate_limited' ? copy.rateLimited : copy.unavailable
}

const isRetryableError = (error: unknown): boolean =>
  !(error instanceof ChatServiceError) || error.retryable

const shouldDiscardPersistedSession = (error: unknown): boolean =>
  error instanceof ChatServiceError && (error.code === 'forbidden' || error.code === 'not_found')

const hasAction = (session: ChatSession | null, action: ChatAllowedAction): boolean =>
  Boolean(session?.allowedActions.includes(action))

const formatTime = (createdAt: string, locale: Locale): string =>
  new Intl.DateTimeFormat(locale === 'ar' ? 'ar' : 'en', {
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(createdAt))

const operationPending = (status: WidgetStatus): boolean =>
  status === 'loading' || status === 'sending'

export function ChatWidget({ locale, service }: ChatWidgetProps) {
  const copy = getWebsiteCopy(locale).chat
  const browserService = useMemo(() => createBrowserChatService(), [])
  const activeService = service || browserService
  const persistSession = !service
  const dialogID = `chat-panel-${locale}`
  const sessionStorageKey = `ivybm_chat_session_id_${locale}`
  const [isOpen, setIsOpen] = useState(false)
  const [session, setSession] = useState<ChatSession | null>(null)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState('')
  const [status, setStatus] = useState<WidgetStatus>('idle')
  const [lastFailedAttempt, setLastFailedAttempt] = useState<FailedChatAttempt | null>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const launcherRef = useRef<HTMLButtonElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const hasOpenedRef = useRef(false)
  const startPromiseRef = useRef<Promise<ChatSession | null> | null>(null)

  const commitSession = useCallback((next: ChatSession) => {
    setSession(next)
    if (persistSession && typeof window !== 'undefined') {
      window.sessionStorage.setItem(sessionStorageKey, String(next.id))
    }
  }, [persistSession, sessionStorageKey])

  useEffect(() => {
    const scrollIntoView = messagesEndRef.current?.scrollIntoView
    if (typeof scrollIntoView === 'function') {
      scrollIntoView.call(messagesEndRef.current, { behavior: 'smooth', block: 'end' })
    }
  }, [session?.messages.length, isOpen])

  const closeChat = useCallback(() => {
    setIsOpen(false)
  }, [])

  useEffect(() => {
    if (isOpen) {
      hasOpenedRef.current = true
      closeButtonRef.current?.focus()
    } else if (hasOpenedRef.current) {
      launcherRef.current?.focus()
      hasOpenedRef.current = false
    }
  }, [isOpen])

  useEffect(() => {
    if (
      !isOpen ||
      !session ||
      (session.handoffStatus !== 'handoff_requested' && session.handoffStatus !== 'human_active')
    ) return undefined
    const timer = window.setInterval(() => {
      void activeService.getSession(session.id).then((next) => {
        commitSession(next)
        setError('')
      }).catch((caught: unknown) => {
        if (shouldDiscardPersistedSession(caught)) {
          setSession(null)
          setLastFailedAttempt(null)
          if (persistSession && typeof window !== 'undefined') {
            window.sessionStorage.removeItem(sessionStorageKey)
          }
        }
        setError(getErrorMessage(caught, copy))
      })
    }, 12_000)
    return () => window.clearInterval(timer)
  }, [activeService, commitSession, copy, isOpen, persistSession, session, sessionStorageKey])

  const startSession = useCallback((forceNew = false): Promise<ChatSession | null> => {
    if (!forceNew && session) return Promise.resolve(session)
    if (startPromiseRef.current) return startPromiseRef.current

    const pending = (async (): Promise<ChatSession | null> => {
      setError('')
      setStatus('loading')
      try {
        if (!forceNew && persistSession && typeof window !== 'undefined') {
          const persistedID = window.sessionStorage.getItem(sessionStorageKey)
          if (persistedID) {
            try {
              const restored = await activeService.getSession(persistedID)
              commitSession(restored)
              return restored
            } catch (caught) {
              if (!shouldDiscardPersistedSession(caught)) throw caught
              window.sessionStorage.removeItem(sessionStorageKey)
            }
          }
        }
        const input: StartChatSessionInput = {
          channel: 'website',
          idempotencyKey: chatCommandKey(),
          locale,
          sourceURL: typeof window === 'undefined' ? undefined : window.location.href,
        }
        const next = await activeService.startSession(input)
        commitSession(next)
        return next
      } catch (caught) {
        setError(getErrorMessage(caught, copy))
        return null
      } finally {
        setStatus('idle')
      }
    })()

    startPromiseRef.current = pending
    void pending.finally(() => {
      if (startPromiseRef.current === pending) startPromiseRef.current = null
    })
    return pending
  }, [activeService, commitSession, copy, locale, persistSession, session, sessionStorageKey])

  const open = (): void => {
    setIsOpen(true)
    void startSession()
  }

  const submitMessage = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const text = draft.trim()
    if (!text || operationPending(status)) return

    const activeSession = await startSession()
    if (!activeSession || !hasAction(activeSession, 'send_message')) return

    setStatus('sending')
    setError('')
    setLastFailedAttempt(null)
    const idempotencyKey = chatCommandKey()
    try {
      const input: SendChatMessageInput = {
        idempotencyKey,
        sessionId: activeSession.id,
        text,
      }
      const next = await activeService.sendMessage(input)
      commitSession(next)
      setDraft('')
    } catch (caught) {
      const failed: ChatMessage = {
        author: 'visitor',
        content: text,
        createdAt: new Date().toISOString(),
        errorCode: caught instanceof ChatServiceError ? caught.code : 'internal_error',
        id: `failed-${chatCommandKey()}`,
        status: 'failed',
      }
      setLastFailedAttempt({
        idempotencyKey,
        message: failed,
        retryable: isRetryableError(caught),
      })
      setError(getErrorMessage(caught, copy))
    } finally {
      setStatus('idle')
    }
  }

  const requestHandoff = async () => {
    if (!session || !hasAction(session, 'request_handoff') || operationPending(status)) return
    setStatus('sending')
    setError('')
    try {
      const input: RequestHandoffInput = {
        idempotencyKey: chatCommandKey(),
        reason: 'visitor_requested_assistance',
        sessionId: session.id,
        source: 'visitor',
      }
      commitSession(await activeService.requestHandoff(input))
    } catch (caught) {
      setError(getErrorMessage(caught, copy))
    } finally {
      setStatus('idle')
    }
  }

  const retryFailedMessage = async () => {
    if (!session || !lastFailedAttempt || !lastFailedAttempt.retryable || operationPending(status)) return
    setStatus('sending')
    setError('')
    try {
      // Reuse the original command key. If the server committed before a response
      // was lost, its durable idempotency record safely returns that first result.
      const input: SendChatMessageInput = {
        idempotencyKey: lastFailedAttempt.idempotencyKey,
        sessionId: session.id,
        text: lastFailedAttempt.message.content,
      }
      commitSession(await activeService.sendMessage(input))
      setLastFailedAttempt(null)
      setDraft('')
    } catch (caught) {
      setLastFailedAttempt((previous) => previous && {
        ...previous,
        message: {
          ...previous.message,
          errorCode: caught instanceof ChatServiceError ? caught.code : 'internal_error',
        },
        retryable: isRetryableError(caught),
      })
      setError(getErrorMessage(caught, copy))
    } finally {
      setStatus('idle')
    }
  }

  const retryPersistedMessage = async (message: ChatMessage) => {
    if (!session || operationPending(status)) return
    setStatus('sending')
    setError('')
    try {
      const input: RetryChatMessageInput = {
        idempotencyKey: chatCommandKey(),
        messageId: message.id,
        sessionId: session.id,
      }
      commitSession(await activeService.retryMessage(input))
    } catch (caught) {
      setError(getErrorMessage(caught, copy))
    } finally {
      setStatus('idle')
    }
  }

  const startNewConversation = () => {
    setDraft('')
    setError('')
    setLastFailedAttempt(null)
    setSession(null)
    if (persistSession && typeof window !== 'undefined') {
      window.sessionStorage.removeItem(sessionStorageKey)
    }
    void startSession(true)
  }

  const messages = [
    ...(session?.messages || []),
    ...(lastFailedAttempt ? [lastFailedAttempt.message] : []),
  ]
  const inputEnabled = hasAction(session, 'send_message') && !operationPending(status)
  const showHandoff = hasAction(session, 'request_handoff')
  const liveStatus = error
    ? ''
    : status === 'loading'
      ? copy.loading
      : status === 'sending'
        ? copy.sending
        : session?.handoffStatus === 'handoff_requested'
          ? copy.handoffPending
          : session?.handoffStatus === 'human_active'
            ? copy.humanActive
            : ''

  const trapDialogFocus = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      closeChat()
      return
    }
    if (event.key !== 'Tab') return

    const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(
      'button:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
    ))
    const first = focusable[0]
    const last = focusable.at(-1)
    if (!first || !last) return

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  return (
    <aside className="chat-widget" data-open={isOpen} data-testid="chat-widget">
      {isOpen ? (
        <section
          aria-labelledby={`${dialogID}-title`}
          aria-modal="true"
          className="chat-panel"
          data-status={session?.handoffStatus || 'starting'}
          id={dialogID}
          onKeyDown={trapDialogFocus}
          role="dialog"
        >
          <span aria-live="polite" className="sr-only" role="status">{liveStatus}</span>
          <header className="chat-panel-header">
            <div className="chat-title-wrap">
              <span aria-hidden className="chat-title-icon"><IconMessageCircle2 size={19} stroke={1.8} /></span>
              <div>
                <strong id={`${dialogID}-title`}>{copy.title}</strong>
                <span className="chat-presence">{session?.handoffStatus === 'human_active' ? copy.humanActive : copy.assistantAvailable}</span>
              </div>
            </div>
            <button aria-label={copy.close} className="chat-close" onClick={closeChat} ref={closeButtonRef} type="button">
              <IconX aria-hidden size={20} />
            </button>
          </header>

          <div className="chat-thread" data-testid="chat-thread">
            {!session && status === 'loading' ? <p className="chat-empty">{copy.loading}</p> : null}
            {!session && error && status === 'idle' ? (
              <article className="chat-unavailable-card" role="alert">
                <IconMessageCircle2 aria-hidden size={22} stroke={1.7} />
                <p>{error}</p>
                <button onClick={() => void startSession()} type="button">
                  <IconRefresh aria-hidden size={15} />
                  {copy.retry}
                </button>
              </article>
            ) : null}
            {session && messages.length === 0 ? (
              <article className="chat-welcome">
                <IconUser aria-hidden size={18} stroke={1.7} />
                <p>{copy.greeting}</p>
              </article>
            ) : null}
            {messages.map((message) => (
              <ChatBubble
                copy={copy}
                key={String(message.id)}
                locale={locale}
                message={message}
                onRetry={() => retryPersistedMessage(message)}
                retryAllowed={hasAction(session, 'retry_message') && message.status === 'failed'}
              />
            ))}
            {session?.handoffStatus === 'handoff_requested' ? (
              <p className="chat-state-note" data-testid="chat-handoff-pending">{copy.handoffPending}</p>
            ) : null}
            {session?.handoffStatus === 'resolved' ? (
              <div className="chat-resolved-wrap">
                <p className="chat-state-note" data-testid="chat-resolved">{copy.resolved}</p>
                <button className="chat-restart" onClick={startNewConversation} type="button">
                  <IconMessageCircle2 aria-hidden size={15} />
                  {copy.newConversation}
                </button>
              </div>
            ) : null}
            <div ref={messagesEndRef} />
          </div>

          {error && session ? (
            <div className="chat-error" role="alert">
              <span>{error}</span>
              {lastFailedAttempt?.retryable ? (
                <button onClick={retryFailedMessage} type="button">
                  <IconRefresh aria-hidden size={15} />
                  {copy.retry}
                </button>
              ) : null}
            </div>
          ) : null}

          {showHandoff ? (
            <button className="chat-handoff" disabled={operationPending(status)} onClick={requestHandoff} type="button">
              <IconUser aria-hidden size={16} />
              {copy.requestHuman}
            </button>
          ) : null}

          <form aria-busy={operationPending(status)} className="chat-composer" onSubmit={submitMessage}>
            <label className="sr-only" htmlFor={`chat-message-${locale}`}>{copy.inputPlaceholder}</label>
            <textarea
              disabled={!inputEnabled}
              id={`chat-message-${locale}`}
              maxLength={5_000}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault()
                  event.currentTarget.form?.requestSubmit()
                }
              }}
              placeholder={copy.inputPlaceholder}
              rows={1}
              value={draft}
            />
            <button aria-label={copy.send} disabled={!inputEnabled || !draft.trim()} type="submit">
              {status === 'sending' ? <IconRefresh aria-hidden className="chat-spin" size={18} /> : <IconArrowUp aria-hidden size={18} />}
              <span>{status === 'sending' ? copy.sending : copy.send}</span>
            </button>
          </form>
        </section>
      ) : null}
      <button
        aria-controls={dialogID}
        aria-expanded={isOpen}
        aria-label={isOpen ? copy.close : copy.launcher}
        className="chat-launcher"
        disabled={!isOpen && status === 'loading'}
        ref={launcherRef}
        onClick={() => {
          if (isOpen) closeChat()
          else open()
        }}
        type="button"
      >
        {isOpen ? <IconX aria-hidden size={24} /> : <IconMessageCircle2 aria-hidden size={24} stroke={1.8} />}
        <span>{copy.title}</span>
      </button>
    </aside>
  )
}

function ChatBubble({
  copy,
  locale,
  message,
  onRetry,
  retryAllowed,
}: {
  copy: ReturnType<typeof getWebsiteCopy>['chat']
  locale: Locale
  message: ChatMessage
  onRetry: () => void
  retryAllowed: boolean
}) {
  const author = message.author === 'visitor' ? 'visitor' : 'assistant'
  return (
    <article className="chat-message" data-author={author} data-status={message.status}>
      <div className="chat-message-content">
        <p>{message.content}</p>
        {message.citations?.length ? (
          <div className="chat-citations">
            <span>{copy.sources}</span>
            {message.citations.map((citation) => (
              <span className="chat-citation" key={`${citation.documentId}-${citation.version}`}>
                {citation.title} · v{citation.version}
              </span>
            ))}
          </div>
        ) : null}
        {retryAllowed ? (
          <button className="chat-message-retry" onClick={onRetry} type="button">
            <IconRefresh aria-hidden size={14} />
            {copy.retryMessage}
          </button>
        ) : null}
      </div>
      <time dateTime={message.createdAt}>{formatTime(message.createdAt, locale)}</time>
    </article>
  )
}
