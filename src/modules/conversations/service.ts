import type { LeadIntentScore, LeadScoringInput } from '@/modules/leads/score'

import type {
  ChatCitation,
  ChatQualificationState,
  ChatService,
  ChatSession,
  ExternalMessageDelivery,
  HandoffCreatedEvent,
  IngestExternalMessageInput,
  PlatformConversationService,
  RequestHandoffInput,
  RetryChatMessageInput,
  SendChatMessageInput,
  SessionCommandInput,
  StartChatSessionInput,
} from './contracts'
import { ChatServiceError, isCreatableChatChannel } from './contracts'
import {
  allowedActionsFor,
  assertAiReplyAllowed,
  type HandoffCommand,
  transitionHandoff,
} from './handoffState'
import {
  externalMessageCommandKey,
  externalMessageIdentifierMaxLength,
  externalMessagePersistenceKey,
  externalSessionCommandKey,
} from './externalDeliveryIdentity'
import { requiresHumanReview } from './responder'

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
  qualificationState?: ChatQualificationState
  messageMetadata?: Record<string, { externalMessageId?: string; persistedIdempotencyKey?: string }>
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
  qualificationState?: ChatQualificationState
}

export type ConversationResponse =
  AiConversationReply | { handoff: { reason: string; source: 'ai_policy' } }

export interface ConversationResponder {
  generateReply(input: {
    message: string
    missingFields?: readonly import('@/modules/leads/score').LeadQualificationField[]
    qualificationState?: ChatQualificationState
    session: ChatSession
  }): Promise<ConversationResponse>
}

export interface ConversationLeadSink {
  evaluate(session: ChatSession): Promise<ConversationLeadEvaluation>
}

type ConversationServiceOptions = {
  /**
   * TikTok direct messages are a conditional Task 13 capability.  The generic
   * conversation service therefore fails closed until a reviewed, already
   * normalized connector opts in.  Website and Meta callers must never need
   * this flag.
   */
  allowTikTokNormalizedDelivery?: boolean
  clock?: () => Date
  createId?: (kind: 'event' | 'message' | 'request' | 'session') => string
  leadSink?: ConversationLeadSink
  repository: ConversationRepository
  responder: ConversationResponder
}

const defaultCreateId = (kind: 'event' | 'message' | 'request' | 'session'): string =>
  `${kind}-${crypto.randomUUID()}`

const emptyQualificationState = (): ChatQualificationState => ({
  askedFields: [],
  awaitingFields: [],
  roundCount: 0,
})

/**
 * Old persisted sessions and third-party responders may omit the newly added
 * awaiting list at runtime. Normalize at the service boundary so an undefined
 * Payload update can never leave stale answer context in the database.
 */
const normalizeQualificationState = (
  state: ChatQualificationState | undefined,
): ChatQualificationState => {
  const answeredCompany = state?.answeredCompany?.trim()
  return {
    ...(answeredCompany ? { answeredCompany } : {}),
    askedFields: [...(state?.askedFields ?? [])],
    awaitingFields: [...(state?.awaitingFields ?? [])],
    roundCount: state?.roundCount ?? 0,
  }
}

const consumeQualificationAnswerContext = (
  state: ChatQualificationState | undefined,
  evaluation: ConversationLeadEvaluation | undefined,
): ChatQualificationState => {
  const normalized = normalizeQualificationState(state)
  const answeredCompany = evaluation?.signals.company?.trim() || normalized.answeredCompany
  return {
    ...(answeredCompany ? { answeredCompany } : {}),
    askedFields: normalized.askedFields,
    awaitingFields: [],
    roundCount: normalized.roundCount,
  }
}

const mergeQualificationState = (
  consumed: ChatQualificationState,
  next: ChatQualificationState | undefined,
): ChatQualificationState =>
  normalizeQualificationState({
    ...consumed,
    ...next,
    answeredCompany: next?.answeredCompany ?? consumed.answeredCompany,
  })

type IdempotentSessionResult = {
  session: ChatSession
  state: 'claimed' | 'completed'
}

type VisitorMessageCommand = SendChatMessageInput & {
  /** Authenticated platform events are persisted even after AI automation stops. */
  externalInbound?: boolean
  externalMessageId?: string
  persistedIdempotencyKey?: string
}

const requireExternalIdentifier = (value: unknown, field: string, maxLength: number): string => {
  const normalized = typeof value === 'string' ? value.trim() : ''
  if (!normalized || normalized.length > maxLength) {
    throw new ChatServiceError('invalid_request', `${field} is required`)
  }
  return normalized
}

export const createConversationService = ({
  allowTikTokNormalizedDelivery = false,
  clock = () => new Date(),
  createId = defaultCreateId,
  leadSink,
  repository,
  responder,
}: ConversationServiceOptions): ChatService & PlatformConversationService => {
  const idempotent = async (
    scope: string,
    idempotencyKey: string,
    operation: (claim: ConversationCommandClaim) => Promise<ChatSession>,
  ): Promise<IdempotentSessionResult> => {
    if (!idempotencyKey.trim() || idempotencyKey.length > 200) {
      throw new ChatServiceError('invalid_request', 'A valid idempotency key is required')
    }
    const result = await repository.beginCommand(scope, idempotencyKey)
    // Persisting an entire session as the command result leaked a previous viewer's
    // internal snapshot and grew quadratically with the transcript. Rehydrate the
    // durable session for the caller that is replaying this idempotent command.
    if (result.state === 'completed') {
      return { session: await requireSession(result.sessionId), state: 'completed' }
    }
    if (result.state === 'processing') {
      throw new ChatServiceError('conflict', 'The same command is already being processed', {
        retryable: true,
      })
    }
    try {
      return { session: await operation(result.claim), state: 'claimed' }
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
      await repository
        .recordRejectedTransition(session.id, session.handoffStatus, command)
        .catch(() => undefined)
      throw error
    }
  }

  const replyOrHandoff = async (
    message: string,
    session: ChatSession,
    missingFields?: readonly import('@/modules/leads/score').LeadQualificationField[],
    qualificationState?: ChatQualificationState,
  ): Promise<ConversationResponse> => {
    try {
      return await responder.generateReply({ message, missingFields, qualificationState, session })
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

  const startSession = async (input: StartChatSessionInput): Promise<ChatSession> => {
    if (
      !isCreatableChatChannel(input.channel) ||
      (input.channel === 'tiktok' && !allowTikTokNormalizedDelivery)
    ) {
      throw new ChatServiceError('invalid_request', 'Unsupported chat channel')
    }
    if (input.externalThreadId !== undefined) {
      requireExternalIdentifier(input.externalThreadId, 'externalThreadId', 500)
    }
    if (input.externalAccountId !== undefined || input.externalSenderId !== undefined) {
      requireExternalIdentifier(input.externalAccountId ?? '', 'externalAccountId', 240)
      requireExternalIdentifier(input.externalSenderId ?? '', 'externalSenderId', 240)
      if (!input.externalThreadId) {
        throw new ChatServiceError('invalid_request', 'External routing requires a thread ID')
      }
    }
    const result = await idempotent('start', input.idempotencyKey, async (claim) => {
      const session: ChatSession = {
        allowedActions: allowedActionsFor('ai_active'),
        channel: input.channel,
        handoffStatus: 'ai_active',
        id: createId('session'),
        locale: input.locale,
        messages: [],
        qualificationState: emptyQualificationState(),
        revision: 1,
        requestId: createId('request'),
      }
      return repository.createSession(session, input, claim)
    })
    return result.session
  }

  const sendVisitorMessage = async (
    input: VisitorMessageCommand,
  ): Promise<IdempotentSessionResult> =>
    idempotent(`message:${String(input.sessionId)}`, input.idempotencyKey, async (claim) => {
      const session = await requireSession(input.sessionId)
      const base = structuredClone(session)
      const text = input.text.trim()
      if (!text || text.length > 5_000) {
        throw new ChatServiceError('invalid_request', 'Message must contain 1 to 5000 characters')
      }
      if (!session.allowedActions.includes('send_message') && !input.externalInbound) {
        throw new ChatServiceError('conflict', 'Messages are not allowed in the current state')
      }
      const messageID = createId('message')
      session.messages.push({
        author: 'visitor',
        content: text,
        createdAt: clock().toISOString(),
        id: messageID,
        status: 'sent',
      })

      const messageMetadata =
        input.externalMessageId || input.persistedIdempotencyKey
          ? {
              [messageID]: {
                ...(input.externalMessageId ? { externalMessageId: input.externalMessageId } : {}),
                ...(input.persistedIdempotencyKey
                  ? { persistedIdempotencyKey: input.persistedIdempotencyKey }
                  : {}),
              },
            }
          : undefined
      await repository.renewCommand(claim)
      // Handoff state disables AI automation, not durable recording of messages that
      // arrived through an authenticated external platform. Website callers retain
      // the existing state-machine guard above, while later Meta messages remain
      // visible to the operator without inventing an outbound AI reply or transition.
      if (input.externalInbound && session.handoffStatus !== 'ai_active') {
        const qualificationState = consumeQualificationAnswerContext(
          session.qualificationState,
          undefined,
        )
        session.qualificationState = qualificationState
        return repository.saveSession(
          session,
          { base, qualificationState, ...(messageMetadata ? { messageMetadata } : {}) },
          claim,
        )
      }
      const highRiskTopic = requiresHumanReview(text)
      let leadEvaluation = highRiskTopic
        ? await leadSink?.evaluate(session).catch(() => undefined)
        : await leadSink?.evaluate(session)
      const consumedQualificationState = consumeQualificationAnswerContext(
        session.qualificationState,
        leadEvaluation,
      )
      session.qualificationState = consumedQualificationState
      if (highRiskTopic && leadEvaluation) {
        leadEvaluation = { ...leadEvaluation, handoffReason: 'high_risk_topic' }
      }
      let handoff: HandoffCreatedEvent | undefined
      let qualificationState: ChatQualificationState = consumedQualificationState
      const handoffReason = highRiskTopic ? 'high_risk_topic' : leadEvaluation?.handoffReason
      if (handoffReason && session.handoffStatus === 'ai_active') {
        session.handoffStatus = await transition(session, 'request')
        session.allowedActions = allowedActionsFor(session.handoffStatus)
        handoff = createHandoff(session, {
          idempotencyKey: input.idempotencyKey,
          reason: handoffReason,
          source: 'ai_policy',
        })
      } else if (session.handoffStatus === 'ai_active') {
        assertAiReplyAllowed(session.handoffStatus)
        await repository.renewCommand(claim)
        const reply = await replyOrHandoff(
          text,
          session,
          leadEvaluation?.score.missingFields,
          consumedQualificationState,
        )
        if ('handoff' in reply) {
          if (leadEvaluation && !leadEvaluation.handoffReason) {
            leadEvaluation = { ...leadEvaluation, handoffReason: reply.handoff.reason }
          }
          session.handoffStatus = await transition(session, 'request')
          session.allowedActions = allowedActionsFor(session.handoffStatus)
          handoff = createHandoff(session, {
            ...reply.handoff,
            idempotencyKey: input.idempotencyKey,
          })
        } else {
          appendAiReply(session, reply)
          qualificationState = mergeQualificationState(
            consumedQualificationState,
            reply.qualificationState,
          )
          session.qualificationState = qualificationState
        }
      }
      return repository.saveSession(
        session,
        {
          base,
          handoff,
          leadEvaluation,
          qualificationState,
          ...(messageMetadata ? { messageMetadata } : {}),
        },
        claim,
      )
    })

  return {
    async getSession(sessionId) {
      return requireSession(sessionId)
    },

    async startSession(input: StartChatSessionInput) {
      return startSession(input)
    },

    async ingestExternalMessage(
      input: IngestExternalMessageInput,
    ): Promise<ExternalMessageDelivery> {
      if (
        input.channel !== 'facebook' &&
        input.channel !== 'instagram' &&
        input.channel !== 'tiktok'
      ) {
        throw new ChatServiceError('invalid_request', 'Unsupported external conversation channel')
      }
      if (input.channel === 'tiktok' && !allowTikTokNormalizedDelivery) {
        throw new ChatServiceError('invalid_request', 'TikTok normalized delivery is not enabled')
      }
      const externalAccountId = requireExternalIdentifier(
        input.externalAccountId,
        'externalAccountId',
        500,
      )
      const externalSenderId = requireExternalIdentifier(
        input.externalSenderId,
        'externalSenderId',
        500,
      )
      const externalThreadId = requireExternalIdentifier(
        input.externalThreadId,
        'externalThreadId',
        500,
      )
      const externalMessageId = requireExternalIdentifier(
        input.externalMessageId,
        'externalMessageId',
        externalMessageIdentifierMaxLength(input.channel),
      )
      const sessionIdempotencyKey = externalSessionCommandKey(
        input.channel,
        externalAccountId,
        externalSenderId,
      )
      const messageIdempotencyKey = externalMessageCommandKey(input.channel, externalMessageId)
      const session = await startSession({
        channel: input.channel,
        externalAccountId,
        externalSenderId,
        externalThreadId,
        idempotencyKey: sessionIdempotencyKey,
        locale: input.locale,
      })
      const result = await sendVisitorMessage({
        externalInbound: true,
        externalMessageId,
        idempotencyKey: messageIdempotencyKey,
        persistedIdempotencyKey: externalMessagePersistenceKey(
          input.channel,
          externalAccountId,
          externalMessageId,
        ),
        sessionId: session.id,
        text: input.text,
      })
      return {
        session: result.session,
        status: result.state === 'completed' ? 'duplicate' : 'accepted',
      }
    },

    async sendMessage(input: SendChatMessageInput) {
      return (await sendVisitorMessage(input)).session
    },

    async sendOperatorMessage(input: SendChatMessageInput) {
      const result = await idempotent(
        `operator-message:${String(input.sessionId)}`,
        input.idempotencyKey,
        async (claim) => {
          const session = await requireSession(input.sessionId)
          const base = structuredClone(session)
          const text = input.text.trim()
          if (!text || text.length > 5_000) {
            throw new ChatServiceError(
              'invalid_request',
              'Message must contain 1 to 5000 characters',
            )
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
        },
      )
      return result.session
    },

    async retryMessage(input: RetryChatMessageInput) {
      const result = await idempotent(
        `retry:${String(input.sessionId)}`,
        input.idempotencyKey,
        async (claim) => {
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
          const highRiskTopic = requiresHumanReview(message.content)
          let leadEvaluation = highRiskTopic
            ? await leadSink?.evaluate(session).catch(() => undefined)
            : await leadSink?.evaluate(session)
          const consumedQualificationState = consumeQualificationAnswerContext(
            session.qualificationState,
            leadEvaluation,
          )
          session.qualificationState = consumedQualificationState
          if (highRiskTopic && leadEvaluation) {
            leadEvaluation = { ...leadEvaluation, handoffReason: 'high_risk_topic' }
          }
          const reply = highRiskTopic
            ? { handoff: { reason: 'high_risk_topic', source: 'ai_policy' as const } }
            : await replyOrHandoff(
                message.content,
                session,
                leadEvaluation?.score.missingFields,
                consumedQualificationState,
              )
          let handoff: HandoffCreatedEvent | undefined
          let qualificationState: ChatQualificationState = consumedQualificationState
          if ('handoff' in reply) {
            if (leadEvaluation && !leadEvaluation.handoffReason) {
              leadEvaluation = { ...leadEvaluation, handoffReason: reply.handoff.reason }
            }
            session.handoffStatus = await transition(session, 'request')
            session.allowedActions = allowedActionsFor(session.handoffStatus)
            handoff = createHandoff(session, {
              ...reply.handoff,
              idempotencyKey: input.idempotencyKey,
            })
          } else {
            appendAiReply(session, reply)
            qualificationState = mergeQualificationState(
              consumedQualificationState,
              reply.qualificationState,
            )
            session.qualificationState = qualificationState
          }
          return repository.saveSession(
            session,
            { base, handoff, leadEvaluation, qualificationState },
            claim,
          )
        },
      )
      return result.session
    },

    async requestHandoff(input: RequestHandoffInput) {
      const result = await idempotent(
        `handoff:${String(input.sessionId)}`,
        input.idempotencyKey,
        async (claim) => {
          const session = await requireSession(input.sessionId)
          const base = structuredClone(session)
          if (!input.reason.trim()) {
            throw new ChatServiceError('invalid_request', 'Handoff reason is required')
          }
          session.handoffStatus = await transition(session, 'request')
          session.allowedActions = allowedActionsFor(session.handoffStatus)
          return repository.saveSession(
            session,
            {
              base,
              handoff: createHandoff(session, input),
            },
            claim,
          )
        },
      )
      return result.session
    },

    async takeOver(input: SessionCommandInput) {
      const result = await idempotent(
        `take-over:${String(input.sessionId)}`,
        input.idempotencyKey,
        async (claim) => {
          const session = await requireSession(input.sessionId)
          const base = structuredClone(session)
          session.handoffStatus = await transition(session, 'take_over')
          session.allowedActions = allowedActionsFor(session.handoffStatus)
          return repository.saveSession(session, { base }, claim)
        },
      )
      return result.session
    },

    async resolve(input: SessionCommandInput) {
      const result = await idempotent(
        `resolve:${String(input.sessionId)}`,
        input.idempotencyKey,
        async (claim) => {
          const session = await requireSession(input.sessionId)
          const base = structuredClone(session)
          session.handoffStatus = await transition(session, 'resolve')
          session.allowedActions = allowedActionsFor(session.handoffStatus)
          return repository.saveSession(session, { base }, claim)
        },
      )
      return result.session
    },
  }
}
