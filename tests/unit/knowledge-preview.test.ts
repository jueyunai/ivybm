import { describe, expect, it, vi } from 'vitest'

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
})
