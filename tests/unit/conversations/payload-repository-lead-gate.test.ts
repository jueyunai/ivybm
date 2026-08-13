import { describe, expect, it } from 'vitest'

import { shouldCreateConversationLead } from '@/modules/conversations/payloadRepository'
import type { ConversationLeadEvaluation } from '@/modules/conversations/service'

const evaluation = ({
  country = 'UAE',
  email = 'buyer@example.invalid',
  handoffReason,
  level,
}: {
  country?: string
  email?: string
  handoffReason?: string
  level: 'a' | 'b' | 'c'
}): ConversationLeadEvaluation => ({
  ...(handoffReason ? { handoffReason } : {}),
  score: {
    handoffRecommended: level === 'a',
    level,
    missingFields: [],
    reasons: [],
    score: level === 'a' ? 70 : level === 'b' ? 40 : 0,
  },
  signals: { contact: { email }, country },
})

describe('Payload conversation Lead gate', () => {
  it('creates Leads for A intent or completed qualification with a sustainable contact', () => {
    expect(shouldCreateConversationLead(evaluation({ level: 'a' }))).toBe(true)
    expect(
      shouldCreateConversationLead(evaluation({ handoffReason: 'high_risk_topic', level: 'a' })),
    ).toBe(true)
    expect(
      shouldCreateConversationLead(
        evaluation({ handoffReason: 'qualification_complete', level: 'b' }),
      ),
    ).toBe(true)
    expect(shouldCreateConversationLead(evaluation({ country: '', level: 'a' }))).toBe(true)
  })

  it('does not treat every handoff as a Lead or invent a missing contact', () => {
    expect(
      shouldCreateConversationLead(evaluation({ handoffReason: 'high_risk_topic', level: 'b' })),
    ).toBe(false)
    expect(
      shouldCreateConversationLead(
        evaluation({ email: '', handoffReason: 'qualification_complete', level: 'b' }),
      ),
    ).toBe(false)
  })
})
