import {
  ChatServiceError,
  type ExternalMessageDelivery,
  type ChatMessage,
  type ChatService,
  type ChatSession,
  type IngestExternalMessageInput,
  type PlatformConversationService,
  type RequestHandoffInput,
  type RetryChatMessageInput,
  type SendChatMessageInput,
  type SessionCommandInput,
  type StartChatSessionInput,
} from '@/modules/conversations/contracts'
import {
  allowedActionsFor,
  type ChatSessionViewer,
  transitionHandoff,
} from '@/modules/conversations/handoffState'

const createdAt = '2026-07-19T00:00:00.000Z'

export class FakeChatService implements ChatService, PlatformConversationService {
  private commandResults = new Map<string, ChatSession>()
  private messageSequence = 0
  private sessionSequence = 0
  private sessions = new Map<number | string, ChatSession>()
  private readonly viewer: ChatSessionViewer

  constructor({ viewer = 'visitor' }: { viewer?: ChatSessionViewer } = {}) {
    this.viewer = viewer
  }

  private snapshot(session: ChatSession): ChatSession {
    const snapshot = structuredClone(session)
    snapshot.allowedActions = allowedActionsFor(snapshot.handoffStatus, this.viewer)
    return snapshot
  }

  private idempotent(command: string, key: string, operation: () => ChatSession): ChatSession {
    if (!key.trim() || key.length > 200) {
      throw new ChatServiceError('invalid_request', 'A valid idempotency key is required')
    }
    const commandKey = `${command}:${key}`
    const existing = this.commandResults.get(commandKey)
    if (existing) return this.snapshot(this.requireSession(existing.id))
    const result = operation()
    this.commandResults.set(commandKey, structuredClone(result))
    return this.snapshot(result)
  }

  private requireSession(sessionId: number | string): ChatSession {
    const session = this.sessions.get(sessionId)
    if (!session) throw new ChatServiceError('not_found', 'Chat session not found')
    return session
  }

  private assertText(value: string): string {
    const text = value.trim()
    if (!text || text.length > 5_000) {
      throw new ChatServiceError('invalid_request', 'Message must contain 1 to 5000 characters')
    }
    return text
  }

  private commit(session: ChatSession): ChatSession {
    session.revision += 1
    this.sessions.set(session.id, session)
    return session
  }

  private appendAiReply(session: ChatSession): void {
    this.messageSequence += 1
    session.messages.push({
      author: 'ai',
      citations: [{
        documentId: 'fake-knowledge-document',
        title: 'Fixture knowledge source',
        version: '1.0',
      }],
      content: 'Fixture AI reply.',
      createdAt,
      id: `fake-message-${this.messageSequence}`,
      status: 'sent',
    })
  }

  async getSession(sessionId: number | string): Promise<ChatSession> {
    return this.snapshot(this.requireSession(sessionId))
  }

  async ingestExternalMessage(input: IngestExternalMessageInput): Promise<ExternalMessageDelivery> {
    if (!input.externalThreadId.trim() || input.externalThreadId.length > 500) {
      throw new ChatServiceError('invalid_request', 'externalThreadId is required')
    }
    if (!input.externalMessageId.trim() || input.externalMessageId.length > 200) {
      throw new ChatServiceError('invalid_request', 'externalMessageId is required')
    }
    const session = await this.startSession({
      channel: input.channel,
      externalThreadId: input.externalThreadId,
      idempotencyKey: input.sessionIdempotencyKey,
      locale: input.locale,
    })
    const commandKey = `message:${String(session.id)}:${input.idempotencyKey}`
    const duplicate = this.commandResults.has(commandKey)
    const updated = session.handoffStatus === 'ai_active'
      ? await this.sendMessage({
          idempotencyKey: input.idempotencyKey,
          sessionId: session.id,
          text: input.text,
        })
      : this.idempotent(`message:${String(session.id)}`, input.idempotencyKey, () => {
          const persisted = this.requireSession(session.id)
          const text = this.assertText(input.text)
          this.messageSequence += 1
          // External events remain customer records after AI automation has stopped.
          // This mirrors the authoritative service without creating a fake AI reply.
          persisted.messages.push({
            author: 'visitor',
            content: text,
            createdAt,
            id: `fake-message-${this.messageSequence}`,
            status: 'sent',
          })
          return this.commit(persisted)
        })
    return { session: updated, status: duplicate ? 'duplicate' : 'accepted' }
  }

  async startSession(input: StartChatSessionInput): Promise<ChatSession> {
    return this.idempotent('start', input.idempotencyKey, () => {
      this.sessionSequence += 1
      const id = `fake-session-${this.sessionSequence}`
      const session: ChatSession = {
        allowedActions: allowedActionsFor('ai_active'),
        channel: input.channel,
        handoffStatus: 'ai_active',
        id,
        locale: input.locale,
        messages: [],
        revision: 1,
        requestId: `fake-request-${this.sessionSequence}`,
      }
      this.sessions.set(id, session)
      return session
    })
  }

  async sendMessage(input: SendChatMessageInput): Promise<ChatSession> {
    return this.idempotent(`message:${String(input.sessionId)}`, input.idempotencyKey, () => {
      const session = this.requireSession(input.sessionId)
      if (!session.allowedActions.includes('send_message')) {
        throw new ChatServiceError('conflict', 'Messages are not allowed in the current state')
      }
      const text = this.assertText(input.text)
      this.messageSequence += 1
      const message: ChatMessage = {
        author: 'visitor',
        content: text,
        createdAt,
        id: `fake-message-${this.messageSequence}`,
        status: 'sent',
      }
      session.messages.push(message)
      if (session.handoffStatus === 'ai_active') this.appendAiReply(session)
      return this.commit(session)
    })
  }

  async sendOperatorMessage(input: SendChatMessageInput): Promise<ChatSession> {
    return this.idempotent(`operator-message:${String(input.sessionId)}`, input.idempotencyKey, () => {
      const session = this.requireSession(input.sessionId)
      if (session.handoffStatus !== 'human_active') {
        throw new ChatServiceError('conflict', 'Operator messages require an active handoff')
      }
      const text = this.assertText(input.text)
      this.messageSequence += 1
      session.messages.push({
        author: 'operator',
        content: text,
        createdAt,
        id: `fake-message-${this.messageSequence}`,
        status: 'sent',
      })
      return this.commit(session)
    })
  }

  async retryMessage(input: RetryChatMessageInput): Promise<ChatSession> {
    return this.idempotent(`retry:${String(input.sessionId)}`, input.idempotencyKey, () => {
      const session = this.requireSession(input.sessionId)
      const message = session.messages.find(({ id }) => String(id) === String(input.messageId))
      if (!message || message.author !== 'visitor') {
        throw new ChatServiceError('not_found', 'Retryable visitor message not found')
      }
      if (message.status !== 'failed') {
        throw new ChatServiceError('conflict', 'Only failed visitor messages can be retried')
      }
      if (session.handoffStatus !== 'ai_active') {
        throw new ChatServiceError('handoff_required', 'AI replies are disabled for this conversation')
      }
      this.appendAiReply(session)
      return this.commit(session)
    })
  }

  async requestHandoff(input: RequestHandoffInput): Promise<ChatSession> {
    return this.idempotent(`handoff:${String(input.sessionId)}`, input.idempotencyKey, () => {
      const session = this.requireSession(input.sessionId)
      if (!input.reason.trim()) {
        throw new ChatServiceError('invalid_request', 'Handoff reason is required')
      }
      session.handoffStatus = transitionHandoff(session.handoffStatus, 'request')
      session.allowedActions = allowedActionsFor(session.handoffStatus)
      return this.commit(session)
    })
  }

  async takeOver(input: SessionCommandInput): Promise<ChatSession> {
    return this.idempotent(`take-over:${String(input.sessionId)}`, input.idempotencyKey, () => {
      const session = this.requireSession(input.sessionId)
      session.handoffStatus = transitionHandoff(session.handoffStatus, 'take_over')
      session.allowedActions = allowedActionsFor(session.handoffStatus)
      return this.commit(session)
    })
  }

  async resolve(input: SessionCommandInput): Promise<ChatSession> {
    return this.idempotent(`resolve:${String(input.sessionId)}`, input.idempotencyKey, () => {
      const session = this.requireSession(input.sessionId)
      session.handoffStatus = transitionHandoff(session.handoffStatus, 'resolve')
      session.allowedActions = allowedActionsFor(session.handoffStatus)
      return this.commit(session)
    })
  }
}
