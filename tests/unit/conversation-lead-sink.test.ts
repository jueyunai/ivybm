import { describe, expect, it } from 'vitest'

import type { ChatSession } from '@/modules/conversations/contracts'
import { extractLeadSignals } from '@/modules/leads/conversationLeadSink'

const sessionWith = (locale: ChatSession['locale'], content: string): ChatSession => ({
  allowedActions: ['send_message', 'request_handoff'],
  channel: 'website',
  handoffStatus: 'ai_active',
  id: `signals-${locale}`,
  locale,
  messages: [
    {
      author: 'visitor',
      content,
      createdAt: '2026-08-12T00:00:00.000Z',
      id: `message-${locale}`,
      status: 'sent',
    },
  ],
  qualificationState: { askedFields: [], roundCount: 0 },
  revision: 1,
  requestId: `request-${locale}`,
})

describe('conversation lead signal extraction', () => {
  it('extracts English budget and procurement qualification signals', () => {
    const signals = extractLeadSignals(
      sessionWith(
        'en',
        'I am from UAE. My company name is Facade Engineering LLC. The project is in tender for 3,200 sqm. Drawings are ready. Our budget is USD 420000 and our purchase plan is within 3 months. Email buyer@example.invalid.',
      ),
    )

    expect(signals).toMatchObject({
      budget: 'USD 420000',
      company: 'Facade Engineering LLC',
      country: 'UAE',
      hasDrawings: true,
      procurementPlan: 'within 3 months',
      projectStage: 'tender',
      quantitySquareMeters: 3200,
      timeline: 'within_3_months',
    })
    expect(signals.contact.email).toBe('buyer@example.invalid')
  })

  it('preserves English budget thousands separators and stops before the procurement plan', () => {
    const signals = extractLeadSignals(
      sessionWith('en', 'Our budget is USD 450,000, and our procurement plan is within 3 months.'),
    )

    expect(signals.budget).toBe('USD 450,000')
    expect(signals.procurementPlan).toBe('within 3 months')
  })

  it('does not mistake a project-stage phrase for a company name', () => {
    const signals = extractLeadSignals(
      sessionWith('en', 'We are at tender stage in the UAE and need 500 sqm.'),
    )

    expect(signals.company).toBeUndefined()
  })

  it.each([
    ['I work at Acme Facades.', 'Acme Facades'],
    ["I'm from Acme Corp.", 'Acme Corp'],
    ['I work at Acme Facades for our procurement team.', 'Acme Facades'],
    ['I work for Acme Facades from UAE.', 'Acme Facades'],
    ['My company is Acme Facades and we need 500 sqm.', 'Acme Facades'],
    ['My company is Alcoa.', 'Alcoa'],
    ['I work at IVYBM.', 'IVYBM'],
    ['My company is acme facades.', 'acme facades'],
    ['My company is Acme Design LLC.', 'Acme Design LLC'],
  ])('extracts a bounded workplace company from %s', (content, company) => {
    expect(extractLeadSignals(sessionWith('en', content)).company).toBe(company)
  })

  it.each(['I am from UAE.', 'I work at UAE.', 'I work at Saudi Arabia.'])(
    'does not mistake a country for a company in %s',
    (content) => {
      expect(extractLeadSignals(sessionWith('en', content)).company).toBeUndefined()
    },
  )

  it('does not mistake a generic workplace phrase for a company', () => {
    for (const content of [
      'I work at a factory for our team.',
      'I work at the business team.',
      'My company is a company.',
      'My company is a factory office.',
      'I am from a workplace.',
    ]) {
      expect(extractLeadSignals(sessionWith('en', content)).company).toBeUndefined()
    }
  })

  it('does not mistake a qualification question for a supplied budget', () => {
    const signals = extractLeadSignals(
      sessionWith('en', 'Do you have a budget or purchasing plan for this project?'),
    )

    expect(signals.budget).toBeUndefined()
    expect(signals.procurementPlan).toBeUndefined()
  })

  it('extracts Arabic qualification signals and records an explicit lack of drawings', () => {
    const signals = extractLeadSignals(
      sessionWith(
        'ar',
        'اسم الشركة: شركة النور. المشروع في السعودية ومرحلة مناقصة بمساحة 1200 متر مربع. لا توجد رسومات. الميزانية حوالي 300000 ريال. خطة الشراء خلال 3 أشهر. البريد sales@example.invalid.',
      ),
    )

    expect(signals).toMatchObject({
      budget: '300000 ريال',
      company: 'شركة النور',
      country: 'Saudi Arabia',
      hasDrawings: false,
      projectStage: 'tender',
      quantitySquareMeters: 1200,
      timeline: 'within_3_months',
    })
    expect(signals.contact.email).toBe('sales@example.invalid')
  })

  it('stops an Arabic company before country and project qualification phrases', () => {
    const signals = extractLeadSignals(
      sessionWith('ar', 'نحن شركة النور في السعودية والمشروع مناقصة.'),
    )

    expect(signals).toMatchObject({
      company: 'النور',
      country: 'Saudi Arabia',
      projectStage: 'tender',
    })
  })

  it.each([
    'نحن شركة في السعودية والمشروع مناقصة.',
    'اسم الشركة في السعودية والمشروع مناقصة.',
    'شركة المشروع في السعودية.',
    'نحن شركة مرحلة مناقصة.',
    'اسم الشركة مناقصة شراء.',
  ])('does not mistake Arabic location or project words for a company in %s', (content) => {
    expect(extractLeadSignals(sessionWith('ar', content)).company).toBeUndefined()
  })
})
