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

  it('ingests an external message once and reports a replay without a second AI turn', async () => {
    const { generateReply, service } = createService()
    const input = {
      channel: 'facebook' as const,
      externalMessageId: 'meta-message-1',
      externalThreadId: 'page-1:sender-1',
      idempotencyKey: 'facebook-messenger:meta-message-1',
      locale: 'en' as const,
      sessionIdempotencyKey: 'platform-session:facebook-messenger:page-1:sender-1',
      text: 'Please share available facade finishes.',
    }

    const accepted = await service.ingestExternalMessage(input)
    const duplicate = await service.ingestExternalMessage(input)

    expect(accepted).toMatchObject({ status: 'accepted' })
    expect(duplicate).toMatchObject({
      session: accepted.session,
      status: 'duplicate',
    })
    expect(accepted.session.messages.filter(({ author }) => author === 'visitor')).toHaveLength(1)
    expect(generateReply).toHaveBeenCalledTimes(1)
  })

  it('records later external messages after handoff and resolution without restarting AI automation', async () => {
    let sequence = 0
    const repository = new InMemoryConversationRepository()
    const generateReply = vi.fn(async () => ({
      handoff: { reason: 'platform_outbound_not_configured', source: 'ai_policy' as const },
    }))
    const service = createConversationService({
      createId: (kind) => `${kind}-${++sequence}`,
      repository,
      responder: { generateReply },
    })
    const base = {
      channel: 'facebook' as const,
      externalThreadId: 'page-1:sender-1',
      locale: 'en' as const,
      sessionIdempotencyKey: 'platform-session:facebook-messenger:page-1:sender-1',
    }

    const first = await service.ingestExternalMessage({
      ...base,
      externalMessageId: 'meta-message-first',
      idempotencyKey: 'facebook-messenger:meta-message-first',
      text: 'First customer message.',
    })
    expect(first.session.handoffStatus).toBe('handoff_requested')

    const followUp = await service.ingestExternalMessage({
      ...base,
      externalMessageId: 'meta-message-follow-up',
      idempotencyKey: 'facebook-messenger:meta-message-follow-up',
      text: 'Second customer message before an operator responds.',
    })
    expect(followUp).toMatchObject({
      status: 'accepted',
      session: { handoffStatus: 'handoff_requested' },
    })
    expect(followUp.session.messages.filter(({ author }) => author === 'visitor')).toHaveLength(2)

    await service.takeOver({ idempotencyKey: 'meta-take-over', sessionId: first.session.id })
    await service.resolve({ idempotencyKey: 'meta-resolve', sessionId: first.session.id })
    const afterResolution = await service.ingestExternalMessage({
      ...base,
      externalMessageId: 'meta-message-after-resolution',
      idempotencyKey: 'facebook-messenger:meta-message-after-resolution',
      text: 'A later customer follow-up must still be retained.',
    })
    expect(afterResolution).toMatchObject({
      status: 'accepted',
      session: { handoffStatus: 'resolved' },
    })
    expect(afterResolution.session.messages.filter(({ author }) => author === 'visitor')).toHaveLength(3)
    expect(generateReply).toHaveBeenCalledTimes(1)
  })

  it('rejects malformed external thread identity before creating any session', async () => {
    const { repository, service } = createService()

    await expect(
      service.ingestExternalMessage({
        channel: 'facebook',
        externalMessageId: 'meta-message-invalid',
        externalThreadId: ' ',
        idempotencyKey: 'facebook-messenger:meta-message-invalid',
        locale: 'en',
        sessionIdempotencyKey: 'platform-session:facebook-messenger:page-1:sender-1',
        text: 'Please share available facade finishes.',
      }),
    ).rejects.toMatchObject({ code: 'invalid_request' } satisfies Partial<ChatServiceError>)
    expect(repository.sessionCount).toBe(0)
  })

  it('does not allow public website or historical WhatsApp channels through the connector command', async () => {
    const { repository, service } = createService()

    await expect(
      service.ingestExternalMessage({
        channel: 'website' as never,
        externalMessageId: 'external-message-website',
        externalThreadId: 'page-1:sender-1',
        idempotencyKey: 'facebook-messenger:external-message-website',
        locale: 'en',
        sessionIdempotencyKey: 'platform-session:facebook-messenger:page-1:sender-1',
        text: 'Please share available facade finishes.',
      }),
    ).rejects.toMatchObject({ code: 'invalid_request' } satisfies Partial<ChatServiceError>)
    expect(repository.sessionCount).toBe(0)
  })
})
