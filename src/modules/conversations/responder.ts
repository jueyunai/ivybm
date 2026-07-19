import type { ChatLocale, ChatSession } from './contracts'
import type { ConversationResponder } from './service'

type ReviewedKnowledge = {
  citation: { documentId: number | string; title: string; url?: string; version: string }
  content: string
}

type GeneratedText = {
  cost: { estimated: number | null }
  model: string
  text: string
  usage: { inputTokens: number; outputTokens?: number; totalTokens: number }
}

type ConversationResponderOptions = {
  generateText(input: { input: string; instructions: string }): Promise<GeneratedText>
  getPrompt(locale: ChatLocale): Promise<{ template: string; version: number } | null>
  retrieve(input: { locale: ChatLocale; query: string }): Promise<ReviewedKnowledge[]>
}

const highRiskPatterns = [
  /\b(price|pricing|quotation|quote|discount|payment|delivery|lead time|certificate|certification|warranty)\b/i,
  /(السعر|الأسعار|عرض سعر|الدفع|التسليم|مدة التوريد|شهادة|ضمان)/,
]

export const requiresHumanReview = (message: string): boolean =>
  highRiskPatterns.some((pattern) => pattern.test(message))

export const createKnowledgeConversationResponder = ({
  generateText,
  getPrompt,
  retrieve,
}: ConversationResponderOptions): ConversationResponder => ({
  async generateReply({ message, session }: { message: string; session: ChatSession }) {
    if (requiresHumanReview(message)) {
      return { handoff: { reason: 'high_risk_topic', source: 'ai_policy' } }
    }

    const [knowledge, prompt] = await Promise.all([
      retrieve({ locale: session.locale, query: message }),
      getPrompt(session.locale),
    ])
    if (knowledge.length === 0 || !prompt) {
      return { handoff: { reason: 'reviewed_knowledge_unavailable', source: 'ai_policy' } }
    }

    const context = knowledge
      .map((item, index) => `[${index + 1}] ${item.citation.title} v${item.citation.version}\n${item.content}`)
      .join('\n\n')
    const generated = await generateText({
      input: `Customer message:\n${message}\n\nReviewed knowledge:\n${context}`,
      instructions: `${prompt.template}\nAnswer only from the reviewed knowledge. Do not promise price, delivery, certification, payment terms, or warranty.`,
    })

    return {
      citations: knowledge.map(({ citation }) => citation),
      content: generated.text,
      estimatedCostUSD: generated.cost.estimated,
      model: generated.model,
      promptVersion: prompt.version,
      tokenUsage: generated.usage,
    }
  },
})
