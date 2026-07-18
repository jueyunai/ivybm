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
const mediaDir = path.resolve(__dirname, '../../media')

const seedContext = {
  disableRevalidate: true,
  skipAudit: true,
}

/** Demo images downloaded from Unsplash matching the website prototype. */
const demoImages: Array<{ alt: string; filename: string }> = [
  { alt: 'Modern commercial building facade with glass curtain wall', filename: 'ivybm-demo-hero-1.jpg' },
  { alt: 'Contemporary architecture building exterior at sunset', filename: 'ivybm-demo-hero-2.jpg' },
  { alt: 'Modern architectural building with geometric facade', filename: 'ivybm-demo-hero-3.jpg' },
  { alt: 'Factory production line and manufacturing facility', filename: 'ivybm-demo-factory.jpg' },
  { alt: 'Office interior with modern workspace design', filename: 'ivybm-demo-panel.jpg' },
  { alt: 'Modern airport terminal interior architecture', filename: 'ivybm-demo-airport.jpg' },
  { alt: 'Landmark building with unique architectural design', filename: 'ivybm-demo-landmark.jpg' },
  { alt: 'Factory workshop with aluminum panel fabrication equipment', filename: 'ivybm-demo-workshop.jpg' },
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

const findSeedMedia = async (payload: Payload, filename: string, alt: string) => {
  const exactFilename = await findMediaByFilename(payload, filename)
  if (exactFilename) return exactFilename

  const renamedUpload = await payload.find({
    collection: 'media',
    limit: 1,
    overrideAccess: true,
    where: {
      alt: {
        equals: alt,
      },
    },
  })

  return renamedUpload.docs[0]
}

/** Read a file from disk and create or update a media record. */
const ensureMediaFile = async (payload: Payload, filepath: string, filename: string, alt: string): Promise<number> => {
  const existing = await findSeedMedia(payload, filename, alt)

  if (existing) {
    const media = await payload.update({
      collection: 'media',
      context: seedContext,
      data: {
        alt,
        isPublic: true,
        source: 'Unsplash demo image for development preview; replace with approved brand photography before production.',
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
      source: 'Unsplash demo image for development preview; replace with approved brand photography before production.',
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

/** Upload all demo images and return a map of filename -> media ID. */
const ensureSeedImages = async (payload: Payload): Promise<Map<string, number>> => {
  const map = new Map<string, number>()
  for (const { alt, filename } of demoImages) {
    const filepath = path.join(mediaDir, filename)
    if (!fs.existsSync(filepath)) {
      payload.logger.warn(`Demo image not found on disk, skipping: ${filename}`)
      continue
    }

    const id = await ensureMediaFile(payload, filepath, filename, alt)
    map.set(filename, id)
  }

  // Fallback: if no image was loaded (e.g. media dir missing), regenerate the placeholder
  if (map.size === 0) {
    const { default: sharp } = await import('sharp')
    const data = await sharp({ create: { background: '#b78335', channels: 3, height: 1200, width: 1800 } })
      .jpeg({ quality: 85 })
      .toBuffer()
    const media = await payload.create({
      collection: 'media',
      context: seedContext,
      data: { alt: 'Architectural aluminum facade panel application', isPublic: true, source: 'Local placeholder.' },
      file: { data, mimetype: 'image/jpeg', name: 'fallback-placeholder.jpg', size: data.length },
      overrideAccess: true,
    })
    map.set('fallback-placeholder.jpg', media.id)
  }

  return map
}

const ensurePlaceholderPDF = async (payload: Payload): Promise<number> => {
  const filename = 'ivybm-technical-data-placeholder.pdf'
  const alt = 'Aluminum panel technical data document'
  const existing = await findSeedMedia(payload, filename, alt)

  if (existing) {
    const media = await payload.update({
      collection: 'media',
      context: seedContext,
      data: {
        alt,
        isPublic: true,
        source: 'IVYBM-owned development document generated locally; replace with approved technical data before production.',
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
      source: 'IVYBM-owned development document generated locally; replace with approved technical data before production.',
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

const removeLegacySeedMedia = async (payload: Payload) => {
  for (const filename of [
    'ivybm-demo-facade.jpg',
    'ivybm-demo-technical-data.pdf',
    'ivybm-facade-placeholder.jpg',
    'ivybm-facade-placeholder-1.jpg',
    'fallback-placeholder.jpg',
  ]) {
    const media = await findMediaByFilename(payload, filename)
    if (!media) continue

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
  const fallbackImageID = imgMap.values().next().value
  if (fallbackImageID === undefined) throw new Error('Website seed requires at least one image')

  const heroID = imgMap.get('ivybm-demo-hero-1.jpg') ?? fallbackImageID
  const hero2ID = imgMap.get('ivybm-demo-hero-2.jpg') ?? heroID
  const hero3ID = imgMap.get('ivybm-demo-hero-3.jpg') ?? heroID
  const factoryID = imgMap.get('ivybm-demo-factory.jpg') ?? heroID
  const panelID = imgMap.get('ivybm-demo-panel.jpg') ?? heroID
  const airportID = imgMap.get('ivybm-demo-airport.jpg') ?? heroID
  const landmarkID = imgMap.get('ivybm-demo-landmark.jpg') ?? heroID
  const workshopID = imgMap.get('ivybm-demo-workshop.jpg') ?? heroID

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
      arabic: { description: 'ألواح ثلاثية الأبعاد للواجهات ذات الأشكال المعقدة.', title: 'ألواح مزدوجة الانحناء' },
      english: { description: 'Three-dimensional panels for complex facade geometry.', sortOrder: 1, title: 'Double-Curved' },
      slug: 'double-curved',
    },
    {
      arabic: { description: 'ألواح منحنية للأسقف والمظلات والواجهات القوسية.', title: 'ألواح أحادية الانحناء' },
      english: { description: 'Curved panels for roofs, canopies, and arc-shaped facade zones.', sortOrder: 2, title: 'Single-Curved' },
      slug: 'single-curved',
    },
    {
      arabic: { description: 'ألواح ألمنيوم معمارية قابلة للتخصيص للواجهات القياسية.', title: 'واجهات قياسية' },
      english: { description: 'Custom architectural aluminum panel systems for standard facade applications.', sortOrder: 3, title: 'Standard Facade' },
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
        shortDescription: 'For landmark facades, complex geometry, flowing surfaces, and high-precision architectural skins.',
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
        shortDescription: 'For curtain wall cladding, exterior walls, ceilings, parapets, and durable decorative systems.',
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
    ['commercial-complex-facade', 'Commercial Complex Facade', 'Dubai, UAE', 'Double-curved panels', 'واجهة مجمع تجاري', 'دبي، الإمارات', 'ألواح مزدوجة الانحناء', 'hero1'] as const,
    ['airport-terminal-roof', 'Airport Terminal Roof', 'Central Asia', 'Single-curved panels', 'سقف مبنى مطار', 'آسيا الوسطى', 'ألواح أحادية الانحناء', 'airport'] as const,
    ['landmark-curtain-wall', 'Landmark Curtain Wall', 'Abu Dhabi, UAE', 'Custom-shaped panels', 'واجهة مبنى مميز', 'أبوظبي، الإمارات', 'ألواح بأشكال مخصصة', 'landmark'] as const,
    ['factory-production-support', 'Factory Production Support', 'China', 'VMU / PMU samples', 'دعم الإنتاج في المصنع', 'الصين', 'عينات VMU وPMU', 'factory'] as const,
    ['hotel-podium-cladding', 'Hotel Podium Cladding', 'Riyadh, Saudi Arabia', 'PVDF facade panels', 'تكسية قاعدة فندق', 'الرياض، السعودية', 'ألواح واجهات PVDF', 'hero2'] as const,
    ['public-building-canopy', 'Public Building Canopy', 'Doha, Qatar', 'Perforated aluminum panels', 'مظلة مبنى عام', 'الدوحة، قطر', 'ألواح ألمنيوم مثقبة', 'hero3'] as const,
  ]

  const projectImageMap: Record<string, number> = {
    hero1: heroID,
    hero2: hero2ID,
    hero3: hero3ID,
    airport: airportID,
    landmark: landmarkID,
    factory: factoryID,
  }

  for (const [slug, title, location, application, arabicTitle, arabicLocation, arabicApplication, imgKey] of projectSeeds) {
    await upsertLocalizedDocument({
      arabic: { application: arabicApplication, location: arabicLocation, summary: 'مرجع لتنسيق التصميم والتصنيع والتسليم للمشروع.', title: arabicTitle },
      collection: 'projects',
      english: { application, coverImage: projectImageMap[imgKey] ?? heroID, location, summary: 'Reference for project-specific design coordination, fabrication, inspection, and delivery.', title },
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
    await payload.delete({ collection: 'projects', context: seedContext, id: project.id, overrideAccess: true })
  }

  const postSeeds = [
    {
      arabic: { excerpt: 'اعتبارات الهندسة ثلاثية الأبعاد ودقة التشكيل والرسومات واتساق التشطيب.', title: 'كيف تدعم ألواح الألمنيوم مزدوجة الانحناء تصميم الواجهات المميزة' },
      category: 'products',
      english: { excerpt: 'Key considerations for 3D geometry, forming accuracy, shop drawings, and surface consistency.', title: 'How Double-Curved Aluminum Panels Support Landmark Facade Design' },
      publishedAt: '2026-06-18T00:00:00.000Z',
      slug: 'aluminum-facade-guide',
    },
    {
      arabic: { excerpt: 'قائمة فحص عملية لسماكة الطلاء واختلاف اللون والالتصاق وحماية التعبئة.', title: 'فحوصات طلاء PVDF لمشاريع الواجهات الخارجية' },
      category: 'industry',
      english: { excerpt: 'A practical inspection checklist for coating thickness, color difference, adhesion, and packing protection.', title: 'PVDF Coating Checks For Overseas Curtain Wall Projects' },
      publishedAt: '2026-06-10T00:00:00.000Z',
      slug: 'pvdf-coating-checks',
    },
    {
      arabic: { excerpt: 'تحسين الوثائق وسير العينات وتقارير الإنتاج لفرق شراء الواجهات في الخارج.', title: 'IVYBM توسع دعم التصدير لمقاولي الشرق الأوسط' },
      category: 'company',
      english: { excerpt: 'Improved documentation, sample workflow, and production reporting for overseas facade procurement teams.', title: 'IVYBM Expands Export Support For Middle East Contractors' },
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
    arabic: { description: 'ملف تطوير داخلي يجب استبداله بالبيانات الفنية المعتمدة قبل الإنتاج.', title: 'البيانات الفنية' },
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

  await removeLegacySeedMedia(payload)

  payload.logger.info('Seeded deterministic English and Arabic CMS development content')
}
