// @vitest-environment node

import { createHash } from 'node:crypto'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { redactLogValue } from '../../../scripts/content-import/logging'
import { importContentManifest } from '../../../scripts/content-import/importer'
import { PayloadRestClient, PayloadRestError } from '../../../scripts/content-import/payload-client'

type StoredDocument = {
  id: number
  slug: string
  title: { en: string; ar: string }
  seo: { en: Record<string, string>; ar: Record<string, string> }
  category?: number | string
  coverImage?: number | string
  gallery?: Array<number | string>
  _status: 'draft' | 'published'
  isPublic?: boolean
  filename?: string
  sha256?: string
  mimeType?: string
  alt?: string
  source?: string
}

const digest = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')

class FakePayloadRest {
  writes = 0
  mediaPostAttempts = 0
  mediaPostVisibility: boolean[] = []
  mediaPatchVisibility: boolean[] = []
  failMediaUpload = false
  nextID = 10
  media: StoredDocument[] = []
  products: StoredDocument[] = []
  categories: StoredDocument[] = [
    {
      id: 1,
      slug: 'aluminum-panels',
      title: { en: 'Aluminum Panels', ar: 'ألواح ألمنيوم' },
      seo: { en: {}, ar: {} },
      _status: 'published',
    },
  ]
  bytes = new Map<string, Uint8Array>()

  readonly fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const requestURL = new URL(String(input))
    const method = init?.method ?? 'GET'
    const parts = requestURL.pathname.split('/').filter(Boolean)
    const collection = parts[1]
    const id = parts[2]
    if (collection === 'media' && parts[2] === 'file' && parts[3]) {
      const mediaBytes = this.bytes.get(decodeURIComponent(parts[3]))
      return mediaBytes ? new Response(mediaBytes) : new Response('not found', { status: 404 })
    }
    if (method === 'GET') {
      const docs = this.findDocs(collection, requestURL.searchParams)
      if (id) {
        const document = docs.find((candidate) => String(candidate.id) === decodeURIComponent(id))
        return document
          ? Response.json(this.render(document, requestURL.searchParams.get('locale')))
          : new Response('not found', { status: 404 })
      }
      return Response.json({
        docs: docs.map((document) => this.render(document, requestURL.searchParams.get('locale'))),
        totalDocs: docs.length,
      })
    }
    if (collection === 'media' && method === 'POST') {
      this.mediaPostAttempts += 1
      if (this.failMediaUpload)
        throw new Error('simulated network failure after provider write boundary')
      const form = init?.body as FormData
      const file = form.get('file') as File
      const payload = JSON.parse(String(form.get('_payload'))) as Record<string, unknown>
      const filename = file.name
      const bytes = new Uint8Array(await file.arrayBuffer())
      const document: StoredDocument = {
        id: this.nextID++,
        filename,
        sha256: digest(bytes),
        mimeType: file.type,
        alt: String(payload.alt),
        source: String(payload.source),
        isPublic: payload.isPublic === true,
        slug: filename,
        title: { en: filename, ar: filename },
        seo: { en: {}, ar: {} },
        _status: 'published',
      }
      this.mediaPostVisibility.push(document.isPublic === true)
      this.media.push(document)
      this.bytes.set(filename, bytes)
      this.writes += 1
      return Response.json(document)
    }
    if (collection === 'products' && method === 'POST') {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      const document: StoredDocument = {
        id: this.nextID++,
        slug: String(body.slug ?? 'test-panel'),
        title: { en: String(body.title ?? ''), ar: '' },
        seo: { en: (body.seo ?? {}) as Record<string, string>, ar: {} },
        category: body.category as number | string,
        coverImage: body.coverImage as number | string,
        gallery: body.gallery as Array<number | string>,
        _status: 'draft',
      }
      this.products.push(document)
      this.writes += 1
      return Response.json(document)
    }
    if ((collection === 'products' || collection === 'media') && method === 'PATCH' && id) {
      const store = collection === 'products' ? this.products : this.media
      const document = store.find((candidate) => String(candidate.id) === decodeURIComponent(id))
      if (!document) return new Response('not found', { status: 404 })
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      const locale = (requestURL.searchParams.get('locale') ?? 'en') as 'en' | 'ar'
      if (collection === 'media') {
        if (typeof body.isPublic === 'boolean') this.mediaPatchVisibility.push(body.isPublic)
        Object.assign(document, body)
      }
      else this.updateLocalized(document, body, locale)
      this.writes += 1
      return Response.json(this.render(document, requestURL.searchParams.get('locale')))
    }
    return new Response('unsupported', { status: 404 })
  }

  private findDocs(collection: string, query: URLSearchParams): StoredDocument[] {
    const store =
      collection === 'media'
        ? this.media
        : collection === 'products'
          ? this.products
          : this.categories
    const slug = query.get('where[slug][equals]')
    const filename = query.get('where[filename][equals]')
    return store.filter(
      (document) =>
        (!slug || document.slug === slug) && (!filename || document.filename === filename),
    )
  }

  private updateLocalized(
    document: StoredDocument,
    body: Record<string, unknown>,
    locale: 'en' | 'ar',
  ): void {
    if (typeof body.title === 'string') document.title[locale] = body.title
    if (body.seo && typeof body.seo === 'object')
      document.seo[locale] = body.seo as Record<string, string>
    for (const key of [
      'category',
      'coverImage',
      'gallery',
      '_status',
      'shortDescription',
      'description',
    ]) {
      if (key in body) (document as unknown as Record<string, unknown>)[key] = body[key]
    }
  }

  private render(document: StoredDocument, locale: string | null): PayloadDocumentLike {
    if (locale === 'en' || locale === 'ar') {
      return {
        ...document,
        title: document.title[locale],
        seo: document.seo[locale],
      }
    }
    return { ...document, title: { ...document.title }, seo: { ...document.seo } }
  }
}

type PayloadDocumentLike = Record<string, unknown> & { id: number }

const text = (title: string) => ({
  title,
  shortDescription: `${title} summary`,
  description: `${title} description`,
  seo: {
    title: `${title} SEO`,
    description: `${title} SEO description`,
    keywords: 'aluminum,panel',
  },
})

const makeFixture = async (title = 'Test Panel') => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ivybm-content-import-'))
  const mediaDirectory = path.join(root, 'media')
  await import('node:fs/promises').then(({ mkdir }) => mkdir(mediaDirectory))
  const bytes = new Uint8Array([255, 216, 255, 224, 1, 2, 3])
  const mediaPath = path.join(mediaDirectory, 'panel-01.jpg')
  await writeFile(mediaPath, bytes)
  const manifest = {
    version: 1,
    batch: 'unit-test',
    items: [
      {
        kind: 'product',
        sourceNumbers: ['01'],
        slug: 'test-panel',
        action: 'create',
        categorySlug: 'aluminum-panels',
        locales: { en: text(title), ar: text('لوح اختبار') },
        coverImage: {
          filename: 'panel-01.jpg',
          path: 'media/panel-01.jpg',
          mimeType: 'image/jpeg',
          width: 1,
          height: 1,
          bytes: bytes.byteLength,
          sha256: digest(bytes),
          alt: 'Synthetic panel',
          source: 'Synthetic fixture',
        },
        publish: true,
      },
    ],
  }
  const manifestPath = path.join(root, 'batch-manifest.json')
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  return { manifestPath, manifestSha: digest(new Uint8Array(await readFile(manifestPath))), root }
}

const clientFor = (server: FakePayloadRest): PayloadRestClient =>
  new PayloadRestClient({
    origin: 'http://localhost:43123',
    token: 'synthetic-token',
    fetchImpl: server.fetch,
  })

describe('content importer against fake Payload REST', () => {
  it('performs a dry-run with zero remote writes', async () => {
    const fixture = await makeFixture()
    const server = new FakePayloadRest()
    const summary = await importContentManifest(clientFor(server), fixture.manifestPath, {
      mode: 'dry-run',
      batch: 'products',
    })
    expect(summary.dryRun).toBe(true)
    expect(summary.writes).toBe(0)
    expect(summary.operations[0]).toMatchObject({ status: 'planned', mediaUploaded: 0 })
    expect(server.writes).toBe(0)
  })

  it('uploads once, updates localized drafts, publishes, and reuses slug/media on rerun', async () => {
    const fixture = await makeFixture()
    const server = new FakePayloadRest()
    const first = await importContentManifest(clientFor(server), fixture.manifestPath, {
      mode: 'execute',
      confirmSha: fixture.manifestSha,
      publish: true,
    })
    expect(first.operations[0]).toMatchObject({
      status: 'published',
      mediaUploaded: 1,
      mediaReused: 0,
    })
    expect(server.products).toHaveLength(1)
    expect(server.media).toHaveLength(1)
    expect(server.products[0]._status).toBe('published')
    expect(server.mediaPostVisibility).toEqual([false])
    expect(server.mediaPatchVisibility).toEqual([true])

    const second = await importContentManifest(clientFor(server), fixture.manifestPath, {
      mode: 'execute',
      confirmSha: fixture.manifestSha,
      publish: true,
    })
    expect(second.operations[0]).toMatchObject({
      status: 'published',
      mediaUploaded: 0,
      mediaReused: 1,
    })
    expect(server.products).toHaveLength(1)
    expect(server.media).toHaveLength(1)
  })

  it('writes and resumes an external checkpoint without re-running the item', async () => {
    const fixture = await makeFixture()
    const checkpointPath = path.join(fixture.root, 'checkpoint.json')
    const server = new FakePayloadRest()
    await importContentManifest(clientFor(server), fixture.manifestPath, {
      mode: 'execute',
      confirmSha: fixture.manifestSha,
      checkpointPath,
    })
    const writesBeforeResume = server.writes
    const resumed = await importContentManifest(clientFor(server), fixture.manifestPath, {
      mode: 'execute',
      confirmSha: fixture.manifestSha,
      resumePath: checkpointPath,
    })
    expect(resumed.operations[0].status).toBe('skipped')
    expect(server.writes).toBe(writesBeforeResume)
  })

  it('stops after an unknown media write outcome and never blindly retries', async () => {
    const fixture = await makeFixture()
    const server = new FakePayloadRest()
    server.failMediaUpload = true
    await expect(
      importContentManifest(clientFor(server), fixture.manifestPath, {
        mode: 'execute',
        confirmSha: fixture.manifestSha,
      }),
    ).rejects.toThrow(/unknown/)
    expect(server.mediaPostAttempts).toBe(1)
    expect(server.writes).toBe(0)
  })
})

describe('content import security boundaries', () => {
  it('uses Payload JWT authentication for REST reads', async () => {
    let authorization = ''
    const client = new PayloadRestClient({
      origin: 'http://localhost:43123',
      token: 'synthetic-token',
      fetchImpl: async (_input, init) => {
        authorization = String((init?.headers as Record<string, string>).Authorization)
        return Response.json({ docs: [] })
      },
    })
    await client.find('products', { slug: 'test-panel' })
    expect(authorization).toBe('JWT synthetic-token')
  })

  it('rejects unapproved origins and redacts credential/path/content fields', () => {
    expect(
      () => new PayloadRestClient({ origin: 'https://example.com', token: 'secret-token' }),
    ).toThrow(expect.objectContaining({ code: 'origin-not-allowed' }) as PayloadRestError)
    expect(
      redactLogValue({
        token: 'secret-token',
        sourcePath: '/customer/private/file.docx',
        description: 'full source',
      }),
    ).toEqual({
      token: '[REDACTED]',
      sourcePath: '[OMITTED]',
      description: '[OMITTED]',
    })
  })
})
