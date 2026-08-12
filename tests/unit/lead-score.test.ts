import { describe, expect, it } from 'vitest'

import { scoreLeadIntent } from '@/modules/leads/score'

describe('lead intent scoring', () => {
  it('prioritizes complete project enquiries to reduce high-intent false negatives', () => {
    const result = scoreLeadIntent({
      budget: 'USD 450000',
      company: 'Facade Engineering LLC',
      contact: { email: 'buyer@example.invalid', phone: '+971500000000' },
      country: 'United Arab Emirates',
      hasDrawings: true,
      productInterest: 'custom perforated aluminum facade panels',
      projectStage: 'tender',
      quantitySquareMeters: 3200,
      timeline: 'within_3_months',
    })

    expect(result).toMatchObject({
      handoffRecommended: true,
      level: 'a',
    })
    expect(result.score).toBeGreaterThanOrEqual(70)
    expect(result.reasons).toContain('project_quantity')
  })

  it('keeps incomplete enquiries visible and identifies the next fields to collect', () => {
    const result = scoreLeadIntent({
      contact: {},
      productInterest: 'aluminum panel',
    })

    expect(result.level).toBe('c')
    expect(result.handoffRecommended).toBe(false)
    expect(result.missingFields).toEqual(
      expect.arrayContaining(['country', 'company', 'contact', 'projectStage', 'quantity']),
    )
  })

  it('keeps requesting an email when only a phone number is available', () => {
    const result = scoreLeadIntent({
      company: 'Facade LLC',
      contact: { phone: '+971500000000' },
      country: 'United Arab Emirates',
      hasDrawings: true,
      projectStage: 'tender',
      quantitySquareMeters: 1000,
      timeline: 'within_3_months',
    })

    expect(result.missingFields).toContain('contact')
    expect(result.reasons).toContain('phone_available_email_required')
    expect(result.handoffRecommended).toBe(false)
  })
})
