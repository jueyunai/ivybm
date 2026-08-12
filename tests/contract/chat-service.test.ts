import sessionFixture from '../fixtures/chat/session.json'
import { describe, expect, it } from 'vitest'

import {
  ChatServiceError,
  type ChatService,
  type PlatformConversationService,
} from '@/modules/conversations/contracts'
import { createConversationService } from '@/modules/conversations/service'

import { FakeChatService } from '../fakes/chatService'
import { InMemoryConversationRepository } from '../fakes/conversationRepository'

const exerciseChatContract = (createService: () => ChatService & PlatformConversationService): void => {
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
    await expect(service.startSession({
      channel: 'whatsapp' as never, idempotencyKey: 'historical-whatsapp', locale: 'en',
    })).rejects.toMatchObject({ code: 'invalid_request' } satisfies Partial<ChatServiceError>)
    await expect(service.startSession({
      channel: 'tiktok', idempotencyKey: 'blocked-tiktok-start', locale: 'en',
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
      idempotencyKey: 'message-fixture-003', sessionId: session.id, text: 'I need facade panel specifications.',
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

  it('preserves external delivery idempotency without exposing connector implementation details', async () => {
    const service = createService()
    const input = {
      channel: 'instagram' as const,
      externalAccountId: 'instagram-account-fixture',
      externalMessageId: 'instagram-message-fixture-001',
      externalSenderId: 'instagram-sender-fixture',
      externalThreadId: 'instagram-account-fixture:instagram-sender-fixture',
      locale: 'en' as const,
      text: 'Please send your panel specification.',
    }

    const accepted = await service.ingestExternalMessage(input)
    const duplicate = await service.ingestExternalMessage(input)

    expect(accepted.status).toBe('accepted')
    expect(duplicate).toEqual({ session: accepted.session, status: 'duplicate' })
  })

  it('rejects website, historical-only, and blocked conditional channels from the authenticated connector command', async () => {
    const service = createService()

    for (const channel of ['website', 'whatsapp', 'tiktok'] as const) {
      await expect(
        service.ingestExternalMessage({
          channel: channel as never,
          externalAccountId: `unsupported-${channel}-account`,
          externalMessageId: `unsupported-${channel}-message`,
          externalSenderId: `unsupported-${channel}-sender`,
          externalThreadId: `unsupported-${channel}-thread`,
          locale: 'en',
          text: 'This must not be treated as a platform message.',
        }),
      ).rejects.toMatchObject({ code: 'invalid_request' } satisfies Partial<ChatServiceError>)
    }
  })

  it('rejects malformed connector identity fields without throwing implementation errors', async () => {
    const service = createService()

    await expect(
      service.ingestExternalMessage({
        channel: 'facebook',
        externalAccountId: 42 as never,
        externalMessageId: 'malformed-identity-message',
        externalSenderId: 'sender-fixture',
        externalThreadId: 'page-fixture:sender-fixture',
        locale: 'en',
        text: 'This typed escape must fail as a stable request error.',
      }),
    ).rejects.toMatchObject({ code: 'invalid_request' } satisfies Partial<ChatServiceError>)
  })

  it('retains a later external inbound message after automated replies have stopped', async () => {
    const service = createService()
    const first = await service.ingestExternalMessage({
      channel: 'facebook',
      externalAccountId: 'page-fixture',
      externalMessageId: 'facebook-message-before-handoff',
      externalSenderId: 'sender-fixture',
      externalThreadId: 'page-fixture:sender-fixture',
      locale: 'en',
      text: 'Please create the durable handoff first.',
    })
    const handoff = first.session.handoffStatus === 'ai_active'
      ? await service.requestHandoff({
          idempotencyKey: 'external-handoff-fixture',
          reason: 'platform_outbound_not_configured',
          sessionId: first.session.id,
          source: 'ai_policy',
        })
      : first.session
    expect(handoff.handoffStatus).toBe('handoff_requested')

    const delivery = await service.ingestExternalMessage({
      channel: 'facebook',
      externalAccountId: 'page-fixture',
      externalMessageId: 'facebook-message-after-handoff',
      externalSenderId: 'sender-fixture',
      externalThreadId: 'page-fixture:sender-fixture',
      locale: 'en',
      text: 'Please keep this follow-up visible to the operator.',
    })

    expect(delivery).toMatchObject({
      status: 'accepted',
      session: { handoffStatus: 'handoff_requested' },
    })
    expect(delivery.session.messages.filter(({ author }) => author === 'visitor')).toHaveLength(2)
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

  it('models platform inbound as a durable handoff until outbound delivery is configured', async () => {
    const service = new FakeChatService()
    const delivery = await service.ingestExternalMessage({
      channel: 'facebook',
      externalAccountId: 'page-fixture',
      externalMessageId: 'facebook-inbound-no-outbound',
      externalSenderId: 'sender-fixture',
      externalThreadId: 'page-fixture:sender-fixture',
      locale: 'en',
      text: 'Please send a quotation.',
    })

    expect(delivery.session).toMatchObject({ handoffStatus: 'handoff_requested' })
    expect(delivery.session.messages).toEqual([
      expect.objectContaining({ author: 'visitor', status: 'sent' }),
    ])
    expect(delivery.session.messages.some(({ author }) => author === 'ai')).toBe(false)
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
