import type {
  ChatErrorCode,
  ChatSession,
  ChatSessionList,
  HandoffStatus,
} from '@/modules/conversations/contracts'

const HANDOFF_STATUS_SET = new Set<HandoffStatus>([
  'ai_active',
  'handoff_requested',
  'human_active',
  'resolved',
])

export class ConversationClientError extends Error {
  readonly code: ChatErrorCode | 'invalid_response' | 'network_failure'
  readonly retryable: boolean
  /** The server must explicitly prove that no command side effect was accepted before rotating a key. */
  readonly safeToRotateIdempotencyKey: boolean

  constructor(
    code: ChatErrorCode | 'invalid_response' | 'network_failure',
    message: string,
    retryable = false,
    safeToRotateIdempotencyKey = false,
  ) {
    super(message)
    this.name = 'ConversationClientError'
    this.code = code
    this.retryable = retryable
    this.safeToRotateIdempotencyKey = safeToRotateIdempotencyKey
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const parseError = (value: unknown): ConversationClientError => {
  if (!isRecord(value) || !isRecord(value.error)) {
    return new ConversationClientError('invalid_response', 'The conversation request failed')
  }
  const code = typeof value.error.code === 'string' ? value.error.code : 'invalid_response'
  const message =
    typeof value.error.message === 'string'
      ? value.error.message
      : 'The conversation request failed'
  return new ConversationClientError(
    code as ConversationClientError['code'],
    message,
    value.error.retryable === true,
    value.error.safeToRotateIdempotencyKey === true,
  )
}

const readJSON = async (response: Response): Promise<unknown> => {
  try {
    return await response.json()
  } catch {
    throw new ConversationClientError('invalid_response', 'The server returned invalid JSON')
  }
}

export const isChatSession = (value: unknown): value is ChatSession => {
  if (!isRecord(value)) return false
  return (
    (typeof value.id === 'string' || typeof value.id === 'number') &&
    typeof value.channel === 'string' &&
    typeof value.locale === 'string' &&
    typeof value.handoffStatus === 'string' &&
    HANDOFF_STATUS_SET.has(value.handoffStatus as HandoffStatus) &&
    Number.isInteger(value.revision) &&
    Array.isArray(value.allowedActions) &&
    Array.isArray(value.messages)
  )
}

export const isChatSessionList = (value: unknown): value is ChatSessionList => {
  if (!isRecord(value) || !Array.isArray(value.docs)) return false
  return (
    Number.isInteger(value.page) &&
    Number.isInteger(value.totalDocs) &&
    Number.isInteger(value.totalPages) &&
    value.docs.every(
      (session) =>
        isRecord(session) &&
        (typeof session.id === 'string' || typeof session.id === 'number') &&
        typeof session.handoffStatus === 'string' &&
        HANDOFF_STATUS_SET.has(session.handoffStatus as HandoffStatus) &&
        Array.isArray(session.allowedActions),
    )
  )
}

export const fetchConversationList = async ({
  page = 1,
  signal,
  status = 'all',
}: {
  page?: number
  signal?: AbortSignal
  status?: HandoffStatus | 'all'
} = {}): Promise<ChatSessionList> => {
  const params = new URLSearchParams({ limit: '20', page: String(page) })
  if (status !== 'all') params.set('status', status)
  try {
    const response = await fetch(`/api/portal/conversations?${params}`, {
      cache: 'no-store',
      credentials: 'same-origin',
      signal,
    })
    const body = await readJSON(response)
    if (!response.ok) throw parseError(body)
    if (!isChatSessionList(body)) {
      throw new ConversationClientError('invalid_response', 'The inbox response is invalid')
    }
    return body
  } catch (error) {
    if (error instanceof ConversationClientError) throw error
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    if (error instanceof Error && error.name === 'AbortError') throw error
    throw new ConversationClientError(
      'network_failure',
      'Unable to reach the conversation service',
      true,
    )
  }
}

export const fetchConversationDetail = async (
  id: number | string,
  options?: { signal?: AbortSignal },
): Promise<ChatSession> => {
  try {
    const response = await fetch(
      `/api/portal/conversations/${encodeURIComponent(String(id))}?view=operator`,
      {
        cache: 'no-store',
        credentials: 'same-origin',
        signal: options?.signal,
      },
    )
    const body = await readJSON(response)
    if (!response.ok) throw parseError(body)
    if (!isChatSession(body)) {
      throw new ConversationClientError('invalid_response', 'The conversation response is invalid')
    }
    return body
  } catch (error) {
    if (error instanceof ConversationClientError) throw error
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    if (error instanceof Error && error.name === 'AbortError') throw error
    throw new ConversationClientError(
      'network_failure',
      'Unable to reach the conversation service',
      true,
    )
  }
}

type ConversationCommand = 'operator-messages' | 'resolve' | 'take-over'

export const executeConversationCommand = async ({
  command,
  id,
  idempotencyKey,
  signal,
  text,
}: {
  command: ConversationCommand
  id: number | string
  idempotencyKey: string
  signal?: AbortSignal
  text?: string
}): Promise<ChatSession> => {
  const body = command === 'operator-messages' ? { idempotencyKey, text } : { idempotencyKey }
  try {
    const response = await fetch(
      `/api/portal/conversations/${encodeURIComponent(String(id))}/${command}`,
      {
        body: JSON.stringify(body),
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        method: 'POST',
        signal,
      },
    )
    const value = await readJSON(response)
    if (!response.ok) throw parseError(value)
    if (!isChatSession(value)) {
      throw new ConversationClientError('invalid_response', 'The command response is invalid')
    }
    return value
  } catch (error) {
    if (error instanceof ConversationClientError) throw error
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    if (error instanceof Error && error.name === 'AbortError') throw error
    throw new ConversationClientError(
      'network_failure',
      'Unable to reach the conversation service',
      true,
    )
  }
}

export const createConversationIdempotencyKey = (command: string, id: number | string): string =>
  `portal:${command}:${String(id)}:${crypto.randomUUID()}`
