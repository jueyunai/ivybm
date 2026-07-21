import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getPayload, type Payload } from 'payload'

import config from '@/payload.config'
import { seedContent } from '@/seed/content'

const showcaseFilenames = [
  'ivybm-showcase-hero-1.jpg',
  'ivybm-showcase-hero-2.jpg',
  'ivybm-showcase-hero-3.jpg',
  'ivybm-showcase-factory.jpg',
  'ivybm-showcase-panel.jpg',
  'ivybm-showcase-airport.jpg',
  'ivybm-showcase-landmark.jpg',
  'ivybm-showcase-workshop.jpg',
] as const

const legacyFilenames = [
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
] as const

const relationID = (value: unknown): number | string | undefined => {
  if (typeof value === 'number' || typeof value === 'string') return value
  if (value && typeof value === 'object' && 'id' in value) {
    const id = (value as { id?: unknown }).id
    if (typeof id === 'number' || typeof id === 'string') return id
  }
  return undefined
}

const buildLegacyPDF = (): Buffer => {
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n',
    '4 0 obj\n<< /Length 48 >>\nstream\nBT /F1 12 Tf 36 72 Td (Legacy data) Tj ET\nendstream\nendobj\n',
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

describe.sequential('showcase media seed', () => {
  let payload: Payload

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL is required for showcase seed integration tests')
    }

    payload = await getPayload({
      config,
      disableOnInit: true,
      key: 'showcase-media-seed-integration-tests',
    })
  })

  afterAll(async () => {
    await payload?.destroy()
  })

  it('keeps tracked showcase media and all seeded references stable across repeated runs', async () => {
    const before = await payload.find({ collection: 'media', limit: 100, overrideAccess: true })
    const beforeShowcase = before.docs.filter((doc) =>
      doc.source?.startsWith('IVYBM seed asset: showcase:'),
    )
    expect(beforeShowcase).toHaveLength(showcaseFilenames.length)
    for (const filename of showcaseFilenames) {
      expect(
        beforeShowcase.some((doc) =>
          doc.source?.startsWith(`IVYBM seed asset: showcase:${filename};`),
        ),
      ).toBe(true)
    }

    const beforeIDs = new Map(beforeShowcase.map((doc) => [doc.source, doc.id]))
    await seedContent(payload)

    const after = await payload.find({ collection: 'media', limit: 100, overrideAccess: true })
    expect(after.totalDocs).toBe(before.totalDocs)
    expect(
      after.docs
        .filter((doc) => doc.source?.startsWith('IVYBM seed asset: showcase:'))
        .map((doc) => [doc.source, doc.id]),
    ).toEqual(expect.arrayContaining([...beforeIDs.entries()]))
    expect(
      after.docs.filter((doc) => legacyFilenames.includes(doc.filename as never)),
    ).toHaveLength(0)

    const showcaseIDs = new Set<number | string>(beforeShowcase.map((doc) => doc.id))
    const pages = await payload.find({
      collection: 'pages',
      depth: 0,
      limit: 10,
      locale: 'en',
      overrideAccess: true,
      where: { slug: { in: ['home', 'about', 'contact'] } },
    })
    expect(pages.docs).toHaveLength(3)
    expect(pages.docs.every((page) => showcaseIDs.has(relationID(page.heroImage) ?? -1))).toBe(true)

    for (const collection of ['products', 'projects'] as const) {
      const documents = await payload.find({
        collection,
        depth: 0,
        limit: 20,
        locale: 'en',
        overrideAccess: true,
      })
      expect(documents.docs.length).toBeGreaterThan(0)
      expect(
        documents.docs.every((document) => showcaseIDs.has(relationID(document.coverImage) ?? -1)),
      ).toBe(true)
    }

    const posts = await payload.find({
      collection: 'posts',
      depth: 0,
      limit: 20,
      locale: 'en',
      overrideAccess: true,
    })
    expect(posts.docs.length).toBeGreaterThan(0)
    expect(posts.docs.every((post) => showcaseIDs.has(relationID(post.featuredImage) ?? -1))).toBe(
      true,
    )

    const downloads = await payload.find({
      collection: 'downloads',
      depth: 0,
      limit: 10,
      locale: 'en',
      overrideAccess: true,
      where: { slug: { equals: 'aluminum-panel-technical-data' } },
    })
    expect(downloads.docs).toHaveLength(1)
    expect(showcaseIDs.has(relationID(downloads.docs[0].coverImage) ?? -1)).toBe(true)
    expect(relationID(downloads.docs[0].file)).toBeDefined()

    const settings = await payload.findGlobal({
      depth: 0,
      locale: 'en',
      overrideAccess: true,
      slug: 'site-settings',
    })
    expect(showcaseIDs.has(relationID(settings.logo) ?? -1)).toBe(true)
  })

  it('replaces the legacy technical PDF without clearing the active download file', async () => {
    const legacyPDF = buildLegacyPDF()
    const legacy = await payload.create({
      collection: 'media',
      context: { disableRevalidate: true, skipAudit: true },
      data: {
        alt: 'Aluminum panel technical data document',
        isPublic: true,
        source:
          'IVYBM-owned development document generated locally; replace with approved technical data before production.',
      },
      file: {
        data: legacyPDF,
        mimetype: 'application/pdf',
        name: 'ivybm-demo-technical-data.pdf',
        size: legacyPDF.length,
      },
      overrideAccess: true,
    })

    await seedContent(payload)

    const removedLegacy = await payload.find({
      collection: 'media',
      limit: 1,
      overrideAccess: true,
      where: { id: { equals: legacy.id } },
    })
    expect(removedLegacy.docs).toHaveLength(0)

    const canonical = await payload.find({
      collection: 'media',
      limit: 1,
      overrideAccess: true,
      where: {
        source: {
          equals:
            'IVYBM seed asset: technical-data-placeholder-v2; locally generated development document; replace with approved technical data before final production acceptance.',
        },
      },
    })
    const downloads = await payload.find({
      collection: 'downloads',
      depth: 0,
      limit: 1,
      locale: 'en',
      overrideAccess: true,
      where: { slug: { equals: 'aluminum-panel-technical-data' } },
    })

    expect(canonical.docs).toHaveLength(1)
    expect(relationID(downloads.docs[0]?.file)).toBe(canonical.docs[0].id)
  })
})
