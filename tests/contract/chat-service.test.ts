import sessionFixture from '../fixtures/chat/session.json'
import { describe, expect, it } from 'vitest'

import type { ChatService } from '@/modules/conversations/contracts'
import { createConversationService } from '@/modules/conversations/service'

import { FakeChatService } from '../fakes/chatService'
import { InMemoryConversationRepository } from '../fakes/conversationRepository'

const exerciseChatContract = (createService: () => ChatService): void => {
  it('starts a session and returns a stable client-facing snapshot', async () => {
    const service = createService()
    const session = await service.startSession({
      channel: 'website',
      idempotencyKey: 'start-fixture-001',
      locale: 'en',
    })

    expect(session).toMatchObject({
      allowedActions: sessionFixture.allowedActions,
      channel: sessionFixture.channel,
      handoffStatus: sessionFixture.handoffStatus,
      locale: sessionFixture.locale,
      messages: sessionFixture.messages,
    })
    expect(session.id).toBeTruthy()
    expect(session.requestId).toBeTruthy()
  })

  it('keeps duplicate commands idempotent and exposes authoritative handoff state', async () => {
    const service = createService()
    const session = await service.startSession({
      channel: 'website',
      idempotencyKey: 'start-fixture-002',
      locale: 'ar',
    })
    const firstMessage = await service.sendMessage({
      idempotencyKey: 'message-fixture-001',
      sessionId: session.id,
      text: 'أحتاج ألواح ألمنيوم لمشروع واجهة.',
    })
    const repeatedMessage = await service.sendMessage({
      idempotencyKey: 'message-fixture-001',
      sessionId: session.id,
      text: 'أحتاج ألواح ألمنيوم لمشروع واجهة.',
    })
    expect(repeatedMessage).toEqual(firstMessage)

    const requested = await service.requestHandoff({
      idempotencyKey: 'handoff-fixture-001',
      reason: 'visitor_request',
      sessionId: session.id,
      source: 'visitor',
    })
    const repeated = await service.requestHandoff({
      idempotencyKey: 'handoff-fixture-001',
      reason: 'visitor_request',
      sessionId: session.id,
      source: 'visitor',
    })

    expect(repeated).toEqual(requested)
    expect(requested).toMatchObject({
      allowedActions: ['take_over'],
      handoffStatus: 'handoff_requested',
    })
  })
}

describe('ChatService contract', () => {
  describe('FakeChatService', () => {
    exerciseChatContract(() => new FakeChatService())
  })

  describe('ConversationService', () => {
    exerciseChatContract(() => {
      let sequence = 0
      return createConversationService({
        createId: (kind) => `${kind}-${++sequence}`,
        eventSink: { publish: async () => undefined },
        repository: new InMemoryConversationRepository(),
        responder: {
          generateReply: async () => ({
            content: 'Reviewed fixture answer.',
            estimatedCostUSD: 0,
            model: 'fake-text-model',
            promptVersion: 1,
            tokenUsage: { inputTokens: 5, outputTokens: 3, totalTokens: 8 },
          }),
        },
      })
    })
  })
})
