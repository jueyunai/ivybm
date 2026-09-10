import { createLocalReq, type Payload, type RequiredDataFromCollectionSlug } from 'payload'

import {
  createContentStudioDraft,
  reviewContentStudioDraft,
  submitContentStudioReview,
  type ContentStudioPayload,
} from '../admin-portal/modules/content-studio/contentStudioCommands'
import type { User } from '../payload-types'

const portalDemoContext = { skipAudit: true, skipFeishuSync: true }

export async function seedPortalDemo(payload: Payload): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Portal DEMO seed is forbidden in production')
  }

  payload.logger.info('Starting portal demo data seeding...')

  // 1. Lead Sources & Leads
  let websiteSource = (
    await payload.find({
      collection: 'lead-sources',
      where: { key: { equals: 'website' } },
      limit: 1,
      overrideAccess: true,
    })
  ).docs[0]

  if (!websiteSource) {
    websiteSource = await payload.create({
      collection: 'lead-sources',
      context: portalDemoContext,
      data: { name: '官网询盘 (Website)', key: 'website', channel: 'manual', isActive: true },
      overrideAccess: true,
    })
  }

  let chatSource = (
    await payload.find({
      collection: 'lead-sources',
      where: { key: { equals: 'ai-chat' } },
      limit: 1,
      overrideAccess: true,
    })
  ).docs[0]

  if (!chatSource) {
    chatSource = await payload.create({
      collection: 'lead-sources',
      context: portalDemoContext,
      data: { name: 'AI 对话 (AI Chat)', key: 'ai-chat', channel: 'manual', isActive: true },
      overrideAccess: true,
    })
  }

  const demoLeads = [
    {
      name: 'Ahmed Al-Mansoor',
      company: 'Dubai Construction Group',
      email: 'ahmed@dcg.ae',
      phone: '+971 50 123 4567',
      country: 'United Arab Emirates',
      interest: 'Aluminum Decorative Screen',
      message:
        'Need 500 sqm decorative screen panels for luxury hotel facade project in Downtown Dubai.',
      status: 'new' as const,
      intentLevel: 'a' as const,
      locale: 'en' as const,
      source: websiteSource.id,
      projectStage: 'tender',
      quantitySquareMeters: 500,
      budget: 'USD 50,000 - 100,000',
      timeline: 'Q4 2026',
      hasDrawings: true,
    },
    {
      name: 'Rashid Khalifa',
      company: 'Riyadh Commercial Tower',
      email: 'rashid@rct.sa',
      phone: '+966 55 987 6543',
      country: 'Saudi Arabia',
      interest: 'Aluminum Baffle Ceiling',
      message: 'Looking for acoustic baffle ceiling for corporate headquarters lobby.',
      status: 'contacted' as const,
      intentLevel: 'b' as const,
      locale: 'en' as const,
      source: chatSource.id,
      projectStage: 'design',
      quantitySquareMeters: 1200,
      budget: 'USD 80,000',
      timeline: 'Q1 2027',
    },
    {
      name: 'Sarah Jenkins',
      company: 'Apex Facades Ltd',
      email: 's.jenkins@apexfacades.co.uk',
      phone: '+44 20 7946 0912',
      country: 'United Kingdom',
      interest: 'Solid Aluminum Cladding',
      message: 'Require CWCT tested solid aluminum facade panels for commercial retrofit.',
      status: 'qualified' as const,
      intentLevel: 'a' as const,
      locale: 'en' as const,
      source: websiteSource.id,
      projectStage: 'tender',
      quantitySquareMeters: 2500,
      budget: 'USD 150,000+',
      hasDrawings: true,
    },
    {
      name: 'Omar Fayed',
      company: 'Cairo Metro Project Office',
      email: 'omar.fayed@cairometro.gov.eg',
      phone: '+20 10 2345 6789',
      country: 'Egypt',
      interest: 'Expanded Metal Mesh',
      message: 'Ventilation and decorative mesh for subway stations.',
      status: 'new' as const,
      intentLevel: 'c' as const,
      locale: 'en' as const,
      source: chatSource.id,
      projectStage: 'concept',
      quantitySquareMeters: 300,
    },
    {
      name: 'Tariq Al-Sabah',
      company: 'Kuwait Modern Architecture',
      email: 'tariq@kma.kw',
      phone: '+965 9876 5432',
      country: 'Kuwait',
      interest: 'Aluminum Honeycomb Panel',
      message: 'Lightweight honeycomb panels for high-rise exterior cladding.',
      status: 'contacted' as const,
      intentLevel: 'a' as const,
      locale: 'ar' as const,
      source: websiteSource.id,
      projectStage: 'construction',
      quantitySquareMeters: 1800,
    },
  ]

  for (let i = 0; i < demoLeads.length; i++) {
    const lead = demoLeads[i]
    const idempotencyKey = `idemp-lead-seed-${i + 1}`
    const existing = await payload.find({
      collection: 'leads',
      limit: 1,
      overrideAccess: true,
      where: { idempotencyKey: { equals: idempotencyKey } },
    })
    if (existing.totalDocs === 0) {
      await payload.create({
        collection: 'leads',
        context: portalDemoContext,
        data: {
          ...lead,
          requestId: `req-lead-seed-${i + 1}`,
          idempotencyKey,
        },
        overrideAccess: true,
      })
    }
  }
  payload.logger.info(`Ensured ${demoLeads.length} demo leads.`)

  // 2. Visitor Sessions & Conversations
  const expiresAt = new Date(Date.now() + 30 * 86400000).toISOString()
  const now = new Date().toISOString()
  const ensureVisitorSession = async (data: RequiredDataFromCollectionSlug<'visitor-sessions'>) => {
    const existing = await payload.find({
      collection: 'visitor-sessions',
      limit: 1,
      overrideAccess: true,
      where: { publicId: { equals: data.publicId } },
    })
    return (
      existing.docs[0] ??
      (await payload.create({
        collection: 'visitor-sessions',
        context: portalDemoContext,
        data,
        overrideAccess: true,
      }))
    )
  }
  const ensureConversation = async (data: RequiredDataFromCollectionSlug<'conversations'>) => {
    const existing = await payload.find({
      collection: 'conversations',
      limit: 1,
      overrideAccess: true,
      where: { publicId: { equals: data.publicId } },
    })
    return (
      existing.docs[0] ??
      (await payload.create({
        collection: 'conversations',
        context: portalDemoContext,
        data,
        overrideAccess: true,
      }))
    )
  }
  const ensureMessage = async (data: RequiredDataFromCollectionSlug<'messages'>) => {
    const existing = await payload.find({
      collection: 'messages',
      limit: 1,
      overrideAccess: true,
      where: { idempotencyKey: { equals: data.idempotencyKey } },
    })
    if (existing.totalDocs === 0) {
      await payload.create({
        collection: 'messages',
        context: portalDemoContext,
        data,
        overrideAccess: true,
      })
    }
  }

  const session1 = await ensureVisitorSession({
    channel: 'website',
    expiresAt,
    idempotencyKey: 'idemp-vs-1',
    lastSeenAt: now,
    locale: 'en',
    publicId: 'vs-website-demo-1',
    sessionTokenHash: 'hash-vs-1',
  })
  const session2 = await ensureVisitorSession({
    channel: 'facebook',
    expiresAt,
    idempotencyKey: 'idemp-vs-2',
    lastSeenAt: now,
    locale: 'en',
    publicId: 'vs-facebook-demo-2',
    sessionTokenHash: 'hash-vs-2',
  })
  const session3 = await ensureVisitorSession({
    channel: 'instagram',
    expiresAt,
    idempotencyKey: 'idemp-vs-3',
    lastSeenAt: now,
    locale: 'ar',
    publicId: 'vs-instagram-demo-3',
    sessionTokenHash: 'hash-vs-3',
  })
  const conv1 = await ensureConversation({
    channel: 'website',
    handoffStatus: 'ai_active',
    intentLevel: 'a',
    locale: 'en',
    publicId: 'conv-001',
    requestId: 'req-conv-001',
    revision: 1,
    visitorSession: session1.id,
  })
  const conv2 = await ensureConversation({
    channel: 'facebook',
    handoffStatus: 'ai_active',
    intentLevel: 'a',
    locale: 'en',
    publicId: 'conv-002',
    requestId: 'req-conv-002',
    revision: 1,
    visitorSession: session2.id,
  })
  await ensureConversation({
    channel: 'instagram',
    handoffStatus: 'ai_active',
    intentLevel: 'b',
    locale: 'ar',
    publicId: 'conv-003',
    requestId: 'req-conv-003',
    revision: 1,
    visitorSession: session3.id,
  })
  await ensureMessage({
    author: 'visitor',
    content:
      'Hello, do you supply perforated aluminum facade panels for exterior cladding in Dubai?',
    conversation: conv1.id,
    idempotencyKey: 'idemp-msg-1-1',
    requestId: 'req-msg-001-1',
    status: 'sent',
  })
  await ensureMessage({
    author: 'ai',
    content:
      'Yes! We specialize in customized architectural aluminum panels including perforated facades with PVDF coating tested for high-temperature Middle East climates. What panel thickness are you looking for?',
    conversation: conv1.id,
    idempotencyKey: 'idemp-msg-1-2',
    requestId: 'req-msg-001-2',
    status: 'sent',
  })
  await ensureMessage({
    author: 'visitor',
    content:
      'Hi, I need an urgent quotation for 1,500 sqm aluminum baffle ceilings with wood grain finish. Can I speak with an engineer?',
    conversation: conv2.id,
    idempotencyKey: 'idemp-msg-2-1',
    requestId: 'req-msg-002-1',
    status: 'sent',
  })
  await ensureMessage({
    author: 'ai',
    content:
      'Thank you for reaching out! We provide realistic sublimation wood-grain baffle ceilings. Let me transfer you to our architectural sales specialist to prepare a detailed quotation.',
    conversation: conv2.id,
    idempotencyKey: 'idemp-msg-2-2',
    requestId: 'req-msg-002-2',
    status: 'sent',
  })
  payload.logger.info('Ensured 3 demo conversations and messages.')

  // 3. Generated Contents (AI 内容工作台)
  const adminUser = (await payload.find({ collection: 'users', limit: 1, overrideAccess: true }))
    .docs[0]
  if (!adminUser) throw new Error('Portal DEMO seed requires an administrator')
  const contentReq = await createLocalReq(
    { user: { ...adminUser, collection: 'users' } as User },
    payload,
  )
  const contentPayload = payload as unknown as ContentStudioPayload
  const demoContents = [
    {
      body: 'From iconic architectural landmarks to demanding commercial towers, our custom aluminum facade panels deliver exceptional wind-load resistance and enduring PVDF finishes.\n\n#Architecture #FacadeEngineering #BuildingMaterials #DubaiConstruction #AluminumCladding',
      contentLocale: 'en' as const,
      contentType: 'post' as const,
      platform: 'linkedin' as const,
      status: 'approved' as const,
      title: 'Dubai Metro Station Aluminum Cladding Case Study',
    },
    {
      body: 'Experience the warm aesthetics of natural timber combined with the durability, fire rating (Class A1), and low maintenance of aluminum.\n\nIdeal for airport terminals, commercial atriums, and hospitality projects.\n\n#InteriorDesign #BaffleCeiling #CommercialArchitecture #AcousticCeiling',
      contentLocale: 'en' as const,
      contentType: 'post' as const,
      platform: 'facebook' as const,
      status: 'review' as const,
      title: 'Wood-Grain Aluminum Baffle Ceiling Technical Guide',
    },
    {
      body: 'Designing facades in the Gulf region requires meticulous engineering for thermal expansion, sand erosion, and extreme solar irradiance.\n\nIn this technical brief, we analyze perforated solid aluminum versus expanded mesh systems.',
      contentLocale: 'en' as const,
      contentType: 'long-form' as const,
      platform: 'linkedin' as const,
      status: 'draft' as const,
      title: 'Architectural Perforated Panels: Wind Load & Corrosion Resistance in GCC',
    },
    {
      body: 'Sleek, geometric, and acoustically optimized. Explore our latest grid ceiling collection manufactured for modern corporate headquarters.',
      contentLocale: 'en' as const,
      contentType: 'post' as const,
      platform: 'instagram' as const,
      status: 'draft' as const,
      title: 'Modern Minimalist Ceiling Solutions for Commercial Spaces',
    },
  ]

  for (let i = 0; i < demoContents.length; i++) {
    const content = demoContents[i]
    let current = (
      await createContentStudioDraft({
        input: {
          assets: [],
          body: content.body,
          contentLocale: content.contentLocale,
          contentType: content.contentType,
          idempotencyKey: `portal-content-studio:demo-${i + 1}`,
          knowledgeSources: [],
          platform: content.platform,
          sourceReferences: [],
          title: content.title,
        },
        payload: contentPayload,
        req: contentReq,
      })
    ).content
    if (current.status === 'draft' && content.status !== 'draft') {
      current = await submitContentStudioReview({
        id: Number(current.id),
        input: { updatedAt: current.updatedAt },
        payload: contentPayload,
        req: contentReq,
      })
    }
    if (current.status === 'review' && content.status === 'approved') {
      current = await reviewContentStudioDraft({
        id: Number(current.id),
        input: {
          checklist: {
            arabicProofread: true,
            factsTraceable: true,
            noCommercialCommitment: true,
            platformFormatChecked: true,
            technicalClaimsChecked: true,
          },
          comments: 'Synthetic local demonstration content reviewed through the Portal workflow.',
          decision: 'approved',
          updatedAt: current.updatedAt,
        },
        payload: contentPayload,
        req: contentReq,
      })
    }
  }
  payload.logger.info(`Ensured ${demoContents.length} demo generated contents.`)
  // 4. Platform Accounts (平台账号待授权占位)
  const demoPlatformAccounts = [
    {
      name: 'IVY Building Materials (官方主页)',
      accountKind: 'facebook-page' as const,
      platformFamily: 'meta' as const,
      externalAccountId: '108472910384721',
      authorization: {
        state: 'not_started' as const,
        appId: '108472910384721',
        accessTokenConfigured: false,
        refreshTokenConfigured: false,
      },
      authorizationRevision: 0,
      capabilities: {
        messagingInbound: 'not_started' as const,
        publishing: 'not_started' as const,
      },
      aiAutoReplyEnabled: false,
      notes: 'Meta Facebook 官方企业主页，用于品牌展示与客户询盘接入。',
    },
    {
      name: '@ivybm_architectural (Instagram 商业号)',
      accountKind: 'instagram-professional' as const,
      platformFamily: 'meta' as const,
      externalAccountId: '178414002938471',
      messagingExternalAccountId: '178414002938471',
      authorization: {
        state: 'not_started' as const,
        appId: '178414002938471',
        accessTokenConfigured: false,
        refreshTokenConfigured: false,
      },
      authorizationRevision: 0,
      capabilities: {
        messagingInbound: 'not_started' as const,
        publishing: 'not_started' as const,
      },
      aiAutoReplyEnabled: false,
      notes: 'Instagram 官方品牌视觉账号，同步建筑幕墙工程案例贴文与私信。',
    },
    {
      name: 'IVY Building Materials Global (领英机构主页)',
      accountKind: 'linkedin-organization' as const,
      platformFamily: 'linkedin' as const,
      externalAccountId: 'urn:li:organization:98273641',
      authorization: {
        state: 'not_started' as const,
        appId: 'urn:li:organization:98273641',
        accessTokenConfigured: false,
        refreshTokenConfigured: false,
      },
      authorizationRevision: 0,
      capabilities: {
        messagingInbound: 'not_started' as const,
        publishing: 'not_started' as const,
      },
      aiAutoReplyEnabled: false,
      notes: 'LinkedIn B2B 行业客户与海外采购总包机构账号，发布工程白皮书与技术案例。',
    },
    {
      name: '@ivybm_official (TikTok 企业号)',
      accountKind: 'tiktok-business' as const,
      platformFamily: 'tiktok' as const,
      externalAccountId: 'tiktok_ivybm_7829',
      authorization: {
        state: 'not_started' as const,
      },
      authorizationRevision: 0,
      capabilities: {
        messagingInbound: 'not_started' as const,
        publishing: 'not_started' as const,
      },
      aiAutoReplyEnabled: false,
      notes: 'TikTok 视频营销账号，授权流程待配置。',
    },
  ] satisfies RequiredDataFromCollectionSlug<'platform-accounts'>[]

  for (const account of demoPlatformAccounts) {
    const existing = await payload.find({
      collection: 'platform-accounts',
      limit: 1,
      overrideAccess: true,
      where: { externalAccountId: { equals: account.externalAccountId } },
    })
    if (existing.totalDocs === 0) {
      try {
        await payload.create({
          collection: 'platform-accounts',
          context: { ...portalDemoContext, __platformMessagingIdentityWrite: true },
          data: account,
          overrideAccess: true,
        })
      } catch (err) {
        payload.logger.warn(`Failed to seed platform account ${account.name}: ${err}`)
      }
    }
  }
  payload.logger.info(`Ensured ${demoPlatformAccounts.length} demo platform accounts.`)

  payload.logger.info('Portal demo data seeding completed.')
}
