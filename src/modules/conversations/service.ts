import type { LeadIntentScore, LeadScoringInput } from '@/modules/leads/score'

import type {
  ChatCitation,
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
import {
  allowedActionsFor,
  assertAiReplyAllowed,
  type HandoffCommand,
  transitionHandoff,
} from './handoffState'

export type ConversationCommandClaim = {
  id: number | string
  idempotencyKey: string
  scope: string
  token: string
}

export type ConversationLeadEvaluation = {
  handoffReason?: string
  score: LeadIntentScore
  signals: LeadScoringInput
}

export type ConversationMutation = {
  base: ChatSession
  handoff?: HandoffCreatedEvent
  leadEvaluation?: ConversationLeadEvaluation
}

export interface ConversationRepository {
  beginCommand(
    scope: string,
    idempotencyKey: string,
  ): Promise<
    | { claim: ConversationCommandClaim; state: 'claimed' }
    | { sessionId: number | string; state: 'completed' }
    | { state: 'processing' }
  >
  createSession(
    session: ChatSession,
    input: StartChatSessionInput,
    claim: ConversationCommandClaim,
  ): Promise<ChatSession>
  failCommand(claim: ConversationCommandClaim, error: unknown): Promise<void>
  getSession(sessionId: number | string): Promise<ChatSession | null>
  recordRejectedTransition(
    sessionId: number | string,
    current: ChatSession['handoffStatus'],
    command: HandoffCommand,
  ): Promise<void>
  renewCommand(claim: ConversationCommandClaim): Promise<void>
  saveSession(
    session: ChatSession,
    mutation: ConversationMutation,
    claim: ConversationCommandClaim,
  ): Promise<ChatSession>
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

export interface ConversationLeadSink {
  evaluate(session: ChatSession): Promise<ConversationLeadEvaluation>
}

type ConversationServiceOptions = {
  clock?: () => Date
  createId?: (kind: 'event' | 'message' | 'request' | 'session') => string
  leadSink?: ConversationLeadSink
  repository: ConversationRepository
  responder: ConversationResponder
}

const defaultCreateId = (kind: 'event' | 'message' | 'request' | 'session'): string =>
  `${kind}-${crypto.randomUUID()}`

export const createConversationService = ({
  clock = () => new Date(),
  createId = defaultCreateId,
  leadSink,
  repository,
  responder,
}: ConversationServiceOptions): ChatService => {
  const idempotent = async (
    scope: string,
    idempotencyKey: string,
    operation: (claim: ConversationCommandClaim) => Promise<ChatSession>,
  ): Promise<ChatSession> => {
    if (!idempotencyKey.trim() || idempotencyKey.length > 200) {
      throw new ChatServiceError('invalid_request', 'A valid idempotency key is required')
    }
    const result = await repository.beginCommand(scope, idempotencyKey)
    // Persisting an entire session as the command result leaked a previous viewer's
    // internal snapshot and grew quadratically with the transcript. Rehydrate the
    // durable session for the caller that is replaying this idempotent command.
    if (result.state === 'completed') return requireSession(result.sessionId)
    if (result.state === 'processing') {
      throw new ChatServiceError('conflict', 'The same command is already being processed', {
        retryable: true,
      })
    }
    try {
      return await operation(result.claim)
    } catch (error) {
      await repository.failCommand(result.claim, error).catch(() => undefined)
      throw error
    }
  }

  const requireSession = async (sessionId: number | string): Promise<ChatSession> => {
    const session = await repository.getSession(sessionId)
    if (!session) throw new ChatServiceError('not_found', 'Chat session not found')
    return session
  }

  const createHandoff = (
    session: ChatSession,
    input: Pick<RequestHandoffInput, 'idempotencyKey' | 'reason' | 'source'>,
  ): HandoffCreatedEvent => ({
    conversationId: session.id,
    id: createId('event'),
    idempotencyKey: input.idempotencyKey,
    occurredAt: clock().toISOString(),
    reason: input.reason,
    source: input.source,
    type: 'handoff.created',
  })

  const transition = async (
    session: ChatSession,
    command: HandoffCommand,
  ): Promise<ChatSession['handoffStatus']> => {
    try {
      return transitionHandoff(session.handoffStatus, command)
    } catch (error) {
      // Preserve the authoritative conflict even if best-effort audit persistence is unavailable.
      await repository.recordRejectedTransition(session.id, session.handoffStatus, command).catch(() => undefined)
      throw error
    }
  }

  const replyOrHandoff = async (
    message: string,
    session: ChatSession,
  ): Promise<ConversationResponse> => {
    try {
      return await responder.generateReply({ message, session })
    } catch {
      // AI and retrieval failures must not leave a visitor without a recoverable path.
      return { handoff: { reason: 'ai_service_unavailable', source: 'ai_policy' } }
    }
  }

  const appendAiReply = (session: ChatSession, reply: AiConversationReply): void => {
    session.messages.push({
      author: 'ai',
      citations: reply.citations,
      content: reply.content,
      createdAt: clock().toISOString(),
      estimatedCostUSD: reply.estimatedCostUSD,
      id: createId('message'),
      model: reply.model,
      promptVersion: reply.promptVersion,
      status: 'sent',
      tokenUsage: reply.tokenUsage,
    })
  }

  return {
    async getSession(sessionId) {
      return requireSession(sessionId)
    },

    async startSession(input: StartChatSessionInput) {
      return idempotent('start', input.idempotencyKey, async (claim) => {
        const session: ChatSession = {
          allowedActions: allowedActionsFor('ai_active'),
          channel: input.channel,
          handoffStatus: 'ai_active',
          id: createId('session'),
          locale: input.locale,
          messages: [],
          revision: 1,
          requestId: createId('request'),
        }
        return repository.createSession(session, input, claim)
      })
    },

    async sendMessage(input: SendChatMessageInput) {
      return idempotent(`message:${String(input.sessionId)}`, input.idempotencyKey, async (claim) => {
        const session = await requireSession(input.sessionId)
        const base = structuredClone(session)
        const text = input.text.trim()
        if (!text || text.length > 5_000) {
          throw new ChatServiceError('invalid_request', 'Message must contain 1 to 5000 characters')
        }
        if (!session.allowedActions.includes('send_message')) {
          throw new ChatServiceError('conflict', 'Messages are not allowed in the current state')
        }
        session.messages.push({
          author: 'visitor',
          content: text,
          createdAt: clock().toISOString(),
          id: createId('message'),
          status: 'sent',
        })

        await repository.renewCommand(claim)
        const leadEvaluation = await leadSink?.evaluate(session)
        let handoff: HandoffCreatedEvent | undefined
        if (leadEvaluation?.handoffReason && session.handoffStatus === 'ai_active') {
          session.handoffStatus = await transition(session, 'request')
          session.allowedActions = allowedActionsFor(session.handoffStatus)
          handoff = createHandoff(session, {
            idempotencyKey: input.idempotencyKey,
            reason: leadEvaluation.handoffReason,
            source: 'ai_policy',
          })
        } else if (session.handoffStatus === 'ai_active') {
          assertAiReplyAllowed(session.handoffStatus)
          await repository.renewCommand(claim)
          const reply = await replyOrHandoff(text, session)
          if ('handoff' in reply) {
            session.handoffStatus = await transition(session, 'request')
            session.allowedActions = allowedActionsFor(session.handoffStatus)
            handoff = createHandoff(session, { ...reply.handoff, idempotencyKey: input.idempotencyKey })
          } else {
            appendAiReply(session, reply)
          }
        }
        return repository.saveSession(session, { base, handoff, leadEvaluation }, claim)
      })
    },

    async sendOperatorMessage(input: SendChatMessageInput) {
      return idempotent(`operator-message:${String(input.sessionId)}`, input.idempotencyKey, async (claim) => {
        const session = await requireSession(input.sessionId)
        const base = structuredClone(session)
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
          status: 'sent',
        })
        return repository.saveSession(session, { base }, claim)
      })
    },

    async retryMessage(input: RetryChatMessageInput) {
      return idempotent(`retry:${String(input.sessionId)}`, input.idempotencyKey, async (claim) => {
        const session = await requireSession(input.sessionId)
        const base = structuredClone(session)
        const message = session.messages.find(({ id }) => String(id) === String(input.messageId))
        if (!message || message.author !== 'visitor') {
          throw new ChatServiceError('not_found', 'Retryable visitor message not found')
        }
        if (message.status !== 'failed') {
          throw new ChatServiceError('conflict', 'Only failed visitor messages can be retried')
        }
        assertAiReplyAllowed(session.handoffStatus)
        await repository.renewCommand(claim)
        const reply = await replyOrHandoff(message.content, session)
        let handoff: HandoffCreatedEvent | undefined
        if ('handoff' in reply) {
          session.handoffStatus = await transition(session, 'request')
          session.allowedActions = allowedActionsFor(session.handoffStatus)
          handoff = createHandoff(session, { ...reply.handoff, idempotencyKey: input.idempotencyKey })
        } else {
          appendAiReply(session, reply)
        }
        return repository.saveSession(session, { base, handoff }, claim)
      })
    },

    async requestHandoff(input: RequestHandoffInput) {
      return idempotent(`handoff:${String(input.sessionId)}`, input.idempotencyKey, async (claim) => {
        const session = await requireSession(input.sessionId)
        const base = structuredClone(session)
        if (!input.reason.trim()) {
          throw new ChatServiceError('invalid_request', 'Handoff reason is required')
        }
        session.handoffStatus = await transition(session, 'request')
        session.allowedActions = allowedActionsFor(session.handoffStatus)
        return repository.saveSession(session, {
          base,
          handoff: createHandoff(session, input),
        }, claim)
      })
    },

    async takeOver(input: SessionCommandInput) {
      return idempotent(`take-over:${String(input.sessionId)}`, input.idempotencyKey, async (claim) => {
        const session = await requireSession(input.sessionId)
        const base = structuredClone(session)
        session.handoffStatus = await transition(session, 'take_over')
        session.allowedActions = allowedActionsFor(session.handoffStatus)
        return repository.saveSession(session, { base }, claim)
      })
    },

    async resolve(input: SessionCommandInput) {
      return idempotent(`resolve:${String(input.sessionId)}`, input.idempotencyKey, async (claim) => {
        const session = await requireSession(input.sessionId)
        const base = structuredClone(session)
        session.handoffStatus = await transition(session, 'resolve')
        session.allowedActions = allowedActionsFor(session.handoffStatus)
        return repository.saveSession(session, { base }, claim)
      })
    },
  }
}
