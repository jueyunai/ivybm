import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Payload } from 'payload'

import { AiGatewayError } from '@/modules/ai/gateway'
import type { ChatSession } from '@/modules/conversations/contracts'
import { createPayloadConversationResponder } from '@/modules/conversations/payloadResponder'

const mocks = vi.hoisted(() => ({
  resolveAiGateway: vi.fn(),
  retrieveKnowledgeForQuery: vi.fn(),
}))

vi.mock('@/modules/ai/registry', () => ({
  AI_USAGE_KEYS: {
    chatReply: 'chat.reply',
    knowledgeEmbedding: 'knowledge.embedding',
  },
  resolveAiGateway: mocks.resolveAiGateway,
}))

vi.mock('@/modules/knowledge/retrieve', () => ({
  retrieveKnowledgeForQuery: mocks.retrieveKnowledgeForQuery,
}))

const session: ChatSession = {
  allowedActions: ['send_message', 'request_handoff'],
  channel: 'website' as const,
  handoffStatus: 'ai_active' as const,
  id: 'session-safe-log',
  locale: 'en' as const,
  messages: [],
  requestId: 'request-safe-log',
  revision: 1,
}

const gateway = () => ({
  embed: vi.fn().mockResolvedValue({
    cost: { estimated: 0 },
    embeddingSpace: 'fixture-space',
    embeddings: [[0.1, 0.2]],
    model: 'fixture-embedding',
    provider: 'fixture-provider',
    usage: { inputTokens: 1, totalTokens: 1 },
  }),
  generateText: vi.fn().mockResolvedValue({
    cost: { estimated: 0 },
    model: 'fixture-text',
    provider: 'fixture-provider',
    text: 'Reviewed fixture answer.',
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
  }),
})

const payload = () => {
  const logger = { error: vi.fn() }
  return {
    logger,
    payload: {
      db: { pool: {} },
      find: vi.fn().mockResolvedValue({
        docs: [{ template: 'Answer from reviewed knowledge.', version: 1 }],
      }),
      logger,
    } as unknown as Payload,
  }
}

describe('Payload conversation responder resilience', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.retrieveKnowledgeForQuery.mockImplementation(async ({ gateway: resolvedGateway }) => {
      await resolvedGateway.embed({ input: ['fixture'] })
      return [
        {
          citation: { documentId: 1, title: 'Reviewed manual', version: '1' },
          content: 'Reviewed knowledge.',
        },
      ]
    })
  })

  it('does not cache a rejected gateway resolution and succeeds on the next command', async () => {
    const { logger, payload: instance } = payload()
    const recoveredGateway = gateway()
    mocks.resolveAiGateway
      .mockRejectedValueOnce(new Error('configuration database offline'))
      .mockResolvedValueOnce(recoveredGateway)
    const responder = createPayloadConversationResponder(instance)

    await expect(
      responder.generateReply({ message: 'sensitive visitor text', session }),
    ).rejects.toMatchObject({ code: 'ai_unavailable', retryable: true })
    await expect(
      responder.generateReply({ message: 'sensitive visitor text', session }),
    ).resolves.toMatchObject({ content: 'Reviewed fixture answer.' })

    expect(mocks.resolveAiGateway).toHaveBeenCalledTimes(2)
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'session-safe-log',
        errorCode: 'ai_unavailable',
        event: 'conversation.ai.reply.failed',
        requestId: 'request-safe-log',
        retryable: true,
      }),
    )
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain('sensitive visitor text')
  })

  it('logs only bounded failure metadata for a provider timeout', async () => {
    const { logger, payload: instance } = payload()
    const timedOutGateway = gateway()
    timedOutGateway.generateText.mockRejectedValue(
      new AiGatewayError('timeout', 'provider request included sensitive upstream detail', {
        retryable: true,
        status: 504,
      }),
    )
    mocks.resolveAiGateway.mockResolvedValue(timedOutGateway)
    const responder = createPayloadConversationResponder(instance)

    await expect(
      responder.generateReply({ message: 'sensitive visitor text', session }),
    ).rejects.toMatchObject({ code: 'timeout', retryable: true })

    expect(logger.error).toHaveBeenCalledWith({
      channel: 'website',
      conversationId: 'session-safe-log',
      errorCode: 'timeout',
      errorName: 'AiGatewayError',
      event: 'conversation.ai.reply.failed',
      providerStatus: 504,
      requestId: 'request-safe-log',
      retryable: true,
    })
    const serialized = JSON.stringify(logger.error.mock.calls)
    expect(serialized).not.toContain('sensitive visitor text')
    expect(serialized).not.toContain('sensitive upstream detail')
  })
})
