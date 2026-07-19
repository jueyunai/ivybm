import {
  ChatServiceError,
  type ChatMessage,
  type ChatService,
  type ChatSession,
  type RequestHandoffInput,
  type RetryChatMessageInput,
  type SendChatMessageInput,
  type SessionCommandInput,
  type StartChatSessionInput,
} from '@/modules/conversations/contracts'
import { allowedActionsFor, transitionHandoff } from '@/modules/conversations/handoffState'

const createdAt = '2026-07-19T00:00:00.000Z'

export class FakeChatService implements ChatService {
  private commandResults = new Map<string, ChatSession>()
  private messageSequence = 0
  private sessionSequence = 0
  private sessions = new Map<number | string, ChatSession>()

  private idempotent(command: string, key: string, operation: () => ChatSession): ChatSession {
    const commandKey = `${command}:${key}`
    const existing = this.commandResults.get(commandKey)
    if (existing) return structuredClone(existing)
    const result = operation()
    this.commandResults.set(commandKey, structuredClone(result))
    return structuredClone(result)
  }

  private requireSession(sessionId: number | string): ChatSession {
    const session = this.sessions.get(sessionId)
    if (!session) throw new ChatServiceError('not_found', 'Chat session not found')
    return session
  }

  async getSession(sessionId: number | string): Promise<ChatSession> {
    return structuredClone(this.requireSession(sessionId))
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
      this.messageSequence += 1
      const message: ChatMessage = {
        author: 'visitor',
        content: input.text,
        createdAt,
        id: `fake-message-${this.messageSequence}`,
      }
      session.messages.push(message)
      return session
    })
  }

  async sendOperatorMessage(input: SendChatMessageInput): Promise<ChatSession> {
    return this.idempotent(`operator-message:${String(input.sessionId)}`, input.idempotencyKey, () => {
      const session = this.requireSession(input.sessionId)
      if (session.handoffStatus !== 'human_active') {
        throw new ChatServiceError('conflict', 'Operator messages require an active handoff')
      }
      this.messageSequence += 1
      session.messages.push({
        author: 'operator',
        content: input.text,
        createdAt,
        id: `fake-message-${this.messageSequence}`,
      })
      return session
    })
  }

  async retryMessage(input: RetryChatMessageInput): Promise<ChatSession> {
    return this.idempotent(`retry:${String(input.sessionId)}`, input.idempotencyKey, () =>
      this.requireSession(input.sessionId),
    )
  }

  async requestHandoff(input: RequestHandoffInput): Promise<ChatSession> {
    return this.idempotent(`handoff:${String(input.sessionId)}`, input.idempotencyKey, () => {
      const session = this.requireSession(input.sessionId)
      session.handoffStatus = transitionHandoff(session.handoffStatus, 'request')
      session.allowedActions = allowedActionsFor(session.handoffStatus)
      return session
    })
  }

  async takeOver(input: SessionCommandInput): Promise<ChatSession> {
    return this.idempotent(`take-over:${String(input.sessionId)}`, input.idempotencyKey, () => {
      const session = this.requireSession(input.sessionId)
      session.handoffStatus = transitionHandoff(session.handoffStatus, 'take_over')
      session.allowedActions = allowedActionsFor(session.handoffStatus)
      return session
    })
  }

  async resolve(input: SessionCommandInput): Promise<ChatSession> {
    return this.idempotent(`resolve:${String(input.sessionId)}`, input.idempotencyKey, () => {
      const session = this.requireSession(input.sessionId)
      session.handoffStatus = transitionHandoff(session.handoffStatus, 'resolve')
      session.allowedActions = allowedActionsFor(session.handoffStatus)
      return session
    })
  }
}
