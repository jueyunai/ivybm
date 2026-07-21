import type { ChatSession } from '@/modules/conversations/contracts'
import type { ConversationLeadEvaluation, ConversationLeadSink } from '@/modules/conversations/service'

import { scoreLeadIntent, type LeadScoringInput } from './score'

const countries = [
  'United Arab Emirates', 'UAE', 'Saudi Arabia', 'Qatar', 'Kuwait', 'Oman', 'Bahrain',
  'United States', 'USA', 'Australia', 'Canada', 'United Kingdom',
]

export const extractLeadSignals = (session: ChatSession): LeadScoringInput => {
  const text = session.messages
    .filter(({ author }) => author === 'visitor')
    .map(({ content }) => content)
    .join('\n')
  const email = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0]
  const phone = text.match(/(?:\+?\d[\d\s()-]{7,}\d)/)?.[0]
  const quantityMatch = text.match(/([\d,.]+)\s*(?:m2|m²|sqm|square meters?)/i)?.[1]
  const quantitySquareMeters = quantityMatch
    ? Number(quantityMatch.replaceAll(',', ''))
    : undefined
  const country = countries.find((candidate) => text.toLowerCase().includes(candidate.toLowerCase()))
  const stage = /\b(tender|bid)\b/i.test(text)
    ? 'tender'
    : /\b(procurement|purchase|buying)\b/i.test(text)
      ? 'procurement'
      : /\b(design|drawing)\b/i.test(text)
        ? 'design'
        : undefined
  const timeline = /\b(within|in)\s+(?:1|2|3)\s+months?\b/i.test(text)
    ? 'within_3_months'
    : /\b(within|in)\s+(?:4|5|6)\s+months?\b/i.test(text)
      ? 'within_6_months'
      : undefined
  const company = text.match(/(?:company|from|at)\s+([A-Z][\w& .-]{2,80})/i)?.[1]?.trim()
  return {
    company,
    contact: { email, phone },
    country,
    hasDrawings: /\b(drawings?|blueprints?|cad)\b/i.test(text),
    productInterest: /aluminum|aluminium|panel|facade/i.test(text) ? 'aluminum panels' : undefined,
    projectStage: stage,
    quantitySquareMeters,
    timeline,
  }
}

/**
 * Keeps intent scoring pure so that the repository can commit score, lead, handoff and command
 * result in one database transaction.
 */
export class PayloadConversationLeadSink implements ConversationLeadSink {
  async evaluate(session: ChatSession): Promise<ConversationLeadEvaluation> {
    const signals = extractLeadSignals(session)
    const score = scoreLeadIntent(signals)
    return {
      ...(score.handoffRecommended ? { handoffReason: 'high_intent' } : {}),
      score,
      signals,
    }
  }
}
