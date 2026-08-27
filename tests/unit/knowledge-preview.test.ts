import { beforeEach, describe, expect, it, vi } from 'vitest'

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

import { previewKnowledgeAnswer } from '@/modules/knowledge/preview'

describe('knowledge answer preview', () => {
  beforeEach(() => {
    mocks.resolveAiGateway.mockReset()
    mocks.retrieveKnowledgeForQuery.mockReset()
  })

  it('hands high-risk questions to a human before resolving an unavailable model route', async () => {
    const payload = {
      db: { pool: {} },
      find: vi.fn(),
    }
    mocks.resolveAiGateway.mockRejectedValue(new Error('model route unavailable'))

    await expect(
      previewKnowledgeAnswer({
        locale: 'en',
        payload: payload as never,
        query: 'What is the final price and payment term?',
      }),
    ).resolves.toEqual({ outcome: 'handoff', reason: 'high_risk_topic' })
    expect(mocks.resolveAiGateway).not.toHaveBeenCalled()
    expect(mocks.retrieveKnowledgeForQuery).not.toHaveBeenCalled()
    expect(payload.find).not.toHaveBeenCalled()
  })

  it('forwards the dispatch marker to embedding retrieval and text generation', async () => {
    const onProviderDispatch = vi.fn()
    const generateText = vi.fn(async ({ onDispatch }: { onDispatch?: () => void }) => {
      onDispatch?.()
      return {
        cost: { currency: 'USD', estimated: 0.001 },
        model: 'text-model',
        provider: 'fixture-provider',
        text: 'Grounded answer',
        usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 },
      }
    })
    mocks.resolveAiGateway.mockResolvedValue({ generateText })
    mocks.retrieveKnowledgeForQuery.mockImplementation(
      async ({ onDispatch }: { onDispatch?: () => void }) => {
        onDispatch?.()
        return [
          {
            citation: { documentId: 1, title: 'Reviewed source', version: '1.0' },
            content: 'Reviewed fact',
            id: 2,
            locale: 'en',
            score: 0.9,
            stableId: 'reviewed-source-1',
          },
        ]
      },
    )
    const payload = {
      db: { pool: {} },
      find: vi.fn().mockResolvedValue({
        docs: [{ template: 'Use reviewed knowledge.', version: 4 }],
      }),
    }

    await expect(
      previewKnowledgeAnswer({
        locale: 'en',
        onProviderDispatch,
        payload: payload as never,
        query: 'Which specification applies?',
      }),
    ).resolves.toMatchObject({ outcome: 'answer', promptVersion: 4 })

    expect(onProviderDispatch).toHaveBeenCalledTimes(2)
    expect(mocks.retrieveKnowledgeForQuery).toHaveBeenCalledWith(
      expect.objectContaining({ onDispatch: onProviderDispatch }),
    )
    expect(generateText).toHaveBeenCalledWith(
      expect.objectContaining({ onDispatch: onProviderDispatch }),
    )
  })
})
