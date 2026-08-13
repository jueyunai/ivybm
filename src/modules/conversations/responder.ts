import type { ChatLocale, ChatQualificationState } from './contracts'
import type { ConversationResponder } from './service'
import { detectKnowledgeRiskTopics } from '@/modules/knowledge/ingestion/translation'
import type { LeadQualificationField } from '@/modules/leads/score'

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

const QUALIFICATION_QUESTIONS: Record<LeadQualificationField, { en: string; ar: string }> = {
  country: {
    en: 'Which country or market is the project for?',
    ar: 'لأي دولة أو سوق يخص المشروع؟',
  },
  company: {
    en: 'What is your company name? Please reply “Company: your company name”, or say you prefer not to share.',
    ar: 'ما اسم شركتكم؟ يرجى الرد بصيغة «الشركة: اسم الشركة»، أو اذكروا أنكم تفضلون عدم المشاركة.',
  },
  projectStage: {
    en: 'What stage is the project at: concept, design, procurement, or tender?',
    ar: 'ما مرحلة المشروع: فكرة، تصميم، شراء، أم مناقصة؟',
  },
  quantity: {
    en: 'What approximate area or quantity do you need?',
    ar: 'ما المساحة أو الكمية التقريبية المطلوبة؟',
  },
  drawings: {
    en: 'Do you have drawings or specifications you can share?',
    ar: 'هل لديكم رسومات أو مواصفات يمكن مشاركتها؟',
  },
  budget: {
    en: 'Do you have a budget or purchasing plan for this project?',
    ar: 'هل لديكم ميزانية أو خطة شراء لهذا المشروع؟',
  },
  timeline: {
    en: 'When do you expect to purchase or start the project?',
    ar: 'متى تتوقعون الشراء أو بدء المشروع؟',
  },
  contact: {
    en: 'What work email address should our team use to follow up? You may also share a phone number.',
    ar: 'ما عنوان البريد الإلكتروني للعمل الذي يستخدمه فريقنا للمتابعة؟ ويمكنكم أيضاً مشاركة رقم هاتف.',
  },
}

const QUALIFICATION_FIELD_ORDER: LeadQualificationField[] = [
  'country',
  'company',
  'projectStage',
  'quantity',
  'timeline',
  'drawings',
  'budget',
  'contact',
]
const MAX_QUALIFICATION_QUESTIONS_PER_ROUND = 2

const qualificationPrompt = (fields: LeadQualificationField[], locale: ChatLocale): string =>
  fields.map((field) => QUALIFICATION_QUESTIONS[field][locale]).join(' ')

const nextQualificationFields = (
  missingFields: readonly LeadQualificationField[],
  state: ChatQualificationState,
): LeadQualificationField[] => {
  const pending = new Set(missingFields.filter((field) => !state.askedFields.includes(field)))
  return QUALIFICATION_FIELD_ORDER.filter((field) => pending.has(field)).slice(
    0,
    MAX_QUALIFICATION_QUESTIONS_PER_ROUND,
  )
}

export const requiresHumanReview = (message: string): boolean =>
  detectKnowledgeRiskTopics(message).length > 0

export const createKnowledgeConversationResponder = ({
  generateText,
  getPrompt,
  retrieve,
}: ConversationResponderOptions): ConversationResponder => ({
  async generateReply({ message, session, missingFields = [], qualificationState }) {
    if (requiresHumanReview(message)) {
      return { handoff: { reason: 'high_risk_topic', source: 'ai_policy' } }
    }

    const state = qualificationState ?? { awaitingFields: [], roundCount: 0, askedFields: [] }
    if (state.roundCount >= 3 && missingFields.length > 0) {
      return { handoff: { reason: 'qualification_incomplete', source: 'ai_policy' } }
    }

    const fields = state.roundCount < 3 ? nextQualificationFields(missingFields, state) : []
    if (missingFields.length > 0 && fields.length === 0) {
      return { handoff: { reason: 'qualification_incomplete', source: 'ai_policy' } }
    }

    const [knowledge, prompt] = await Promise.all([
      retrieve({ locale: session.locale, query: message }),
      getPrompt(session.locale),
    ])
    if (knowledge.length === 0 || !prompt) {
      return { handoff: { reason: 'reviewed_knowledge_unavailable', source: 'ai_policy' } }
    }

    const question = fields.length > 0 ? qualificationPrompt(fields, session.locale) : null

    const context = knowledge
      .map(
        (item, index) =>
          `[${index + 1}] ${item.citation.title} v${item.citation.version}\n${item.content}`,
      )
      .join('\n\n')
    const generated = await generateText({
      input: `Customer message:\n${message}\n\nReviewed knowledge:\n${context}`,
      instructions: `${prompt.template}\nAnswer only from the reviewed knowledge. Do not promise price, delivery, certification, payment terms, or warranty.`,
    })

    return {
      citations: knowledge.map(({ citation }) => citation),
      content: question ? `${generated.text.trim()}\n\n${question}` : generated.text,
      estimatedCostUSD: generated.cost.estimated,
      model: generated.model,
      promptVersion: prompt.version,
      qualificationState: question
        ? {
            ...state,
            awaitingFields: fields,
            roundCount: state.roundCount + 1,
            askedFields: [...state.askedFields, ...fields],
          }
        : { ...state, awaitingFields: [] },
      tokenUsage: generated.usage,
    }
  },
})
