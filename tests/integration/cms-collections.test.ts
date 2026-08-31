import type { PostgresAdapter } from '@payloadcms/db-postgres'
import { randomUUID } from 'node:crypto'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getPayload, ValidationError, type Payload } from 'payload'

import config from '@/payload.config'

type DocumentID = number

let payload: Payload
let categoryID: DocumentID
let mediaID: DocumentID
let productID: DocumentID
let siteSettingsRows: Array<Record<string, unknown>> = []
let siteSettingsLocaleRows: Array<Record<string, unknown>> = []

const createdDocuments: Array<{
  collection:
    'downloads' | 'media' | 'pages' | 'posts' | 'product-categories' | 'products' | 'projects'
  id: DocumentID
}> = []

const pngData = await sharp({
  create: { background: '#777777', channels: 3, height: 600, width: 800 },
})
  .png()
  .toBuffer()

const uploadTestImage = async (alt: string) => {
  const filename = `task4-${randomUUID()}.png`
  const media = await payload.create({
    collection: 'media',
    data: { alt, isPublic: true, source: 'IVYBM generated integration test fixture' },
    file: {
      data: pngData,
      mimetype: 'image/png',
      name: filename,
      size: pngData.length,
    },
    overrideAccess: true,
  })

  createdDocuments.push({ collection: 'media', id: media.id })
  return media
}

const quoteIdentifier = (identifier: string): string => `"${identifier.replaceAll('"', '""')}"`

const insertRows = async (
  database: PostgresAdapter,
  table: 'site_settings' | 'site_settings_locales',
  rows: Array<Record<string, unknown>>,
) => {
  for (const row of rows) {
    const columns = Object.keys(row)
    const values = Object.values(row)
    const placeholders = values.map((_, index) => `$${index + 1}`).join(', ')

    await database.pool.query(
      `INSERT INTO ${quoteIdentifier(table)} (${columns.map(quoteIdentifier).join(', ')}) VALUES (${placeholders})`,
      values,
    )
  }
}

const restoreSiteSettings = async () => {
  const database = payload.db as unknown as PostgresAdapter

  await database.pool.query('BEGIN')

  try {
    if (siteSettingsRows.length === 0) {
      await database.pool.query('DELETE FROM "site_settings"')
    } else {
      const original = siteSettingsRows[0]
      const id = original.id
      const columns = Object.keys(original).filter((column) => column !== 'id')
      const assignments = columns
        .map((column, index) => `${quoteIdentifier(column)} = $${index + 1}`)
        .join(', ')

      await database.pool.query(
        `UPDATE "site_settings" SET ${assignments} WHERE "id" = $${columns.length + 1}`,
        [...columns.map((column) => original[column]), id],
      )
      await database.pool.query('DELETE FROM "site_settings_locales" WHERE "_parent_id" = $1', [id])
      await insertRows(database, 'site_settings_locales', siteSettingsLocaleRows)
    }

    await database.pool.query('COMMIT')
  } catch (error) {
    await database.pool.query('ROLLBACK')
    throw error
  }
}

describe.sequential('multilingual CMS collections', () => {
  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL is required for CMS integration tests')
    }

    payload = await getPayload({
      config,
      disableOnInit: true,
      key: 'cms-collections-integration-tests',
    })

    const database = payload.db as unknown as PostgresAdapter
    const [settings, locales] = await Promise.all([
      database.pool.query<Record<string, unknown>>('SELECT * FROM "site_settings"'),
      database.pool.query<Record<string, unknown>>('SELECT * FROM "site_settings_locales"'),
    ])
    siteSettingsRows = settings.rows
    siteSettingsLocaleRows = locales.rows
  })

  afterAll(async () => {
    if (!payload) {
      return
    }

    try {
      await restoreSiteSettings()
    } finally {
      for (const document of [...createdDocuments].reverse()) {
        await payload
          .delete({
            collection: document.collection,
            id: document.id,
            overrideAccess: true,
          })
          .catch(() => undefined)
      }

      await payload.destroy()
    }
  })

  it('requires alt text for uploaded media', async () => {
    await expect(
      payload.create({
        collection: 'media',
        data: { source: 'IVYBM generated integration test fixture' } as never,
        file: {
          data: pngData,
          mimetype: 'image/png',
          name: `task4-missing-alt-${randomUUID()}.png`,
          size: pngData.length,
        },
        overrideAccess: true,
      }),
    ).rejects.toBeInstanceOf(ValidationError)

    const media = await uploadTestImage('Aluminum facade sample')
    mediaID = media.id

    expect(media.alt).toBe('Aluminum facade sample')
  })

  it('stores English and Arabic category content under one stable slug', async () => {
    const suffix = randomUUID()
    const title = `Facade Panels ${suffix}`
    const slug = `facade-panels-${suffix}`
    const category = await payload.create({
      collection: 'product-categories',
      data: {
        description: 'Facade panel systems',
        seo: {
          description: 'Facade panel categories and systems',
          title: 'Facade Panel Categories',
        },
        slug: '',
        title,
      },
      fallbackLocale: false,
      locale: 'en',
      overrideAccess: true,
    })
    categoryID = category.id
    createdDocuments.push({ collection: 'product-categories', id: category.id })

    await payload.update({
      collection: 'product-categories',
      data: {
        description: 'أنظمة ألواح الواجهات',
        seo: {
          description: 'فئات وأنظمة ألواح الواجهات',
          title: 'فئات ألواح الواجهات',
        },
        title: 'ألواح الواجهات',
      },
      fallbackLocale: false,
      id: category.id,
      locale: 'ar',
      overrideAccess: true,
    })

    const english = await payload.findByID({
      collection: 'product-categories',
      fallbackLocale: false,
      id: category.id,
      locale: 'en',
      overrideAccess: true,
    })
    const arabic = await payload.findByID({
      collection: 'product-categories',
      fallbackLocale: false,
      id: category.id,
      locale: 'ar',
      overrideAccess: true,
    })

    expect(english.title).toBe(title)
    expect(arabic.title).toBe('ألواح الواجهات')
    expect(english.slug).toBe(slug)
    expect(arabic.slug).toBe(slug)
    expect(english.seo?.title).toBe('Facade Panel Categories')
    expect(arabic.seo?.title).toBe('فئات ألواح الواجهات')
  })

  it('enforces slug uniqueness within a collection', async () => {
    const slug = `unique-category-${randomUUID()}`
    const first = await payload.create({
      collection: 'product-categories',
      data: { slug, title: 'Unique Category' },
      locale: 'en',
      overrideAccess: true,
    })
    createdDocuments.push({ collection: 'product-categories', id: first.id })

    await expect(
      payload.create({
        collection: 'product-categories',
        data: { slug, title: 'Duplicate Category' },
        locale: 'en',
        overrideAccess: true,
      }),
    ).rejects.toBeDefined()
  })

  it('requires a valid stable slug for Arabic-first and publishable content', async () => {
    await expect(
      payload.create({
        collection: 'product-categories',
        data: {
          slug: '',
          title: 'ألواح الواجهات',
        },
        locale: 'ar',
        overrideAccess: true,
      }),
    ).rejects.toBeInstanceOf(ValidationError)

    await expect(
      payload.update({
        collection: 'product-categories',
        data: { slug: 'ألواح-الواجهات' },
        id: categoryID,
        locale: 'ar',
        overrideAccess: true,
      }),
    ).rejects.toBeInstanceOf(ValidationError)

    await expect(
      payload.create({
        collection: 'pages',
        data: {
          _status: 'draft',
          slug: '',
          title: 'من نحن',
        },
        draft: true,
        locale: 'ar',
        overrideAccess: true,
      }),
    ).rejects.toBeInstanceOf(ValidationError)

    const stableSlug = `arabic-first-page-${randomUUID()}`
    const page = await payload.create({
      collection: 'pages',
      data: {
        _status: 'draft',
        slug: stableSlug,
        title: 'من نحن',
      },
      draft: true,
      locale: 'ar',
      overrideAccess: true,
    })
    createdDocuments.push({ collection: 'pages', id: page.id })

    const published = await payload.update({
      collection: 'pages',
      data: { _status: 'published' },
      draft: false,
      id: page.id,
      locale: 'ar',
      overrideAccess: true,
    })

    expect(published._status).toBe('published')
    expect(published.slug).toBe(stableSlug)
  })

  it('supports draft-to-publication transitions and records versions', async () => {
    const slug = `perforated-panel-${randomUUID()}`
    const product = await payload.create({
      collection: 'products',
      data: {
        _status: 'draft',
        category: categoryID,
        coverImage: mediaID,
        seo: {
          description: 'Custom perforated aluminum panels',
          keywords: 'perforated aluminum panel, facade',
          title: 'Perforated Aluminum Panel',
        },
        shortDescription: 'Custom perforation patterns for facade projects.',
        slug,
        title: 'Perforated Aluminum Panel',
      },
      draft: true,
      fallbackLocale: false,
      locale: 'en',
      overrideAccess: true,
    })
    productID = product.id
    createdDocuments.push({ collection: 'products', id: product.id })

    const draftDocument = await payload.findByID({
      collection: 'products',
      draft: true,
      id: product.id,
      overrideAccess: true,
    })

    expect(product._status).toBe('draft')
    expect(draftDocument._status).toBe('draft')

    const published = await payload.update({
      collection: 'products',
      data: { _status: 'published' },
      draft: false,
      id: product.id,
      locale: 'en',
      overrideAccess: true,
    })
    const versions = await payload.findVersions({
      collection: 'products',
      overrideAccess: true,
      where: { parent: { equals: product.id } },
    })

    expect(published._status).toBe('published')
    expect(versions.totalDocs).toBeGreaterThanOrEqual(2)
  })

  it('expands category and media relationships and rejects invalid references', async () => {
    const product = await payload.findByID({
      collection: 'products',
      depth: 1,
      id: productID,
      locale: 'en',
      overrideAccess: true,
    })

    expect(product.category).toMatchObject({ id: categoryID })
    expect(product.coverImage).toMatchObject({ id: mediaID })

    await expect(
      payload.create({
        collection: 'products',
        data: {
          category: 999999999,
          coverImage: mediaID,
          slug: `invalid-reference-${randomUUID()}`,
          title: 'Invalid Relationship',
        },
        locale: 'en',
        overrideAccess: true,
      }),
    ).rejects.toBeDefined()
  })

  it('stores independent English and Arabic SEO text', async () => {
    await payload.update({
      collection: 'products',
      data: {
        seo: {
          description: 'ألواح ألمنيوم مثقبة مخصصة',
          keywords: 'ألواح ألمنيوم مثقبة, واجهات',
          title: 'ألواح ألمنيوم مثقبة',
        },
        shortDescription: 'أنماط تثقيب مخصصة لمشاريع الواجهات.',
        title: 'ألواح ألمنيوم مثقبة',
      },
      id: productID,
      locale: 'ar',
      overrideAccess: true,
    })

    const english = await payload.findByID({
      collection: 'products',
      fallbackLocale: false,
      id: productID,
      locale: 'en',
      overrideAccess: true,
    })
    const arabic = await payload.findByID({
      collection: 'products',
      fallbackLocale: false,
      id: productID,
      locale: 'ar',
      overrideAccess: true,
    })

    expect(english.seo?.title).toBe('Perforated Aluminum Panel')
    expect(arabic.seo?.title).toBe('ألواح ألمنيوم مثقبة')
    expect(arabic.shortDescription).toContain('الواجهات')
    expect(arabic.slug).toBe(english.slug)
  })

  it('creates the remaining localized CMS content and stores internal notes', async () => {
    const suffix = randomUUID()
    const page = await payload.create({
      collection: 'pages',
      data: {
        _status: 'published',
        internalNotes: '仅供后台运营人员查看',
        slug: `about-${suffix}`,
        title: 'About Us',
      },
      draft: false,
      locale: 'en',
      overrideAccess: true,
    })
    const project = await payload.create({
      collection: 'projects',
      data: {
        _status: 'published',
        coverImage: mediaID,
        slug: `airport-facade-${suffix}`,
        title: 'Airport Facade',
      },
      draft: false,
      locale: 'en',
      overrideAccess: true,
    })
    const post = await payload.create({
      collection: 'posts',
      data: {
        _status: 'published',
        category: 'industry',
        contentType: 'news',
        slug: `facade-guide-${suffix}`,
        title: 'Facade Design Guide',
      },
      draft: false,
      locale: 'en',
      overrideAccess: true,
    })
    const download = await payload.create({
      collection: 'downloads',
      data: {
        file: mediaID,
        seo: {
          description: 'Download facade technical data.',
          title: 'Facade Technical Data',
        },
        slug: `technical-data-${suffix}`,
        title: 'Technical Data',
        type: 'technical-data',
      },
      locale: 'en',
      overrideAccess: true,
    })
    createdDocuments.push(
      { collection: 'pages', id: page.id },
      { collection: 'projects', id: project.id },
      { collection: 'posts', id: post.id },
      { collection: 'downloads', id: download.id },
    )

    await Promise.all([
      payload.update({
        collection: 'pages',
        data: { title: 'من نحن' },
        id: page.id,
        locale: 'ar',
        overrideAccess: true,
      }),
      payload.update({
        collection: 'projects',
        data: { title: 'واجهة المطار' },
        id: project.id,
        locale: 'ar',
        overrideAccess: true,
      }),
      payload.update({
        collection: 'posts',
        data: { title: 'دليل تصميم الواجهات' },
        id: post.id,
        locale: 'ar',
        overrideAccess: true,
      }),
      payload.update({
        collection: 'downloads',
        data: {
          seo: {
            description: 'تحميل البيانات الفنية للواجهات.',
            title: 'البيانات الفنية للواجهات',
          },
          title: 'البيانات الفنية',
        },
        id: download.id,
        locale: 'ar',
        overrideAccess: true,
      }),
    ])

    const [arabicPage, arabicProject, arabicPost, arabicDownload] = await Promise.all([
      payload.findByID({
        collection: 'pages',
        fallbackLocale: false,
        id: page.id,
        locale: 'ar',
        overrideAccess: true,
      }),
      payload.findByID({
        collection: 'projects',
        fallbackLocale: false,
        id: project.id,
        locale: 'ar',
        overrideAccess: true,
      }),
      payload.findByID({
        collection: 'posts',
        fallbackLocale: false,
        id: post.id,
        locale: 'ar',
        overrideAccess: true,
      }),
      payload.findByID({
        collection: 'downloads',
        fallbackLocale: false,
        id: download.id,
        locale: 'ar',
        overrideAccess: true,
      }),
    ])

    expect(arabicPage.title).toBe('من نحن')
    expect(arabicProject.title).toBe('واجهة المطار')
    expect(arabicPost.title).toBe('دليل تصميم الواجهات')
    expect(arabicDownload.title).toBe('البيانات الفنية')
    expect(arabicDownload.seo?.title).toBe('البيانات الفنية للواجهات')
    expect(page.internalNotes).toBe('仅供后台运营人员查看')
  })

  it('reads and writes localized site settings', async () => {
    await payload.updateGlobal({
      data: {
        footerText: 'Engineering aluminum facades for global projects.',
        siteDescription: 'Architectural aluminum facade manufacturer',
        siteName: 'IVY Building Materials',
      },
      locale: 'en',
      overrideAccess: true,
      slug: 'site-settings',
    })
    await payload.updateGlobal({
      data: {
        footerText: 'واجهات ألمنيوم هندسية للمشاريع العالمية.',
        siteDescription: 'مصنع واجهات ألمنيوم معمارية',
        siteName: 'آيفي لمواد البناء',
      },
      locale: 'ar',
      overrideAccess: true,
      slug: 'site-settings',
    })

    const english = await payload.findGlobal({
      fallbackLocale: false,
      locale: 'en',
      overrideAccess: true,
      slug: 'site-settings',
    })
    const arabic = await payload.findGlobal({
      fallbackLocale: false,
      locale: 'ar',
      overrideAccess: true,
      slug: 'site-settings',
    })

    expect(english.siteName).toBe('IVY Building Materials')
    expect(arabic.siteName).toBe('آيفي لمواد البناء')
  })

  it('creates locale and version tables for publishable CMS collections', async () => {
    const database = payload.db as unknown as PostgresAdapter
    const result = await database.pool.query<{ table_name: string }>(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name = ANY($1::text[])`,
      [
        [
          'pages_locales',
          '_pages_v',
          '_pages_v_locales',
          'products_locales',
          '_products_v',
          '_products_v_locales',
          'projects_locales',
          '_projects_v',
          '_projects_v_locales',
          'posts_locales',
          '_posts_v',
          '_posts_v_locales',
        ],
      ],
    )

    expect(result.rows.map(({ table_name }) => table_name).sort()).toEqual(
      [
        '_pages_v',
        '_pages_v_locales',
        '_posts_v',
        '_posts_v_locales',
        '_products_v',
        '_products_v_locales',
        '_projects_v',
        '_projects_v_locales',
        'pages_locales',
        'posts_locales',
        'products_locales',
        'projects_locales',
      ].sort(),
    )
  })
})
