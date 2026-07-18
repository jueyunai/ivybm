import sharp from 'sharp'
import type { Payload } from 'payload'

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

const seedContext = {
  disableRevalidate: true,
  skipAudit: true,
}

const buildMinimalPDF = (): Buffer => {
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 420 240] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n',
    '4 0 obj\n<< /Length 66 >>\nstream\nBT /F1 16 Tf 48 120 Td (IVYBM demo technical data) Tj ET\nendstream\nendobj\n',
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

const ensureDemoImage = async (payload: Payload): Promise<number> => {
  const filename = 'ivybm-demo-facade.jpg'
  const existing = await findMediaByFilename(payload, filename)

  if (existing) return existing.id

  const data = await sharp({
    create: {
      background: '#b78335',
      channels: 3,
      height: 1200,
      width: 1800,
    },
  })
    .jpeg({ quality: 85 })
    .toBuffer()
  const media = await payload.create({
    collection: 'media',
    context: seedContext,
    data: {
      alt: 'Demo architectural aluminum facade placeholder',
      isPublic: true,
      source: 'IVYBM-owned placeholder generated locally; replace before production.',
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

const ensureDemoPDF = async (payload: Payload): Promise<number> => {
  const filename = 'ivybm-demo-technical-data.pdf'
  const existing = await findMediaByFilename(payload, filename)

  if (existing) return existing.id

  const data = buildMinimalPDF()
  const media = await payload.create({
    collection: 'media',
    context: seedContext,
    data: {
      alt: 'Demo aluminum panel technical data document',
      isPublic: true,
      source: 'IVYBM-owned placeholder generated locally; replace before production.',
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
  const [imageID, pdfID] = await Promise.all([ensureDemoImage(payload), ensureDemoPDF(payload)])
  const homeID = await upsertLocalizedDocument({
    arabic: { summary: 'حلول واجهات ألمنيوم معمارية للمشاريع العالمية.', title: 'الرئيسية' },
    collection: 'pages',
    english: {
      heroImage: imageID,
      internalNotes: 'Demo content only. Replace with customer-approved copy before production.',
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
      summary: 'Contact the project team for technical and quotation support.',
      title: 'Contact Us',
    },
    payload,
    publishable: true,
    slug: 'contact',
  })
  const categoryID = await upsertLocalizedDocument({
    arabic: { description: 'ألواح ألمنيوم معمارية قابلة للتخصيص.', title: 'ألواح الألمنيوم' },
    collection: 'product-categories',
    english: {
      description: 'Custom architectural aluminum panel systems.',
      title: 'Aluminum Panels',
    },
    payload,
    slug: 'aluminum-panels',
  })

  await Promise.all([
    upsertLocalizedDocument({
      arabic: {
        shortDescription: 'ألواح متينة قابلة للتخصيص لتطبيقات الواجهات.',
        specifications: [
          { label: 'المادة', value: 'سبائك الألمنيوم' },
          { label: 'التشطيب', value: 'طلاء PVDF' },
        ],
        title: 'ألواح ألمنيوم مصمتة',
      },
      collection: 'products',
      english: {
        category: categoryID,
        coverImage: imageID,
        shortDescription: 'Durable custom panels for architectural facade applications.',
        specifications: [
          { label: 'Material', value: 'Aluminum alloy' },
          { label: 'Finish', value: 'PVDF coating' },
        ],
        title: 'Solid Aluminum Panel',
      },
      payload,
      publishable: true,
      slug: 'solid-aluminum-panel',
    }),
    upsertLocalizedDocument({
      arabic: { location: 'مشروع تجريبي', title: 'مشروع واجهة تجريبي' },
      collection: 'projects',
      english: {
        coverImage: imageID,
        location: 'Demo project',
        summary: 'Placeholder case study for CMS and layout validation.',
        title: 'Demo Facade Project',
      },
      payload,
      publishable: true,
      slug: 'demo-facade-project',
    }),
    upsertLocalizedDocument({
      arabic: { excerpt: 'مقدمة تجريبية لتخطيط محتوى الواجهات.', title: 'دليل واجهات الألمنيوم' },
      collection: 'posts',
      english: {
        category: 'industry',
        excerpt: 'Demo introduction for aluminum facade content planning.',
        featuredImage: imageID,
        publishedAt: new Date('2026-07-18T00:00:00.000Z').toISOString(),
        title: 'Aluminum Facade Guide',
      },
      payload,
      publishable: true,
      slug: 'aluminum-facade-guide',
    }),
    upsertLocalizedDocument({
      arabic: { description: 'ملف تجريبي، يجب استبداله قبل الإنتاج.', title: 'البيانات الفنية' },
      collection: 'downloads',
      english: {
        coverImage: imageID,
        description: 'Demo technical file. Replace before production.',
        file: pdfID,
        isActive: true,
        title: 'Technical Data',
        type: 'technical-data',
      },
      payload,
      slug: 'aluminum-panel-technical-data',
    }),
  ])

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
      footerText: 'Demo content only — replace with customer-approved information.',
      logo: imageID,
      navigation: navigationPages.map((page, index) => ({
        ...(existingNavigationIDs.get(page) ? { id: existingNavigationIDs.get(page) } : {}),
        label: ['Home', 'About', 'Contact'][index],
        page,
      })),
      siteDescription: 'Architectural aluminum facade manufacturer',
      siteName: 'IVY Building Materials Demo',
    },
    locale: 'en',
    overrideAccess: true,
    slug: 'site-settings',
  })
  await payload.updateGlobal({
    context: seedContext,
    data: {
      footerText: 'محتوى تجريبي فقط — يجب استبداله بالمعلومات المعتمدة.',
      navigation: navigationPages.map((page, index) => ({
        id: englishSettings.navigation?.[index]?.id,
        label: ['الرئيسية', 'من نحن', 'اتصل بنا'][index],
        page,
      })),
      siteDescription: 'مصنع واجهات ألمنيوم معمارية',
      siteName: 'عرض آيفي لمواد البناء',
    },
    locale: 'ar',
    overrideAccess: true,
    slug: 'site-settings',
  })

  payload.logger.info('Seeded deterministic English and Arabic demo CMS content')
}
