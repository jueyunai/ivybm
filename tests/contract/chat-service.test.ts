import sessionFixture from '../fixtures/chat/session.json'
import { describe, expect, it } from 'vitest'

import { ChatServiceError, type ChatService } from '@/modules/conversations/contracts'
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
    await expect(service.startSession({
      channel: 'website', idempotencyKey: ' ', locale: 'en',
    })).rejects.toMatchObject({ code: 'invalid_request' } satisfies Partial<ChatServiceError>)

    expect(session).toMatchObject({
      allowedActions: sessionFixture.allowedActions,
      channel: sessionFixture.channel,
      handoffStatus: sessionFixture.handoffStatus,
      locale: sessionFixture.locale,
      messages: sessionFixture.messages,
    })
    expect(session.id).toBeTruthy()
    expect(session.requestId).toBeTruthy()
    expect(session.revision).toBe(1)
  })

  it('validates client commands and keeps duplicate message and handoff requests idempotent', async () => {
    const service = createService()
    const session = await service.startSession({
      channel: 'website',
      idempotencyKey: 'start-fixture-002',
      locale: 'ar',
    })
    await expect(service.sendMessage({
      idempotencyKey: 'invalid-message', sessionId: session.id, text: ' ',
    })).rejects.toMatchObject({ code: 'invalid_request' } satisfies Partial<ChatServiceError>)
    await expect(service.requestHandoff({
      idempotencyKey: 'invalid-handoff', reason: ' ', sessionId: session.id, source: 'visitor',
    })).rejects.toMatchObject({ code: 'invalid_request' } satisfies Partial<ChatServiceError>)

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
    expect(firstMessage.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ author: 'visitor', status: 'sent' }),
      expect.objectContaining({ author: 'ai', status: 'sent' }),
    ]))

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
    expect(requested).toMatchObject({ allowedActions: [], handoffStatus: 'handoff_requested' })
  })

  it('covers takeover, operator response, resolve and a safe retry rejection', async () => {
    const service = createService()
    const session = await service.startSession({
      channel: 'website', idempotencyKey: 'start-fixture-003', locale: 'en',
    })
    const messaged = await service.sendMessage({
      idempotencyKey: 'message-fixture-003', sessionId: session.id, text: 'I need a quotation.',
    })
    const visitorMessage = messaged.messages.find(({ author }) => author === 'visitor')
    await expect(service.retryMessage({
      idempotencyKey: 'retry-fixture-003', messageId: visitorMessage?.id || '', sessionId: session.id,
    })).rejects.toMatchObject({ code: 'conflict' } satisfies Partial<ChatServiceError>)

    await service.requestHandoff({
      idempotencyKey: 'handoff-fixture-003', reason: 'visitor_request', sessionId: session.id, source: 'visitor',
    })
    const active = await service.takeOver({ idempotencyKey: 'takeover-fixture-003', sessionId: session.id })
    expect(active.handoffStatus).toBe('human_active')
    const repeatedTakeover = await service.takeOver({
      idempotencyKey: 'takeover-fixture-003', sessionId: session.id,
    })
    expect(repeatedTakeover).toEqual(active)

    const operatorReply = await service.sendOperatorMessage({
      idempotencyKey: 'operator-message-fixture-003',
      sessionId: session.id,
      text: 'A representative is reviewing your request.',
    })
    expect(operatorReply.messages.at(-1)).toMatchObject({ author: 'operator', status: 'sent' })
    const resolved = await service.resolve({ idempotencyKey: 'resolve-fixture-003', sessionId: session.id })
    expect(resolved).toMatchObject({ allowedActions: [], handoffStatus: 'resolved' })
    await expect(service.getSession(session.id)).resolves.toEqual(resolved)
  })
}

describe('ChatService contract', () => {
  it('lets UI tests select a viewer-specific fake snapshot', async () => {
    const service = new FakeChatService({ viewer: 'operator' })
    const session = await service.startSession({
      channel: 'website', idempotencyKey: 'operator-view-start', locale: 'en',
    })
    await service.requestHandoff({
      idempotencyKey: 'operator-view-handoff', reason: 'visitor_request', sessionId: session.id, source: 'visitor',
    })
    await expect(service.getSession(session.id)).resolves.toMatchObject({
      allowedActions: ['take_over'], handoffStatus: 'handoff_requested',
    })
  })

  describe('FakeChatService', () => {
    exerciseChatContract(() => new FakeChatService())
  })

  describe('ConversationService', () => {
    exerciseChatContract(() => {
      let sequence = 0
      return createConversationService({
        createId: (kind) => `${kind}-${++sequence}`,
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
