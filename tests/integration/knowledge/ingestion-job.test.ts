import { randomUUID } from 'node:crypto'
import { deflateRawSync } from 'node:zlib'

import { NextRequest } from 'next/server'
import type { PostgresAdapter } from '@payloadcms/db-postgres'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createLocalReq, getPayload, type Payload } from 'payload'

import { GET as getSourceFile } from '@/app/api/portal/knowledge/sources/[id]/file/route'
import { GET as getSourceAsset } from '@/app/api/portal/knowledge/sources/[id]/assets/[assetId]/route'
import { POST as uploadKnowledgeSource } from '@/app/api/portal/knowledge/sources/route'
import { createAiGateway, type AiProvider } from '@/modules/ai/gateway'
import { PayloadJobQueue } from '@/modules/jobs/claim'
import { JobWorker } from '@/modules/jobs/worker'
import {
  createKnowledgeIngestJobHandler,
  KNOWLEDGE_INGEST_JOB_TYPE,
} from '@/modules/knowledge/ingestion/jobs'
import { sha256 } from '@/modules/knowledge/ingestion/parser'
import {
  createKnowledgeSourceAndEnqueue,
  retryKnowledgeSource,
} from '@/modules/knowledge/ingestion/source'
import type { User } from '@/payload-types'
import config from '@/payload.config'

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

const makeDocx = (): Buffer => {
  const files = [
    {
      name: 'word/document.xml',
      value: `<?xml version="1.0"?><w:document xmlns:w="x" xmlns:r="r"><w:body><w:p><w:r><w:t>AA3003 aluminum panel price</w:t></w:r><w:drawing r:embed="rId1"/></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Width</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>1200 mm</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>`,
    },
    {
      name: 'word/_rels/document.xml.rels',
      value: '<Relationships><Relationship Id="rId1" Target="media/image1.png"/></Relationships>',
    },
    {
      name: 'word/media/image1.png',
      value: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
        'base64',
      ),
    },
  ]
  const local: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  for (const file of files) {
    const data = Buffer.isBuffer(file.value) ? file.value : Buffer.from(file.value)
    const compressed = deflateRawSync(data)
    const name = Buffer.from(file.name)
    const header = Buffer.alloc(30)
    header.writeUInt32LE(0x04034b50, 0)
    header.writeUInt16LE(20, 4)
    header.writeUInt16LE(8, 8)
    header.writeUInt32LE(compressed.length, 18)
    header.writeUInt32LE(data.length, 22)
    header.writeUInt16LE(name.length, 26)
    local.push(header, name, compressed)
    const entry = Buffer.alloc(46)
    entry.writeUInt32LE(0x02014b50, 0)
    entry.writeUInt16LE(20, 4)
    entry.writeUInt16LE(20, 6)
    entry.writeUInt16LE(8, 10)
    entry.writeUInt32LE(compressed.length, 20)
    entry.writeUInt32LE(data.length, 24)
    entry.writeUInt16LE(name.length, 28)
    entry.writeUInt32LE(offset, 42)
    central.push(entry, name)
    offset += header.length + name.length + compressed.length
  }
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(files.length, 8)
  end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(central.reduce((sum, part) => sum + part.length, 0), 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...local, ...central, end])
}

const assertIsolatedDatabase = () => {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required')
  const url = new URL(process.env.DATABASE_URL)
  const database = decodeURIComponent(url.pathname.replace(/^\//, ''))
  if (!new Set(['127.0.0.1', 'localhost', '::1']).has(url.hostname) || (!database.endsWith('_test') && !database.endsWith('_ci'))) {
    throw new Error('Knowledge ingestion integration tests require a local _test or _ci database')
  }
}

const loginHeader = async (payload: Payload, user: User, password: string): Promise<string> => {
  const login = await payload.login({ collection: 'users', data: { email: user.email, password } })
  return `JWT ${login.token}`
}

describe.sequential('knowledge source ingestion job', () => {
  let payload: Payload
  let admin: User
  let operator: User
  let sales: User
  let operatorAuthorization = ''
  let salesAuthorization = ''
  const sourceIDs: number[] = []
  const userIDs: number[] = []
  const jobIDs: number[] = []
  const promptIDs: number[] = []

  beforeAll(async () => {
    assertIsolatedDatabase()
    payload = await getPayload({ config, disableOnInit: true, key: 'knowledge-ingestion-integration' })
    const suffix = randomUUID()
    for (const role of ['admin', 'operator', 'sales'] as const) {
      const user = await payload.create({
        collection: 'users',
        context: { skipAudit: true },
        data: {
          email: `knowledge-ingestion-${role}-${suffix}@example.invalid`,
          password: 'knowledge-ingestion-test-password',
          role,
        },
        overrideAccess: true,
      })
      userIDs.push(user.id)
      if (role === 'admin') admin = user
      if (role === 'operator') operator = user
      if (role === 'sales') sales = user
    }
    operatorAuthorization = await loginHeader(payload, operator, 'knowledge-ingestion-test-password')
    salesAuthorization = await loginHeader(payload, sales, 'knowledge-ingestion-test-password')
    const prompt = await payload.create({
      collection: 'prompt-templates',
      data: {
        key: `knowledge-translation-${suffix}`,
        locale: 'all',
        purpose: 'translation',
        status: 'active',
        template: 'Translate {{sourceLocale}} into {{targetLocale}} without adding facts.',
        version: 1,
      },
      overrideAccess: true,
    })
    promptIDs.push(prompt.id)
  })

  afterAll(async () => {
    if (!payload) return
    if (sourceIDs.length) {
      await payload.delete({ collection: 'knowledge-documents', overrideAccess: true, where: { ingestionSource: { in: sourceIDs } } })
      await payload.delete({ collection: 'knowledge-source-assets', overrideAccess: true, where: { source: { in: sourceIDs } } })
      await payload.delete({ collection: 'knowledge-source-documents', overrideAccess: true, where: { id: { in: sourceIDs } } })
    }
    if (jobIDs.length) await payload.delete({ collection: 'jobs', overrideAccess: true, where: { id: { in: jobIDs } } })
    if (promptIDs.length) await payload.delete({ collection: 'prompt-templates', overrideAccess: true, where: { id: { in: promptIDs } } })
    await payload.delete({ collection: 'portal-command-receipts', overrideAccess: true, where: { actor: { in: userIDs } } })
    await payload.delete({ collection: 'audit-logs', overrideAccess: true, where: { actor: { in: userIDs } } })
    await payload.delete({ collection: 'users', context: { skipAudit: true }, overrideAccess: true, where: { id: { in: userIDs } } })
    await payload.destroy()
  })

  const upload = async (version: string) => {
    const data = makeDocx()
    const req = await createLocalReq({ user: operator }, payload)
    const result = await createKnowledgeSourceAndEnqueue({
      file: { data, mimetype: DOCX_MIME, name: `synthetic-${version}.docx`, size: data.length },
      metadata: { originalLanguage: 'en', sourceTitle: `Synthetic source ${version}`, sourceType: 'technical-specification', sourceVersion: version },
      payload,
      req,
    })
    sourceIDs.push(Number(result.source.id))
    jobIDs.push(result.job.id)
    return { data, req, result }
  }

  const gateway = (failure: 'all' | 'arabic' | 'none' = 'none') => {
    const generateText = vi.fn<AiProvider['generateText']>(async ({ input, instructions, model }) => {
      if (failure === 'all' || (failure === 'arabic' && instructions?.includes('Arabic'))) {
        throw new Error('simulated translation outage')
      }
      return {
        model,
        text: `${instructions?.includes('Arabic') ? 'نص مترجم' : 'Translated text'}: ${input}`,
        usage: { inputTokens: input.length, outputTokens: input.length, totalTokens: input.length * 2 },
      }
    })
    return createAiGateway({
      operations: {
        text: {
          model: 'knowledge-translation-test-model',
          provider: { embed: vi.fn(), generateText, name: 'knowledge-ingestion-test' },
        },
      },
    })
  }

  it('protects and idempotently accepts the multipart Portal upload command', async () => {
    const data = makeDocx()
    const version = `portal-${randomUUID()}`
    const request = (authorization?: string) => {
      const form = new FormData()
      form.set('file', new File([data], 'portal-source.docx', { type: DOCX_MIME }))
      form.set('originalLanguage', 'en')
      form.set('sourceTitle', `Portal source ${version}`)
      form.set('sourceType', 'technical-specification')
      form.set('sourceVersion', version)
      return new NextRequest('http://localhost/api/portal/knowledge/sources', {
        body: form,
        headers: {
          ...(authorization ? { authorization } : {}),
          'Idempotency-Key': `knowledge-ingestion-${version}`,
        },
        method: 'POST',
      })
    }

    expect((await uploadKnowledgeSource(request())).status).toBe(401)
    expect((await uploadKnowledgeSource(request(salesAuthorization))).status).toBe(403)
    const created = await uploadKnowledgeSource(request(operatorAuthorization))
    expect(created.status).toBe(201)
    const createdBody = (await created.json()) as { job: { id: number } & Record<string, unknown>; source: { id: number } }
    sourceIDs.push(createdBody.source.id)
    jobIDs.push(createdBody.job.id)
    for (const forbidden of ['payload', 'ownerToken', 'leaseExpiresAt', 'lastError']) {
      expect(createdBody.job).not.toHaveProperty(forbidden)
    }
    const duplicate = await uploadKnowledgeSource(request(operatorAuthorization))
    // An idempotency receipt replays the original HTTP result exactly.
    expect(duplicate.status).toBe(201)
    const duplicateBody = (await duplicate.json()) as { job: { id: number } & Record<string, unknown>; source: { id: number } }
    expect(duplicateBody).toMatchObject({
      job: { id: createdBody.job.id },
      source: { id: createdBody.source.id },
    })
    for (const forbidden of ['payload', 'ownerToken', 'leaseExpiresAt', 'lastError']) {
      expect(duplicateBody.job).not.toHaveProperty(forbidden)
    }
    const worker = new JobWorker({
      handlers: { [KNOWLEDGE_INGEST_JOB_TYPE]: createKnowledgeIngestJobHandler({ payload, resolveGateway: async () => gateway() }) },
      queue: new PayloadJobQueue({ payload }),
    })
    await expect(worker.runOnce()).resolves.toBe('succeeded')
  })

  it('serializes concurrent uploads with different command keys for the same hash and version', async () => {
    const data = makeDocx()
    const version = `concurrent-${randomUUID()}`
    const request = (key: string) => {
      const form = new FormData()
      form.set('file', new File([data], 'concurrent-source.docx', { type: DOCX_MIME }))
      form.set('originalLanguage', 'en')
      form.set('sourceTitle', `Concurrent source ${version}`)
      form.set('sourceType', 'technical-specification')
      form.set('sourceVersion', version)
      return new NextRequest('http://localhost/api/portal/knowledge/sources', {
        body: form,
        headers: {
          authorization: operatorAuthorization,
          'Idempotency-Key': `knowledge-ingestion-${version}-${key}`,
        },
        method: 'POST',
      })
    }

    const responses = await Promise.all([
      uploadKnowledgeSource(request('first')),
      uploadKnowledgeSource(request('second')),
    ])
    expect(responses.map((response) => response.status).sort()).toEqual([200, 201])
    const results = await Promise.all(responses.map(async (response) => response.json() as Promise<{
      job: { id: number }
      source: { id: number }
      state: 'created' | 'duplicate'
    }>))
    expect(results.map((result) => result.state).sort()).toEqual(['created', 'duplicate'])
    expect(new Set(results.map((result) => result.source.id))).toHaveProperty('size', 1)
    expect(new Set(results.map((result) => result.job.id))).toHaveProperty('size', 1)
    sourceIDs.push(results[0].source.id)
    jobIDs.push(results[0].job.id)
  })

  it('deduplicates upload, creates private EN/AR drafts, and protects source files', async () => {
    const uploaded = await upload(`happy-${randomUUID()}`)
    const duplicate = await createKnowledgeSourceAndEnqueue({
      file: { data: uploaded.data, mimetype: DOCX_MIME, name: 'duplicate-name.docx', size: uploaded.data.length },
      metadata: {
        originalLanguage: 'en',
        sourceTitle: 'Different display title does not duplicate billing',
        sourceType: 'other',
        sourceVersion: uploaded.result.source.sourceVersion,
      },
      payload,
      req: uploaded.req,
    })
    expect(duplicate).toMatchObject({ job: { id: uploaded.result.job.id }, source: { id: uploaded.result.source.id }, state: 'duplicate' })

    const worker = new JobWorker({
      handlers: {
        [KNOWLEDGE_INGEST_JOB_TYPE]: createKnowledgeIngestJobHandler({ payload, resolveGateway: async () => gateway() }),
      },
      queue: new PayloadJobQueue({ payload }),
    })
    await expect(worker.runOnce()).resolves.toBe('succeeded')

    const source = await payload.findByID({ collection: 'knowledge-source-documents', id: uploaded.result.source.id, overrideAccess: true })
    expect(source).toMatchObject({ detectedLanguage: 'en', imageCount: 1, parserVersion: 'task8-ingestion-v1', processingStage: 'complete', processingStatus: 'needs_review' })
    const outputs = await payload.find({ collection: 'knowledge-documents', overrideAccess: true, pagination: false, where: { ingestionSource: { equals: source.id } } })
    expect(outputs.docs).toHaveLength(2)
    expect(outputs.docs.map((document) => document.locale).sort()).toEqual(['ar', 'en'])
    for (const document of outputs.docs) {
      expect(document).toMatchObject({
        customerVisible: false,
        generationModel: 'knowledge-translation-test-model',
        generationPromptVersion: 1,
        indexStatus: 'pending',
        reviewStatus: 'draft',
        riskTopics: expect.arrayContaining(['price']),
        sourceHash: uploaded.result.source.sourceHash,
      })
    }
    const assets = await payload.find({ collection: 'knowledge-source-assets', overrideAccess: true, pagination: false, where: { source: { equals: source.id } } })
    expect(assets.docs).toHaveLength(1)
    expect(assets.docs[0]).toMatchObject({ accessibility: 'preview-only', originalName: 'image1.png', sequence: 1 })

    const anonymous = await getSourceFile(new NextRequest(`http://localhost/api/portal/knowledge/sources/${source.id}/file`), { params: Promise.resolve({ id: String(source.id) }) })
    expect(anonymous.status).toBe(401)
    const forbidden = await getSourceFile(new NextRequest(`http://localhost/api/portal/knowledge/sources/${source.id}/file`, { headers: { authorization: salesAuthorization } }), { params: Promise.resolve({ id: String(source.id) }) })
    expect(forbidden.status).toBe(403)
    const original = await getSourceFile(new NextRequest(`http://localhost/api/portal/knowledge/sources/${source.id}/file`, { headers: { authorization: operatorAuthorization } }), { params: Promise.resolve({ id: String(source.id) }) })
    expect(original.status).toBe(200)
    expect(Buffer.from(await original.arrayBuffer())).toEqual(uploaded.data)
    const preview = await getSourceAsset(new NextRequest(`http://localhost/api/portal/knowledge/sources/${source.id}/assets/${assets.docs[0].id}`, { headers: { authorization: operatorAuthorization } }), { params: Promise.resolve({ assetId: String(assets.docs[0].id), id: String(source.id) }) })
    expect(preview.status).toBe(200)
    expect(preview.headers.get('cache-control')).toBe('private, no-store')

    const operatorReq = await createLocalReq({ user: operator }, payload)
    const safeSource = await payload.findByID({ collection: 'knowledge-source-documents', id: source.id, overrideAccess: false, req: operatorReq })
    expect(safeSource).not.toHaveProperty('currentJobOwnerToken')
    await expect(payload.update({ collection: 'knowledge-source-documents', data: { processingStatus: 'archived' }, id: source.id, overrideAccess: false, req: operatorReq })).rejects.toThrow()

    for (const output of outputs.docs) {
      await payload.update({ collection: 'knowledge-documents', data: { customerVisible: true }, id: output.id, overrideAccess: true })
      await payload.update({ collection: 'knowledge-documents', data: { reviewStatus: 'reviewed' }, id: output.id, overrideAccess: true })
      await payload.update({ collection: 'knowledge-documents', data: { embeddingModel: 'stale-model', embeddingSpace: 'stale-space', indexStatus: 'ready', indexedAt: new Date().toISOString() }, id: output.id, overrideAccess: true })
    }
    const replacement = await createKnowledgeSourceAndEnqueue({
      file: { data: uploaded.data, mimetype: DOCX_MIME, name: 'replacement.docx', size: uploaded.data.length },
      metadata: {
        originalLanguage: 'en',
        sourceTitle: source.sourceTitle,
        sourceType: source.sourceType,
        sourceVersion: `replacement-${randomUUID()}`,
      },
      payload,
      req: uploaded.req,
    })
    sourceIDs.push(Number(replacement.source.id))
    jobIDs.push(replacement.job.id)
    for (const output of outputs.docs) {
      await expect(payload.findByID({ collection: 'knowledge-documents', id: output.id, overrideAccess: true })).resolves.toMatchObject({
        customerVisible: false,
        indexStatus: 'pending',
        reviewStatus: 'draft',
      })
    }
    await expect(worker.runOnce()).resolves.toBe('succeeded')
  })

  it('keeps partial failures private and allows only an admin-controlled retry', async () => {
    const uploaded = await upload(`retry-${randomUUID()}`)
    const failingWorker = new JobWorker({
      handlers: { [KNOWLEDGE_INGEST_JOB_TYPE]: createKnowledgeIngestJobHandler({ payload, resolveGateway: async () => gateway('arabic') }) },
      queue: new PayloadJobQueue({ payload }),
    })
    await expect(failingWorker.runOnce()).resolves.toBe('failed')
    await expect(payload.findByID({ collection: 'knowledge-source-documents', id: uploaded.result.source.id, overrideAccess: true })).resolves.toMatchObject({ processingStatus: 'failed' })
    const outputs = await payload.find({ collection: 'knowledge-documents', overrideAccess: true, where: { ingestionSource: { equals: uploaded.result.source.id } } })
    expect(outputs.totalDocs).toBe(0)

    await expect(retryKnowledgeSource({ actor: { id: operator.id, role: 'operator' }, id: Number(uploaded.result.source.id), payload, req: uploaded.req })).rejects.toMatchObject({ status: 403 })
    const adminReq = await createLocalReq({ user: admin }, payload)
    await expect(retryKnowledgeSource({ actor: { id: admin.id, role: 'admin' }, id: Number(uploaded.result.source.id), payload, req: adminReq })).resolves.toMatchObject({ source: { processingStatus: 'queued' } })
    const succeedingWorker = new JobWorker({
      handlers: { [KNOWLEDGE_INGEST_JOB_TYPE]: createKnowledgeIngestJobHandler({ payload, resolveGateway: async () => gateway() }) },
      queue: new PayloadJobQueue({ payload }),
    })
    await expect(succeedingWorker.runOnce()).resolves.toBe('succeeded')
    await expect(payload.findByID({ collection: 'knowledge-source-documents', id: uploaded.result.source.id, overrideAccess: true })).resolves.toMatchObject({ processingStatus: 'needs_review' })
  })

  it('cascades private assets when their required source is deleted', async () => {
    const sourceFile = makeDocx()
    const suffix = randomUUID()
    const source = await payload.create({
      collection: 'knowledge-source-documents',
      context: { knowledgeIngestion: true, skipAudit: true },
      data: {
        ingestionRevision: `cascade-${suffix}`,
        originalLanguage: 'en',
        processingStage: 'queued',
        processingStatus: 'queued',
        sourceHash: sha256(sourceFile),
        sourceTitle: `Cascade source ${suffix}`,
        sourceType: 'technical-specification',
        sourceVersion: suffix,
      },
      file: { data: sourceFile, mimetype: DOCX_MIME, name: `cascade-${suffix}.docx`, size: sourceFile.length },
      overrideAccess: true,
    })
    sourceIDs.push(source.id)

    const database = (payload.db as unknown as PostgresAdapter).pool
    const inserted = await database.query<{ id: number }>(
      `INSERT INTO knowledge_source_assets
        (source_id, sequence, original_name, sha256, byte_size, accessibility)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [source.id, 1, 'cascade.png', 'a'.repeat(64), 1, 'private'],
    )
    const assetID = inserted.rows[0].id

    await payload.delete({ collection: 'knowledge-source-documents', id: source.id, overrideAccess: true })
    const remaining = await payload.find({
      collection: 'knowledge-source-assets',
      overrideAccess: true,
      pagination: false,
      where: { id: { equals: assetID } },
    })
    expect(remaining.docs).toHaveLength(0)
  })
})
