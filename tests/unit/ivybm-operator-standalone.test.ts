import { spawn } from 'node:child_process'
import fsp from 'node:fs/promises'
import { createServer, type RequestListener, type Server } from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const source = path.resolve('docs/skills/ivybm-operator')
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aMhUAAAAASUVORK5CYII=', 'base64')

// This suite uses real Node fetch/CLI transport, not a real Payload database or account.
describe('IVYBM Operator standalone package (local HTTP fixtures)', () => {
  let testDir: string
  let workingDir: string
  let entry: string
  let servers: Server[]

  beforeEach(async () => {
    servers = []
    testDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'ivybm-standalone-'))
    workingDir = path.join(testDir, 'customer working directory')
    const installed = path.join(testDir, 'installed skills', 'ivybm-operator')
    await fsp.mkdir(workingDir, { recursive: true })
    await fsp.cp(source, installed, { recursive: true })
    await fsp.cp(source, installed, { recursive: true })
    entry = path.join(installed, 'bin', 'runner.cjs')
  })

  afterEach(async () => {
    await Promise.all(servers.map(server => new Promise<void>((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve())
      server.closeAllConnections()
    })))
    await fsp.rm(testDir, { recursive: true })
  })

  async function serve(handler: RequestListener) {
    const server = createServer(handler)
    servers.push(server)
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Fixture did not bind a TCP port')
    return `http://127.0.0.1:${address.port}`
  }

  async function cli(endpoint: string, args: string[]) {
    const child = spawn(process.execPath, [entry, ...args], {
      cwd: workingDir,
      env: {
        ...process.env,
        IVYBM_ENDPOINT: endpoint,
        IVYBM_TOKEN: 'fixture-only-token',
        IVYBM_AUTH_DIR: path.join(testDir, 'auth'),
      },
      timeout: 5000,
    })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk })
    child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk })
    const code = await new Promise<number | null>((resolve, reject) => {
      child.once('error', reject)
      child.once('close', resolve)
    })
    return { code, stdout, stderr }
  }

  it('runs after repeat installation from a different working directory and rejects invalid flags as JSON', async () => {
    const help = await cli('http://127.0.0.1:1', [])
    expect(help.code).toBe(0)
    expect(JSON.parse(help.stdout).version).toBe('1.0.1-rc.2')
    const invalid = await cli('http://127.0.0.1:1', ['media', 'upload', '--public=no'])
    expect(invalid.code).toBe(1)
    expect(JSON.parse(invalid.stderr).error).toContain('--public')
    expect(invalid.stdout).toBe('')
  })

  it('never forwards login credentials or write payloads to a redirect destination', async () => {
    let forwarded = 0
    const destination = await serve((req, res) => {
      forwarded++
      req.resume()
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ token: 'fixture-token', result: { id: 15 } }))
    })
    const origin = await serve((req, res) => {
      req.resume()
      res.writeHead(307, { Location: `${destination}/outside` })
      res.end()
    })
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const installedRunner = require(entry)
    await expect(installedRunner.executeLogin({
      endpoint: origin, username: 'fixture-user', password: 'fixture-password', authDir: path.join(testDir, 'auth'),
    })).rejects.toThrow()
    await expect(fsp.access(path.join(testDir, 'auth', 'auth.json'))).rejects.toThrow()
    const write = await cli(origin, [
      'content', 'upsert', '--type', 'products', '--locale', 'en',
      '--data', '{"title":"Fixture","slug":"fixture"}', '--idempotency-key', 'fixture.redirect-key-1234',
    ])
    expect(write.code).toBe(1)
    expect(JSON.parse(write.stderr).error).toContain('fixture.redirect-key-1234')
    expect(forwarded).toBe(0)
  })

  it('transmits media, EN→AR and complete social draft→update→review from the installed package', async () => {
    const requests: { method: string; url: string; key: string; auth: string; body: string }[] = []
    const endpoint = await serve((req, res) => {
      const chunks: Buffer[] = []
      req.on('data', chunk => chunks.push(chunk))
      req.on('end', () => {
        const body = Buffer.concat(chunks).toString()
        requests.push({ method: req.method!, url: req.url!, key: String(req.headers['idempotency-key']), auth: String(req.headers.authorization), body })
        res.writeHead(200, { 'Content-Type': 'application/json' })
        if (req.url === '/api/portal/media') {
          res.end(JSON.stringify({ result: { id: 101, previewUrl: '/api/media/file/panel.png' } }))
        } else if (req.url?.startsWith('/api/portal/content/products')) {
          res.end(JSON.stringify({ result: { id: 15, updatedAt: req.method === 'PATCH' ? 'revision-ar' : 'revision-en' } }))
        } else if (req.url === '/api/portal/content-studio') {
          res.end(JSON.stringify({ content: { id: 88, status: 'draft', updatedAt: 'draft-created' }, duplicate: false }))
        } else if (req.method === 'PATCH') {
          res.end(JSON.stringify({ content: { id: 88, status: 'draft', updatedAt: 'draft-updated' } }))
        } else {
          res.end(JSON.stringify({ content: { id: 88, status: 'review', updatedAt: 'draft-reviewed' } }))
        }
      })
    })
    const image = 'panel image.png'
    await fsp.writeFile(path.join(workingDir, image), png)
    const publicMedia = await cli(endpoint, ['media', 'upload', '--public', image, '--alt', 'Fixture panel', '--idempotency-key', 'fixture.public-image-1234'])
    expect(publicMedia.code).toBe(0)
    expect(JSON.parse(publicMedia.stdout).result.id).toBe(101)
    const privateMedia = await cli(endpoint, ['media', 'upload', image, '--public=false', '--idempotency-key', 'fixture.private-image-1234'])
    expect(privateMedia.code).toBe(0)
    const product = { title: 'Fixture Panel', slug: 'fixture-panel', categoryId: 2, coverImageId: 101 }
    await fsp.writeFile(path.join(workingDir, 'product en.json'), JSON.stringify(product))
    const en = await cli(endpoint, ['content', 'upsert', '--type', 'products', '--locale', 'en', '--file', 'product en.json', '--idempotency-key', 'fixture.product-en-1234'])
    expect(en.code).toBe(0)
    const created = JSON.parse(en.stdout).result
    const ar = await cli(endpoint, ['content', 'upsert', '--type', 'products', '--id', String(created.id), '--locale', 'ar', '--updatedAt', created.updatedAt, '--data', JSON.stringify({ ...product, title: 'لوح تجريبي' }), '--idempotency-key', 'fixture.product-ar-1234'])
    expect(ar.code).toBe(0)
    expect(JSON.parse(ar.stdout).result.updatedAt).toBe('revision-ar')
    const draft = { title: 'Fixture post', body: 'Verified fixture facts', platform: 'linkedin', contentType: 'post', contentLocale: 'en', assets: [101] }
    const social = await cli(endpoint, ['social', 'draft-create', '--data', JSON.stringify(draft), '--idempotency-key', 'fixture.draft-create-1234'])
    expect(social.code).toBe(0)
    const content = JSON.parse(social.stdout).content
    expect(content.status).toBe('draft')
    const update = await cli(endpoint, ['social', 'draft-update', '--id', String(content.id), '--updatedAt', content.updatedAt, '--data', JSON.stringify(draft), '--idempotency-key', 'fixture.draft-update-1234'])
    expect(update.code).toBe(0)
    expect(JSON.parse(update.stdout).content.status).toBe('draft')
    const submit = await cli(endpoint, ['social', 'draft-submit', '--id', String(content.id), '--updatedAt', JSON.parse(update.stdout).content.updatedAt, '--idempotency-key', 'fixture.draft-submit-1234'])
    expect(submit.code).toBe(0)
    expect(JSON.parse(submit.stdout).content.status).toBe('review')
    expect(requests).toHaveLength(7)
    expect(requests.map(({ method, url }) => [method, url])).toEqual([
      ['POST', '/api/portal/media'],
      ['POST', '/api/portal/media'],
      ['POST', '/api/portal/content/products'],
      ['PATCH', '/api/portal/content/products/15'],
      ['POST', '/api/portal/content-studio'],
      ['PATCH', '/api/portal/content-studio/88'],
      ['POST', '/api/portal/content-studio/88'],
    ])
    expect(requests[0].body).toContain('name="isPublic"\r\n\r\ntrue')
    expect(requests[1].body).toContain('name="isPublic"\r\n\r\nfalse')
    expect(JSON.parse(requests[3].body)).toEqual({ ...product, title: 'لوح تجريبي', locale: 'ar', updatedAt: 'revision-en' })
    expect(JSON.parse(requests[4].body)).toEqual({ ...draft, knowledgeSources: [], sourceReferences: [], idempotencyKey: requests[4].key })
    expect(JSON.parse(requests[5].body)).toEqual({ ...draft, updatedAt: 'draft-created' })
    expect(JSON.parse(requests[6].body)).toEqual({ action: 'submit-review', updatedAt: 'draft-updated' })
    expect(requests.every(({ auth, key }) => auth === 'JWT fixture-only-token' && /^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$/.test(key))).toBe(true)
    expect(new Set(requests.map(({ key }) => key)).size).toBe(7)
  })

  it('uploads per-image descriptions and sources and reads back a complete bilingual case with its cover and gallery', async () => {
    const media: { id: number; name: string; alt: string; source: string; isPublic: string; bytes: Buffer }[] = []
    const writes: { method: string; url: string; body: Record<string, unknown> }[] = []
    const keys: string[] = []
    const records = new Map<string, Record<string, unknown>>()
    const versions = { en: '2026-10-22T01:00:00.000Z', ar: '2026-10-22T01:00:01.000Z' }
    const endpoint = await serve((req, res) => {
      const chunks: Buffer[] = []
      req.on('data', chunk => chunks.push(chunk))
      req.on('end', () => { void (async () => {
        const buffer = Buffer.concat(chunks)
        if (req.method !== 'GET') keys.push(String(req.headers['idempotency-key']))
        res.setHeader('Content-Type', 'application/json')
        if (req.method === 'POST' && req.url === '/api/portal/media') {
          // Inspect the actual wire bytes without mixing jsdom File with Node FormData.
          const boundary = String(req.headers['content-type']).split('boundary=')[1]
          const parts = new Map<string, { bytes: Buffer; filename?: string }>()
          for (const part of buffer.toString('latin1').split(`--${boundary}`)) {
            const separator = part.indexOf('\r\n\r\n')
            if (separator < 0) continue
            const header = part.slice(0, separator)
            const name = /\bname="([^"]+)"/.exec(header)![1]
            parts.set(name, { bytes: Buffer.from(part.slice(separator + 4, -2), 'latin1'), filename: /\bfilename="([^"]+)"/.exec(header)?.[1] })
          }
          const file = parts.get('file')!
          const id = 301 + media.length
          media.push({ id, name: file.filename!, alt: parts.get('alt')!.bytes.toString('utf8'), source: parts.get('source')!.bytes.toString('utf8'), isPublic: parts.get('isPublic')!.bytes.toString('utf8'), bytes: file.bytes })
          res.end(JSON.stringify({ result: { id, previewUrl: `/media/${file.filename}` } }))
        } else if ((req.method === 'POST' && req.url === '/api/portal/content/projects') || (req.method === 'PATCH' && req.url === '/api/portal/content/projects/71')) {
          const body = JSON.parse(buffer.toString())
          writes.push({ method: req.method, url: req.url!, body })
          const data = { ...body }
          delete data.locale
          delete data.action
          delete data.updatedAt
          records.set(body.locale, data)
          res.end(JSON.stringify({ result: { id: 71, status: 'draft', updatedAt: versions[body.locale as 'en' | 'ar'] } }))
        } else if (req.method === 'GET' && req.url?.startsWith('/api/portal/content/projects/71?locale=')) {
          const locale = new URL(req.url, endpoint).searchParams.get('locale')!
          res.end(JSON.stringify({ options: {}, record: { id: 71, locale, status: 'draft', updatedAt: versions.ar, data: records.get(locale) } }))
        } else {
          res.statusCode = 404
          res.end(JSON.stringify({ error: { message: 'Unexpected fixture route' } }))
        }
      })().catch(error => { res.statusCode = 500; res.end(JSON.stringify({ error: { message: String(error) } })) }) })
    })
    const images = [
      { name: 'hall overview.png', alt: 'Aluminum ceiling viewed from the main hall', source: 'Fixture company — own photography' },
      { name: 'panel detail.png', alt: 'Close view of the aluminum ceiling panels', source: 'Fixture photographer — licensed for internal use' },
      { name: 'installation.png', alt: 'Ceiling installation shown in the supplied project photos', source: 'Fixture company — installation team photography' },
    ]
    const ids: number[] = []
    for (const [index, image] of images.entries()) {
      await fsp.writeFile(path.join(workingDir, image.name), png)
      const uploaded = await cli(endpoint, ['media', 'upload', image.name, '--alt', image.alt, '--source', image.source, '--public=false', '--idempotency-key', `fixture.case-image-${index}-1234`])
      expect(uploaded.code, uploaded.stderr).toBe(0)
      ids.push(JSON.parse(uploaded.stdout).result.id)
    }
    expect(media).toEqual(images.map((image, index) => ({ ...image, id: ids[index], isPublic: 'false', bytes: png })))
    const en = {
      title: 'Aluminum Ceiling Case', slug: 'aluminum-ceiling-case', summary: 'A supplied aluminum ceiling installation case.', bodyText: 'The supplied project brief describes aluminum ceiling panels used in the main hall.',
      location: 'Doha, Qatar', application: 'Main hall ceiling', projectSnapshot: 'Aluminum ceiling installation in the main hall.', observedFocus: 'Ceiling layout shown in the supplied drawings.', solutionFramework: '', qualityVerification: '',
      coverImageId: ids[0], galleryIds: ids.slice(1), seoTitle: 'Aluminum Ceiling Case | IVYBM', seoDescription: 'An aluminum ceiling installation case with supplied project photographs.', action: 'save-draft',
    }
    const created = await cli(endpoint, ['content', 'upsert', '--type', 'projects', '--locale', 'en', '--data', JSON.stringify(en), '--idempotency-key', 'fixture.case-create-en-1234'])
    expect(created.code).toBe(0)
    const result = JSON.parse(created.stdout).result
    expect(result).toEqual({ id: 71, status: 'draft', updatedAt: versions.en })
    const ar = { ...en, title: 'مشروع أسقف ألومنيوم', summary: 'مشروع تركيب أسقف ألومنيوم حسب المواد المقدمة.', bodyText: 'يوضح موجز المشروع استخدام ألواح أسقف ألومنيوم في القاعة الرئيسية.', location: 'الدوحة، قطر', application: 'سقف القاعة الرئيسية', projectSnapshot: 'تركيب أسقف ألومنيوم في القاعة الرئيسية.', observedFocus: 'توزيع السقف الموضح في الرسومات المقدمة.', seoTitle: 'مشروع أسقف ألومنيوم | IVYBM', seoDescription: 'مشروع تركيب أسقف ألومنيوم مع صور المشروع المقدمة.' }
    const updated = await cli(endpoint, ['content', 'upsert', '--type', 'projects', '--id', String(result.id), '--locale', 'ar', '--updatedAt', result.updatedAt, '--data', JSON.stringify(ar), '--idempotency-key', 'fixture.case-update-ar-1234'])
    expect(updated.code).toBe(0)
    expect(JSON.parse(updated.stdout).result).toEqual({ id: 71, status: 'draft', updatedAt: versions.ar })
    expect(writes).toEqual([
      { method: 'POST', url: '/api/portal/content/projects', body: { ...en, locale: 'en' } },
      { method: 'PATCH', url: '/api/portal/content/projects/71', body: { ...ar, locale: 'ar', updatedAt: versions.en } },
    ])
    for (const [locale, payload] of [['en', en], ['ar', ar]] as const) {
      const read = await cli(endpoint, ['content', 'get', '--type', 'projects', '--id', String(result.id), '--locale', locale])
      expect(read.code).toBe(0)
      const expectedData: Record<string, unknown> = { ...payload }
      delete expectedData.action
      expect(JSON.parse(read.stdout).record).toEqual({ id: 71, locale, status: 'draft', updatedAt: versions.ar, data: expectedData })
    }
    expect(keys).toHaveLength(5)
    expect(new Set(keys).size).toBe(5)
    expect(keys.every(key => /^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$/.test(key))).toBe(true)
  })

  it('stops after a committed write loses its response and replays the same key without another creation', async () => {
    let creations = 0
    const receipts = new Map<string, { result: { id: number } }>()
    const requests: { key: string; body: string }[] = []
    const endpoint = await serve((req, res) => {
      let body = ''
      req.on('data', chunk => { body += chunk })
      req.on('end', () => {
        const key = String(req.headers['idempotency-key'])
        requests.push({ key, body })
        if (!receipts.has(key)) {
          creations++
          receipts.set(key, { result: { id: 15 } })
          res.writeHead(201, { 'Content-Type': 'application/json', 'Content-Length': '1000', Connection: 'close' })
          res.end('{"result":')
        } else {
          res.writeHead(201, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify(receipts.get(key)))
        }
      })
    })
    const args = ['content', 'upsert', '--type', 'products', '--locale', 'en', '--data', '{"title":"Fixture","slug":"fixture"}', '--idempotency-key', 'fixture.committed-key-1234']
    const first = await cli(endpoint, args)
    expect(first.code).toBe(1)
    expect(first.stdout).toBe('')
    expect(JSON.parse(first.stderr).error).toContain('复用 --idempotency-key fixture.committed-key-1234')
    expect(requests).toHaveLength(1)
    const retry = await cli(endpoint, args)
    expect(retry.code).toBe(0)
    expect(JSON.parse(retry.stdout).result.id).toBe(15)
    expect(requests).toHaveLength(2)
    expect(requests[1]).toEqual(requests[0])
    expect(creations).toBe(1)
  })
})
