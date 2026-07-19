import type {
  ChatCitation,
  ChatMessage,
  ChatService,
  ChatSession,
  HandoffCreatedEvent,
  RequestHandoffInput,
  RetryChatMessageInput,
  SendChatMessageInput,
  SessionCommandInput,
  StartChatSessionInput,
} from './contracts'
import { ChatServiceError } from './contracts'
import { allowedActionsFor, assertAiReplyAllowed, transitionHandoff } from './handoffState'

export interface ConversationRepository {
  beginCommand(
    scope: string,
    idempotencyKey: string,
  ): Promise<
    | { state: 'claimed'; token: string }
    | { state: 'completed'; session: ChatSession }
    | { state: 'processing' }
  >
  completeCommand(
    scope: string,
    idempotencyKey: string,
    token: string,
    session: ChatSession,
  ): Promise<void>
  createSession(session: ChatSession, input: StartChatSessionInput): Promise<ChatSession>
  failCommand(scope: string, idempotencyKey: string, token: string, error: unknown): Promise<void>
  getSession(sessionId: number | string): Promise<ChatSession | null>
  saveSession(session: ChatSession): Promise<ChatSession>
}

export type AiConversationReply = {
  citations?: ChatCitation[]
  content: string
  estimatedCostUSD: number | null
  model: string
  promptVersion: number
  tokenUsage: { inputTokens: number; outputTokens?: number; totalTokens: number }
}

export type ConversationResponse =
  | AiConversationReply
  | { handoff: { reason: string; source: 'ai_policy' } }

export interface ConversationResponder {
  generateReply(input: { message: string; session: ChatSession }): Promise<ConversationResponse>
}

export interface ConversationEventSink {
  publish(event: HandoffCreatedEvent): Promise<void>
}

export interface ConversationLeadSink {
  evaluate(session: ChatSession): Promise<{ handoffReason?: string }>
}

type ConversationServiceOptions = {
  clock?: () => Date
  createId?: (kind: 'event' | 'message' | 'request' | 'session') => string
  eventSink: ConversationEventSink
  leadSink?: ConversationLeadSink
  repository: ConversationRepository
  responder: ConversationResponder
}

const defaultCreateId = (kind: 'event' | 'message' | 'request' | 'session'): string =>
  `${kind}-${crypto.randomUUID()}`

export const createConversationService = ({
  clock = () => new Date(),
  createId = defaultCreateId,
  eventSink,
  leadSink,
  repository,
  responder,
}: ConversationServiceOptions): ChatService => {
  const idempotent = async (
    scope: string,
    idempotencyKey: string,
    operation: () => Promise<ChatSession>,
  ): Promise<ChatSession> => {
    if (!idempotencyKey.trim() || idempotencyKey.length > 200) {
      throw new ChatServiceError('invalid_request', 'A valid idempotency key is required')
    }
    const claim = await repository.beginCommand(scope, idempotencyKey)
    if (claim.state === 'completed') return claim.session
    if (claim.state === 'processing') {
      throw new ChatServiceError('conflict', 'The same command is already being processed', {
        retryable: true,
      })
    }
    try {
      const result = await operation()
      await repository.completeCommand(scope, idempotencyKey, claim.token, result)
      return result
    } catch (error) {
      await repository.failCommand(scope, idempotencyKey, claim.token, error).catch(() => undefined)
      throw error
    }
  }

  const requireSession = async (sessionId: number | string): Promise<ChatSession> => {
    const session = await repository.getSession(sessionId)
    if (!session) throw new ChatServiceError('not_found', 'Chat session not found')
    return session
  }

  const publishHandoff = async (
    session: ChatSession,
    input: Pick<RequestHandoffInput, 'idempotencyKey' | 'reason' | 'source'>,
  ): Promise<void> => {
    await eventSink.publish({
      conversationId: session.id,
      id: createId('event'),
      idempotencyKey: input.idempotencyKey,
      occurredAt: clock().toISOString(),
      reason: input.reason,
      source: input.source,
      type: 'handoff.created',
    })
  }

  return {
    async getSession(sessionId) {
      return requireSession(sessionId)
    },

    async startSession(input: StartChatSessionInput) {
      return idempotent('start', input.idempotencyKey, async () => {
        const session: ChatSession = {
          allowedActions: allowedActionsFor('ai_active'),
          channel: input.channel,
          handoffStatus: 'ai_active',
          id: createId('session'),
          locale: input.locale,
          messages: [],
          requestId: createId('request'),
        }
        return repository.createSession(session, input)
      })
    },

    async sendMessage(input: SendChatMessageInput) {
      return idempotent(`message:${String(input.sessionId)}`, input.idempotencyKey, async () => {
        const session = await requireSession(input.sessionId)
        const text = input.text.trim()
        if (!text || text.length > 5_000) {
          throw new ChatServiceError('invalid_request', 'Message must contain 1 to 5000 characters')
        }
        if (!session.allowedActions.includes('send_message')) {
          throw new ChatServiceError('conflict', 'Messages are not allowed in the current state')
        }
        const now = clock().toISOString()
        const visitorMessage: ChatMessage = {
          author: 'visitor',
          content: text,
          createdAt: now,
          id: createId('message'),
        }
        session.messages.push(visitorMessage)

        const leadResult = await leadSink?.evaluate(session)
        if (leadResult?.handoffReason && session.handoffStatus === 'ai_active') {
          session.handoffStatus = transitionHandoff(session.handoffStatus, 'request')
          session.allowedActions = allowedActionsFor(session.handoffStatus)
          await publishHandoff(session, {
            idempotencyKey: input.idempotencyKey,
            reason: leadResult.handoffReason,
            source: 'ai_policy',
          })
          return repository.saveSession(session)
        }

        if (session.handoffStatus === 'ai_active') {
          assertAiReplyAllowed(session.handoffStatus)
          const reply = await responder.generateReply({ message: text, session })
          if ('handoff' in reply) {
            session.handoffStatus = transitionHandoff(session.handoffStatus, 'request')
            session.allowedActions = allowedActionsFor(session.handoffStatus)
            await publishHandoff(session, { ...reply.handoff, idempotencyKey: input.idempotencyKey })
          } else {
            session.messages.push({
              author: 'ai',
              citations: reply.citations,
              content: reply.content,
              createdAt: clock().toISOString(),
              estimatedCostUSD: reply.estimatedCostUSD,
              id: createId('message'),
              model: reply.model,
              promptVersion: reply.promptVersion,
              tokenUsage: reply.tokenUsage,
            })
          }
        }
        return repository.saveSession(session)
      })
    },

    async sendOperatorMessage(input: SendChatMessageInput) {
      return idempotent(`operator-message:${String(input.sessionId)}`, input.idempotencyKey, async () => {
        const session = await requireSession(input.sessionId)
        const text = input.text.trim()
        if (!text || text.length > 5_000) {
          throw new ChatServiceError('invalid_request', 'Message must contain 1 to 5000 characters')
        }
        if (session.handoffStatus !== 'human_active') {
          throw new ChatServiceError('conflict', 'Operator messages require an active handoff')
        }
        session.messages.push({
          author: 'operator',
          content: text,
          createdAt: clock().toISOString(),
          id: createId('message'),
        })
        return repository.saveSession(session)
      })
    },

    async retryMessage(input: RetryChatMessageInput) {
      return idempotent(`retry:${String(input.sessionId)}`, input.idempotencyKey, async () => {
        const session = await requireSession(input.sessionId)
        const message = session.messages.find(({ id }) => String(id) === String(input.messageId))
        if (!message || message.author !== 'visitor') {
          throw new ChatServiceError('not_found', 'Retryable visitor message not found')
        }
        assertAiReplyAllowed(session.handoffStatus)
        const reply = await responder.generateReply({ message: message.content, session })
        if ('handoff' in reply) {
          session.handoffStatus = transitionHandoff(session.handoffStatus, 'request')
          session.allowedActions = allowedActionsFor(session.handoffStatus)
          await publishHandoff(session, { ...reply.handoff, idempotencyKey: input.idempotencyKey })
        } else {
          session.messages.push({
            author: 'ai',
            citations: reply.citations,
            content: reply.content,
            createdAt: clock().toISOString(),
            estimatedCostUSD: reply.estimatedCostUSD,
            id: createId('message'),
            model: reply.model,
            promptVersion: reply.promptVersion,
            tokenUsage: reply.tokenUsage,
          })
        }
        return repository.saveSession(session)
      })
    },

    async requestHandoff(input: RequestHandoffInput) {
      return idempotent(`handoff:${String(input.sessionId)}`, input.idempotencyKey, async () => {
        const session = await requireSession(input.sessionId)
        if (!input.reason.trim()) {
          throw new ChatServiceError('invalid_request', 'Handoff reason is required')
        }
        session.handoffStatus = transitionHandoff(session.handoffStatus, 'request')
        session.allowedActions = allowedActionsFor(session.handoffStatus)
        await publishHandoff(session, input)
        return repository.saveSession(session)
      })
    },

    async takeOver(input: SessionCommandInput) {
      return idempotent(`take-over:${String(input.sessionId)}`, input.idempotencyKey, async () => {
        const session = await requireSession(input.sessionId)
        session.handoffStatus = transitionHandoff(session.handoffStatus, 'take_over')
        session.allowedActions = allowedActionsFor(session.handoffStatus)
        return repository.saveSession(session)
      })
    },

    async resolve(input: SessionCommandInput) {
      return idempotent(`resolve:${String(input.sessionId)}`, input.idempotencyKey, async () => {
        const session = await requireSession(input.sessionId)
        session.handoffStatus = transitionHandoff(session.handoffStatus, 'resolve')
        session.allowedActions = allowedActionsFor(session.handoffStatus)
        return repository.saveSession(session)
      })
    },
  }
}
