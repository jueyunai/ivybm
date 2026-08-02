import type { Payload } from 'payload'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  ABOUT_SECTIONS,
  buildLocalizedContent,
  OLD_SITE_ASSETS,
  OLD_SITE_POSTS,
  OLD_SITE_PRODUCT_DESCRIPTIONS,
  OLD_SITE_PROJECTS,
  PRODUCT_ASSET_FILENAMES,
} from './oldSiteContent'

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
    const storedFilename = typeof existing.filename === 'string' ? existing.filename : filename
    const storedFile = path.resolve(process.cwd(), 'media', storedFilename)
    const shouldRestoreFile = !fs.existsSync(storedFile)
    const data = shouldRestoreFile ? fs.readFileSync(filepath) : null
    const media = await payload.update({
      collection: 'media',
      context: seedContext,
      data: {
        alt,
        isPublic: true,
        source,
      },
      id: existing.id,
      ...(data
        ? {
            file: {
              data,
              mimetype: 'image/jpeg',
              name: filename,
              size: data.length,
            },
            overwriteExistingFiles: true,
          }
        : {}),
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
    overwriteExistingFiles: true,
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

const oldSitePlaceholderMap = (showcaseMedia: Map<string, number>): Map<string, number> => {
  const placeholderIDs = showcaseImages.map(({ filename }) => {
    const id = showcaseMedia.get(filename)
    if (id === undefined) throw new Error(`Website seed did not load showcase image: ${filename}`)
    return id
  })

  return new Map(
    OLD_SITE_ASSETS.map(({ filename }, index) => [
      filename,
      placeholderIDs[index % placeholderIDs.length],
    ]),
  )
}

const localCustomerMediaDir = (): string | undefined => {
  const configured = process.env.LOCAL_CUSTOMER_MEDIA_DIR?.trim()
  if (!configured) return undefined

  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'LOCAL_CUSTOMER_MEDIA_DIR is local-only; upload production customer media through Payload CMS',
    )
  }

  const resolved = path.resolve(configured)
  const repositoryRoot = path.resolve(process.cwd())
  if (resolved === repositoryRoot || resolved.startsWith(`${repositoryRoot}${path.sep}`)) {
    throw new Error('LOCAL_CUSTOMER_MEDIA_DIR must be outside the source repository')
  }

  return resolved
}

/**
 * Use repository placeholders by default. Local previews may opt into customer-owned media from
 * an external, untracked directory; production media is uploaded separately through Payload CMS.
 */
const ensureOldSiteImages = async (
  payload: Payload,
  showcaseMedia: Map<string, number>,
): Promise<Map<string, number>> => {
  const assetsDir = localCustomerMediaDir()
  if (!assetsDir) return oldSitePlaceholderMap(showcaseMedia)

  const map = new Map<string, number>()

  for (const { alt, filename, sourceURL } of OLD_SITE_ASSETS) {
    const filepath = path.join(assetsDir, filename)
    if (!fs.existsSync(filepath)) {
      throw new Error(`Required local customer media is missing: ${filepath}`)
    }

    const source = `IVYBM customer-owned legacy website asset; confirmed reusable by client on 2026-07-28; original URL: ${sourceURL}`
    const existing = await findMediaBySource(payload, source)

    if (existing) {
      const media = await payload.update({
        collection: 'media',
        context: seedContext,
        data: { alt, isPublic: true, source },
        id: existing.id,
        overrideAccess: true,
      })
      map.set(filename, media.id)
      continue
    }

    const data = fs.readFileSync(filepath)
    const media = await payload.create({
      collection: 'media',
      context: seedContext,
      data: { alt, isPublic: true, source },
      file: {
        data,
        mimetype: 'image/webp',
        name: filename,
        size: data.length,
      },
      overrideAccess: true,
    })
    map.set(filename, media.id)
  }

  return map
}

const removeSeedOwnedDocuments = async (
  payload: Payload,
  collection: 'posts' | 'projects',
  identities: Array<{ slug: string; title: string }>,
) => {
  const result = await payload.find({
    collection,
    fallbackLocale: false,
    limit: identities.length,
    locale: 'en',
    overrideAccess: true,
    where: { slug: { in: identities.map(({ slug }) => slug) } },
  })

  for (const document of result.docs) {
    const expected = identities.find(({ slug }) => slug === document.slug)
    if (!expected || document.title !== expected.title) continue

    await payload.delete({
      collection,
      context: seedContext,
      id: document.id,
      overrideAccess: true,
    })
  }
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
  const oldSiteImageMap = await ensureOldSiteImages(payload, imgMap)
  const imageID = (filename: string): number => {
    const id = imgMap.get(filename)
    if (id === undefined) throw new Error(`Website seed did not load showcase image: ${filename}`)
    return id
  }
  const oldSiteImageID = (filename: string): number => {
    const id = oldSiteImageMap.get(filename)
    if (id === undefined) throw new Error(`Website seed did not load old-site image: ${filename}`)
    return id
  }

  const heroID = imageID('ivybm-showcase-hero-1.jpg')
  const aboutHeroID = oldSiteImageID('factory-warehouse.webp')
  const contactHeroID = oldSiteImageID('factory-loading.webp')
  const aboutBodyImageIDs = [
    'factory-cnc-bending.webp',
    'factory-cnc-punching.webp',
    'factory-inspection.webp',
    'factory-workshop.webp',
  ].map(oldSiteImageID)

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
    arabic: {
      body: buildLocalizedContent('ar', ABOUT_SECTIONS.ar, 'about-ar', aboutBodyImageIDs),
      summary: 'تصنيع ألواح الألمنيوم وفحصها وتغليفها للمشاريع العالمية.',
      title: 'من نحن',
    },
    collection: 'pages',
    english: {
      body: buildLocalizedContent('en', ABOUT_SECTIONS.en, 'about-en', aboutBodyImageIDs),
      heroImage: aboutHeroID,
      internalNotes:
        'Factory content and imagery migrated from the client-confirmed legacy website.',
      summary:
        'Architectural aluminum panel fabrication, inspection, packing, and export support for global projects.',
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
      heroImage: contactHeroID,
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
        seo: {
          description:
            'ألواح ألمنيوم ثلاثية الأبعاد مخصصة للواجهات الحرة والأشكال المعقدة والأسطح الانسيابية.',
          keywords: 'ألواح ألمنيوم مزدوجة الانحناء، ألواح واجهات ثلاثية الأبعاد، تصنيع واجهات مخصص',
          title: 'ألواح ألمنيوم مزدوجة الانحناء | IVYBM',
        },
        shortDescription: 'للواجهات المميزة والأسطح الانسيابية والأشكال الهندسية المعقدة.',
        specifications: [
          {
            label: 'الهندسة',
            value: 'انحناء مزدوج أو شكل حر وفق النموذج الرقمي والرسومات المعتمدة',
          },
          {
            label: 'التصنيع',
            value: 'تشكيل ولحام وصنفرة ودعامات وتشطيب حسب متطلبات المشروع',
          },
          { label: 'السماكة', value: 'يتم تحديدها وفق الهندسة والمقاس والمعايير الإنشائية' },
          { label: 'التفاوتات', value: 'تحدد في خطة الفحص ونموذج الاعتماد الخاص بالمشروع' },
        ],
        title: 'ألواح ألمنيوم مزدوجة الانحناء',
      },
      categorySlug: 'double-curved',
      english: {
        seo: {
          description:
            'Custom double-curved aluminum panels for complex facade and interior geometry, with drawing, sample, inspection, and export coordination.',
          keywords:
            'double curved aluminum panel, 3D aluminum facade panel, hyperbolic aluminum cladding',
          title: 'Double-Curved Aluminum Panel Manufacturer | IVYBM',
        },
        shortDescription:
          'For landmark facades, complex geometry, flowing surfaces, and high-precision architectural skins.',
        specifications: [
          {
            label: 'Geometry',
            value:
              'Double curvature or free-form geometry from approved digital model and drawings',
          },
          {
            label: 'Fabrication',
            value: 'Forming, welding, grinding, stiffening and finishing as required',
          },
          {
            label: 'Thickness',
            value: 'Engineering selection based on geometry, panel size and structural criteria',
          },
          {
            label: 'Tolerance',
            value: 'Defined in the project-specific inspection plan and approved mock-up',
          },
        ],
        title: 'Double-Curved Aluminum Panel',
      },
      slug: 'double-curved-aluminum-panel',
    },
    {
      arabic: {
        seo: {
          description:
            'ألواح ألمنيوم مخصصة بانحناء أحادي للواجهات والمظلات والأسقف والعناصر المعمارية المنحنية.',
          keywords: 'ألواح ألمنيوم أحادية الانحناء، كسوة ألمنيوم منحنية، ألواح واجهات بنصف قطر',
          title: 'ألواح ألمنيوم أحادية الانحناء | IVYBM',
        },
        shortDescription: 'لأسقف المطارات والمظلات وتكسية الأعمدة ومناطق الواجهات القوسية.',
        specifications: [
          { label: 'الهندسة', value: 'انحناء أحادي ونصف قطر وفق الرسومات أو القوالب المعتمدة' },
          { label: 'السماكة', value: 'يتم تحديدها هندسياً وفق نصف القطر والمقاس والأحمال' },
          { label: 'التشطيب', value: 'وفق العينة ونظام الطلاء المعتمدين للمشروع' },
          { label: 'التحقق', value: 'قالب أو عينة قطعة أولى أو نموذج بصري عند الحاجة' },
        ],
        title: 'ألواح ألمنيوم أحادية الانحناء',
      },
      categorySlug: 'single-curved',
      english: {
        seo: {
          description:
            'Custom single-curved aluminum panels for facades, canopies, ceilings, and radius-based architectural features.',
          keywords: 'single curved aluminum panel, radius aluminum cladding, curved facade panel',
          title: 'Single-Curved Aluminum Panel Manufacturer | IVYBM',
        },
        shortDescription: 'For airport roofs, canopies, column wraps, and arc-shaped facade zones.',
        specifications: [
          {
            label: 'Geometry',
            value: 'Single curvature with radius taken from approved drawings or templates',
          },
          {
            label: 'Thickness',
            value: 'Engineering selection based on radius, panel size, loads and project criteria',
          },
          { label: 'Finish', value: 'According to the approved project sample and coating system' },
          {
            label: 'Verification',
            value: 'Template, first-article sample or visual mock-up where required',
          },
        ],
        title: 'Single-Curved Aluminum Panel',
      },
      slug: 'single-curved-aluminum-panel',
    },
    {
      arabic: {
        seo: {
          description: 'ألواح ألمنيوم مصمتة مخصصة للواجهات والكسوة الداخلية والمشاريع المعمارية.',
          keywords: 'ألواح ألمنيوم مصمتة، ألواح ألمنيوم للواجهات، تصنيع ألواح مخصص',
          title: 'ألواح ألمنيوم مصمتة | IVYBM',
        },
        shortDescription: 'لتكسية الجدران الخارجية والأسقف والردهات وأنظمة الواجهات المتينة.',
        specifications: [
          { label: 'التكوين', value: 'ألواح ومرجعات ودعامات وزوايا تثبيت حسب التصميم المعتمد' },
          { label: 'السماكة', value: 'يتم اختيارها هندسياً وفق المقاس والأحمال ومتطلبات المشروع' },
          { label: 'التشطيب', value: 'وفق العينة ونظام الطلاء المعتمدين للمشروع' },
          { label: 'المراجعة', value: 'رسومات تنفيذية وعينات وفحص أبعاد ومظهر وتغليف' },
        ],
        title: 'ألواح ألمنيوم للواجهات القياسية',
      },
      categorySlug: 'aluminum-panels',
      english: {
        seo: {
          description:
            'Custom solid aluminum panels for facades, curtain walls, canopies, and interior cladding, with project-specific engineering review.',
          keywords:
            'solid aluminum panel manufacturer, aluminum facade panel, custom curtain wall panel',
          title: 'Solid Aluminum Panel Manufacturer | IVYBM',
        },
        shortDescription:
          'For curtain wall cladding, exterior walls, ceilings, parapets, and durable decorative systems.',
        specifications: [
          {
            label: 'Construction',
            value: 'Panel, returns, stiffeners and fixing angles as required by approved design',
          },
          {
            label: 'Thickness',
            value: 'Engineering selection based on panel size, loads and project criteria',
          },
          { label: 'Finish', value: 'According to the approved project sample and coating system' },
          {
            label: 'Verification',
            value: 'Shop drawings, samples, dimensional, appearance and packing checks',
          },
        ],
        title: 'Standard Facade Aluminum Panel',
      },
      slug: 'solid-aluminum-panel',
    },
  ]

  for (const product of productSeeds) {
    const productAssetIDs = PRODUCT_ASSET_FILENAMES[product.slug].map(oldSiteImageID)
    const productDescription = OLD_SITE_PRODUCT_DESCRIPTIONS[product.slug]
    const englishProduct = {
      ...product.english,
      category: categoryIDs.get(product.categorySlug),
      coverImage: productAssetIDs[0],
      description: buildLocalizedContent(
        'en',
        productDescription.en.sections,
        `${product.slug}-en`,
      ),
      gallery: productAssetIDs.slice(1),
      internalNotes: 'Product imagery migrated from the client-confirmed legacy website.',
    }
    const arabicProduct = {
      ...product.arabic,
      description: buildLocalizedContent(
        'ar',
        productDescription.ar.sections,
        `${product.slug}-ar`,
      ),
    }
    const productID = await upsertLocalizedDocument({
      arabic: arabicProduct,
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

  for (const project of OLD_SITE_PROJECTS) {
    const projectAssetIDs = project.assetFilenames.map(oldSiteImageID)
    await upsertLocalizedDocument({
      arabic: {
        application: project.ar.application,
        description: buildLocalizedContent('ar', project.ar.sections, `${project.slug}-ar`),
        location: project.ar.location,
        summary: project.ar.summary,
        title: project.ar.title,
      },
      collection: 'projects',
      english: {
        application: project.en.application,
        coverImage: projectAssetIDs[0],
        description: buildLocalizedContent('en', project.en.sections, `${project.slug}-en`),
        gallery: projectAssetIDs.slice(1),
        internalNotes:
          'Project content and imagery migrated from the client-confirmed legacy website.',
        location: project.en.location,
        summary: project.en.summary,
        title: project.en.title,
      },
      payload,
      publishable: true,
      slug: project.slug,
    })
  }

  await removeSeedOwnedDocuments(payload, 'projects', [
    { slug: 'commercial-complex-facade', title: 'Commercial Complex Facade' },
    { slug: 'airport-terminal-roof', title: 'Airport Terminal Roof' },
    { slug: 'landmark-curtain-wall', title: 'Landmark Curtain Wall' },
    { slug: 'factory-production-support', title: 'Factory Production Support' },
    { slug: 'hotel-podium-cladding', title: 'Hotel Podium Cladding' },
    { slug: 'public-building-canopy', title: 'Public Building Canopy' },
    { slug: 'demo-facade-project', title: 'Demo Facade Project' },
  ])

  for (const post of OLD_SITE_POSTS) {
    await upsertLocalizedDocument({
      arabic: {
        content: buildLocalizedContent('ar', post.ar.sections, `${post.slug}-ar`),
        excerpt: post.ar.excerpt,
        title: post.ar.title,
      },
      collection: 'posts',
      english: {
        content: buildLocalizedContent('en', post.en.sections, `${post.slug}-en`),
        category: post.category,
        excerpt: post.en.excerpt,
        featuredImage: oldSiteImageID(post.featuredFilename),
        internalNotes:
          'Article content and imagery migrated from the client-confirmed legacy website.',
        publishedAt: post.publishedAt,
        title: post.en.title,
      },
      payload,
      publishable: true,
      slug: post.slug,
    })
  }

  await removeSeedOwnedDocuments(payload, 'posts', [
    {
      slug: 'aluminum-facade-guide',
      title: 'How Double-Curved Aluminum Panels Support Landmark Facade Design',
    },
    {
      slug: 'pvdf-coating-checks',
      title: 'PVDF Coating Checks For Overseas Curtain Wall Projects',
    },
    {
      slug: 'middle-east-export-support',
      title: 'IVYBM Expands Export Support For Middle East Contractors',
    },
  ])

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
      contact: {
        address:
          'Office: 2006, Block 2, Aoying Business Center, No. 9 Xingda Road, Southwest Street, Sanshui District, Foshan City\nFactory: No. 2, Heshun Industrial Area, Lishui, Nanhai, Foshan, Guangdong, China',
        email: 'ivy@ivymetalglass.com',
        phone: '+8618520040515',
        whatsapp: '+8618520040515',
      },
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
      contact: {
        address:
          'المكتب: 2006، المبنى 2، مركز Aoying للأعمال، رقم 9 طريق Xingda، شارع Southwest، منطقة Sanshui، مدينة فوشان\nالمصنع: رقم 2، منطقة Heshun الصناعية، Lishui، Nanhai، فوشان، غوانغدونغ، الصين',
      },
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

  await removeLegacySeedMedia(
    payload,
    new Set([...imgMap.values(), ...oldSiteImageMap.values(), pdfID]),
  )

  payload.logger.info(
    process.env.LOCAL_CUSTOMER_MEDIA_DIR?.trim()
      ? 'Seeded deterministic English and Arabic CMS content with external local customer media'
      : 'Seeded deterministic English and Arabic CMS content with repository media placeholders',
  )
}
