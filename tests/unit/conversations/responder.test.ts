import { describe, expect, it, vi } from 'vitest'

import { createKnowledgeConversationResponder } from '@/modules/conversations/responder'
import type { ChatSession } from '@/modules/conversations/contracts'

const session: ChatSession = {
  allowedActions: ['send_message', 'request_handoff'],
  channel: 'website',
  handoffStatus: 'ai_active',
  id: 'session-1',
  locale: 'en',
  messages: [],
  requestId: 'request-1',
}

describe('knowledge conversation responder', () => {
  it.each([
    'Can you confirm the final price and delivery date?',
    'هل يمكن تأكيد السعر ومدة التوريد؟',
  ])('routes high-risk topics to a human without calling the model: %s', async (message) => {
    const generateText = vi.fn()
    const responder = createKnowledgeConversationResponder({
      generateText,
      getPrompt: async () => ({ template: 'fixture', version: 1 }),
      retrieve: async () => [],
    })

    await expect(responder.generateReply({ message, session })).resolves.toEqual({
      handoff: { reason: 'high_risk_topic', source: 'ai_policy' },
    })
    expect(generateText).not.toHaveBeenCalled()
  })

  it('uses reviewed knowledge and preserves citations, model and prompt version', async () => {
    const responder = createKnowledgeConversationResponder({
      generateText: async () => ({
        cost: { estimated: 0 },
        model: 'fake-text-model',
        text: 'Panels can be customized.',
        usage: { inputTokens: 10, outputTokens: 4, totalTokens: 14 },
      }),
      getPrompt: async () => ({ template: 'Be concise.', version: 3 }),
      retrieve: async () => [
        {
          citation: { documentId: 9, title: 'Product manual', version: '2.0' },
          content: 'Custom dimensions require engineering review.',
        },
      ],
    })

    await expect(
      responder.generateReply({ message: 'Do you support custom dimensions?', session }),
    ).resolves.toMatchObject({
      citations: [{ documentId: 9, title: 'Product manual', version: '2.0' }],
      content: 'Panels can be customized.',
      model: 'fake-text-model',
      promptVersion: 3,
    })
  })

  it('requests handoff when reviewed knowledge or an active prompt is unavailable', async () => {
    const responder = createKnowledgeConversationResponder({
      generateText: async () => ({
        cost: { estimated: 0 },
        model: 'must-not-run',
        text: 'must-not-run',
        usage: { inputTokens: 0, totalTokens: 0 },
      }),
      getPrompt: async () => null,
      retrieve: async () => [],
    })

    await expect(
      responder.generateReply({ message: 'Tell me about the product.', session }),
    ).resolves.toEqual({
      handoff: { reason: 'reviewed_knowledge_unavailable', source: 'ai_policy' },
    })
  })
})
