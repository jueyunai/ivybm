import type { Payload } from 'payload'

import type { ChatSession } from '@/modules/conversations/contracts'
import type { ConversationLeadSink } from '@/modules/conversations/service'

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

export class PayloadConversationLeadSink implements ConversationLeadSink {
  constructor(private readonly payload: Payload) {}

  async evaluate(session: ChatSession): Promise<{ handoffReason?: string }> {
    const signals = extractLeadSignals(session)
    const score = scoreLeadIntent(signals)
    const conversations = await this.payload.find({
      collection: 'conversations',
      limit: 1,
      overrideAccess: true,
      where: { publicId: { equals: String(session.id) } },
    })
    const conversation = conversations.docs[0]
    if (!conversation) return {}
    await this.payload.update({
      collection: 'conversations',
      data: { intentLevel: score.level, intentScore: score.score },
      id: conversation.id,
      overrideAccess: true,
    })

    if (score.level === 'a' && signals.contact.email && signals.country) {
      let sources = await this.payload.find({
        collection: 'lead-sources',
        limit: 1,
        overrideAccess: true,
        where: { key: { equals: 'ai-chat' } },
      })
      if (!sources.docs[0]) {
        await this.payload.create({
          collection: 'lead-sources',
          data: { channel: 'ai-chat', isActive: true, key: 'ai-chat', name: 'AI Chat' },
          overrideAccess: true,
        }).catch(() => undefined)
        sources = await this.payload.find({
          collection: 'lead-sources',
          limit: 1,
          overrideAccess: true,
          where: { key: { equals: 'ai-chat' } },
        })
      }
      const source = sources.docs[0]
      if (source) {
        const idempotencyKey = `chat-lead:${String(session.id)}`
        const existing = await this.payload.find({
          collection: 'leads',
          limit: 1,
          overrideAccess: true,
          where: { idempotencyKey: { equals: idempotencyKey } },
        })
        const data = {
          company: signals.company,
          country: signals.country,
          email: signals.contact.email,
          idempotencyKey,
          intentLevel: 'a' as const,
          interest: signals.productInterest,
          locale: session.locale,
          message: session.messages.filter(({ author }) => author === 'visitor').map(({ content }) => content).join('\n'),
          name: signals.company || signals.contact.email.split('@')[0],
          phone: signals.contact.phone,
          requestId: `chat-${session.requestId}`,
          source: source.id,
          status: 'new' as const,
        }
        const lead = existing.docs[0]
          ? await this.payload.update({ collection: 'leads', data, id: existing.docs[0].id, overrideAccess: true })
          : await this.payload.create({ collection: 'leads', data, overrideAccess: true })
        await this.payload.update({
          collection: 'conversations',
          data: { lead: lead.id },
          id: conversation.id,
          overrideAccess: true,
        })
      }
      return { handoffReason: 'high_intent' }
    }
    return {}
  }
}
