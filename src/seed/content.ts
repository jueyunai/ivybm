import type { Payload } from 'payload'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

type SeedCollection =
  'downloads' | 'pages' | 'posts' | 'product-categories' | 'products' | 'projects'

type LocalizedSeedArgs = {
  arabic: Record<string, unknown>
  collection: SeedCollection
  english: Record<string, unknown>
  payload: Payload
  publishable?: boolean
  slug: string
}

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const showcaseAssetsDir = path.resolve(__dirname, './assets/showcase')

const seedContext = {
  disableRevalidate: true,
  skipAudit: true,
}

/** Temporary showcase images matching the customer-approved prototype composition. */
const showcaseImages: Array<{ alt: string; filename: string; sourceURL: string }> = [
  {
    alt: 'Modern commercial building facade with glass curtain wall',
    filename: 'ivybm-showcase-hero-1.jpg',
    sourceURL:
      'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?auto=format&fit=crop&w=1800&q=82',
  },
  {
    alt: 'Contemporary architecture building exterior at sunset',
    filename: 'ivybm-showcase-hero-2.jpg',
    sourceURL:
      'https://images.unsplash.com/photo-1511818966892-d7d671e672a2?auto=format&fit=crop&w=1800&q=82',
  },
  {
    alt: 'Modern architectural building with geometric facade',
    filename: 'ivybm-showcase-hero-3.jpg',
    sourceURL:
      'https://images.unsplash.com/photo-1518005020951-eccb494ad742?auto=format&fit=crop&w=1800&q=82',
  },
  {
    alt: 'Factory production line and manufacturing facility',
    filename: 'ivybm-showcase-factory.jpg',
    sourceURL:
      'https://images.unsplash.com/photo-1581092160607-ee22621dd758?auto=format&fit=crop&w=1800&q=82',
  },
  {
    alt: 'Office interior with modern workspace design',
    filename: 'ivybm-showcase-panel.jpg',
    sourceURL:
      'https://images.unsplash.com/photo-1497366754035-f200968a6e72?auto=format&fit=crop&w=1200&q=82',
  },
  {
    alt: 'Modern airport terminal interior architecture',
    filename: 'ivybm-showcase-airport.jpg',
    sourceURL:
      'https://images.unsplash.com/photo-1436491865332-7a61a109cc05?auto=format&fit=crop&w=1200&q=82',
  },
  {
    alt: 'Landmark building with unique architectural design',
    filename: 'ivybm-showcase-landmark.jpg',
    sourceURL:
      'https://images.unsplash.com/photo-1494526585095-c41746248156?auto=format&fit=crop&w=1200&q=82',
  },
  {
    alt: 'Factory workshop with aluminum panel fabrication equipment',
    filename: 'ivybm-showcase-workshop.jpg',
    sourceURL:
      'https://images.unsplash.com/photo-1565043589221-1a6fd9ae45c7?auto=format&fit=crop&w=1200&q=82',
  },
]

const buildMinimalPDF = (): Buffer => {
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 420 240] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n',
    '4 0 obj\n<< /Length 61 >>\nstream\nBT /F1 16 Tf 48 120 Td (IVYBM technical data) Tj ET\nendstream\nendobj\n',
    '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
  ]
  let pdf = '%PDF-1.4\n'
  const offsets: number[] = []

  for (const object of objects) {
    offsets.push(Buffer.byteLength(pdf))
    pdf += object
  }

  const xrefOffset = Buffer.byteLength(pdf)
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  pdf += offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`
  pdf += `startxref\n${xrefOffset}\n%%EOF\n`

  return Buffer.from(pdf)
}

const findMediaByFilename = async (payload: Payload, filename: string) => {
  const result = await payload.find({
    collection: 'media',
    limit: 1,
    overrideAccess: true,
    where: {
      filename: {
        equals: filename,
      },
    },
  })

  return result.docs[0]
}

const findMediaBySource = async (payload: Payload, source: string) => {
  const result = await payload.find({
    collection: 'media',
    limit: 1,
    overrideAccess: true,
    where: {
      source: {
        equals: source,
      },
    },
  })

  return result.docs[0]
}

/** Read a file from disk and create or update a media record. */
const ensureMediaFile = async (
  payload: Payload,
  filepath: string,
  filename: string,
  alt: string,
  sourceURL: string,
): Promise<number> => {
  const source = `IVYBM seed asset: showcase:${filename}; temporary customer showcase image from Unsplash (${sourceURL}); replace with approved brand photography before final production acceptance.`
  const existing =
    (await findMediaByFilename(payload, filename)) ?? (await findMediaBySource(payload, source))

  if (existing) {
    const media = await payload.update({
      collection: 'media',
      context: seedContext,
      data: {
        alt,
        isPublic: true,
        source,
      },
      id: existing.id,
      overrideAccess: true,
    })

    return media.id
  }

  const data = fs.readFileSync(filepath)
  const media = await payload.create({
    collection: 'media',
    context: seedContext,
    data: {
      alt,
      isPublic: true,
      source,
    },
    file: {
      data,
      mimetype: 'image/jpeg',
      name: filename,
      size: data.length,
    },
    overrideAccess: true,
  })

  return media.id
}

/** Upload all tracked showcase images and return a map of filename -> media ID. */
const ensureSeedImages = async (payload: Payload): Promise<Map<string, number>> => {
  const map = new Map<string, number>()
  for (const { alt, filename, sourceURL } of showcaseImages) {
    const filepath = path.join(showcaseAssetsDir, filename)
    if (!fs.existsSync(filepath)) {
      throw new Error(`Required showcase seed asset is missing: ${filepath}`)
    }

    const id = await ensureMediaFile(payload, filepath, filename, alt, sourceURL)
    map.set(filename, id)
  }

  return map
}

const ensurePlaceholderPDF = async (payload: Payload): Promise<number> => {
  const filename = 'ivybm-technical-data-placeholder.pdf'
  const alt = 'Aluminum panel technical data document'
  const source =
    'IVYBM seed asset: technical-data-placeholder-v2; locally generated development document; replace with approved technical data before final production acceptance.'
  const existing =
    (await findMediaByFilename(payload, filename)) ?? (await findMediaBySource(payload, source))

  if (existing) {
    const media = await payload.update({
      collection: 'media',
      context: seedContext,
      data: {
        alt,
        isPublic: true,
        source,
      },
      id: existing.id,
      overrideAccess: true,
    })

    return media.id
  }

  const data = buildMinimalPDF()
  const media = await payload.create({
    collection: 'media',
    context: seedContext,
    data: {
      alt,
      isPublic: true,
      source,
    },
    file: {
      data,
      mimetype: 'application/pdf',
      name: filename,
      size: data.length,
    },
    overrideAccess: true,
  })

  return media.id
}

const removeLegacySeedMedia = async (payload: Payload, protectedIDs: Set<number>) => {
  for (const filename of [
    'ivybm-demo-facade.jpg',
    'ivybm-demo-technical-data.pdf',
    'ivybm-demo-hero-1.jpg',
    'ivybm-demo-hero-2.jpg',
    'ivybm-demo-hero-3.jpg',
    'ivybm-demo-factory.jpg',
    'ivybm-demo-panel.jpg',
    'ivybm-demo-airport.jpg',
    'ivybm-demo-landmark.jpg',
    'ivybm-demo-workshop.jpg',
    'ivybm-facade-placeholder.jpg',
    'ivybm-facade-placeholder-1.jpg',
    'fallback-placeholder.jpg',
  ]) {
    const media = await findMediaByFilename(payload, filename)
    if (!media || protectedIDs.has(media.id)) continue

    await payload.delete({
      collection: 'media',
      context: seedContext,
      id: media.id,
      overrideAccess: true,
    })
  }

  const legacyMedia = await payload.find({
    collection: 'media',
    limit: 100,
    overrideAccess: true,
    where: {
      source: {
        in: [
          'Unsplash demo image for development preview; replace with approved brand photography before production.',
          'IVYBM-owned development placeholder generated locally; replace with approved brand photography before production.',
          'IVYBM-owned development document generated locally; replace with approved technical data before production.',
          'Local placeholder.',
        ],
      },
    },
  })

  for (const media of legacyMedia.docs) {
    if (protectedIDs.has(media.id)) continue

    await payload.delete({
      collection: 'media',
      context: seedContext,
      id: media.id,
      overrideAccess: true,
    })
  }
}

const upsertLocalizedDocument = async ({
  arabic,
  collection,
  english,
  payload,
  publishable = false,
  slug,
}: LocalizedSeedArgs): Promise<number> => {
  const existing = await payload.find({
    collection,
    limit: 1,
    overrideAccess: true,
    where: {
      slug: {
        equals: slug,
      },
    },
  } as never)
  const existingID = existing.docs[0]?.id as number | undefined
  const shared = publishable ? { _status: 'published' } : {}
  const englishData = { ...english, ...shared, slug }
  const document = existingID
    ? await payload.update({
        collection,
        context: seedContext,
        data: englishData,
        draft: publishable ? false : undefined,
        id: existingID,
        locale: 'en',
        overrideAccess: true,
      } as never)
    : await payload.create({
        collection,
        context: seedContext,
        data: englishData,
        draft: publishable ? false : undefined,
        locale: 'en',
        overrideAccess: true,
      } as never)
  const id = (document as { id: number }).id

  await payload.update({
    collection,
    context: seedContext,
    data: { ...arabic, ...shared },
    draft: publishable ? false : undefined,
    id,
    locale: 'ar',
    overrideAccess: true,
  } as never)

  return id
}

export const seedContent = async (payload: Payload): Promise<void> => {
  const [imgMap, pdfID] = await Promise.all([
    ensureSeedImages(payload),
    ensurePlaceholderPDF(payload),
  ])
  const imageID = (filename: string): number => {
    const id = imgMap.get(filename)
    if (id === undefined) throw new Error(`Website seed did not load showcase image: ${filename}`)
    return id
  }

  const heroID = imageID('ivybm-showcase-hero-1.jpg')
  const hero2ID = imageID('ivybm-showcase-hero-2.jpg')
  const hero3ID = imageID('ivybm-showcase-hero-3.jpg')
  const factoryID = imageID('ivybm-showcase-factory.jpg')
  const panelID = imageID('ivybm-showcase-panel.jpg')
  const airportID = imageID('ivybm-showcase-airport.jpg')
  const landmarkID = imageID('ivybm-showcase-landmark.jpg')
  const workshopID = imageID('ivybm-showcase-workshop.jpg')

  const homeID = await upsertLocalizedDocument({
    arabic: { summary: 'حلول واجهات ألمنيوم معمارية للمشاريع العالمية.', title: 'الرئيسية' },
    collection: 'pages',
    english: {
      heroImage: heroID,
      internalNotes: 'Development content. Replace with customer-approved copy before production.',
      summary: 'Architectural aluminum facade solutions for global projects.',
      title: 'Home',
    },
    payload,
    publishable: true,
    slug: 'home',
  })
  const aboutID = await upsertLocalizedDocument({
    arabic: { summary: 'خبرة في تصنيع وتوريد أنظمة الواجهات.', title: 'من نحن' },
    collection: 'pages',
    english: {
      heroImage: hero2ID,
      summary: 'Manufacturing and supply experience for architectural facade systems.',
      title: 'About Us',
    },
    payload,
    publishable: true,
    slug: 'about',
  })
  const contactID = await upsertLocalizedDocument({
    arabic: { summary: 'تواصل مع فريق المشروع للحصول على الدعم الفني.', title: 'اتصل بنا' },
    collection: 'pages',
    english: {
      heroImage: workshopID,
      summary: 'Contact the project team for technical and quotation support.',
      title: 'Contact Us',
    },
    payload,
    publishable: true,
    slug: 'contact',
  })
  const categorySeeds = [
    {
      arabic: {
        description: 'ألواح ثلاثية الأبعاد للواجهات ذات الأشكال المعقدة.',
        title: 'ألواح مزدوجة الانحناء',
      },
      english: {
        description: 'Three-dimensional panels for complex facade geometry.',
        sortOrder: 1,
        title: 'Double-Curved',
      },
      slug: 'double-curved',
    },
    {
      arabic: {
        description: 'ألواح منحنية للأسقف والمظلات والواجهات القوسية.',
        title: 'ألواح أحادية الانحناء',
      },
      english: {
        description: 'Curved panels for roofs, canopies, and arc-shaped facade zones.',
        sortOrder: 2,
        title: 'Single-Curved',
      },
      slug: 'single-curved',
    },
    {
      arabic: {
        description: 'ألواح ألمنيوم معمارية قابلة للتخصيص للواجهات القياسية.',
        title: 'واجهات قياسية',
      },
      english: {
        description:
          'Custom architectural aluminum panel systems for standard facade applications.',
        sortOrder: 3,
        title: 'Standard Facade',
      },
      slug: 'aluminum-panels',
    },
  ]
  const categoryIDs = new Map<string, number>()

  for (const category of categorySeeds) {
    categoryIDs.set(
      category.slug,
      await upsertLocalizedDocument({
        ...category,
        collection: 'product-categories',
        payload,
      }),
    )
  }

  const productSeeds = [
    {
      arabic: {
        shortDescription: 'للواجهات المميزة والأسطح الانسيابية والأشكال الهندسية المعقدة.',
        specifications: [
          { label: 'السماكة', value: '2.0 / 2.5 / 3.0 / 4.0 مم' },
          { label: 'المادة', value: 'سبائك AA3003 / AA5005' },
          { label: 'التشطيب', value: 'PVDF أو طلاء بودرة أو أنودة' },
          { label: 'التصنيع', value: 'تشكيل ثلاثي الأبعاد ولحام ومعايرة CNC' },
        ],
        title: 'ألواح ألمنيوم مزدوجة الانحناء',
      },
      categorySlug: 'double-curved',
      english: {
        shortDescription:
          'For landmark facades, complex geometry, flowing surfaces, and high-precision architectural skins.',
        specifications: [
          { label: 'Thickness', value: '2.0 / 2.5 / 3.0 / 4.0 mm' },
          { label: 'Material', value: 'AA3003 / AA5005 aluminum alloy' },
          { label: 'Surface', value: 'PVDF, powder coating, or anodized' },
          { label: 'Process', value: '3D forming, welding, and CNC calibration' },
        ],
        title: 'Double-Curved Aluminum Panel',
      },
      slug: 'double-curved-aluminum-panel',
    },
    {
      arabic: {
        shortDescription: 'لأسقف المطارات والمظلات وتكسية الأعمدة ومناطق الواجهات القوسية.',
        specifications: [
          { label: 'السماكة', value: '2.0 / 2.5 / 3.0 مم' },
          { label: 'نصف القطر', value: 'حسب رسومات المشروع' },
          { label: 'التشطيب', value: 'PVDF أو طلاء بودرة أو لون معدني' },
          { label: 'الاستخدام', value: 'الأسقف والمظلات والواجهات المنحنية' },
        ],
        title: 'ألواح ألمنيوم أحادية الانحناء',
      },
      categorySlug: 'single-curved',
      english: {
        shortDescription: 'For airport roofs, canopies, column wraps, and arc-shaped facade zones.',
        specifications: [
          { label: 'Thickness', value: '2.0 / 2.5 / 3.0 mm' },
          { label: 'Radius', value: 'Custom bending radius by shop drawing' },
          { label: 'Finish', value: 'PVDF, powder coating, or metallic color' },
          { label: 'Use', value: 'Roof, soffit, canopy, and facade curve' },
        ],
        title: 'Single-Curved Aluminum Panel',
      },
      slug: 'single-curved-aluminum-panel',
    },
    {
      arabic: {
        shortDescription: 'لتكسية الجدران الخارجية والأسقف والردهات وأنظمة الواجهات المتينة.',
        specifications: [
          { label: 'السماكة', value: '1.5 / 2.0 / 2.5 / 3.0 مم' },
          { label: 'المقاس', value: 'مقاسات مخصصة بعد المراجعة الهندسية' },
          { label: 'اللون', value: 'RAL أو Pantone أو معدني أو ملمس حجري' },
          { label: 'التركيب', value: 'أنظمة ألواح كاسيت مدعمة ومثبتة' },
        ],
        title: 'ألواح ألمنيوم للواجهات القياسية',
      },
      categorySlug: 'aluminum-panels',
      english: {
        shortDescription:
          'For curtain wall cladding, exterior walls, ceilings, parapets, and durable decorative systems.',
        specifications: [
          { label: 'Thickness', value: '1.5 / 2.0 / 2.5 / 3.0 mm' },
          { label: 'Max size', value: 'Custom size subject to engineering review' },
          { label: 'Color', value: 'RAL, Pantone, metallic, or stone texture' },
          { label: 'Installation', value: 'Ribbed, bracketed, cassette panel systems' },
        ],
        title: 'Standard Facade Aluminum Panel',
      },
      slug: 'solid-aluminum-panel',
    },
  ]

  const productImages: Record<string, number> = {
    'double-curved': hero3ID,
    'single-curved': airportID,
    'aluminum-panels': panelID,
  }

  for (const product of productSeeds) {
    const englishProduct = {
      ...product.english,
      category: categoryIDs.get(product.categorySlug),
      coverImage: productImages[product.categorySlug] ?? heroID,
    }
    const productID = await upsertLocalizedDocument({
      arabic: product.arabic,
      collection: 'products',
      english: englishProduct,
      payload,
      publishable: true,
      slug: product.slug,
    })
    const localizedProduct = (await payload.findByID({
      collection: 'products',
      fallbackLocale: false,
      id: productID,
      locale: 'ar',
      overrideAccess: true,
    })) as { specifications?: Array<{ id?: string }> }

    await payload.update({
      collection: 'products',
      context: seedContext,
      data: {
        ...englishProduct,
        _status: 'published',
        specifications: product.english.specifications.map((specification, index) => ({
          ...specification,
          id: localizedProduct.specifications?.[index]?.id,
        })),
      },
      draft: false,
      id: productID,
      locale: 'en',
      overrideAccess: true,
    })
  }

  const projectSeeds = [
    [
      'commercial-complex-facade',
      'Commercial Complex Facade',
      'Dubai, UAE',
      'Double-curved panels',
      'واجهة مجمع تجاري',
      'دبي، الإمارات',
      'ألواح مزدوجة الانحناء',
      'hero1',
    ] as const,
    [
      'airport-terminal-roof',
      'Airport Terminal Roof',
      'Central Asia',
      'Single-curved panels',
      'سقف مبنى مطار',
      'آسيا الوسطى',
      'ألواح أحادية الانحناء',
      'airport',
    ] as const,
    [
      'landmark-curtain-wall',
      'Landmark Curtain Wall',
      'Abu Dhabi, UAE',
      'Custom-shaped panels',
      'واجهة مبنى مميز',
      'أبوظبي، الإمارات',
      'ألواح بأشكال مخصصة',
      'landmark',
    ] as const,
    [
      'factory-production-support',
      'Factory Production Support',
      'China',
      'VMU / PMU samples',
      'دعم الإنتاج في المصنع',
      'الصين',
      'عينات VMU وPMU',
      'factory',
    ] as const,
    [
      'hotel-podium-cladding',
      'Hotel Podium Cladding',
      'Riyadh, Saudi Arabia',
      'PVDF facade panels',
      'تكسية قاعدة فندق',
      'الرياض، السعودية',
      'ألواح واجهات PVDF',
      'hero2',
    ] as const,
    [
      'public-building-canopy',
      'Public Building Canopy',
      'Doha, Qatar',
      'Perforated aluminum panels',
      'مظلة مبنى عام',
      'الدوحة، قطر',
      'ألواح ألمنيوم مثقبة',
      'hero3',
    ] as const,
  ]

  const projectImageMap: Record<string, number> = {
    hero1: heroID,
    hero2: hero2ID,
    hero3: hero3ID,
    airport: airportID,
    landmark: landmarkID,
    factory: factoryID,
  }

  for (const [
    slug,
    title,
    location,
    application,
    arabicTitle,
    arabicLocation,
    arabicApplication,
    imgKey,
  ] of projectSeeds) {
    await upsertLocalizedDocument({
      arabic: {
        application: arabicApplication,
        location: arabicLocation,
        summary: 'مرجع لتنسيق التصميم والتصنيع والتسليم للمشروع.',
        title: arabicTitle,
      },
      collection: 'projects',
      english: {
        application,
        coverImage: projectImageMap[imgKey] ?? heroID,
        location,
        summary:
          'Reference for project-specific design coordination, fabrication, inspection, and delivery.',
        title,
      },
      payload,
      publishable: true,
      slug,
    })
  }

  const legacyProjects = await payload.find({
    collection: 'projects',
    limit: 20,
    overrideAccess: true,
    where: { slug: { equals: 'demo-facade-project' } },
  })
  for (const project of legacyProjects.docs) {
    await payload.delete({
      collection: 'projects',
      context: seedContext,
      id: project.id,
      overrideAccess: true,
    })
  }

  const postSeeds = [
    {
      arabic: {
        excerpt: 'اعتبارات الهندسة ثلاثية الأبعاد ودقة التشكيل والرسومات واتساق التشطيب.',
        title: 'كيف تدعم ألواح الألمنيوم مزدوجة الانحناء تصميم الواجهات المميزة',
      },
      category: 'products',
      english: {
        excerpt:
          'Key considerations for 3D geometry, forming accuracy, shop drawings, and surface consistency.',
        title: 'How Double-Curved Aluminum Panels Support Landmark Facade Design',
      },
      publishedAt: '2026-06-18T00:00:00.000Z',
      slug: 'aluminum-facade-guide',
    },
    {
      arabic: {
        excerpt: 'قائمة فحص عملية لسماكة الطلاء واختلاف اللون والالتصاق وحماية التعبئة.',
        title: 'فحوصات طلاء PVDF لمشاريع الواجهات الخارجية',
      },
      category: 'industry',
      english: {
        excerpt:
          'A practical inspection checklist for coating thickness, color difference, adhesion, and packing protection.',
        title: 'PVDF Coating Checks For Overseas Curtain Wall Projects',
      },
      publishedAt: '2026-06-10T00:00:00.000Z',
      slug: 'pvdf-coating-checks',
    },
    {
      arabic: {
        excerpt: 'تحسين الوثائق وسير العينات وتقارير الإنتاج لفرق شراء الواجهات في الخارج.',
        title: 'IVYBM توسع دعم التصدير لمقاولي الشرق الأوسط',
      },
      category: 'company',
      english: {
        excerpt:
          'Improved documentation, sample workflow, and production reporting for overseas facade procurement teams.',
        title: 'IVYBM Expands Export Support For Middle East Contractors',
      },
      noIndex: true,
      publishedAt: '2026-05-28T00:00:00.000Z',
      slug: 'middle-east-export-support',
    },
  ] as const

  for (const [index, post] of postSeeds.entries()) {
    await upsertLocalizedDocument({
      arabic: post.arabic,
      collection: 'posts',
      english: {
        ...post.english,
        category: post.category,
        featuredImage: [hero3ID, factoryID, heroID][index],
        publishedAt: post.publishedAt,
        seo: { noIndex: 'noIndex' in post ? post.noIndex : false },
      },
      payload,
      publishable: true,
      slug: post.slug,
    })
  }

  await upsertLocalizedDocument({
    arabic: {
      description: 'ملف تطوير داخلي يجب استبداله بالبيانات الفنية المعتمدة قبل الإنتاج.',
      title: 'البيانات الفنية',
    },
    collection: 'downloads',
    english: {
      coverImage: heroID,
      description: 'Development file; replace with approved technical data before production.',
      file: pdfID,
      isActive: true,
      title: 'Technical Data',
      type: 'technical-data',
    },
    payload,
    slug: 'aluminum-panel-technical-data',
  })

  const navigationPages = [homeID, aboutID, contactID]
  const existingSettings = await payload.findGlobal({
    fallbackLocale: false,
    locale: 'en',
    overrideAccess: true,
    slug: 'site-settings',
  })
  const existingNavigationIDs = new Map<number, string>()

  for (const item of existingSettings.navigation ?? []) {
    const pageID = typeof item.page === 'object' ? item.page.id : item.page

    if (item.id) existingNavigationIDs.set(pageID, item.id)
  }

  const englishSettings = await payload.updateGlobal({
    context: seedContext,
    data: {
      footerText: 'Factory-direct architectural aluminum facade solutions for overseas projects.',
      logo: heroID,
      navigation: navigationPages.map((page, index) => ({
        ...(existingNavigationIDs.get(page) ? { id: existingNavigationIDs.get(page) } : {}),
        label: ['Home', 'About', 'Contact'][index],
        page,
      })),
      siteDescription: 'Architectural aluminum facade manufacturer',
      siteName: 'IVY Building Materials',
    },
    locale: 'en',
    overrideAccess: true,
    slug: 'site-settings',
  })
  await payload.updateGlobal({
    context: seedContext,
    data: {
      footerText: 'حلول واجهات ألمنيوم معمارية مباشرة من المصنع للمشاريع الخارجية.',
      navigation: navigationPages.map((page, index) => ({
        id: englishSettings.navigation?.[index]?.id,
        label: ['الرئيسية', 'من نحن', 'اتصل بنا'][index],
        page,
      })),
      siteDescription: 'مصنع واجهات ألمنيوم معمارية',
      siteName: 'IVY لمواد البناء',
    },
    locale: 'ar',
    overrideAccess: true,
    slug: 'site-settings',
  })

  await removeLegacySeedMedia(payload, new Set([...imgMap.values(), pdfID]))

  payload.logger.info('Seeded deterministic English and Arabic CMS showcase content')
}
