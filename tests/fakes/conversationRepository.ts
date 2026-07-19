import type { ChatSession } from '@/modules/conversations/contracts'
import type { ConversationRepository } from '@/modules/conversations/service'

export class InMemoryConversationRepository implements ConversationRepository {
  private commands = new Map<
    string,
    { session?: ChatSession; state: 'completed' | 'failed' | 'processing'; token: string }
  >()
  private commandSequence = 0
  private sessions = new Map<number | string, ChatSession>()

  async createSession(session: ChatSession): Promise<ChatSession> {
    this.sessions.set(session.id, structuredClone(session))
    return structuredClone(session)
  }

  async beginCommand(scope: string, idempotencyKey: string) {
    const key = `${scope}:${idempotencyKey}`
    const existing = this.commands.get(key)
    if (existing?.state === 'completed' && existing.session) {
      return { session: structuredClone(existing.session), state: 'completed' as const }
    }
    if (existing?.state === 'processing') return { state: 'processing' as const }
    const token = `command-token-${++this.commandSequence}`
    this.commands.set(key, { state: 'processing', token })
    return { state: 'claimed' as const, token }
  }

  async getSession(sessionId: number | string): Promise<ChatSession | null> {
    const session = this.sessions.get(sessionId)
    return session ? structuredClone(session) : null
  }

  async completeCommand(
    scope: string,
    idempotencyKey: string,
    token: string,
    session: ChatSession,
  ): Promise<void> {
    const key = `${scope}:${idempotencyKey}`
    const command = this.commands.get(key)
    if (!command || command.token !== token || command.state !== 'processing') {
      throw new Error('Command claim was lost')
    }
    this.commands.set(key, { session: structuredClone(session), state: 'completed', token })
  }

  async failCommand(
    scope: string,
    idempotencyKey: string,
    token: string,
    _error: unknown,
  ): Promise<void> {
    const key = `${scope}:${idempotencyKey}`
    const command = this.commands.get(key)
    if (command?.token === token) this.commands.set(key, { state: 'failed', token })
  }

  async saveSession(session: ChatSession): Promise<ChatSession> {
    this.sessions.set(session.id, structuredClone(session))
    return structuredClone(session)
  }
}
