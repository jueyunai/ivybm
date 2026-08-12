import { describe, expect, it } from 'vitest'

import type { ChatSession } from '@/modules/conversations/contracts'
import {
  extractLeadSignals,
  PayloadConversationLeadSink,
} from '@/modules/leads/conversationLeadSink'

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

  it('extracts a bare company reply after the company field was asked', () => {
    const session = sessionWith('en', 'Acme Facades LLC.')
    session.qualificationState = { askedFields: ['country', 'company'], roundCount: 1 }

    expect(extractLeadSignals(session).company).toBe('Acme Facades LLC')
  })

  it('extracts a framed company reply after the company field was asked', () => {
    const session = sessionWith('en', 'We are Acme Facades LLC.')
    session.qualificationState = { askedFields: ['company'], roundCount: 1 }

    expect(extractLeadSignals(session).company).toBe('Acme Facades LLC')
  })

  it('does not infer an unframed first message as a company answer', () => {
    expect(extractLeadSignals(sessionWith('en', 'Need facade panels.')).company).toBeUndefined()
  })

  it('does not infer a country-only reply as a company after asking the company field', () => {
    const session = sessionWith('en', 'UAE.')
    session.qualificationState = { askedFields: ['country', 'company'], roundCount: 1 }

    expect(extractLeadSignals(session).company).toBeUndefined()
  })

  it('keeps company missing in the authoritative evaluation after an uncertain prompted reply', async () => {
    const session = sessionWith(
      'en',
      'We need 1000 sqm of aluminum panels in UAE at tender stage within 3 months. Drawings are ready. Budget is USD 400000. Email buyer@example.invalid.',
    )
    session.messages.push({
      author: 'visitor',
      content: 'Not sure.',
      createdAt: '2026-08-12T00:01:00.000Z',
      id: 'message-en-2',
      status: 'sent',
    })
    session.qualificationState = { askedFields: ['company'], roundCount: 1 }

    const evaluation = await new PayloadConversationLeadSink().evaluate(session)

    expect(evaluation.signals.company).toBeUndefined()
    expect(evaluation.score.missingFields).toContain('company')
    expect(evaluation.score.reasons).not.toContain('company_identified')
  })

  it('uses a framed prompted company reply in the authoritative evaluation', async () => {
    const session = sessionWith(
      'en',
      'We need 1000 sqm of aluminum panels in UAE at tender stage within 3 months. Drawings are ready. Budget is USD 400000. Email buyer@example.invalid.',
    )
    session.messages.push({
      author: 'visitor',
      content: 'We are Acme Facades LLC.',
      createdAt: '2026-08-12T00:01:00.000Z',
      id: 'message-en-2',
      status: 'sent',
    })
    session.qualificationState = { askedFields: ['company'], roundCount: 1 }

    const evaluation = await new PayloadConversationLeadSink().evaluate(session)

    expect(evaluation.signals.company).toBe('Acme Facades LLC')
    expect(evaluation.score.missingFields).not.toContain('company')
    expect(evaluation.score.reasons).toContain('company_identified')
  })

  it('does not let a one-word refusal complete company scoring after qualification', async () => {
    const session = sessionWith(
      'en',
      'We need 1000 sqm of aluminum panels in UAE at tender stage within 3 months. Drawings are ready. Budget is USD 400000. Email buyer@example.invalid.',
    )
    session.messages.push({
      author: 'visitor',
      content: 'Unknown.',
      createdAt: '2026-08-12T00:01:00.000Z',
      id: 'message-en-unknown',
      status: 'sent',
    })
    session.qualificationState = { askedFields: ['company'], roundCount: 1 }

    const evaluation = await new PayloadConversationLeadSink().evaluate(session)

    expect(evaluation.signals.company).toBeUndefined()
    expect(evaluation.score.missingFields).toContain('company')
    expect(evaluation.score.reasons).not.toContain('company_identified')
  })

  it.each([
    ['en' as const, 'Not applicable.'],
    ['en' as const, 'Better not to say.'],
    ['en' as const, 'Not applicable Inc.'],
    ['en' as const, 'Better not to say LLC.'],
    ['en' as const, 'Nope LLC.'],
    ['ar' as const, 'أفضل عدم القول.'],
    ['ar' as const, 'الرفض.'],
    ['ar' as const, 'السرية.'],
  ])('keeps %s refusal %s out of authoritative company scoring', async (locale, refusal) => {
    const qualifiedText =
      locale === 'ar'
        ? 'نحتاج 1200 متر مربع في السعودية ومرحلة المشروع مناقصة خلال 3 أشهر. الرسومات جاهزة. الميزانية 300000 ريال. البريد sales@example.invalid.'
        : 'We need 1000 sqm in UAE at tender stage within 3 months. Drawings are ready. Budget is USD 400000. Email buyer@example.invalid.'
    const session = sessionWith(locale, qualifiedText)
    session.messages.push({
      author: 'visitor',
      content: refusal,
      createdAt: '2026-08-12T00:01:00.000Z',
      id: `message-${locale}-refusal`,
      status: 'sent',
    })
    session.qualificationState = { askedFields: ['company'], roundCount: 1 }

    const evaluation = await new PayloadConversationLeadSink().evaluate(session)

    expect(evaluation.signals.company).toBeUndefined()
    expect(evaluation.score.missingFields).toContain('company')
    expect(evaluation.score.reasons).not.toContain('company_identified')
  })

  it.each([
    'I am from UAE.',
    'I am from UAE. It is a tender for 1000 sqm. Email buyer@example.invalid.',
    'I am from UAE and need 1000 sqm at tender stage. Email buyer@example.invalid.',
    'Not sure.',
    'Not applicable.',
    'Better not to say.',
    'Refuse.',
    'Decline.',
    'Skip.',
    'Nope.',
    'REFUSE.',
    'DECLINE.',
    'SKIP.',
    'Refuse LLC.',
    'Decline Corp.',
    'Skip Group.',
    'Not applicable Inc.',
    'Better not to say LLC.',
    'Nope LLC.',
    'Pass Group.',
    'Refusal LLC.',
    'No company.',
    'None.',
    'No idea.',
    'It is confidential.',
    'Prefer not to say.',
    'There is no company.',
    'Unknown.',
    'Confidential.',
    'Yes.',
    'Budget 500000.',
    'Maybe.',
    'Cannot disclose.',
    'Private.',
    'Phone.',
    'Email.',
    'Country.',
    'Within 3 months.',
    'I cannot disclose.',
    'I prefer not to say.',
    'That is confidential.',
    'We do not have one.',
    'My company is a company in UAE.',
    '500 sqm.',
    `${'A'.repeat(161)}.`,
  ])('does not infer a sentence fragment as a prompted company reply in %s', (content) => {
    const session = sessionWith('en', content)
    session.qualificationState = { askedFields: ['company'], roundCount: 1 }

    expect(extractLeadSignals(session).company).toBeUndefined()
  })

  it('bounds a prompted company answer before another qualification phrase', () => {
    const session = sessionWith('en', 'Acme and we need panels.')
    session.qualificationState = { askedFields: ['company'], roundCount: 1 }

    expect(extractLeadSignals(session).company).toBe('Acme')
  })

  it('accepts a title-cased multi-word bare answer after explicitly asking for company', () => {
    const session = sessionWith('en', 'Blue Horizon.')
    session.qualificationState = { askedFields: ['company'], roundCount: 1 }

    expect(extractLeadSignals(session).company).toBe('Blue Horizon')
    expect(extractLeadSignals(sessionWith('en', 'My company is Blue Horizon.')).company).toBe(
      'Blue Horizon',
    )
  })

  it('accepts title-cased and acronym bare English brands only after the company prompt', () => {
    const acronym = sessionWith('en', 'IVYBM.')
    acronym.qualificationState = { askedFields: ['company'], roundCount: 1 }
    const titleCase = sessionWith('en', 'Alcoa.')
    titleCase.qualificationState = { askedFields: ['company'], roundCount: 1 }

    expect(extractLeadSignals(acronym).company).toBe('IVYBM')
    expect(extractLeadSignals(titleCase).company).toBe('Alcoa')
    expect(extractLeadSignals(sessionWith('en', 'IVYBM.')).company).toBeUndefined()
    expect(extractLeadSignals(sessionWith('en', 'Alcoa.')).company).toBeUndefined()
    expect(extractLeadSignals(sessionWith('en', 'My company is Alcoa.')).company).toBe('Alcoa')
    expect(extractLeadSignals(sessionWith('en', 'I work at IVYBM.')).company).toBe('IVYBM')
  })

  it('does not reject a legitimate company merely because a later word resembles refusal text', () => {
    const session = sessionWith('en', 'Waste Refuse LLC.')
    session.qualificationState = { askedFields: ['company'], roundCount: 1 }

    expect(extractLeadSignals(session).company).toBe('Waste Refuse LLC')
  })

  it('extracts a grouped prompted company and country answer before later qualification details', () => {
    const session = sessionWith(
      'en',
      'Acme Facades from UAE. It is a tender for 1,200 sqm within 3 months.',
    )
    session.qualificationState = { askedFields: ['country', 'company'], roundCount: 1 }

    expect(extractLeadSignals(session).company).toBe('Acme Facades')
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
      'I work at my company in UAE.',
      'I am from sales team.',
      'My company is a company.',
      'My company is a factory office.',
      'My company is a company in UAE.',
      'My company is my company in UAE.',
      'My company is and we need aluminum panels.',
      'I work at in UAE.',
      'I am from a workplace.',
    ]) {
      expect(extractLeadSignals(sessionWith('en', content)).company).toBeUndefined()
    }
  })

  it.each([
    'I work at my company.',
    'I work at my company in UAE.',
    'We work at our company.',
    'I work at company.',
    'I work at the business.',
    'I work at our team.',
    'I work at my office in UAE.',
  ])('does not reinterpret a generic sentence after asking the company field in %s', (content) => {
    const session = sessionWith('en', content)
    session.qualificationState = { askedFields: ['company'], roundCount: 1 }

    expect(extractLeadSignals(session).company).toBeUndefined()
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

  it('extracts a bare Arabic company reply after the company field was asked', () => {
    const session = sessionWith('ar', 'النور.')
    session.qualificationState = { askedFields: ['company'], roundCount: 1 }

    expect(extractLeadSignals(session).company).toBe('النور')
  })

  it.each(['نور.', 'الصحراء للألمنيوم.', 'النور للتجارة.'])(
    'extracts a bounded Arabic proper-name reply after the company field was asked in %s',
    (content) => {
      const session = sessionWith('ar', content)
      session.qualificationState = { askedFields: ['company'], roundCount: 1 }

      expect(extractLeadSignals(session).company).toBe(content.slice(0, -1))
      expect(extractLeadSignals(sessionWith('ar', content)).company).toBeUndefined()
    },
  )

  it('uses a bare Arabic prompted company reply in the authoritative evaluation', async () => {
    const session = sessionWith(
      'ar',
      'نحتاج 1200 متر مربع من الألواح في السعودية ومرحلة المشروع مناقصة خلال 3 أشهر. الرسومات جاهزة. الميزانية 300000 ريال. البريد sales@example.invalid.',
    )
    session.messages.push({
      author: 'visitor',
      content: 'النور.',
      createdAt: '2026-08-12T00:01:00.000Z',
      id: 'message-ar-2',
      status: 'sent',
    })
    session.qualificationState = { askedFields: ['company'], roundCount: 1 }

    const evaluation = await new PayloadConversationLeadSink().evaluate(session)

    expect(evaluation.signals.company).toBe('النور')
    expect(evaluation.score.missingFields).not.toContain('company')
    expect(evaluation.score.reasons).toContain('company_identified')
  })

  it.each([
    'السعودية.',
    'لا أعرف.',
    'ليس لدينا اسم.',
    'أفضل عدم القول.',
    'أرفض.',
    'تخطي.',
    'الرفض.',
    'السرية.',
    'الخاص.',
    'المجهول.',
    'التخطي.',
    'الامتناع.',
    'في السعودية.',
    'المشروع مناقصة.',
  ])('does not infer a generic Arabic prompted company reply in %s', (content) => {
    const session = sessionWith('ar', content)
    session.qualificationState = { askedFields: ['company'], roundCount: 1 }

    expect(extractLeadSignals(session).company).toBeUndefined()
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
