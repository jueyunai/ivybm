import type { PostgresAdapter } from '@payloadcms/db-postgres'
import { randomUUID } from 'node:crypto'
import {
  commitTransaction,
  createLocalReq,
  initTransaction,
  killTransaction,
  type Payload,
} from 'payload'

import type { Conversation, Message, User } from '@/payload-types'

import type { ChatMessage, ChatSession, StartChatSessionInput } from './contracts'
import { ChatServiceError, type HandoffCreatedEvent } from './contracts'
import { allowedActionsFor } from './handoffState'
import type { ConversationEventSink, ConversationRepository } from './service'

type PayloadConversationRepositoryOptions = {
  actor?: User
  payload: Payload
  sessionTokenHash?: string
}

const relationshipID = (value: number | { id: number } | null | undefined): number | undefined =>
  typeof value === 'number' ? value : value?.id

const isChatSession = (value: unknown): value is ChatSession => {
  if (!value || typeof value !== 'object') return false
  const session = value as Partial<ChatSession>
  return (
    (typeof session.id === 'number' || typeof session.id === 'string') &&
    typeof session.requestId === 'string' &&
    Array.isArray(session.messages) &&
    Array.isArray(session.allowedActions)
  )
}

const mapMessage = (message: Message): ChatMessage => ({
  author: message.author,
  citations: message.citations?.map((citation) => ({
    documentId: citation.documentId,
    title: citation.title,
    ...(citation.url ? { url: citation.url } : {}),
    version: citation.version,
  })),
  content: message.content,
  createdAt: message.createdAt,
  estimatedCostUSD: message.estimatedCostUSD ?? undefined,
  id: message.requestId,
  model: message.model ?? undefined,
  promptVersion: message.promptVersion ?? undefined,
  tokenUsage: message.tokenUsage?.totalTokens
    ? {
        inputTokens: message.tokenUsage.inputTokens ?? 0,
        outputTokens: message.tokenUsage.outputTokens ?? undefined,
        totalTokens: message.tokenUsage.totalTokens,
      }
    : undefined,
})

export class PayloadConversationRepository implements ConversationRepository {
  private readonly actor?: User
  private readonly payload: Payload
  private readonly pool: PostgresAdapter['pool']
  private readonly sessionTokenHash?: string

  constructor(options: PayloadConversationRepositoryOptions) {
    this.actor = options.actor
    this.payload = options.payload
    this.pool = (options.payload.db as unknown as PostgresAdapter).pool
    this.sessionTokenHash = options.sessionTokenHash
  }

  private async findConversation(publicId: number | string): Promise<Conversation | null> {
    const result = await this.payload.find({
      collection: 'conversations',
      limit: 1,
      overrideAccess: true,
      where: { publicId: { equals: String(publicId) } },
    })
    return result.docs[0] ?? null
  }

  private async hydrate(conversation: Conversation): Promise<ChatSession> {
    const messages: Message[] = []
    let page = 1
    while (true) {
      const result = await this.payload.find({
        collection: 'messages',
        limit: 200,
        overrideAccess: true,
        page,
        sort: 'createdAt',
        where: { conversation: { equals: conversation.id } },
      })
      messages.push(...result.docs)
      if (!result.hasNextPage) break
      if (messages.length >= 5_000) {
        throw new ChatServiceError('internal_error', 'Conversation exceeds the message limit')
      }
      page += 1
    }
    const assigned =
      conversation.assignedTo && typeof conversation.assignedTo === 'object'
        ? { id: conversation.assignedTo.id, name: conversation.assignedTo.email }
        : conversation.assignedTo
          ? { id: conversation.assignedTo }
          : undefined
    return {
      allowedActions: allowedActionsFor(conversation.handoffStatus),
      assignedTo: assigned,
      channel: conversation.channel,
      handoffStatus: conversation.handoffStatus,
      id: conversation.publicId,
      locale: conversation.locale,
      messages: messages.map(mapMessage),
      requestId: conversation.requestId,
    }
  }

  async beginCommand(scope: string, idempotencyKey: string) {
    const existing = await this.payload.find({
      collection: 'conversation-commands',
      limit: 1,
      overrideAccess: true,
      where: { idempotencyKey: { equals: idempotencyKey } },
    })
    const command = existing.docs[0]
    if (command) {
      if (command.scope !== scope) {
        throw new ChatServiceError('conflict', 'Idempotency key was used for another command')
      }
      if (command.status === 'completed' && isChatSession(command.result)) {
        return { session: command.result, state: 'completed' as const }
      }
      if (command.status === 'processing') return { state: 'processing' as const }
      const token = randomUUID()
      const reclaimed = await this.pool.query(
        `UPDATE conversation_commands
            SET status = 'processing', owner_token = $1, error_code = NULL, updated_at = NOW()
          WHERE id = $2 AND status = 'failed'`,
        [token, command.id],
      )
      return reclaimed.rowCount === 1
        ? { state: 'claimed' as const, token }
        : { state: 'processing' as const }
    }

    const token = randomUUID()
    try {
      await this.payload.create({
        collection: 'conversation-commands',
        data: { idempotencyKey, ownerToken: token, scope, status: 'processing' },
        overrideAccess: true,
      })
      return { state: 'claimed' as const, token }
    } catch (error) {
      const raced = await this.payload.find({
        collection: 'conversation-commands',
        limit: 1,
        overrideAccess: true,
        where: { idempotencyKey: { equals: idempotencyKey } },
      })
      if (raced.docs[0]) return { state: 'processing' as const }
      throw error
    }
  }

  async completeCommand(
    _scope: string,
    idempotencyKey: string,
    token: string,
    session: ChatSession,
  ): Promise<void> {
    const conversation = await this.findConversation(session.id)
    const result = await this.pool.query(
      `UPDATE conversation_commands
          SET status = 'completed',
              result = $1::jsonb,
              conversation_id = $2,
              updated_at = NOW()
        WHERE idempotency_key = $3
          AND owner_token = $4
          AND status = 'processing'`,
      [JSON.stringify(session), conversation?.id ?? null, idempotencyKey, token],
    )
    if (result.rowCount !== 1) throw new Error('Conversation command claim was lost')
  }

  async failCommand(
    _scope: string,
    idempotencyKey: string,
    token: string,
    error: unknown,
  ): Promise<void> {
    const errorCode = error instanceof ChatServiceError ? error.code : 'internal_error'
    await this.pool.query(
      `UPDATE conversation_commands
          SET status = 'failed', error_code = $1, updated_at = NOW()
        WHERE idempotency_key = $2
          AND owner_token = $3
          AND status = 'processing'`,
      [errorCode, idempotencyKey, token],
    )
  }

  async createSession(session: ChatSession, input: StartChatSessionInput): Promise<ChatSession> {
    if (!this.sessionTokenHash) throw new Error('Session token hash is required')
    const req = await createLocalReq({ user: this.actor }, this.payload)
    await initTransaction(req)
    try {
      const visitor = await this.payload.create({
        collection: 'visitor-sessions',
        data: {
          channel: input.channel,
          idempotencyKey: input.idempotencyKey,
          lastSeenAt: new Date().toISOString(),
          locale: input.locale,
          publicId: `visitor-${String(session.id)}`,
          sessionTokenHash: this.sessionTokenHash,
          sourceURL: input.sourceURL,
        },
        overrideAccess: true,
        req,
      })
      await this.payload.create({
        collection: 'conversations',
        data: {
          channel: session.channel,
          handoffStatus: session.handoffStatus,
          intentLevel: 'unscored',
          locale: session.locale,
          publicId: String(session.id),
          requestId: session.requestId,
          visitorSession: visitor.id,
        },
        overrideAccess: true,
        req,
      })
      await commitTransaction(req)
    } catch (error) {
      await killTransaction(req).catch(() => undefined)
      throw error
    }
    const created = await this.findConversation(session.id)
    if (!created) throw new Error('Conversation was not created')
    return this.hydrate(created)
  }

  async getSession(sessionId: number | string): Promise<ChatSession | null> {
    const conversation = await this.findConversation(sessionId)
    return conversation ? this.hydrate(conversation) : null
  }

  async saveSession(session: ChatSession): Promise<ChatSession> {
    const conversation = await this.findConversation(session.id)
    if (!conversation) throw new ChatServiceError('not_found', 'Chat session not found')
    const lastMessageAt = session.messages.at(-1)?.createdAt ?? null
    if (conversation.handoffStatus !== session.handoffStatus) {
      const expected: string | undefined = ({
        handoff_requested: 'ai_active',
        human_active: 'handoff_requested',
        resolved: 'human_active',
      } as Partial<Record<typeof session.handoffStatus, string>>)[session.handoffStatus]
      if (!expected) throw new ChatServiceError('conflict', 'Illegal persisted handoff transition')
      if (session.handoffStatus === 'human_active' && !this.actor) {
        throw new ChatServiceError('forbidden', 'An authenticated operator is required')
      }
      const assignedTo =
        session.handoffStatus === 'human_active'
          ? this.actor?.id
          : relationshipID(conversation.assignedTo)
      const transitioned = await this.pool.query(
        `UPDATE conversations
            SET handoff_status = $1,
                assigned_to_id = $2,
                last_message_at = COALESCE($3, last_message_at),
                updated_at = NOW()
          WHERE id = $4
            AND handoff_status = $5`,
        [session.handoffStatus, assignedTo ?? null, lastMessageAt, conversation.id, expected],
      )
      if (transitioned.rowCount !== 1) {
        throw new ChatServiceError('conflict', 'Conversation state changed concurrently')
      }
      await this.payload.create({
        collection: 'audit-logs',
        context: { skipAudit: true },
        data: {
          action: 'update',
          actor: this.actor?.id,
          documentId: String(conversation.id),
          resource: `conversation.handoff.${session.handoffStatus}`,
        },
        overrideAccess: true,
      })
      const handoffs = await this.payload.find({
        collection: 'handoffs',
        limit: 1,
        overrideAccess: true,
        sort: '-requestedAt',
        where: { conversation: { equals: conversation.id } },
      })
      const handoff = handoffs.docs[0]
      if (handoff && session.handoffStatus === 'human_active') {
        await this.payload.update({
          collection: 'handoffs',
          data: {
            acceptedAt: new Date().toISOString(),
            assignedTo: this.actor?.id,
            status: 'active',
          },
          id: handoff.id,
          overrideAccess: true,
          user: this.actor,
        })
      } else if (handoff && session.handoffStatus === 'resolved') {
        await this.payload.update({
          collection: 'handoffs',
          data: { resolvedAt: new Date().toISOString(), status: 'resolved' },
          id: handoff.id,
          overrideAccess: true,
          user: this.actor,
        })
      }
    } else if (
      session.handoffStatus === 'human_active' &&
      this.actor &&
      relationshipID(conversation.assignedTo) !== this.actor.id
    ) {
      throw new ChatServiceError('conflict', 'Conversation was taken over by another operator')
    } else if (lastMessageAt) {
      await this.pool.query(
        `UPDATE conversations SET last_message_at = $1, updated_at = NOW() WHERE id = $2`,
        [lastMessageAt, conversation.id],
      )
    }

    const messagesToCreate: ChatMessage[] = []
    for (const message of session.messages) {
      const existing = await this.payload.find({
        collection: 'messages',
        limit: 1,
        overrideAccess: true,
        where: { requestId: { equals: String(message.id) } },
      })
      if (existing.totalDocs === 0) messagesToCreate.push(message)
    }

    if (messagesToCreate.length > 0) {
      const req = await createLocalReq({ user: this.actor }, this.payload)
      await initTransaction(req)
      try {
        for (const message of messagesToCreate) {
          await this.payload.create({
            collection: 'messages',
            data: {
              author: message.author,
              citations: message.citations?.map((citation) => ({
                documentId: String(citation.documentId),
                title: citation.title,
                url: citation.url,
                version: citation.version,
              })),
              content: message.content,
              conversation: conversation.id,
              idempotencyKey: `domain-message:${String(message.id)}`,
              estimatedCostUSD: message.estimatedCostUSD ?? undefined,
              model: message.model,
              promptVersion: message.promptVersion,
              requestId: String(message.id),
              status: 'sent',
              tokenUsage: message.tokenUsage,
            },
            overrideAccess: true,
            req,
          })
        }
        await commitTransaction(req)
      } catch (error) {
        await killTransaction(req).catch(() => undefined)
        throw error
      }
    }

    const updated = await this.findConversation(session.id)
    if (!updated) throw new Error('Conversation disappeared after update')
    return this.hydrate(updated)
  }
}

export class PayloadHandoffEventSink implements ConversationEventSink {
  constructor(
    private readonly payload: Payload,
    private readonly actor?: User,
  ) {}

  async publish(event: HandoffCreatedEvent): Promise<void> {
    const existing = await this.payload.find({
      collection: 'handoffs',
      limit: 1,
      overrideAccess: true,
      where: { idempotencyKey: { equals: event.idempotencyKey } },
    })
    if (existing.totalDocs > 0) return
    const conversation = await this.payload.find({
      collection: 'conversations',
      limit: 1,
      overrideAccess: true,
      where: { publicId: { equals: String(event.conversationId) } },
    })
    if (!conversation.docs[0]) throw new ChatServiceError('not_found', 'Conversation not found')
    await this.payload.create({
      collection: 'handoffs',
      data: {
        conversation: conversation.docs[0].id,
        domainEventId: event.id,
        idempotencyKey: event.idempotencyKey,
        publicId: `handoff-${event.id}`,
        reason: event.reason,
        requestedAt: event.occurredAt,
        source: event.source,
        status: 'requested',
      },
      overrideAccess: true,
      user: this.actor,
    })
  }
}
