import type { ChatSession } from '@/modules/conversations/contracts'
import type {
  ConversationLeadEvaluation,
  ConversationLeadSink,
} from '@/modules/conversations/service'

import { scoreLeadIntent, type LeadScoringInput } from './score'

const countries = [
  'United Arab Emirates',
  'UAE',
  'Saudi Arabia',
  'Qatar',
  'Kuwait',
  'Oman',
  'Bahrain',
  'United States',
  'USA',
  'Australia',
  'Canada',
  'United Kingdom',
]

const arabicCountries: Array<[string, string]> = [
  ['الإمارات العربية المتحدة', 'United Arab Emirates'],
  ['الإمارات', 'United Arab Emirates'],
  ['السعودية', 'Saudi Arabia'],
  ['المملكة العربية السعودية', 'Saudi Arabia'],
  ['قطر', 'Qatar'],
  ['الكويت', 'Kuwait'],
  ['عمان', 'Oman'],
  ['البحرين', 'Bahrain'],
]

const companyCandidate =
  /([A-Za-z0-9&'-]+(?:\s+[A-Za-z0-9&'-]+){0,5}?)(?=\s+(?:and|for|from|in|with|we|our|the|need|needs|requiring)\b|[,.!?\n]|$)/
const nonCompanyWords = new Set([
  'a',
  'an',
  'and',
  'the',
  'bid',
  'business',
  'company',
  'concept',
  'design',
  'factory',
  'for',
  'from',
  'in',
  'my',
  'office',
  'our',
  'procurement',
  'project',
  'sales',
  'stage',
  'is',
  'team',
  'tender',
  'with',
  'workplace',
])
const invalidPromptedCompanyAnswer =
  /^(?:(?:i|we|it|there)\b|(?:no|none|not\s+sure|unknown|unsure|maybe)\b)|\b(?:do\s+not|don't|does\s+not|doesn't)\b/i
// prettier-ignore
const arabicCompanyCandidate =
  /(?:اسم\s+الشركة|(?:نحن\s+)?شركة)\s*[:：]?\s*([^\n،,.!?؟]{2,80}?)(?=\s+(?:في\s+(?:الإمارات(?:\s+العربية\s+المتحدة)?|السعودية|المملكة\s+العربية\s+السعودية|قطر|الكويت|عمان|البحرين)|و?(?:المشروع|مرحلة|نحتاج|نريد|لدينا|الكمية|المساحة|التصميم|المناقصة))|[\n،,.!?؟]|$)/
const invalidArabicCompanyCandidate = /^(?:في|المشروع|مشروع|مرحلة|المناقصة|مناقصة)(?:\s|$)/

const cleanCompanyCandidate = (candidate: string | undefined): string | undefined =>
  candidate?.trim().replace(/[,.!?]+$/, '') || undefined

const isNonCompanyCandidate = (candidate: string): boolean =>
  /^(?:and|for|from|in|with)(?:\s|$)/i.test(candidate) ||
  candidate
    .toLowerCase()
    .split(/\s+/)
    .every((word) => nonCompanyWords.has(word))

const isCountryCandidate = (candidate: string): boolean =>
  countries.some(
    (country) => country.toLowerCase() === candidate.replace(/^the\s+/i, '').toLowerCase(),
  )

const validEnglishCompanyCandidate = (candidate: string | undefined): candidate is string =>
  Boolean(candidate && !isNonCompanyCandidate(candidate) && !isCountryCandidate(candidate))

const countryCandidateSource = [...countries]
  .sort((left, right) => right.length - left.length)
  .join('|')

const extractAskedEnglishCompany = (session: ChatSession): string | undefined => {
  if (!session.qualificationState?.askedFields.includes('company')) return undefined
  const message = session.messages
    .slice()
    .reverse()
    .find(({ author }) => author === 'visitor')?.content
  if (
    !message ||
    /^(?:i(?:'m|\s+(?:am|do|don't|have|work))\b|my\s+company\b|not\s+sure\b|we(?:'re|\s+(?:are|do|don't|have|work))\b)/i.test(
      message.trim(),
    )
  ) {
    return undefined
  }
  const candidate = cleanCompanyCandidate(
    message?.match(
      new RegExp(
        String.raw`^\s*${companyCandidate.source}(?=\s+(?:from|in)\s+(?:${countryCandidateSource})\b|[,.!?\n]|$)`,
        'i',
      ),
    )?.[1],
  )
  if (!validEnglishCompanyCandidate(candidate) || invalidPromptedCompanyAnswer.test(candidate)) {
    return undefined
  }
  return candidate
}

const extractArabicCompany = (text: string): string | undefined => {
  const candidate = cleanCompanyCandidate(text.match(arabicCompanyCandidate)?.[1])
  if (!candidate || invalidArabicCompanyCandidate.test(candidate)) return undefined
  return candidate
}

const extractEnglishCompany = (text: string): string | undefined => {
  const explicit = cleanCompanyCandidate(
    text.match(
      new RegExp(
        String.raw`(?:[Mm]y|[Oo]ur|[Tt]he)?\s*[Cc]ompany(?:\s+[Nn]ame)?\s*(?:[Ii]s|[:：])\s*${companyCandidate.source}`,
      ),
    )?.[1],
  )
  if (validEnglishCompanyCandidate(explicit)) return explicit

  const workplace = cleanCompanyCandidate(
    text.match(
      new RegExp(
        String.raw`\b(?:[Ii]\s+(?:work|am\s+working)|[Ii]'m\s+working|[Ww]e\s+(?:work|are\s+working)|[Ww]e're\s+working)\s+(?:at|for)\s+${companyCandidate.source}`,
        '',
      ),
    )?.[1],
  )
  if (validEnglishCompanyCandidate(workplace)) return workplace

  const origin = cleanCompanyCandidate(
    text.match(
      new RegExp(
        String.raw`\b(?:[Ii]\s+am|[Ii]'m|[Ww]e\s+are|[Ww]e're)\s+from\s+${companyCandidate.source}`,
        '',
      ),
    )?.[1],
  )
  if (validEnglishCompanyCandidate(origin)) {
    return origin
  }
  return undefined
}

export const extractLeadSignals = (session: ChatSession): LeadScoringInput => {
  const text = session.messages
    .filter(({ author }) => author === 'visitor')
    .map(({ content }) => content)
    .join('\n')
  const email = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0]
  const phone = text.match(/(?:\+?\d[\d\s()-]{7,}\d)/)?.[0]
  const quantityMatch = text.match(
    /([\d,.]+)\s*(?:m2|m²|sqm|square meters?|م2|م²|متر(?:اً|ا)?\s*مربع(?:اً|ا)?)/i,
  )?.[1]
  const quantitySquareMeters = quantityMatch ? Number(quantityMatch.replaceAll(',', '')) : undefined
  const country =
    countries.find((candidate) => text.toLowerCase().includes(candidate.toLowerCase())) ??
    arabicCountries.find(([candidate]) => text.includes(candidate))?.[1]
  const stage =
    /\b(tender|bid)\b/i.test(text) || /مناقصة|عطاء/.test(text)
      ? 'tender'
      : /\b(procurement|purchase|buying)\b/i.test(text) || /شراء|توريد/.test(text)
        ? 'procurement'
        : /\b(design|drawing)\b/i.test(text) || /تصميم/.test(text)
          ? 'design'
          : /concept/i.test(text) || /فكرة|مفهوم/.test(text)
            ? 'concept'
            : undefined
  const timeline =
    /\b(within|in)\s+(?:1|2|3)\s+months?\b/i.test(text) ||
    /خلال\s+(?:شهر|شهرين|[123]\s*أشهر?)/.test(text)
      ? 'within_3_months'
      : /\b(within|in)\s+(?:4|5|6)\s+months?\b/i.test(text) || /خلال\s+[456]\s*أشهر?/.test(text)
        ? 'within_6_months'
        : /\b(within|in)\s+(?:7|8|9|10|11|12)\s+months?\b/i.test(text) ||
            /خلال\s+(?:7|8|9|10|11|12)\s*أشهر?/.test(text)
          ? 'within_12_months'
          : undefined
  const company =
    extractEnglishCompany(text) ?? extractArabicCompany(text) ?? extractAskedEnglishCompany(session)
  const englishBudget = text
    .match(
      /(?:budget|price range|spend(?:ing)?|investment)\s*(?:is|of|around|about|[:：])?\s*([^\n.!?]{2,80}?)(?=\s+(?:and\s+)?(?:our\s+|the\s+)?(?:purchase|purchasing|procurement)\s+(?:plan|schedule|process|strategy)\b|,(?!\d{3}\b)|[.!?\n]|$)/i,
    )?.[1]
    ?.trim()
  const budget =
    englishBudget && !/^(?:and|or)\b/i.test(englishBudget)
      ? englishBudget
      : text.match(/(?:الميزانية|ميزانية)\s*(?:هي|حوالي|:|：)?\s*([^\n،,.!?؟]{2,80})/)?.[1]?.trim()
  const englishProcurementPlan = text
    .match(
      /(?:procurement|purchasing|purchase)\s*(?:plan|schedule|process|strategy)?\s*(?:is|will be|:)?\s*([^\n,.!?]{2,120})/i,
    )?.[1]
    ?.trim()
  const procurementPlan =
    englishProcurementPlan && !/^(?:and|for|or)\b/i.test(englishProcurementPlan)
      ? englishProcurementPlan
      : text
          .match(
            /(?:خطة\s+(?:الشراء|التوريد)|موعد\s+(?:الشراء|التوريد))\s*(?:هي|:|：)?\s*([^\n،,.!?؟]{2,120})/,
          )?.[1]
          ?.trim()
  const hasDrawings =
    /(?:no|without)\s+(?:drawings?|blueprints?|cad)/i.test(text) ||
    /لا\s+(?:توجد|يوجد|نملك|لدينا)\s+(?:رسومات|مخططات)/.test(text)
      ? false
      : /\b(drawings?|blueprints?|cad)\b/i.test(text) || /رسومات|مخططات/.test(text)
        ? true
        : undefined
  return {
    budget,
    company,
    contact: { email, phone },
    country,
    hasDrawings,
    productInterest: /aluminum|aluminium|panel|facade/i.test(text) ? 'aluminum panels' : undefined,
    procurementPlan,
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
      ...(score.handoffRecommended
        ? { handoffReason: 'high_intent' }
        : score.missingFields.length === 0 &&
            session.messages.filter(({ author }) => author === 'visitor').length >= 2
          ? { handoffReason: 'qualification_complete' }
          : {}),
      score,
      signals,
    }
  }
}
