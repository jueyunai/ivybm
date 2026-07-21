'use client'

import { createIdempotencyKey } from '@/lib/inquiries/idempotency'
import type {
  ChatErrorCode,
  ChatService,
  ChatSession,
  RequestHandoffInput,
  RetryChatMessageInput,
  SendChatMessageInput,
  StartChatSessionInput,
} from '@/modules/conversations/contracts'
import { ChatServiceError } from '@/modules/conversations/contracts'

type ChatErrorResponse = {
  error?: {
    code?: ChatErrorCode
    message?: string
    retryAfterSeconds?: number
    retryable?: boolean
  }
}

const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(path, {
    ...init,
    credentials: 'same-origin',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      ...init?.headers,
    },
  })

  const body = await response.json().catch(() => ({})) as ChatErrorResponse | T
  if (!response.ok) {
    const error = (body as ChatErrorResponse).error
    throw new ChatServiceError(error?.code || 'internal_error', error?.message || 'Chat request failed', {
      retryAfterSeconds: error?.retryAfterSeconds,
      retryable: error?.retryable,
    })
  }

  return body as T
}

const sessionPath = (sessionId: number | string): string =>
  `/api/chat/sessions/${encodeURIComponent(String(sessionId))}`

const command = <T extends Record<string, unknown>>(path: string, body: T): Promise<ChatSession> =>
  request<ChatSession>(path, { body: JSON.stringify(body), method: 'POST' })

/**
 * Same-origin adapter for the frozen public ChatService surface. It intentionally
 * exposes only visitor commands; operator commands live in the authenticated
 * operations UI and never share this browser adapter.
 */
export const createBrowserChatService = (): Pick<
  ChatService,
  'getSession' | 'requestHandoff' | 'retryMessage' | 'sendMessage' | 'startSession'
> => ({
  getSession: (sessionId) => request<ChatSession>(sessionPath(sessionId)),
  requestHandoff: ({ idempotencyKey, reason, sessionId }: RequestHandoffInput) =>
    command(`${sessionPath(sessionId)}/handoff`, { idempotencyKey, reason }),
  retryMessage: ({ idempotencyKey, messageId, sessionId }: RetryChatMessageInput) =>
    command(`${sessionPath(sessionId)}/messages/${encodeURIComponent(String(messageId))}/retry`, {
      idempotencyKey,
    }),
  sendMessage: ({ idempotencyKey, sessionId, text }: SendChatMessageInput) =>
    command(`${sessionPath(sessionId)}/messages`, { idempotencyKey, text }),
  startSession: ({ channel, idempotencyKey, locale, sourceURL }: StartChatSessionInput) =>
    command('/api/chat/sessions', { channel, idempotencyKey, locale, sourceURL }),
})

export const chatCommandKey = (): string => createIdempotencyKey()
