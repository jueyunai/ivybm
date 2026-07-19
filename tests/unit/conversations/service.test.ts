import { describe, expect, it, vi } from 'vitest'

import { ChatServiceError } from '@/modules/conversations/contracts'
import { createConversationService } from '@/modules/conversations/service'

import { InMemoryConversationRepository } from '../../fakes/conversationRepository'

const createService = () => {
  let sequence = 0
  const publish = vi.fn(async () => undefined)
  const generateReply = vi.fn(async () => ({
    content: 'Reviewed answer with a citation.',
    estimatedCostUSD: 0,
    model: 'fake-text-model',
    promptVersion: 1,
    tokenUsage: { inputTokens: 5, outputTokens: 3, totalTokens: 8 },
  }))
  const service = createConversationService({
    clock: () => new Date('2026-07-19T00:00:00.000Z'),
    createId: (kind) => `${kind}-${++sequence}`,
    eventSink: { publish },
    repository: new InMemoryConversationRepository(),
    responder: { generateReply },
  })
  return { generateReply, publish, service }
}

describe('ConversationService', () => {
  it('emits one handoff event for duplicate requests and blocks subsequent AI replies', async () => {
    const { generateReply, publish, service } = createService()
    const session = await service.startSession({
      channel: 'website',
      idempotencyKey: 'start-1',
      locale: 'en',
    })
    const first = await service.requestHandoff({
      idempotencyKey: 'handoff-1',
      reason: 'visitor_request',
      sessionId: session.id,
      source: 'visitor',
    })
    const repeated = await service.requestHandoff({
      idempotencyKey: 'handoff-1',
      reason: 'visitor_request',
      sessionId: session.id,
      source: 'visitor',
    })

    expect(repeated).toEqual(first)
    expect(publish).toHaveBeenCalledTimes(1)
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'handoff.created', source: 'visitor' }),
    )
    await expect(
      service.sendMessage({
        idempotencyKey: 'message-after-handoff',
        sessionId: session.id,
        text: 'Will the AI still answer?',
      }),
    ).rejects.toMatchObject({ code: 'conflict' } satisfies Partial<ChatServiceError>)
    expect(generateReply).not.toHaveBeenCalled()
  })

  it('allows visitor messages after takeover without invoking the AI and then resolves', async () => {
    const { generateReply, service } = createService()
    const session = await service.startSession({
      channel: 'website',
      idempotencyKey: 'start-2',
      locale: 'en',
    })
    await service.requestHandoff({
      idempotencyKey: 'handoff-2',
      reason: 'high_intent',
      sessionId: session.id,
      source: 'ai_policy',
    })
    const active = await service.takeOver({ idempotencyKey: 'takeover-2', sessionId: session.id })
    expect(active.handoffStatus).toBe('human_active')

    const withHumanMessage = await service.sendMessage({
      idempotencyKey: 'visitor-message-2',
      sessionId: session.id,
      text: 'A sales representative will continue this conversation.',
    })
    expect(withHumanMessage.messages.at(-1)?.author).toBe('visitor')
    expect(generateReply).not.toHaveBeenCalled()

    const resolved = await service.resolve({ idempotencyKey: 'resolve-2', sessionId: session.id })
    expect(resolved).toMatchObject({ allowedActions: [], handoffStatus: 'resolved' })
  })
})
