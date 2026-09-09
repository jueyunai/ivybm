import type { Payload } from 'payload'

export async function seedPortalDemo(payload: Payload): Promise<void> {
  payload.logger.info('Starting portal demo data seeding...')

  // 1. Lead Sources & Leads
  let websiteSource = (await payload.find({
    collection: 'lead-sources',
    where: { key: { equals: 'website' } },
    limit: 1,
    overrideAccess: true,
  })).docs[0]

  if (!websiteSource) {
    websiteSource = await payload.create({
      collection: 'lead-sources',
      data: { name: '官网询盘 (Website)', key: 'website', channel: 'manual', isActive: true },
      overrideAccess: true,
    })
  }

  let chatSource = (await payload.find({
    collection: 'lead-sources',
    where: { key: { equals: 'ai-chat' } },
    limit: 1,
    overrideAccess: true,
  })).docs[0]

  if (!chatSource) {
    chatSource = await payload.create({
      collection: 'lead-sources',
      data: { name: 'AI 对话 (AI Chat)', key: 'ai-chat', channel: 'manual', isActive: true },
      overrideAccess: true,
    })
  }

  const existingLeads = await payload.find({ collection: 'leads', limit: 1, overrideAccess: true })
  if (existingLeads.totalDocs === 0) {
    const demoLeads = [
      {
        name: 'Ahmed Al-Mansoor',
        company: 'Dubai Construction Group',
        email: 'ahmed@dcg.ae',
        phone: '+971 50 123 4567',
        country: 'United Arab Emirates',
        interest: 'Aluminum Decorative Screen',
        message: 'Need 500 sqm decorative screen panels for luxury hotel facade project in Downtown Dubai.',
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
      await payload.create({
        collection: 'leads',
        data: {
          ...lead,
          requestId: `req-lead-seed-${i + 1}`,
          idempotencyKey: `idemp-lead-seed-${i + 1}`,
        },
        overrideAccess: true,
      })
    }
    payload.logger.info(`Seeded ${demoLeads.length} demo leads.`)
  }

  // 2. Visitor Sessions & Conversations
  const existingConv = await payload.find({ collection: 'conversations', limit: 1, overrideAccess: true })
  if (existingConv.totalDocs === 0) {
    const expiresAt = new Date(Date.now() + 30 * 86400000).toISOString()
    const now = new Date().toISOString()

    const session1 = await payload.create({
      collection: 'visitor-sessions',
      data: {
        channel: 'website',
        expiresAt,
        idempotencyKey: 'idemp-vs-1',
        lastSeenAt: now,
        locale: 'en',
        publicId: 'vs-website-demo-1',
        sessionTokenHash: 'hash-vs-1',
      },
      overrideAccess: true,
    })

    const session2 = await payload.create({
      collection: 'visitor-sessions',
      data: {
        channel: 'facebook',
        expiresAt,
        idempotencyKey: 'idemp-vs-2',
        lastSeenAt: now,
        locale: 'en',
        publicId: 'vs-facebook-demo-2',
        sessionTokenHash: 'hash-vs-2',
      },
      overrideAccess: true,
    })

    const session3 = await payload.create({
      collection: 'visitor-sessions',
      data: {
        channel: 'instagram',
        expiresAt,
        idempotencyKey: 'idemp-vs-3',
        lastSeenAt: now,
        locale: 'ar',
        publicId: 'vs-instagram-demo-3',
        sessionTokenHash: 'hash-vs-3',
      },
      overrideAccess: true,
    })

    const conv1 = await payload.create({
      collection: 'conversations',
      data: {
        channel: 'website',
        handoffStatus: 'ai_active',
        intentLevel: 'a',
        locale: 'en',
        publicId: 'conv-001',
        requestId: 'req-conv-001',
        revision: 1,
        visitorSession: session1.id,
      },
      overrideAccess: true,
    })

    const conv2 = await payload.create({
      collection: 'conversations',
      data: {
        channel: 'facebook',
        handoffStatus: 'handoff_requested',
        intentLevel: 'a',
        locale: 'en',
        publicId: 'conv-002',
        requestId: 'req-conv-002',
        revision: 1,
        visitorSession: session2.id,
      },
      overrideAccess: true,
    })

    const conv3 = await payload.create({
      collection: 'conversations',
      data: {
        channel: 'instagram',
        handoffStatus: 'resolved',
        intentLevel: 'b',
        locale: 'ar',
        publicId: 'conv-003',
        requestId: 'req-conv-003',
        revision: 1,
        visitorSession: session3.id,
      },
      overrideAccess: true,
    })

    // Seed Messages
    await payload.create({
      collection: 'messages',
      data: {
        author: 'visitor',
        content: 'Hello, do you supply perforated aluminum facade panels for exterior cladding in Dubai?',
        conversation: conv1.id,
        idempotencyKey: 'idemp-msg-1-1',
        requestId: 'req-msg-001-1',
        status: 'sent',
      },
      overrideAccess: true,
    })

    await payload.create({
      collection: 'messages',
      data: {
        author: 'ai',
        content: 'Yes! We specialize in customized architectural aluminum panels including perforated facades with PVDF coating tested for high-temperature Middle East climates. What panel thickness are you looking for?',
        conversation: conv1.id,
        idempotencyKey: 'idemp-msg-1-2',
        requestId: 'req-msg-001-2',
        status: 'sent',
      },
      overrideAccess: true,
    })

    await payload.create({
      collection: 'messages',
      data: {
        author: 'visitor',
        content: 'Hi, I need an urgent quotation for 1,500 sqm aluminum baffle ceilings with wood grain finish. Can I speak with an engineer?',
        conversation: conv2.id,
        idempotencyKey: 'idemp-msg-2-1',
        requestId: 'req-msg-002-1',
        status: 'sent',
      },
      overrideAccess: true,
    })

    await payload.create({
      collection: 'messages',
      data: {
        author: 'ai',
        content: 'Thank you for reaching out! We provide realistic sublimation wood-grain baffle ceilings. Let me transfer you to our architectural sales specialist to prepare a detailed quotation.',
        conversation: conv2.id,
        idempotencyKey: 'idemp-msg-2-2',
        requestId: 'req-msg-002-2',
        status: 'sent',
      },
      overrideAccess: true,
    })

    payload.logger.info('Seeded 3 demo conversations and messages.')
  }

  // 3. Jobs (后台任务)
  const existingJobs = await payload.find({ collection: 'jobs', limit: 1, overrideAccess: true })
  if (existingJobs.totalDocs === 0) {
    const demoJobs = [
      {
        attempts: 1,
        completedAt: new Date().toISOString(),
        maxAttempts: 5,
        payload: { leadId: 1, target: 'feishu-crm' },
        status: 'succeeded' as const,
        type: 'feishu.lead.sync',
      },
      {
        attempts: 1,
        completedAt: new Date().toISOString(),
        maxAttempts: 5,
        payload: { documentId: 1, model: 'text-embedding-3-small' },
        status: 'succeeded' as const,
        type: 'knowledge.document.embed',
      },
      {
        attempts: 1,
        maxAttempts: 3,
        payload: { contentId: 1, platform: 'facebook' },
        status: 'processing' as const,
        type: 'platform.publish.facebook',
      },
      {
        attempts: 0,
        maxAttempts: 5,
        payload: { filename: 'facade-rendering.jpg', source: 'portal' },
        status: 'pending' as const,
        type: 'media.asset.process',
      },
      {
        attempts: 3,
        lastError: 'Platform access token expired (OAuth code 190). Please reauthorize the account in Platform Readiness.',
        maxAttempts: 3,
        payload: { channel: 'instagram', messageId: 3 },
        status: 'failed' as const,
        type: 'social.message.outbound',
      },
    ]

    for (const job of demoJobs) {
      await payload.create({
        collection: 'jobs',
        data: job as any,
        overrideAccess: true,
      })
    }
    payload.logger.info(`Seeded ${demoJobs.length} demo jobs.`)
  }

  // 4. Generated Contents (AI 内容工作台)
  const existingContents = await payload.find({ collection: 'generated-contents', limit: 1, overrideAccess: true })
  if (existingContents.totalDocs === 0) {
    const adminUser = (await payload.find({ collection: 'users', limit: 1, overrideAccess: true })).docs[0]
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
        contentType: 'carousel' as const,
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
      await payload.create({
        collection: 'generated-contents',
        context: { portalContentStudioCommand: true },
        data: {
          ...content,
          idempotencyKey: `idemp-gc-${i + 1}`,
          creationFingerprint: `fp-gc-${i + 1}`,
          createdBy: adminUser?.id,
          reviewedBy: content.status === 'approved' ? adminUser?.id : undefined,
          reviewedAt: content.status === 'approved' ? new Date().toISOString() : undefined,
        },
        overrideAccess: true,
      })
    }
    payload.logger.info(`Seeded ${demoContents.length} demo generated contents.`)
  }


  // 5. Team Members (团队成员账号)
  const existingUsers = await payload.find({ collection: "users", limit: 10, overrideAccess: true });
  if (existingUsers.totalDocs <= 1) {
    const demoMembers = [
      {
        email: "operator_content",
        password: "Password123!Ivybm",
        role: "operator" as const,
        permissions: {
          conversations: { edit: false, view: true },
          leads: { edit: false, view: true },
          content: { edit: true, view: true },
          media: { edit: true, view: true },
          contentStudio: { edit: true, view: true },
          knowledge: { edit: false, view: true },
          platforms: { edit: false, view: false },
          operations: { edit: false, view: false },
          settings: { edit: false, view: false },
        },
      },
      {
        email: "sales_mena",
        password: "Password123!Ivybm",
        role: "sales" as const,
        permissions: {
          conversations: { edit: true, view: true },
          leads: { edit: true, view: true },
          content: { edit: false, view: false },
          media: { edit: false, view: false },
          contentStudio: { edit: false, view: false },
          knowledge: { edit: false, view: false },
          platforms: { edit: false, view: false },
          operations: { edit: false, view: false },
          settings: { edit: false, view: false },
        },
      },
      {
        email: "operator_ai",
        password: "Password123!Ivybm",
        role: "operator" as const,
        permissions: {
          conversations: { edit: false, view: true },
          leads: { edit: false, view: false },
          content: { edit: false, view: false },
          media: { edit: false, view: false },
          contentStudio: { edit: true, view: true },
          knowledge: { edit: true, view: true },
          platforms: { edit: false, view: true },
          operations: { edit: true, view: true },
          settings: { edit: false, view: false },
        },
      },
      {
        email: "audit_lead",
        password: "Password123!Ivybm",
        role: "sales" as const,
        permissions: {
          conversations: { edit: false, view: true },
          leads: { edit: false, view: true },
          content: { edit: false, view: false },
          media: { edit: false, view: false },
          contentStudio: { edit: false, view: false },
          knowledge: { edit: false, view: false },
          platforms: { edit: false, view: false },
          operations: { edit: false, view: false },
          settings: { edit: false, view: false },
        },
      },
    ];

    for (const member of demoMembers) {
      try {
        await payload.create({
          collection: "users",
          data: member as any,
          overrideAccess: true,
        });
      } catch (err) {
        payload.logger.warn(`Failed to seed user ${member.email}: ${err}`);
      }
    }
    payload.logger.info(`Seeded ${demoMembers.length} demo team members.`);
  }

  // 6. Platform Accounts (平台账号)
  const existingPlatforms = await payload.find({ collection: "platform-accounts", limit: 1, overrideAccess: true });
  if (existingPlatforms.totalDocs === 0) {
    let mockToken = "";
    let mockRefreshToken = "";
    try {
      const { readPlatformCredentialEncryptionKey, encryptPlatformCredential } = await import(
        "@/modules/platforms/credentials"
      );
      const encKey = readPlatformCredentialEncryptionKey();
      mockToken = encryptPlatformCredential("EAABsbCS1...mock-access-token", encKey);
      mockRefreshToken = encryptPlatformCredential("mock-refresh-token-12345", encKey);
    } catch {
      // Key might not be configured
    }

    const demoPlatformAccounts = [
      {
        name: "IVY Building Materials (官方主页)",
        accountKind: "facebook-page" as const,
        platformFamily: "meta" as const,
        externalAccountId: "108472910384721",
        authorization: {
          state: mockToken ? ("connected" as const) : ("not_started" as const),
          appId: "108472910384721",
          accessToken: mockToken || undefined,
          accessTokenConfigured: Boolean(mockToken),
          refreshToken: mockRefreshToken || undefined,
          refreshTokenConfigured: Boolean(mockRefreshToken),
          scopes: [{ scope: "pages_show_list" }, { scope: "pages_read_engagement" }, { scope: "pages_manage_posts" }],
        },
        capabilities: {
          messagingInbound: "approved" as const,
          publishing: "approved" as const,
        },
        aiAutoReplyEnabled: true,
        notes: "Meta Facebook 官方企业主页，用于中东及欧美市场品牌展示与客户询盘接入。",
      },
      {
        name: "@ivybm_architectural (Instagram 商业号)",
        accountKind: "instagram-professional" as const,
        platformFamily: "meta" as const,
        externalAccountId: "178414002938471",
        messagingExternalAccountId: "178414002938471",
        authorization: {
          state: mockToken ? ("connected" as const) : ("not_started" as const),
          appId: "178414002938471",
          accessToken: mockToken || undefined,
          accessTokenConfigured: Boolean(mockToken),
          refreshToken: mockRefreshToken || undefined,
          refreshTokenConfigured: Boolean(mockRefreshToken),
          scopes: [{ scope: "instagram_basic" }, { scope: "instagram_manage_messages" }, { scope: "instagram_content_publish" }],
        },
        capabilities: {
          messagingInbound: "approved" as const,
          publishing: "approved" as const,
        },
        aiAutoReplyEnabled: true,
        notes: "Instagram 官方品牌视觉账号，同步海外建筑幕墙工程案例贴文与私信。",
      },
      {
        name: "IVY Building Materials Global (领英机构主页)",
        accountKind: "linkedin-organization" as const,
        platformFamily: "linkedin" as const,
        externalAccountId: "urn:li:organization:98273641",
        authorization: {
          state: mockToken ? ("connected" as const) : ("not_started" as const),
          appId: "urn:li:organization:98273641",
          accessToken: mockToken || undefined,
          accessTokenConfigured: Boolean(mockToken),
          refreshToken: mockRefreshToken || undefined,
          refreshTokenConfigured: Boolean(mockRefreshToken),
          scopes: [{ scope: "w_organization_social" }, { scope: "r_organization_social" }],
        },
        capabilities: {
          messagingInbound: "not_started" as const,
          publishing: "approved" as const,
        },
        aiAutoReplyEnabled: false,
        notes: "LinkedIn B2B 行业客户与海外采购总包机构账号，发布工程白皮书与技术案例。",
      },
      {
        name: "@ivybm_official (TikTok 企业号)",
        accountKind: "tiktok-business" as const,
        platformFamily: "tiktok" as const,
        externalAccountId: "tiktok_ivybm_7829",
        authorization: {
          state: "pending" as const,
        },
        capabilities: {
          messagingInbound: "pending" as const,
          publishing: "not_started" as const,
        },
        aiAutoReplyEnabled: false,
        notes: "TikTok 视频营销账号，授权流程待审批。",
      },
    ];

    for (const pa of demoPlatformAccounts) {
      try {
        await payload.create({
          collection: "platform-accounts",
          context: { __platformMessagingIdentityWrite: true },
          data: pa as any,
          overrideAccess: true,
        });
      } catch (err) {
        payload.logger.warn(`Failed to seed platform account ${pa.name}: ${err}`);
      }
    }
    payload.logger.info(`Seeded ${demoPlatformAccounts.length} demo platform accounts.`);
  }

  payload.logger.info("Portal demo data seeding completed.");
}

