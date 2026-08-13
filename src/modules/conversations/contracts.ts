export const CHAT_LOCALES = ['en', 'ar'] as const
/** Includes historical persisted values. New phase-one writes use CREATABLE_CHAT_CHANNELS. */
export const CHAT_CHANNELS = ['website', 'whatsapp', 'facebook', 'instagram', 'tiktok'] as const
export const CREATABLE_CHAT_CHANNELS = ['website', 'facebook', 'instagram', 'tiktok'] as const
export const HANDOFF_STATUSES = [
  'ai_active',
  'handoff_requested',
  'human_active',
  'resolved',
] as const

export type ChatLocale = (typeof CHAT_LOCALES)[number]
export type ChatChannel = (typeof CHAT_CHANNELS)[number]
export type CreatableChatChannel = (typeof CREATABLE_CHAT_CHANNELS)[number]
export type HandoffStatus = (typeof HANDOFF_STATUSES)[number]
export type HandoffSource = 'ai_policy' | 'operator' | 'visitor'
export type ChatMessageAuthor = 'ai' | 'operator' | 'system' | 'visitor'
export type ChatMessageStatus = 'pending' | 'sent' | 'failed'
export type ChatAllowedAction =
  | 'request_handoff'
  | 'resolve'
  | 'retry_message'
  | 'send_message'
  | 'send_operator_message'
  | 'take_over'

export type ChatErrorCode =
  | 'ai_unavailable'
  | 'conflict'
  | 'forbidden'
  | 'handoff_required'
  | 'internal_error'
  | 'invalid_request'
  | 'knowledge_unavailable'
  | 'not_found'
  | 'rate_limited'

export type ChatCitation = {
  documentId: number | string
  title: string
  url?: string
  version: string
}

export type ChatMessage = {
  author: ChatMessageAuthor
  citations?: ChatCitation[]
  content: string
  createdAt: string
  estimatedCostUSD?: number | null
  errorCode?: ChatErrorCode
  id: number | string
  model?: string
  promptVersion?: number
  status: ChatMessageStatus
  tokenUsage?: { inputTokens: number; outputTokens?: number; totalTokens: number }
}

export type ChatQualificationState = {
  askedFields: import('@/modules/leads/score').LeadQualificationField[]
  roundCount: number
}

export type ChatSession = {
  allowedActions: ChatAllowedAction[]
  assignedTo?: { id: number | string; name?: string }
  channel: ChatChannel
  handoffStatus: HandoffStatus
  id: number | string
  locale: ChatLocale
  messages: ChatMessage[]
  qualificationState?: ChatQualificationState
  /** Optimistic-concurrency token maintained by the authoritative service. */
  revision: number
  requestId: string
}

/**
 * The operator inbox deliberately returns a bounded summary rather than complete
 * conversation transcripts. Fetch the selected session by ID for its messages.
 */
export type ChatSessionSummary = Omit<ChatSession, 'messages'> & {
  lastMessageAt?: string
}

export type ChatSessionList = {
  docs: ChatSessionSummary[]
  page: number
  totalDocs: number
  totalPages: number
}

export type StartChatSessionInput = {
  /** WhatsApp remains readable as a historical channel but cannot start a new phase-one session. */
  channel: CreatableChatChannel
  /** Internal connector identity; never accepted from the public website route. */
  externalThreadId?: string
  idempotencyKey: string
  locale: ChatLocale
  sourceURL?: string
}

export type SendChatMessageInput = {
  idempotencyKey: string
  sessionId: number | string
  text: string
}

/**
 * Server-only adapter command for an already-authenticated external platform event.
 * The external identifiers are persisted for operations, while callers receive only
 * the same bounded ChatSession shape used by the website contract.
 */
export type IngestExternalMessageInput = {
  /**
   * Server-only normalized platform event. Its connector must authenticate the
   * provider payload before this command is called; WhatsApp remains historical-read-only.
   * The service derives its durable session and message identities from channel plus
   * external identifiers, so a caller cannot change delivery semantics with a
   * transport-level idempotency key.
   */
  channel: Exclude<CreatableChatChannel, 'website'>
  externalAccountId: string
  externalMessageId: string
  externalSenderId: string
  externalThreadId: string
  locale: ChatLocale
  text: string
}

export type ExternalMessageDelivery = {
  session: ChatSession
  status: 'accepted' | 'duplicate'
}

export type RetryChatMessageInput = {
  idempotencyKey: string
  messageId: number | string
  sessionId: number | string
}

export type RequestHandoffInput = {
  idempotencyKey: string
  reason: string
  sessionId: number | string
  source: HandoffSource
}

export type SessionCommandInput = {
  idempotencyKey: string
  sessionId: number | string
}

export type HandoffCreatedEvent = {
  conversationId: number | string
  id: string
  idempotencyKey: string
  occurredAt: string
  reason: string
  source: HandoffSource
  type: 'handoff.created'
}

export interface ChatService {
  getSession(sessionId: number | string): Promise<ChatSession>
  requestHandoff(input: RequestHandoffInput): Promise<ChatSession>
  resolve(input: SessionCommandInput): Promise<ChatSession>
  retryMessage(input: RetryChatMessageInput): Promise<ChatSession>
  sendMessage(input: SendChatMessageInput): Promise<ChatSession>
  sendOperatorMessage(input: SendChatMessageInput): Promise<ChatSession>
  startSession(input: StartChatSessionInput): Promise<ChatSession>
  takeOver(input: SessionCommandInput): Promise<ChatSession>
}

/** Server-only extension used by authenticated platform adapters, never by ChatWidget. */
export interface PlatformConversationService {
  ingestExternalMessage(input: IngestExternalMessageInput): Promise<ExternalMessageDelivery>
}

export const isCreatableChatChannel = (value: unknown): value is CreatableChatChannel =>
  typeof value === 'string' && CREATABLE_CHAT_CHANNELS.some((channel) => channel === value)

export class ChatServiceError extends Error {
  readonly code: ChatErrorCode
  readonly requestId?: string
  readonly retryAfterSeconds?: number
  readonly retryable: boolean

  constructor(
    code: ChatErrorCode,
    message: string,
    options: {
      cause?: unknown
      requestId?: string
      retryAfterSeconds?: number
      retryable?: boolean
    } = {},
  ) {
    super(message, { cause: options.cause })
    this.name = 'ChatServiceError'
    this.code = code
    this.requestId = options.requestId
    this.retryAfterSeconds = options.retryAfterSeconds
    this.retryable = options.retryable ?? false
  }
}
