import { describe, expect, it, vi } from 'vitest'

import { ChatServiceError } from '@/modules/conversations/contracts'
import { createConversationService } from '@/modules/conversations/service'

import { InMemoryConversationRepository } from '../../fakes/conversationRepository'

const createService = () => {
  let sequence = 0
  const repository = new InMemoryConversationRepository()
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
    repository,
    responder: { generateReply },
  })
  return { generateReply, repository, service }
}

describe('ConversationService', () => {
  it('persists one authoritative handoff state for duplicate requests and blocks subsequent AI replies', async () => {
    const { generateReply, repository, service } = createService()
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
    expect(repeated).toMatchObject({ handoffStatus: 'handoff_requested' })
    expect(repository.handoffEvents).toEqual([
      expect.objectContaining({
        conversationId: session.id,
        idempotencyKey: 'handoff-1',
        type: 'handoff.created',
      }),
    ])
    await expect(
      service.sendMessage({
        idempotencyKey: 'message-after-handoff',
        sessionId: session.id,
        text: 'Will the AI still answer?',
      }),
    ).rejects.toMatchObject({ code: 'conflict' } satisfies Partial<ChatServiceError>)
    expect(generateReply).not.toHaveBeenCalled()
  })

  it('safely routes an unavailable AI response to human handoff instead of surfacing a provider failure', async () => {
    let sequence = 0
    const service = createConversationService({
      createId: (kind) => `${kind}-${++sequence}`,
      repository: new InMemoryConversationRepository(),
      responder: {
        generateReply: async () => {
          throw new Error('provider timeout')
        },
      },
    })
    const session = await service.startSession({
      channel: 'website',
      idempotencyKey: 'start-ai-failure',
      locale: 'en',
    })

    await expect(service.sendMessage({
      idempotencyKey: 'message-ai-failure',
      sessionId: session.id,
      text: 'What finishes are available?',
    })).resolves.toMatchObject({
      handoffStatus: 'handoff_requested',
      messages: [expect.objectContaining({ author: 'visitor' })],
    })
  })

  it('records an audit intent for illegal handoff transitions', async () => {
    const repository = new InMemoryConversationRepository()
    const service = createConversationService({
      repository,
      responder: {
        generateReply: async () => ({
          content: 'fixture', estimatedCostUSD: 0, model: 'fixture', promptVersion: 1,
          tokenUsage: { inputTokens: 1, totalTokens: 1 },
        }),
      },
    })
    const session = await service.startSession({
      channel: 'website', idempotencyKey: 'illegal-start', locale: 'en',
    })

    await expect(service.takeOver({
      idempotencyKey: 'illegal-takeover', sessionId: session.id,
    })).rejects.toMatchObject({ code: 'conflict' })
    expect(repository.rejectedTransitions).toEqual([
      { command: 'take_over', current: 'ai_active', sessionId: session.id },
    ])
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
