import type { Payload } from 'payload'

const DEMO_NOTICE_EN = 'DEMO ONLY — this is synthetic local preview data for website knowledge, not a customer-approved fact.'
const DEMO_NOTICE_AR = 'بيانات تجريبية فقط — هذا محتوى معاينة محلي لصفحة المعرفة، وليس حقيقة معتمدة من العميل.'

export const buildPlainRichText = (text: string, locale: 'ar' | 'en') => ({
  root: {
    children: text
      .split(/\n{2,}/)
      .map((paragraph) => paragraph.trim())
      .filter(Boolean)
      .map((paragraph) => ({
        children: [
          {
            detail: 0,
            format: 0,
            mode: 'normal',
            style: '',
            text: paragraph,
            type: 'text',
            version: 1,
          },
        ],
        direction: locale === 'ar' ? 'rtl' : 'ltr',
        format: '',
        indent: 0,
        textFormat: 0,
        textStyle: '',
        type: 'paragraph',
        version: 1,
      })),
    direction: (locale === 'ar' ? 'rtl' : 'ltr') as 'ltr' | 'rtl',
    format: '' as const,
    indent: 0,
    type: 'root',
    version: 1,
  },
})

export interface WebsiteKnowledgeDemoPost {
  ar: {
    content: string
    excerpt: string
    seo: { description: string; title: string }
    title: string
  }
  category: 'material-comparison' | 'procurement' | 'quality-logistics' | 'technical-guide'
  contentType: 'knowledge'
  en: {
    content: string
    excerpt: string
    seo: { description: string; title: string }
    title: string
  }
  publishedAt: string
  slug: string
}

export const WEBSITE_KNOWLEDGE_DEMO_POSTS: readonly WebsiteKnowledgeDemoPost[] = [
  {
    ar: {
      content: `${DEMO_NOTICE_AR}\n\nتتطلب الواجهات المعمارية الحديثة تقييمًا دقيقًا بين ألواح الألمنيوم المصمتة (Solid Aluminum Panels) والألواح المركبة (Composite Panels).\n\nتتميز الألواح المصمتة بسماكة 2.0-3.0 مم بقدرة تشكيل ممتازة ومقاومة فائقة للحريق وتوافق عالي مع الواجهات المنحنية والمعقدة.\n\nيجب دائمًا مراجعة المخططات الهندسية المعتمدة واختبارات السلامة قبل اعتماد المواصفة النهائية.`,
      excerpt: `${DEMO_NOTICE_AR} مقارنة هندسية شاملة بين ألواح الألمنيوم المصمتة والألواح المركبة للواجهات المعمارية العالية.`,
      seo: {
        description: 'مقارنة فنية بين ألواح الألمنيوم المصمتة والألواح المركبة للواجهات المعمارية.',
        title: '[عرض تجريبي] دليل الاختيار الهندسي لألواح الواجهات',
      },
      title: '[عرض تجريبي] مقارنة ألواح الألمنيوم المصمتة والألواح المركبة: دليل الاختيار الهندسي',
    },
    category: 'material-comparison',
    contentType: 'knowledge',
    en: {
      content: `${DEMO_NOTICE_EN}\n\nSelecting facade cladding requires balanced consideration between solid aluminum panels and composite panels.\n\nSolid architectural aluminum panels (typically 2.0mm to 3.0mm thickness) offer non-combustible fire safety, superior roll-bending flexibility for double-curved surfaces, and recyclable lifecycle value.\n\nAlways verify final panelization, alloy specifications, and wind-load calculations against project shop drawings.`,
      excerpt: `${DEMO_NOTICE_EN} Comprehensive engineering comparison between solid aluminum sheets and composite panels for high-rise facade envelopes.`,
      seo: {
        description: 'Engineering comparison between solid aluminum panels and composite panels for curtain walls.',
        title: '[DEMO] Aluminum vs Composite Panels Selection Guide',
      },
      title: '[DEMO] Architectural Aluminum vs Composite Panels: Engineering Selection Guide',
    },
    publishedAt: '2026-08-31T08:00:00.000Z',
    slug: 'demo-facade-material-selection-guide',
  },
  {
    ar: {
      content: `${DEMO_NOTICE_AR}\n\nيتطلب تصنيع الألواح مزدوجة الانحناء (Double-Curved Aluminum Panels) دقة هندسية متقدمة في النمذجة ثلاثية الأبعاد والتحكم في تفاوتات التشكيل.\n\nيتم اعتماد تفاوتات تصنيع قياسية في حدود ±0.5 مم إلى ±1.0 مم وفقًا لهندسة المنحنى ونقاط التثبيت.\n\nيوصى بإجراء مسح ليزري ثلاثي الأبعاد وتجميع تجريبي 1:1 في المصنع لضمان سلاسة الفواصل في موقع التركيب.`,
      excerpt: `${DEMO_NOTICE_AR} مرجع فني لتقسيم الألواح البارامترية ثلاثية الأبعاد وحدود التشكيل والانحناء وتفاوتات الفواصل.`,
      seo: {
        description: 'دليل فني لتفاوتات تصنيع ألواح الألمنيوم مزدوجة الانحناء ونمذجة 3D.',
        title: '[عرض تجريبي] تفاوتات ألواح الألمنيوم مزدوجة الانحناء',
      },
      title: '[عرض تجريبي] تفاوتات تصنيع ألواح الألمنيوم مزدوجة الانحناء والتفاصيل البارامترية',
    },
    category: 'technical-guide',
    contentType: 'knowledge',
    en: {
      content: `${DEMO_NOTICE_EN}\n\nFabricating double-curved aluminum panels requires rigorous 3D parametric modelling and tight CNC roll-bending controls.\n\nTypical fabrication tolerances range within ±0.5mm to ±1.0mm depending on radius complexity and interface connections.\n\nFactory 1:1 trial assembly and 3D laser scan verification are recommended before export dispatch to guarantee on-site joint alignment.`,
      excerpt: `${DEMO_NOTICE_EN} Technical reference for 3D parametric panelization, roll-bending limits, and joint tolerance verification.`,
      seo: {
        description: 'Technical guide on double-curved aluminum panel tolerances and parametric detailing.',
        title: '[DEMO] Double-Curved Aluminum Panel Tolerances',
      },
      title: '[DEMO] Double-Curved Aluminum Panel Tolerances and Parametric Detailing',
    },
    publishedAt: '2026-08-31T09:00:00.000Z',
    slug: 'demo-double-curved-tolerance-specifications',
  },
  {
    ar: {
      content: `${DEMO_NOTICE_AR}\n\nتتطلب مشاريع الواجهات الدولية معايير فحص جودة صارمة وتغليفًا بحريًا مخصصًا لحماية الطلاء والأسطح المنحنية.\n\nتشمل خطوات الفحص فحص سمك الطلاء (PVDF/Powder)، التصاق الألوان، واختبارات مقاومة الملوحة والتآكل.\n\nيتم تعبئة الألواح في صناديق خشبية مدعمة مع حواجز رغوية مخصصة لمنع الاحتكاك أثناء النقل والشحن الدولي.`,
      excerpt: `${DEMO_NOTICE_AR} خطوات ضبط الجودة وفحص العينات المعمارية ومعايير التعبئة والشحن البحري للمشاريع العالمية.`,
      seo: {
        description: 'قائمة فحص الجودة ومعايير التغليف والشحن البحري لألواح الواجهات.',
        title: '[عرض تجريبي] فحص جودة الواجهات وتغليف التصدير',
      },
      title: '[عرض تجريبي] مشتريات الواجهات الدولية: قائمة فحص الجودة ومعايير التغليف للتصدير',
    },
    category: 'quality-logistics',
    contentType: 'knowledge',
    en: {
      content: `${DEMO_NOTICE_EN}\n\nInternational curtain wall procurement requires systematic quality inspections and reinforced export crating.\n\nQuality control checkpoints include PVDF coating dry film thickness (DFT), color uniformity (Delta E < 1.0), and salt-spray resistance documentation.\n\nCustom reinforced wooden crates with protective EVA foam interleaving prevent surface abrasion during long-haul ocean freight.`,
      excerpt: `${DEMO_NOTICE_EN} Step-by-step quality control, 1:1 mock-up verification, and containerized export packing standards for global curtain wall projects.`,
      seo: {
        description: 'Quality assurance checklist and export packing standards for international facade procurement.',
        title: '[DEMO] Facade Quality Inspection & Export Packing',
      },
      title: '[DEMO] International Facade Procurement: Quality Inspection and Export Packing Checklist',
    },
    publishedAt: '2026-08-31T10:00:00.000Z',
    slug: 'demo-facade-procurement-qa-checklist',
  },
] as const

const seedContext = {
  disableRevalidate: true,
  skipAudit: true,
}

export const seedWebsiteKnowledgeDemo = async (payload: Payload): Promise<void> => {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Website Knowledge DEMO seed is forbidden in production')
  }

  for (const item of WEBSITE_KNOWLEDGE_DEMO_POSTS) {
    const existing = await payload.find({
      collection: 'posts',
      fallbackLocale: false,
      limit: 1,
      locale: 'en',
      overrideAccess: true,
      where: { slug: { equals: item.slug } },
    })

    const englishData = {
      _status: 'published' as const,
      category: item.category,
      content: buildPlainRichText(item.en.content, 'en'),
      contentType: item.contentType,
      excerpt: item.en.excerpt,
      internalNotes: 'Local preview demo knowledge article. Synthetic data, not customer-approved.',
      publishedAt: item.publishedAt,
      seo: {
        canonical: `/en/knowledge/${item.slug}`,
        description: item.en.seo.description,
        noIndex: true,
        title: item.en.seo.title,
      },
      slug: item.slug,
      title: item.en.title,
    }

    const arabicData = {
      content: buildPlainRichText(item.ar.content, 'ar'),
      excerpt: item.ar.excerpt,
      seo: {
        canonical: `/ar/knowledge/${item.slug}`,
        description: item.ar.seo.description,
        noIndex: true,
        title: item.ar.seo.title,
      },
      title: item.ar.title,
    }

    const current = existing.docs[0]
    if (!current) {
      const created = await payload.create({
        collection: 'posts',
        context: seedContext,
        data: englishData as any,
        draft: false,
        fallbackLocale: false,
        locale: 'en',
        overrideAccess: true,
      })

      await payload.update({
        collection: 'posts',
        context: seedContext,
        data: arabicData as any,
        draft: false,
        fallbackLocale: false,
        id: created.id,
        locale: 'ar',
        overrideAccess: true,
      })
    } else {
      await payload.update({
        collection: 'posts',
        context: seedContext,
        data: englishData as any,
        draft: false,
        fallbackLocale: false,
        id: current.id,
        locale: 'en',
        overrideAccess: true,
      })

      await payload.update({
        collection: 'posts',
        context: seedContext,
        data: arabicData as any,
        draft: false,
        fallbackLocale: false,
        id: current.id,
        locale: 'ar',
        overrideAccess: true,
      })
    }
  }

  payload.logger?.info?.(
    `Seeded ${WEBSITE_KNOWLEDGE_DEMO_POSTS.length} local DEMO website knowledge articles`,
  )
}
