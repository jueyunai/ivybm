import type { Payload, RequiredDataFromCollectionSlug } from 'payload'

const DEMO_NOTICE = 'DEMO ONLY — this is synthetic local acceptance data, not a customer-approved fact.'

export const KNOWLEDGE_DEMO_DOCUMENTS = [
  {
    content: `${DEMO_NOTICE}\n\nThe demo catalog distinguishes solid, single-curved, and double-curved aluminum panel enquiries. Final alloy grade, thickness, dimensions, tolerance, finish, and quantity must be confirmed against project drawings.`,
    sourceTitle: '[DEMO] Product enquiry scope',
    sourceType: 'product-manual' as const,
  },
  {
    content: `${DEMO_NOTICE}\n\nBefore preparing a quotation, collect the destination country, project type, requested product, drawings, dimensions, quantity, surface finish, destination port, required date, company name, and contact details. Pricing is always confirmed by sales.`,
    sourceTitle: '[DEMO] Quotation information checklist',
    sourceType: 'sales-script' as const,
  },
  {
    content: `${DEMO_NOTICE}\n\nA customization request starts with drawings and application requirements. Engineering reviews geometry, tolerances, fixing details, finish, and production feasibility before any specification is treated as confirmed.`,
    sourceTitle: '[DEMO] Customization review workflow',
    sourceType: 'technical-specification' as const,
  },
  {
    content: `${DEMO_NOTICE}\n\nFor sample enquiries, collect the product type, intended finish, target dimensions, application, destination, and required date. Sample availability, cost, freight, and lead time require manual confirmation.`,
    sourceTitle: '[DEMO] Sample request workflow',
    sourceType: 'faq' as const,
  },
  {
    content: `${DEMO_NOTICE}\n\nPackaging recommendations depend on panel geometry, finish protection, quantity, transport mode, and destination. The final packing method and loading plan are confirmed for each order and must not be promised by the AI assistant.`,
    sourceTitle: '[DEMO] Packaging information boundary',
    sourceType: 'faq' as const,
  },
  {
    content: `${DEMO_NOTICE}\n\nQuestions about price, discount, delivery date, payment terms, certification applicability, warranty, complaints, or contract commitments must be transferred to a human operator. The AI assistant may collect context but must not make a commitment.`,
    sourceTitle: '[DEMO] Mandatory human handoff policy',
    sourceType: 'sales-script' as const,
  },
] as const

const promptData = {
  key: 'demo.customer-chat',
  locale: 'all' as const,
  purpose: 'customer-chat' as const,
  status: 'active' as const,
  template:
    'Answer concisely in the customer language. Use only reviewed knowledge supplied in the context, cite the relevant source, ask for missing project details when needed, and never invent specifications or commercial commitments.',
  version: 1,
}

const seedContext = { skipAudit: true }

export const seedKnowledgeDemo = async (payload: Payload): Promise<void> => {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Knowledge DEMO seed is forbidden in production')
  }

  for (const demo of KNOWLEDGE_DEMO_DOCUMENTS) {
    const existing = await payload.find({
      collection: 'knowledge-documents',
      limit: 1,
      overrideAccess: true,
      where: { sourceTitle: { equals: demo.sourceTitle } },
    })
    const data = {
      content: demo.content,
      customerVisible: true,
      locale: 'en' as const,
      reviewStatus: 'reviewed' as const,
      sourceTitle: demo.sourceTitle,
      sourceType: demo.sourceType,
      sourceVersion: 'demo-2026.07-v1',
    }
    const current = existing.docs[0]
    if (!current) {
      await payload.create({
        collection: 'knowledge-documents',
        context: seedContext,
        data: {
          ...data,
          indexStatus: 'pending',
        } satisfies RequiredDataFromCollectionSlug<'knowledge-documents'>,
        overrideAccess: true,
      })
      continue
    }
    await payload.update({
      collection: 'knowledge-documents',
      context: seedContext,
      data,
      id: current.id,
      overrideAccess: true,
    })
    await payload.update({
      collection: 'knowledge-documents',
      context: seedContext,
      data: { reviewStatus: 'reviewed' },
      id: current.id,
      overrideAccess: true,
    })
  }

  const activePrompt = await payload.find({
    collection: 'prompt-templates',
    limit: 1,
    overrideAccess: true,
    where: {
      and: [
        { purpose: { equals: 'customer-chat' } },
        { status: { equals: 'active' } },
        { or: [{ locale: { equals: 'en' } }, { locale: { equals: 'all' } }] },
      ],
    },
  })
  if (activePrompt.totalDocs === 0) {
    const existingDemoPrompt = await payload.find({
      collection: 'prompt-templates',
      limit: 1,
      overrideAccess: true,
      where: {
        and: [
          { key: { equals: promptData.key } },
          { locale: { equals: promptData.locale } },
          { version: { equals: promptData.version } },
        ],
      },
    })
    const currentPrompt = existingDemoPrompt.docs[0]
    if (currentPrompt) {
      await payload.update({
        collection: 'prompt-templates',
        context: seedContext,
        data: promptData,
        id: currentPrompt.id,
        overrideAccess: true,
      })
    } else {
      await payload.create({
        collection: 'prompt-templates',
        context: seedContext,
        data: promptData,
        overrideAccess: true,
      })
    }
  }

  payload.logger.info(
    `Seeded ${KNOWLEDGE_DEMO_DOCUMENTS.length} local DEMO knowledge documents and ensured a customer-chat prompt`,
  )
}
