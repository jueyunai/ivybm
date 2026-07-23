import { randomUUID } from 'node:crypto'
import { sql, type PostgresAdapter } from '@payloadcms/db-postgres'
import {
  commitTransaction,
  createLocalReq,
  initTransaction,
  killTransaction,
  type Payload,
  type PayloadRequest,
  type Where,
} from 'payload'

import type { Conversation, Lead, LeadSource, Message, User } from '@/payload-types'

import { visitorSessionExpiresAt } from './auth'
import type { ChatErrorCode, ChatMessage, ChatSession, StartChatSessionInput } from './contracts'
import { ChatServiceError } from './contracts'
import { allowedActionsFor, type ChatSessionViewer, type HandoffCommand } from './handoffState'
import type {
  ConversationCommandClaim,
  ConversationLeadEvaluation,
  ConversationMutation,
  ConversationRepository,
} from './service'

// Covers the default 15s embedding + 30s text timeouts with room for a slow provider response.
const DEFAULT_COMMAND_LEASE_MS = 120_000

type PayloadConversationRepositoryOptions = {
  actor?: User
  clock?: () => Date
  commandLeaseMs?: number
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

const isCompletedCommandResult = (value: unknown): value is { sessionId: number | string } => {
  if (!value || typeof value !== 'object') return false
  const sessionId = (value as { sessionId?: unknown }).sessionId
  return typeof sessionId === 'number' || typeof sessionId === 'string'
}

const isUniqueConstraintError = (error: unknown): boolean =>
  error instanceof Error && /duplicate|unique/i.test(error.message)

export const truncateLeadTranscript = (transcript: string, maxLength = 5_000): string =>
  transcript.length > maxLength ? transcript.slice(-maxLength) : transcript

const mapMessage = (message: Message, includeInternalMetadata: boolean): ChatMessage => ({
  author: message.author,
  citations: message.citations?.map((citation) => ({
    documentId: citation.documentId,
    title: citation.title,
    // Knowledge source URLs are frequently internal authoring locations. Visitors
    // receive a stable title/version citation, while only authenticated operators
    // can see the source URL needed for review and correction.
    ...(includeInternalMetadata && citation.url ? { url: citation.url } : {}),
    version: citation.version,
  })),
  content: message.content,
  createdAt: message.createdAt,
  ...(message.errorCode ? { errorCode: message.errorCode as ChatErrorCode } : {}),
  id: message.requestId,
  status: message.status,
  ...(includeInternalMetadata
    ? {
        estimatedCostUSD: message.estimatedCostUSD ?? undefined,
        model: message.model ?? undefined,
        promptVersion: message.promptVersion ?? undefined,
        tokenUsage: message.tokenUsage?.totalTokens
          ? {
              inputTokens: message.tokenUsage.inputTokens ?? 0,
              outputTokens: message.tokenUsage.outputTokens ?? undefined,
              totalTokens: message.tokenUsage.totalTokens,
            }
          : undefined,
      }
    : {}),
})

export class PayloadConversationRepository implements ConversationRepository {
  private readonly actor?: User
  private readonly clock: () => Date
  private readonly commandLeaseMs: number
  private readonly payload: Payload
  private readonly sessionTokenHash?: string

  constructor(options: PayloadConversationRepositoryOptions) {
    this.actor = options.actor
    this.clock = options.clock ?? (() => new Date())
    this.commandLeaseMs = options.commandLeaseMs ?? DEFAULT_COMMAND_LEASE_MS
    this.payload = options.payload
    this.sessionTokenHash = options.sessionTokenHash
  }

  private async transaction<T>(operation: (req: PayloadRequest) => Promise<T>): Promise<T> {
    const req = await createLocalReq({ user: this.actor }, this.payload)
    await initTransaction(req)
    try {
      const result = await operation(req)
      await commitTransaction(req)
      return result
    } catch (error) {
      await killTransaction(req).catch(() => undefined)
      throw error
    }
  }

  private leaseExpiresAt(): string {
    return new Date(this.clock().getTime() + this.commandLeaseMs).toISOString()
  }

  private async transactionDB(req: PayloadRequest) {
    const adapter = this.payload.db as unknown as PostgresAdapter
    const transactionID = await req.transactionID
    return transactionID ? adapter.sessions[transactionID]?.db ?? adapter.drizzle : adapter.drizzle
  }

  private async findConversation(
    publicId: number | string,
    req?: PayloadRequest,
  ): Promise<Conversation | null> {
    const result = await this.payload.find({
      collection: 'conversations',
      depth: 0,
      limit: 1,
      overrideAccess: true,
      ...(req ? { req } : {}),
      where: { publicId: { equals: String(publicId) } },
    })
    return result.docs[0] ?? null
  }

  private async hydrate(conversation: Conversation, req?: PayloadRequest): Promise<ChatSession> {
    const messages: Message[] = []
    let page = 1
    while (true) {
      const result = await this.payload.find({
        collection: 'messages',
        depth: 0,
        limit: 200,
        overrideAccess: true,
        page,
        ...(req ? { req } : {}),
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
    const assignedTo = relationshipID(conversation.assignedTo)
    if (this.actor?.role === 'sales' && String(assignedTo) !== String(this.actor.id)) {
      throw new ChatServiceError('forbidden', 'Sales users may view only assigned conversations')
    }
    const viewer: ChatSessionViewer = this.actor?.role === 'admin' || this.actor?.role === 'operator'
      ? 'operator'
      : this.actor?.role === 'sales'
        ? 'sales'
        : 'visitor'
    const includeInternalMetadata = viewer === 'operator'
    return {
      allowedActions: allowedActionsFor(conversation.handoffStatus, viewer),
      ...(this.actor && assignedTo ? { assignedTo: { id: assignedTo } } : {}),
      channel: conversation.channel,
      handoffStatus: conversation.handoffStatus,
      id: conversation.publicId,
      locale: conversation.locale,
      messages: messages
        .filter(({ author }) => includeInternalMetadata || author !== 'system')
        .map((message) => mapMessage(message, includeInternalMetadata)),
      revision: conversation.revision,
      requestId: conversation.requestId,
    }
  }

  private async completeCommand(
    req: PayloadRequest,
    claim: ConversationCommandClaim,
    conversationID: number,
    session: ChatSession,
  ): Promise<void> {
    const commandDoc = await this.payload.findByID({
      collection: 'conversation-commands',
      id: claim.id,
      overrideAccess: true,
      req,
    })
    if (!commandDoc || commandDoc.ownerToken !== claim.token || commandDoc.status !== 'processing') {
      throw new ChatServiceError('conflict', 'Conversation command lease was reclaimed', {
        retryable: true,
      })
    }
    await this.payload.update({
      collection: 'conversation-commands',
      context: { skipAudit: true },
      data: {
        conversation: conversationID,
        errorCode: null,
        leaseExpiresAt: this.clock().toISOString(),
        result: { sessionId: session.id },
        status: 'completed',
      },
      id: claim.id,
      overrideAccess: true,
      req,
    })
  }

  private async requireAiChatLeadSource(req: PayloadRequest): Promise<LeadSource> {
    const source = await this.payload.find({
      collection: 'lead-sources',
      depth: 0,
      limit: 1,
      overrideAccess: true,
      req,
      where: { key: { equals: 'ai-chat' } },
    })
    if (!source.docs[0]) {
      throw new ChatServiceError('internal_error', 'AI chat lead source is not configured')
    }
    return source.docs[0]
  }

  private shouldCreateLead(evaluation?: ConversationLeadEvaluation): boolean {
    return Boolean(
      evaluation?.score.level === 'a' &&
        evaluation.signals.contact.email?.trim() &&
        evaluation.signals.country?.trim(),
    )
  }

  private async persistLead(
    req: PayloadRequest,
    conversation: Conversation,
    session: ChatSession,
    evaluation: ConversationLeadEvaluation,
    source: LeadSource,
  ): Promise<Conversation> {
    const idempotencyKey = `chat-lead:${String(session.id)}`
    const existing = await this.payload.find({
      collection: 'leads',
      depth: 0,
      limit: 1,
      overrideAccess: true,
      req,
      where: { idempotencyKey: { equals: idempotencyKey } },
    })
    const visitorMessages = session.messages
      .filter(({ author }) => author === 'visitor')
      .map(({ content }) => content)
      .join('\n')
    const transcript = truncateLeadTranscript(visitorMessages)
    const email = evaluation.signals.contact.email?.trim()
    const country = evaluation.signals.country?.trim()
    if (!email || !country) {
      throw new ChatServiceError('internal_error', 'High-intent lead data is incomplete')
    }
    const data = {
      company: evaluation.signals.company,
      country,
      email,
      idempotencyKey,
      intentLevel: 'a' as const,
      interest: evaluation.signals.productInterest,
      locale: session.locale,
      message: transcript,
      name: evaluation.signals.company || email.split('@')[0],
      phone: evaluation.signals.contact.phone,
      requestId: `chat-${session.requestId}`,
      source: source.id,
      status: 'new' as const,
    }
    const lead: Lead = existing.docs[0]
      ? await this.payload.update({
          collection: 'leads',
          context: { skipAudit: true },
          data,
          id: existing.docs[0].id,
          overrideAccess: true,
          req,
        })
      : await this.payload.create({
          collection: 'leads',
          context: { skipAudit: true },
          data,
          overrideAccess: true,
          req,
        })
    return this.payload.update({
      collection: 'conversations',
      context: { skipAudit: true },
      data: { lead: lead.id },
      id: conversation.id,
      overrideAccess: true,
      req,
    })
  }

  private async writeHandoffAudit(
    req: PayloadRequest,
    conversationID: number,
    status: ChatSession['handoffStatus'],
  ): Promise<void> {
    await this.payload.create({
      collection: 'audit-logs',
      context: { skipAudit: true },
      data: {
        action: 'update',
        actor: this.actor?.id,
        documentId: String(conversationID),
        resource: `conversation.handoff.${status}`,
      },
      overrideAccess: true,
      req,
    })
  }

  private assertMutationAuthority(
    session: ChatSession,
    mutation: ConversationMutation,
    newMessages: ChatMessage[],
  ): void {
    const stateChanged = mutation.base.handoffStatus !== session.handoffStatus
    const operatorMessage = newMessages.some(({ author }) => author === 'operator')
    const takingOver = stateChanged && session.handoffStatus === 'human_active'
    const resolving = stateChanged && session.handoffStatus === 'resolved'

    if (takingOver) {
      if (!this.actor || (this.actor.role !== 'admin' && this.actor.role !== 'operator')) {
        throw new ChatServiceError('forbidden', 'An authenticated operator is required')
      }
    }
    if ((operatorMessage || resolving) && !this.actor) {
      throw new ChatServiceError('forbidden', 'An authenticated operator is required')
    }
  }

  private stateTransitionIsValid(
    current: ChatSession['handoffStatus'],
    next: ChatSession['handoffStatus'],
  ): boolean {
    return (
      current === next ||
      (current === 'ai_active' && next === 'handoff_requested') ||
      (current === 'handoff_requested' && next === 'human_active') ||
      (current === 'human_active' && next === 'resolved')
    )
  }

  async beginCommand(scope: string, idempotencyKey: string) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await this.transaction(async (req) => {
          const existing = await this.payload.find({
            collection: 'conversation-commands',
            depth: 0,
            limit: 1,
            overrideAccess: true,
            req,
            where: {
              and: [
                { scope: { equals: scope } },
                { idempotencyKey: { equals: idempotencyKey } },
              ],
            },
          })
          const command = existing.docs[0]
          const token = randomUUID()
          if (!command) {
            const created = await this.payload.create({
              collection: 'conversation-commands',
              context: { skipAudit: true },
              data: {
                idempotencyKey,
                leaseExpiresAt: this.leaseExpiresAt(),
                ownerToken: token,
                scope,
                status: 'processing',
              },
              overrideAccess: true,
              req,
            })
            return {
              claim: { id: created.id, idempotencyKey, scope, token },
              state: 'claimed' as const,
            }
          }
          if (command.status === 'completed' && isCompletedCommandResult(command.result)) {
            return { sessionId: command.result.sessionId, state: 'completed' as const }
          }
          // This compatibility branch permits any pre-hardening command row to replay
          // safely while newer writes retain only a bounded public session identifier.
          if (command.status === 'completed' && isChatSession(command.result)) {
            return { sessionId: command.result.id, state: 'completed' as const }
          }
          if (command.status === 'completed') {
            throw new ChatServiceError('internal_error', 'Conversation command result is invalid')
          }

          const now = this.clock().getTime()
          const leaseExpiresAtTime = command.leaseExpiresAt ? new Date(command.leaseExpiresAt).getTime() : 0
          const leaseExpired = !command.leaseExpiresAt || Number.isNaN(leaseExpiresAtTime) || leaseExpiresAtTime <= now
          if (command.status === 'processing' && !leaseExpired) {
            return { state: 'processing' as const }
          }
          const reclaimWhere: Where = {
            and: [
              { id: { equals: command.id } },
              {
                or: [
                  { status: { equals: 'failed' } },
                  {
                    and: [
                      { status: { equals: 'processing' } },
                      { leaseExpiresAt: { less_than_equal: now } },
                    ],
                  },
                ],
              },
            ],
          }
          const reclaimed = await this.payload.update({
            collection: 'conversation-commands',
            context: { skipAudit: true },
            data: {
              conversation: null,
              errorCode: null,
              leaseExpiresAt: this.leaseExpiresAt(),
              ownerToken: token,
              result: null,
              status: 'processing',
            },
            overrideAccess: true,
            req,
            where: reclaimWhere,
          })
          if (!reclaimed.docs[0]) return { state: 'processing' as const }
          return {
            claim: { id: command.id, idempotencyKey, scope, token },
            state: 'claimed' as const,
          }
        })
      } catch (error) {
        if (attempt === 0 && isUniqueConstraintError(error)) continue
        throw error
      }
    }
    throw new ChatServiceError('conflict', 'Conversation command could not be claimed', {
      retryable: true,
    })
  }

  async createSession(
    session: ChatSession,
    input: StartChatSessionInput,
    claim: ConversationCommandClaim,
  ): Promise<ChatSession> {
    const sessionTokenHash = this.sessionTokenHash
    if (!sessionTokenHash) throw new Error('Session token hash is required')
    return this.transaction(async (req) => {
      const visitor = await this.payload.create({
        collection: 'visitor-sessions',
        context: { skipAudit: true },
        data: {
          channel: input.channel,
          expiresAt: visitorSessionExpiresAt(this.clock()),
          idempotencyKey: input.idempotencyKey,
          lastSeenAt: this.clock().toISOString(),
          locale: input.locale,
          publicId: `visitor-${String(session.id)}`,
          sessionTokenHash,
          sourceURL: input.sourceURL,
        },
        overrideAccess: true,
        req,
      })
      const conversation = await this.payload.create({
        collection: 'conversations',
        context: { skipAudit: true },
        data: {
          channel: session.channel,
          externalThreadId: input.externalThreadId,
          handoffStatus: session.handoffStatus,
          intentLevel: 'unscored',
          locale: session.locale,
          publicId: String(session.id),
          revision: session.revision,
          requestId: session.requestId,
          visitorSession: visitor.id,
        },
        overrideAccess: true,
        req,
      })
      const snapshot = await this.hydrate(conversation, req)
      await this.completeCommand(req, claim, conversation.id, snapshot)
      return snapshot
    })
  }

  async failCommand(claim: ConversationCommandClaim, error: unknown): Promise<void> {
    const errorCode = error instanceof ChatServiceError ? error.code : 'internal_error'
    await this.transaction(async (req) => {
      await this.payload.update({
        collection: 'conversation-commands',
        context: { skipAudit: true },
        data: {
          errorCode,
          leaseExpiresAt: this.clock().toISOString(),
          status: 'failed',
        },
        overrideAccess: true,
        req,
        where: {
          and: [
            { id: { equals: claim.id } },
            { ownerToken: { equals: claim.token } },
            { status: { equals: 'processing' } },
          ],
        },
      })
    })
  }

  async recordRejectedTransition(
    sessionId: number | string,
    current: ChatSession['handoffStatus'],
    command: HandoffCommand,
  ): Promise<void> {
    await this.transaction(async (req) => {
      const conversation = await this.findConversation(sessionId, req)
      if (!conversation) return
      await this.payload.create({
        collection: 'audit-logs',
        context: { skipAudit: true },
        data: {
          action: 'update',
          actor: this.actor?.id,
          documentId: String(conversation.id),
          resource: `conversation.handoff.rejected.${current}.${command}`,
        },
        overrideAccess: true,
        req,
      })
    })
  }

  async renewCommand(claim: ConversationCommandClaim): Promise<void> {
    await this.transaction(async (req) => {
      const renewed = await this.payload.update({
        collection: 'conversation-commands',
        context: { skipAudit: true },
        data: { leaseExpiresAt: this.leaseExpiresAt() },
        overrideAccess: true,
        req,
        where: {
          and: [
            { id: { equals: claim.id } },
            { ownerToken: { equals: claim.token } },
            { status: { equals: 'processing' } },
          ],
        },
      })
      if (renewed.docs.length !== 1) {
        throw new ChatServiceError('conflict', 'Conversation command lease was reclaimed', {
          retryable: true,
        })
      }
    })
  }

  async getSession(sessionId: number | string): Promise<ChatSession | null> {
    const conversation = await this.findConversation(sessionId)
    return conversation ? this.hydrate(conversation) : null
  }

  async saveSession(
    session: ChatSession,
    mutation: ConversationMutation,
    claim: ConversationCommandClaim,
  ): Promise<ChatSession> {
    const needsLead = this.shouldCreateLead(mutation.leadEvaluation)
    return this.transaction(async (req) => {
      const conversation = await this.findConversation(session.id, req)
      if (!conversation) throw new ChatServiceError('not_found', 'Chat session not found')
      // Payload's declarative update is not enough to serialize two independent commands
      // that read the same session before either writes. Lock the row on this request's
      // existing transaction, then validate the version while the lock is held.
      const lock = await (await this.transactionDB(req)).execute(sql`
        SELECT "revision" FROM "conversations" WHERE "id" = ${conversation.id} FOR UPDATE
      `)
      const lockedRevision = Number((lock.rows[0] as { revision?: number | string } | undefined)?.revision)
      if (!Number.isInteger(lockedRevision) || lockedRevision !== mutation.base.revision) {
        throw new ChatServiceError('conflict', 'Conversation state changed concurrently', {
          retryable: true,
        })
      }
      const baseMessageIDs = new Set(mutation.base.messages.map(({ id }) => String(id)))
      const newMessages = session.messages.filter(({ id }) => !baseMessageIDs.has(String(id)))
      const stateChanged = mutation.base.handoffStatus !== session.handoffStatus
      if (!Number.isInteger(mutation.base.revision)) {
        throw new ChatServiceError('internal_error', 'Conversation revision is invalid')
      }
      if (!this.stateTransitionIsValid(mutation.base.handoffStatus, session.handoffStatus)) {
        throw new ChatServiceError('conflict', 'Illegal persisted handoff transition')
      }
      this.assertMutationAuthority(session, mutation, newMessages)
      if (mutation.handoff && (!stateChanged || session.handoffStatus !== 'handoff_requested')) {
        throw new ChatServiceError('conflict', 'Handoff event must accompany its requested transition')
      }

      const operatorWrite = newMessages.some(({ author }) => author === 'operator') ||
        (stateChanged && session.handoffStatus === 'resolved')
      const requiresAssignment = operatorWrite && this.actor?.role !== 'admin'
      const where: Where = {
        and: [
          { id: { equals: conversation.id } },
          { handoffStatus: { equals: mutation.base.handoffStatus } },
          { revision: { equals: mutation.base.revision } },
          ...(requiresAssignment && this.actor
            ? [{ assignedTo: { equals: this.actor.id } }]
            : []),
        ],
      }
      const lastMessage = newMessages.at(-1)
      const shouldUpdateConversation = stateChanged || newMessages.length > 0 || Boolean(mutation.leadEvaluation)
      let persistedConversation = conversation
      if (shouldUpdateConversation) {
        const updated = await this.payload.update({
          collection: 'conversations',
          context: { skipAudit: true },
          data: {
            ...(stateChanged ? { handoffStatus: session.handoffStatus } : {}),
            revision: mutation.base.revision + 1,
            ...(session.handoffStatus === 'human_active' && stateChanged
              ? { assignedTo: this.actor?.id }
              : {}),
            ...(lastMessage ? { lastMessageAt: lastMessage.createdAt } : {}),
            ...(mutation.leadEvaluation
              ? {
                  intentLevel: mutation.leadEvaluation.score.level,
                  intentScore: mutation.leadEvaluation.score.score,
                }
              : {}),
          },
          overrideAccess: true,
          req,
          where,
        })
        if (!updated.docs[0]) {
          throw new ChatServiceError('conflict', 'Conversation state changed concurrently', {
            retryable: true,
          })
        }
        persistedConversation = updated.docs[0]
      }

      for (const message of newMessages) {
        const metadata = mutation.messageMetadata?.[String(message.id)]
        await this.payload.create({
          collection: 'messages',
          context: { skipAudit: true },
          data: {
            author: message.author,
            citations: message.citations?.map((citation) => ({
              documentId: String(citation.documentId),
              title: citation.title,
              url: citation.url,
              version: citation.version,
            })),
            content: message.content,
            conversation: persistedConversation.id,
            estimatedCostUSD: message.estimatedCostUSD ?? undefined,
            externalMessageId: metadata?.externalMessageId,
            idempotencyKey: metadata?.persistedIdempotencyKey ?? `domain-message:${String(message.id)}`,
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

      if (mutation.handoff) {
        await this.payload.create({
          collection: 'handoffs',
          context: { skipAudit: true },
          data: {
            conversation: persistedConversation.id,
            domainEventId: mutation.handoff.id,
            idempotencyKey: mutation.handoff.idempotencyKey,
            publicId: `handoff-${mutation.handoff.id}`,
            reason: mutation.handoff.reason,
            requestedAt: mutation.handoff.occurredAt,
            requestedBy: this.actor?.id,
            source: mutation.handoff.source,
            status: 'requested',
          },
          overrideAccess: true,
          req,
        })
      }

      if (stateChanged && session.handoffStatus === 'human_active') {
        const accepted = await this.payload.update({
          collection: 'handoffs',
          context: { skipAudit: true },
          data: {
            acceptedAt: this.clock().toISOString(),
            assignedTo: this.actor?.id,
            status: 'active',
          },
          overrideAccess: true,
          req,
          where: {
            and: [
              { conversation: { equals: persistedConversation.id } },
              { status: { equals: 'requested' } },
            ],
          },
        })
        if (accepted.docs.length !== 1) {
          throw new ChatServiceError('conflict', 'No requested handoff is available to take over')
        }
      }

      if (stateChanged && session.handoffStatus === 'resolved') {
        const resolved = await this.payload.update({
          collection: 'handoffs',
          context: { skipAudit: true },
          data: { resolvedAt: this.clock().toISOString(), status: 'resolved' },
          overrideAccess: true,
          req,
          where: {
            and: [
              { conversation: { equals: persistedConversation.id } },
              { status: { equals: 'active' } },
            ],
          },
        })
        if (resolved.docs.length !== 1) {
          throw new ChatServiceError('conflict', 'No active handoff is available to resolve')
        }
      }

      if (mutation.leadEvaluation && needsLead) {
        const leadSource = await this.requireAiChatLeadSource(req)
        persistedConversation = await this.persistLead(
          req,
          persistedConversation,
          session,
          mutation.leadEvaluation,
          leadSource,
        )
      }
      if (stateChanged) {
        await this.writeHandoffAudit(req, persistedConversation.id, session.handoffStatus)
      }

      const snapshot = await this.hydrate(persistedConversation, req)
      await this.completeCommand(req, claim, persistedConversation.id, snapshot)
      return snapshot
    })
  }
}
