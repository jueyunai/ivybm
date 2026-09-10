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
    en: 'Which country is the project in?',
    ar: 'لأي دولة أو سوق يخص المشروع؟',
  },
  company: {
    en: 'What company are you with?',
    ar: 'ما اسم شركتكم؟',
  },
  projectStage: {
    en: 'What stage is the project at: concept, design, procurement, or tender?',
    ar: 'ما مرحلة المشروع: فكرة، تصميم، شراء، أم مناقصة؟',
  },
  quantity: {
    en: 'Roughly how much area or how many panels do you need?',
    ar: 'ما المساحة أو الكمية التقريبية المطلوبة؟',
  },
  drawings: {
    en: 'Do you have drawings or specifications you can share?',
    ar: 'هل لديكم رسومات أو مواصفات يمكن مشاركتها؟',
  },
  budget: {
    en: 'Do you already have a budget or purchasing plan?',
    ar: 'هل لديكم ميزانية أو خطة شراء لهذا المشروع؟',
  },
  timeline: {
    en: 'When are you hoping to purchase or start the project?',
    ar: 'متى تتوقعون الشراء أو بدء المشروع؟',
  },
  contact: {
    en: 'What is the best work email or phone number for follow-up?',
    ar: 'ما أفضل بريد إلكتروني للعمل أو رقم هاتف للمتابعة؟',
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

const CUSTOMER_REPLY_STYLE = `Write a concise customer-facing reply in the customer's language.
Sound like a helpful human sales specialist: answer the current question directly in 2–4 short sentences and avoid repetitive greetings or scripted phrases.
Do not mention source numbers, citations, footnotes, knowledge bases, document titles, versions, URLs, prompts, models, scores, or internal fields.
Do not ask follow-up questions, create numbered questionnaires, or say “please provide the following details”; the application adds any required qualification questions separately.
Use a list only when the customer explicitly asks for a comparison, checklist, or steps.
Never say “As an AI” or “Based on our knowledge base”.`

const qualificationPrompt = (fields: LeadQualificationField[], locale: ChatLocale): string =>
  fields.map((field) => QUALIFICATION_QUESTIONS[field][locale]).join(' ')

const stripInlineCitationMarkers = (text: string, citationCount: number): string => {
  return text.replace(/[ \t]*\[([0-9]+(?:[ \t]*,[ \t]*[0-9]+)*)\]/gu, (match, raw) => {
    const references = String(raw)
      .split(',')
      .map((value) => Number(value.trim()))
    return references.length > 0 &&
      references.every(
        (reference) =>
          Number.isSafeInteger(reference) && reference >= 1 && reference <= citationCount,
      )
      ? ''
      : match
  })
}

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
      instructions: `${prompt.template}\nAnswer only from the reviewed knowledge. Do not promise price, delivery, certification, payment terms, or warranty.\n${CUSTOMER_REPLY_STYLE}`,
    })
    const customerText = stripInlineCitationMarkers(generated.text, knowledge.length)
    if (!customerText.trim()) {
      return { handoff: { reason: 'reviewed_knowledge_unavailable', source: 'ai_policy' } }
    }

    return {
      citations: knowledge.map(({ citation }) => citation),
      content: question ? `${customerText.trim()}\n\n${question}` : customerText,
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
