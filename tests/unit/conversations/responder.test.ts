import { describe, expect, it, vi } from 'vitest'

import { createKnowledgeConversationResponder, requiresHumanReview } from '@/modules/conversations/responder'
import type { ChatSession } from '@/modules/conversations/contracts'

const session: ChatSession = {
  allowedActions: ['send_message', 'request_handoff'],
  channel: 'website',
  handoffStatus: 'ai_active',
  id: 'session-1',
  locale: 'en',
  messages: [],
  revision: 1,
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

  it.each([
    ['price', 'What is the price?', '价格是多少？', 'ما هو السعر؟'],
    ['discount', 'Can you give a discount?', '可以打折吗？', 'هل يوجد خصم؟'],
    ['payment', 'What are the payment terms?', '付款方式是什么？', 'ما شروط الدفع؟'],
    ['lead-time', 'What is the lead time?', '交期是多久？', 'ما مدة التوريد؟'],
    ['warranty', 'What warranty do you provide?', '质保多久？', 'ما مدة الضمان؟'],
    ['lifespan', 'What is the product lifespan?', '产品寿命是多少？', 'ما العمر الافتراضي للمنتج؟'],
    ['certification', 'Do you have certification?', '有认证证书吗？', 'هل توجد شهادة معتمدة؟'],
    ['structural-performance', 'What is the structural performance?', '结构性能如何？', 'ما الأداء الإنشائي؟'],
    ['fire-performance', 'What is the fire resistance rating?', '防火性能如何？', 'ما مقاومة الحريق؟'],
    ['customs', 'How do customs duties work?', '海关和关税怎么办？', 'كيف تكون إجراءات الجمارك؟'],
    ['freight', 'How much is freight and shipping?', '运费和运输怎么计算？', 'كم تكلفة الشحن؟'],
    ['insurance', 'Can you arrange insurance?', '可以购买保险吗？', 'هل يشمل التأمين؟'],
    ['liability', 'Who accepts liability?', '责任归属是谁？', 'من يتحمل المسؤولية؟'],
  ])('uses the authoritative policy for %s in English, Chinese, and Arabic', (_topic, en, zh, ar) => {
    expect(requiresHumanReview(en)).toBe(true)
    expect(requiresHumanReview(zh)).toBe(true)
    expect(requiresHumanReview(ar)).toBe(true)
  })

  it.each([
    ['quote', 'Please quote the panels.'],
    ['quotation', 'I need a quotation today.'],
    ['Arabic quotation', 'أرسل عرض سعر من فضلك.'],
  ])('keeps quotation aliases on the handoff path (%s)', (_label, message) => {
    expect(requiresHumanReview(message)).toBe(true)
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

  it('appends a deterministic qualification question and advances explicit state', async () => {
    const responder = createKnowledgeConversationResponder({
      generateText: async () => ({ cost: { estimated: 0 }, model: 'fixture', text: 'We can help.', usage: { inputTokens: 1, totalTokens: 1 } }),
      getPrompt: async () => ({ template: 'fixture', version: 1 }),
      retrieve: async () => [{ citation: { documentId: 1, title: 'Manual', version: '1' }, content: 'Reviewed.' }],
    })
    await expect(responder.generateReply({ message: 'Tell me about your panels.', session, missingFields: ['country', 'company'], qualificationState: { roundCount: 0, askedFields: [] } })).resolves.toMatchObject({
      content: 'We can help.\n\nWhich country or market is the project for? What is your company name?',
      qualificationState: { roundCount: 1, askedFields: ['country', 'company'] },
    })
  })

  it('asks no more than two qualification questions in one round', async () => {
    const responder = createKnowledgeConversationResponder({
      generateText: async () => ({ cost: { estimated: 0 }, model: 'fixture', text: 'We can help.', usage: { inputTokens: 1, totalTokens: 1 } }),
      getPrompt: async () => ({ template: 'fixture', version: 1 }),
      retrieve: async () => [{ citation: { documentId: 1, title: 'Manual', version: '1' }, content: 'Reviewed.' }],
    })
    await expect(responder.generateReply({ message: 'We need facade panels.', session, missingFields: ['quantity', 'drawings', 'budget', 'timeline'], qualificationState: { roundCount: 0, askedFields: [] } })).resolves.toMatchObject({
      content: 'We can help.\n\nWhat approximate area or quantity do you need? When do you expect to purchase or start the project?',
      qualificationState: { roundCount: 1, askedFields: ['quantity', 'timeline'] },
    })
  })

  it('asks Arabic missing fields without repeating fields already requested', async () => {
    const responder = createKnowledgeConversationResponder({
      generateText: async () => ({ cost: { estimated: 0 }, model: 'fixture', text: 'يمكننا المساعدة.', usage: { inputTokens: 1, totalTokens: 1 } }),
      getPrompt: async () => ({ template: 'fixture', version: 1 }),
      retrieve: async () => [{ citation: { documentId: 1, title: 'Manual', version: '1' }, content: 'Reviewed.' }],
    })
    await expect(responder.generateReply({ message: 'أحتاج ألواحاً للمشروع.', missingFields: ['country', 'company', 'projectStage'], qualificationState: { askedFields: ['country'], roundCount: 1 }, session: { ...session, locale: 'ar' } })).resolves.toMatchObject({
      content: 'يمكننا المساعدة.\n\nما اسم شركتكم؟ ما مرحلة المشروع: فكرة، تصميم، شراء، أم مناقصة؟',
      qualificationState: { askedFields: ['country', 'company', 'projectStage'], roundCount: 2 },
    })
  })

  it('hands off after three explicit qualification rounds', async () => {
    const generateText = vi.fn()
    const responder = createKnowledgeConversationResponder({
      generateText, getPrompt: async () => ({ template: 'fixture', version: 1 }), retrieve: async () => [],
    })
    await expect(responder.generateReply({ message: 'I do not know.', session, missingFields: ['contact'], qualificationState: { roundCount: 3, askedFields: ['country', 'company', 'quantity'] } })).resolves.toEqual({ handoff: { reason: 'qualification_incomplete', source: 'ai_policy' } })
    expect(generateText).not.toHaveBeenCalled()
  })

  it('hands off instead of repeating a missing field that was already asked', async () => {
    const generateText = vi.fn()
    const responder = createKnowledgeConversationResponder({
      generateText, getPrompt: async () => ({ template: 'fixture', version: 1 }), retrieve: async () => [],
    })
    await expect(responder.generateReply({ message: 'I do not have anything else to add.', missingFields: ['company'], qualificationState: { askedFields: ['company'], roundCount: 1 }, session })).resolves.toEqual({ handoff: { reason: 'qualification_incomplete', source: 'ai_policy' } })
    expect(generateText).not.toHaveBeenCalled()
  })
})
