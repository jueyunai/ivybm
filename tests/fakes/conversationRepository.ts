import {
  ChatServiceError,
  type ChatSession,
  type HandoffCreatedEvent,
  type StartChatSessionInput,
} from '@/modules/conversations/contracts'
import type {
  ConversationCommandClaim,
  ConversationMutation,
  ConversationRepository,
} from '@/modules/conversations/service'
import type { HandoffCommand } from '@/modules/conversations/handoffState'

type InMemoryCommand = {
  claim: ConversationCommandClaim
  sessionId?: number | string
  state: 'completed' | 'failed' | 'processing'
}

export class InMemoryConversationRepository implements ConversationRepository {
  private commands = new Map<string, InMemoryCommand>()
  private commandSequence = 0
  readonly rejectedTransitions: Array<{ command: HandoffCommand; current: ChatSession['handoffStatus']; sessionId: number | string }> = []
  readonly handoffEvents: HandoffCreatedEvent[] = []
  private sessions = new Map<number | string, ChatSession>()

  get sessionCount(): number {
    return this.sessions.size
  }

  appendFailedVisitorMessage(sessionId: number | string, id: string, content: string): void {
    const session = this.sessions.get(sessionId)
    if (!session) throw new Error('Session not found')
    session.messages.push({ author: 'visitor', content, createdAt: new Date(0).toISOString(), id, status: 'failed' })
  }

  private commandKey(scope: string, idempotencyKey: string): string {
    return `${scope}:${idempotencyKey}`
  }

  private assertClaim(claim: ConversationCommandClaim): InMemoryCommand {
    const command = this.commands.get(this.commandKey(claim.scope, claim.idempotencyKey))
    if (!command || command.state !== 'processing' || command.claim.token !== claim.token) {
      throw new ChatServiceError('conflict', 'Conversation command lease was reclaimed', {
        retryable: true,
      })
    }
    return command
  }

  async beginCommand(scope: string, idempotencyKey: string) {
    const key = this.commandKey(scope, idempotencyKey)
    const existing = this.commands.get(key)
    if (existing?.state === 'completed' && existing.sessionId !== undefined) {
      return { sessionId: existing.sessionId, state: 'completed' as const }
    }
    if (existing?.state === 'processing') return { state: 'processing' as const }
    const sequence = ++this.commandSequence
    const claim: ConversationCommandClaim = {
      id: `command-${sequence}`,
      idempotencyKey,
      scope,
      token: `command-token-${sequence}`,
    }
    this.commands.set(key, { claim, state: 'processing' })
    return { claim, state: 'claimed' as const }
  }

  async createSession(
    session: ChatSession,
    _input: StartChatSessionInput,
    claim: ConversationCommandClaim,
  ): Promise<ChatSession> {
    const command = this.assertClaim(claim)
    this.sessions.set(session.id, structuredClone(session))
    command.sessionId = session.id
    command.state = 'completed'
    return structuredClone(session)
  }

  async failCommand(claim: ConversationCommandClaim, _error: unknown): Promise<void> {
    const command = this.commands.get(this.commandKey(claim.scope, claim.idempotencyKey))
    if (command?.state === 'processing' && command.claim.token === claim.token) {
      command.state = 'failed'
    }
  }

  async getSession(sessionId: number | string): Promise<ChatSession | null> {
    const session = this.sessions.get(sessionId)
    return session ? structuredClone(session) : null
  }

  async recordRejectedTransition(
    sessionId: number | string,
    current: ChatSession['handoffStatus'],
    command: HandoffCommand,
  ): Promise<void> {
    this.rejectedTransitions.push({ command, current, sessionId })
  }

  async renewCommand(claim: ConversationCommandClaim): Promise<void> {
    this.assertClaim(claim)
  }

  async saveSession(
    session: ChatSession,
    mutation: ConversationMutation,
    claim: ConversationCommandClaim,
  ): Promise<ChatSession> {
    const command = this.assertClaim(claim)
    const current = this.sessions.get(session.id)
    if (
      !current ||
      current.handoffStatus !== mutation.base.handoffStatus ||
      current.revision !== mutation.base.revision
    ) {
      throw new ChatServiceError('conflict', 'Conversation state changed concurrently', {
        retryable: true,
      })
    }
    const persisted = structuredClone(session)
    persisted.revision = current.revision + 1
    this.sessions.set(persisted.id, persisted)
    if (mutation.handoff) this.handoffEvents.push(structuredClone(mutation.handoff))
    command.sessionId = persisted.id
    command.state = 'completed'
    return structuredClone(persisted)
  }
}
