import { randomUUID } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import type { PostgresAdapter } from '@payloadcms/db-postgres'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createLocalReq, getPayload, type Payload } from 'payload'

import { contentStudioInternalWriteContext } from '@/access/contentStudio'
import { executePortalCommand } from '@/admin-portal/core/commands/portalCommandReceipts'
import { ContentStudioCommandError } from '@/admin-portal/modules/content-studio/contentStudioCommands'
import {
  adoptContentStudioImage,
  generateContentStudioImage,
  reviewContentStudioDraft,
  submitContentStudioReview,
} from '@/admin-portal/modules/content-studio/contentStudioCommands'
import { publishContentStudioNow } from '@/admin-portal/modules/content-studio/publishContentStudio'
import { PLATFORM_PUBLICATION_JOB_TYPE } from '@/modules/platforms/publicationJobs'
import type { GeneratedContent, Media, User } from '@/payload-types'
import config from '@/payload.config'

let payload: Payload
let admin: User
let operator: User
let media: Media
let knowledgeDocumentID = 0
let originalEncryptionKey: string | undefined
let originalServerURL: string | undefined
const accountIDs: number[] = []
const contentIDs: number[] = []
const generatedMediaIDs: number[] = []
const knowledgeSourceURL = 'https://example.invalid/reviewed-facade-publication-spec'
const reviewChecklist = {
  arabicProofread: true,
  factsTraceable: true,
  noCommercialCommitment: true,
  platformFormatChecked: true,
  technicalClaimsChecked: true,
}

const pool = () => (payload.db as unknown as PostgresAdapter).pool

const accountFixture = ({
  accountKind,
  externalAccountId,
  name,
  platformFamily,
}: {
  accountKind:
    'facebook-page' | 'instagram-professional' | 'linkedin-member' | 'linkedin-organization'
  externalAccountId: string
  name: string
  platformFamily: 'linkedin' | 'meta'
}) => ({
  accountKind,
  authorization: {
    accessToken: `integration-token-${randomUUID()}`,
    accessTokenConfigured: false,
    appId: null,
    clearAccessToken: false,
    clearRefreshToken: false,
    expiresAt: null,
    refreshToken: null,
    refreshTokenConfigured: false,
    scopes: [],
    state: 'connected' as const,
  },
  authorizationRevision: 0,
  capabilities: { messagingInbound: 'not_started' as const, publishing: 'approved' as const },
  connectionKey: null,
  externalAccountId,
  name,
  notes: null,
  platformFamily,
})

const createApprovedContent = async (
  label: string,
  assetIDs: number[] = [media.id],
  status: 'approved' | 'draft' = 'approved',
): Promise<GeneratedContent> => {
  const content = await payload.create({
    collection: 'generated-contents',
    context: contentStudioInternalWriteContext,
    data: {
      assets: assetIDs,
      body: `Approved facade update ${label}`,
      contentLocale: 'en',
      contentType: 'post',
      createdBy: admin.id,
      creationFingerprint: 'a'.repeat(64),
      idempotencyKey: `content-studio-publish-content:${randomUUID()}`,
      knowledgeSources: [knowledgeDocumentID],
      platform: 'facebook',
      sourceReferences: [{ claim: 'Project update', source: knowledgeSourceURL }],
      status,
      title: `Publication fixture ${label}`,
    },
    overrideAccess: true,
  })
  contentIDs.push(content.id)
  return content
}

const invoke = async ({
  content,
  idempotencyKey,
  now = new Date('2026-08-13T01:30:00.000Z'),
  operationAfter,
  targetAccountIds = accountIDs,
  user = admin,
}: {
  content: GeneratedContent
  idempotencyKey: string
  now?: Date
  operationAfter?: () => never
  targetAccountIds?: number[]
  user?: User
}) => {
  const req = await createLocalReq({ user }, payload)
  const input = {
    action: 'publish-now',
    idempotencyKey,
    targetAccountIds,
    updatedAt: content.updatedAt,
  }
  return executePortalCommand({
    fingerprintInput: { id: content.id, input },
    idempotencyKey,
    operation: async (transactionReq) => {
      const result = await publishContentStudioNow({
        environment: { ADMIN_PORTAL_PUBLISHING_ENABLED: 'true' },
        id: content.id,
        input,
        now: () => now,
        payload,
        req: transactionReq,
      })
      operationAfter?.()
      return result
    },
    payload,
    req,
    scope: `portal.content-studio:publish-now:${content.id}`,
    target: { collection: 'generated-contents', id: content.id },
  })
}

const generatePrivateImage = async (req: Awaited<ReturnType<typeof createLocalReq>>) => {
  const input = {
    prompt: 'Generate a polished facade image',
    referenceMediaId: null,
    size: '1024x1024',
  }
  const idempotencyKey = `portal-content-studio:generate-image:${randomUUID()}`
  const result = await executePortalCommand({
    atomic: false,
    fingerprintInput: input,
    idempotencyKey,
    operation: (commandReq, execution) =>
      generateContentStudioImage({
        input,
        onProviderDispatch: execution.markExternalDispatch,
        payload: payload as any,
        req: commandReq,
        resolveGateway: (async () => ({
          generateImage: async () => ({
            image: {
              data: await sharp({
                create: { background: '#1c2f46', channels: 3, height: 4, width: 4 },
              })
                .png()
                .toBuffer(),
              mimeType: 'image/png' as const,
            },
            model: 'image-model',
            provider: 'configured-provider',
          }),
        })) as any,
      }),
    payload: payload as any,
    replayPolicy: 'unknown-on-expiry',
    req,
    scope: 'portal.content-studio:generate-image',
  })
  const mediaID = Number(result.media.id)
  generatedMediaIDs.push(mediaID)
  return { idempotencyKey, mediaID, result }
}

const adoptAndApproveGeneratedImage = async ({
  draft,
  mediaID,
  req,
}: {
  draft: GeneratedContent
  mediaID: number
  req: Awaited<ReturnType<typeof createLocalReq>>
}): Promise<GeneratedContent> => {
  const adoptInput = { action: 'adopt-image', mediaId: mediaID, updatedAt: draft.updatedAt }
  const adopted = await executePortalCommand({
    fingerprintInput: { id: draft.id, input: adoptInput },
    idempotencyKey: `portal-content-studio:adopt-image:${randomUUID()}`,
    operation: (commandReq) =>
      adoptContentStudioImage({
        id: draft.id,
        input: adoptInput,
        payload: payload as any,
        req: commandReq,
      }),
    payload,
    req,
    scope: `portal.content-studio:adopt-image:${draft.id}`,
    target: { collection: 'generated-contents', id: draft.id },
  })
  const submitInput = { action: 'submit-review', updatedAt: adopted.updatedAt }
  const submitted = await executePortalCommand({
    fingerprintInput: { id: draft.id, input: submitInput },
    idempotencyKey: `portal-content-studio:submit-review:${randomUUID()}`,
    operation: (commandReq) =>
      submitContentStudioReview({
        id: draft.id,
        input: submitInput,
        payload: payload as any,
        req: commandReq,
      }),
    payload,
    req,
    scope: `portal.content-studio:submit-review:${draft.id}`,
    target: { collection: 'generated-contents', id: draft.id },
  })
  const reviewInput = {
    action: 'review',
    checklist: reviewChecklist,
    comments: 'Facts, format, and generated image verified.',
    decision: 'approved',
    updatedAt: submitted.updatedAt,
  }
  await executePortalCommand({
    fingerprintInput: { id: draft.id, input: reviewInput },
    idempotencyKey: `portal-content-studio:review:${randomUUID()}`,
    operation: (commandReq) =>
      reviewContentStudioDraft({
        id: draft.id,
        input: reviewInput,
        payload: payload as any,
        req: commandReq,
      }),
    payload,
    req,
    scope: `portal.content-studio:review:${draft.id}`,
    target: { collection: 'generated-contents', id: draft.id },
  })
  return payload.findByID({
    collection: 'generated-contents',
    depth: 0,
    id: draft.id,
    overrideAccess: true,
  }) as Promise<GeneratedContent>
}

describe.sequential('Content Studio immediate platform publication', () => {
  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required')
    originalEncryptionKey = process.env.PLATFORM_CREDENTIAL_ENCRYPTION_KEY
    originalServerURL = process.env.NEXT_PUBLIC_SERVER_URL
    process.env.PLATFORM_CREDENTIAL_ENCRYPTION_KEY = 'e'.repeat(64)
    process.env.NEXT_PUBLIC_SERVER_URL = 'https://ivybm.example.invalid'
    payload = await getPayload({
      config,
      disableOnInit: true,
      key: 'task13-content-studio-publishing',
    })
    admin = await payload.create({
      collection: 'users',
      context: { skipAudit: true },
      data: {
        email: `content-studio-publishing-${randomUUID()}@example.invalid`,
        password: 'content-studio-publishing-test-password',
        role: 'admin',
      },
      overrideAccess: true,
    })
    operator = await payload.create({
      collection: 'users',
      context: { skipAudit: true },
      data: {
        email: `content-studio-operator-${randomUUID()}@example.invalid`,
        password: 'content-studio-operator-test-password',
        role: 'operator',
      },
      overrideAccess: true,
    })
    const knowledgeDocument = await payload.create({
      collection: 'knowledge-documents',
      context: { skipAudit: true },
      data: {
        content: 'Reviewed facade engineering guidance for publication.',
        indexStatus: 'pending',
        locale: 'en',
        reviewStatus: 'reviewed',
        sourceTitle: 'Reviewed facade publication specification',
        sourceType: 'technical-specification',
        sourceURL: knowledgeSourceURL,
        sourceVersion: '1.0',
      },
      overrideAccess: true,
    })
    knowledgeDocumentID = knowledgeDocument.id
    await payload.update({
      collection: 'knowledge-documents',
      context: { skipAudit: true },
      data: {
        embeddingModel: 'content-studio-publication-fixture',
        embeddingSpace: 'b'.repeat(64),
        indexStatus: 'ready',
        indexedAt: new Date().toISOString(),
      },
      id: knowledgeDocumentID,
      overrideAccess: true,
    })
    const image = await sharp({
      create: { background: '#1c2f46', channels: 3, height: 600, width: 800 },
    })
      .png()
      .toBuffer()
    media = await payload.create({
      collection: 'media',
      data: {
        alt: 'Controlled facade publication fixture',
        isPublic: true,
        source: 'Integration test generated asset',
      },
      file: {
        data: image,
        mimetype: 'image/png',
        name: `task13-content-studio-${randomUUID()}.png`,
        size: image.length,
      },
      overrideAccess: true,
    })
    const accounts = await Promise.all([
      payload.create({
        collection: 'platform-accounts',
        data: accountFixture({
          accountKind: 'facebook-page',
          externalAccountId: '129472283584550',
          name: 'Facebook publication fixture',
          platformFamily: 'meta',
        }),
        overrideAccess: true,
      }),
      payload.create({
        collection: 'platform-accounts',
        data: accountFixture({
          accountKind: 'instagram-professional',
          externalAccountId: '1221206873460693',
          name: 'Instagram publication fixture',
          platformFamily: 'meta',
        }),
        overrideAccess: true,
      }),
      payload.create({
        collection: 'platform-accounts',
        data: accountFixture({
          accountKind: 'linkedin-organization',
          externalAccountId: '971937765923229',
          name: 'LinkedIn publication fixture',
          platformFamily: 'linkedin',
        }),
        overrideAccess: true,
      }),
    ])
    accountIDs.push(...accounts.map((account) => account.id))
  })

  afterAll(async () => {
    if (payload) {
      await pool().query('DELETE FROM portal_command_receipts WHERE actor_id = ANY($1::int[])', [
        [admin.id, operator.id],
      ])
      await pool().query(
        'DELETE FROM publish_logs WHERE publish_job_id IN (SELECT id FROM publish_jobs WHERE content_id = ANY($1::int[]))',
        [contentIDs],
      )
      await pool().query(
        "DELETE FROM jobs WHERE type = $1 AND idempotency_key LIKE 'publication-execute:%'",
        [PLATFORM_PUBLICATION_JOB_TYPE],
      )
      await pool().query('DELETE FROM publish_jobs WHERE content_id = ANY($1::int[])', [contentIDs])
      await pool().query('DELETE FROM content_reviews WHERE content_id = ANY($1::int[])', [
        contentIDs,
      ])
      await pool().query('DELETE FROM generated_contents WHERE id = ANY($1::int[])', [contentIDs])
      await payload.delete({ collection: 'media', id: media.id, overrideAccess: true })
      if (generatedMediaIDs.length) {
        await payload.delete({
          collection: 'media',
          where: { id: { in: generatedMediaIDs } },
          overrideAccess: true,
        })
      }
      await payload.delete({
        collection: 'platform-accounts',
        context: { skipAudit: true },
        overrideAccess: true,
        where: { id: { in: accountIDs } },
      })
      await payload.delete({
        collection: 'audit-logs',
        overrideAccess: true,
        where: { actor: { in: [admin.id, operator.id] } },
      })
      await payload.delete({
        collection: 'knowledge-documents',
        context: { skipAudit: true },
        id: knowledgeDocumentID,
        overrideAccess: true,
      })
      await payload.delete({
        collection: 'users',
        context: { skipAudit: true },
        overrideAccess: true,
        where: { id: { in: [admin.id, operator.id] } },
      })
      await payload.destroy()
    }
    if (originalEncryptionKey === undefined) delete process.env.PLATFORM_CREDENTIAL_ENCRYPTION_KEY
    else process.env.PLATFORM_CREDENTIAL_ENCRYPTION_KEY = originalEncryptionKey
    if (originalServerURL === undefined) delete process.env.NEXT_PUBLIC_SERVER_URL
    else process.env.NEXT_PUBLIC_SERVER_URL = originalServerURL
  })

  it('creates three independent immediate jobs and replays one click without duplicates', async () => {
    const content = await createApprovedContent('happy path')
    const idempotencyKey = `portal-content-studio:publish-now:${randomUUID()}`
    const first = await invoke({ content, idempotencyKey })
    const replay = await invoke({ content, idempotencyKey })

    expect(replay).toEqual(first)
    expect(first.jobs).toHaveLength(3)
    const jobs = await payload.find({
      collection: 'publish-jobs',
      depth: 0,
      overrideAccess: true,
      pagination: false,
      sort: 'platform',
      where: { content: { equals: content.id } },
    })
    expect(jobs.docs).toHaveLength(3)
    expect(jobs.docs.map((job) => job.executionRoute).sort()).toEqual([
      'facebook-photo-single',
      'instagram-image-staged',
      'linkedin-image-staged',
    ])
    expect(jobs.docs.every((job) => job.scheduledFor === '2026-08-13T01:30:00.000Z')).toBe(true)
    expect(jobs.docs.every((job) => job.executionRevision === 0)).toBe(true)
    expect(jobs.docs.every((job) => job.authorizationRevision === 0)).toBe(true)
    expect(jobs.docs.every((job) => /^[a-f0-9]{64}$/.test(job.requestFingerprint ?? ''))).toBe(true)
    expect(
      jobs.docs.every(
        (job) =>
          job.requestSnapshot &&
          typeof job.requestSnapshot === 'object' &&
          !('scheduledFor' in job.requestSnapshot),
      ),
    ).toBe(true)
    expect(new Set(jobs.docs.map((job) => job.idempotencyKey)).size).toBe(3)

    const queued = await pool().query<{ payload: Record<string, unknown> }>(
      "SELECT payload FROM jobs WHERE type = $1 AND payload->>'publishJobId' = ANY($2::text[])",
      [PLATFORM_PUBLICATION_JOB_TYPE, jobs.docs.map((job) => String(job.id))],
    )
    expect(queued.rows).toHaveLength(3)
    expect(
      queued.rows.every(
        ({ payload: jobPayload }) =>
          Object.keys(jobPayload).sort().join(',') === 'expectedExecutionRevision,publishJobId' &&
          jobPayload.expectedExecutionRevision === 0,
      ),
    ).toBe(true)
  })

  it('lets an operator publish through the server authority without PlatformAccounts read access', async () => {
    const content = await createApprovedContent('operator publication')
    const publication = await invoke({
      content,
      idempotencyKey: `portal-content-studio:operator-publish:${randomUUID()}`,
      user: operator,
    })

    expect(publication.jobs).toHaveLength(3)
    const jobs = await payload.find({
      collection: 'publish-jobs',
      depth: 0,
      overrideAccess: true,
      pagination: false,
      where: { content: { equals: content.id } },
    })
    expect(jobs.docs).toHaveLength(3)
  })

  it('prepares an adopted private AI image for explicit publication and records the public transition', async () => {
    const draft = await createApprovedContent('generated private asset', [], 'draft')
    const req = await createLocalReq({ user: admin }, payload)
    const generated = await generatePrivateImage(req)
    const approved = await adoptAndApproveGeneratedImage({
      draft,
      mediaID: generated.mediaID,
      req,
    })
    const publication = await invoke({
      content: approved,
      idempotencyKey: `portal-content-studio:publish-generated:${randomUUID()}`,
    })
    expect(publication.jobs).toHaveLength(3)
    const publishedMedia = await payload.findByID({
      collection: 'media',
      depth: 0,
      id: generated.mediaID,
      overrideAccess: true,
    })
    expect(publishedMedia.isPublic).toBe(true)
    const reviews = await payload.find({
      collection: 'content-reviews',
      depth: 0,
      overrideAccess: true,
      where: { content: { equals: draft.id } },
    })
    expect(reviews.docs).toHaveLength(1)
    expect(reviews.docs[0]).toMatchObject({ checklist: reviewChecklist, decision: 'approved' })
    const jobs = await payload.find({
      collection: 'publish-jobs',
      depth: 0,
      overrideAccess: true,
      pagination: false,
      sort: 'platform',
      where: { content: { equals: draft.id } },
    })
    expect(jobs.docs.map((job) => job.executionRoute).sort()).toEqual([
      'facebook-photo-single',
      'instagram-image-staged',
      'linkedin-image-staged',
    ])
    const expectedAssetPath = `/api/publication-assets/${generated.mediaID}/${generated.result.sha256}`
    const facebookJob = jobs.docs.find((job) => job.platform === 'facebook')
    const instagramJob = jobs.docs.find((job) => job.platform === 'instagram')
    expect(JSON.stringify(facebookJob?.requestSnapshot)).toContain(expectedAssetPath)
    expect(JSON.stringify(instagramJob?.providerCheckpoint)).toContain(expectedAssetPath)
    expect(JSON.stringify([facebookJob, instagramJob])).not.toContain(
      `/media/${publishedMedia.filename}`,
    )
    const audit = await payload.find({
      collection: 'audit-logs',
      overrideAccess: true,
      where: {
        and: [
          { resource: { equals: 'media' } },
          { documentId: { equals: String(generated.mediaID) } },
          { action: { equals: 'update' } },
        ],
      },
    })
    expect(audit.docs.length).toBeGreaterThan(0)
  })

  it('rejects an unrelated private asset before creating publication jobs', async () => {
    const privateImage = await sharp({
      create: { background: '#1c2f46', channels: 3, height: 4, width: 4 },
    })
      .png()
      .toBuffer()
    const privateMedia = await payload.create({
      collection: 'media',
      data: {
        alt: 'Private source',
        isPublic: false,
        source: 'AI generated via forged-provider / forged-model',
      },
      file: {
        data: privateImage,
        mimetype: 'image/png',
        name: `private-${randomUUID()}.png`,
        size: privateImage.length,
      },
      overrideAccess: true,
    })
    const content = await createApprovedContent('private asset remediation', [privateMedia.id])
    const before = await pool().query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM publish_jobs',
    )
    await expect(
      invoke({
        content,
        idempotencyKey: `portal-content-studio:private:${randomUUID()}`,
        targetAccountIds: [accountIDs[0]!],
      }),
    ).rejects.toMatchObject({ code: 'content-studio-publication-asset-private', status: 409 })
    const after = await pool().query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM publish_jobs',
    )
    expect(after.rows[0]?.count).toBe(before.rows[0]?.count)
    await payload.delete({ collection: 'media', id: privateMedia.id, overrideAccess: true })
  })

  it('rejects a replaced private AI image even when the media ID still has a completed receipt', async () => {
    const draft = await createApprovedContent('replaced generated private asset', [], 'draft')
    const req = await createLocalReq({ user: admin }, payload)
    const generated = await generatePrivateImage(req)
    const approved = await adoptAndApproveGeneratedImage({
      draft,
      mediaID: generated.mediaID,
      req,
    })
    const stored = await payload.findByID({
      collection: 'media',
      depth: 0,
      id: generated.mediaID,
      overrideAccess: true,
    })
    const filename = typeof stored.filename === 'string' ? stored.filename : ''
    const filePath = path.resolve(process.cwd(), 'media', filename)
    const original = await readFile(filePath)
    const replacement = await sharp({
      create: { background: '#d84315', channels: 3, height: 4, width: 4 },
    })
      .png()
      .toBuffer()
    expect(replacement.byteLength).toBe(original.byteLength)
    await writeFile(filePath, replacement)

    try {
      await expect(
        invoke({
          content: approved,
          idempotencyKey: `portal-content-studio:publish-replaced:${randomUUID()}`,
          targetAccountIds: [accountIDs[0]!],
        }),
      ).rejects.toMatchObject({ code: 'content-studio-publication-asset-private', status: 409 })
      const reloaded = await payload.findByID({
        collection: 'media',
        depth: 0,
        id: generated.mediaID,
        overrideAccess: true,
      })
      expect(reloaded.isPublic).toBe(false)
      const jobs = await pool().query('SELECT id FROM publish_jobs WHERE content_id = $1', [
        draft.id,
      ])
      expect(jobs.rows).toHaveLength(0)
    } finally {
      await writeFile(filePath, original)
    }
  })

  it('rejects a public WebP asset before creating publication jobs', async () => {
    const webp = await sharp({
      create: { background: '#1c2f46', channels: 3, height: 4, width: 4 },
    })
      .webp()
      .toBuffer()
    const webpMedia = await payload.create({
      collection: 'media',
      data: { alt: 'WebP source', isPublic: true, source: 'Operator upload' },
      file: {
        data: webp,
        mimetype: 'image/webp',
        name: `webp-${randomUUID()}.webp`,
        size: webp.length,
      },
      overrideAccess: true,
    })
    const content = await createApprovedContent('webp asset remediation', [webpMedia.id])
    const before = await pool().query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM publish_jobs',
    )
    await expect(
      invoke({
        content,
        idempotencyKey: `portal-content-studio:webp:${randomUUID()}`,
        targetAccountIds: [accountIDs[0]!],
      }),
    ).rejects.toMatchObject({ code: 'content-studio-publication-format-unsupported', status: 409 })
    const after = await pool().query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM publish_jobs',
    )
    expect(after.rows[0]?.count).toBe(before.rows[0]?.count)
    await payload.delete({ collection: 'media', id: webpMedia.id, overrideAccess: true })
  })

  it('fails closed before reading content when the publication kill switch is disabled', async () => {
    const req = await createLocalReq({ user: admin }, payload)
    await expect(
      publishContentStudioNow({
        environment: { ADMIN_PORTAL_PUBLISHING_ENABLED: 'false' },
        id: 999_999,
        input: {},
        payload,
        req,
      }),
    ).rejects.toMatchObject({ code: 'content-studio-publishing-disabled', status: 503 })
  })

  it('rejects reuse of the click key for another approved content item', async () => {
    const firstContent = await createApprovedContent('first key owner')
    const secondContent = await createApprovedContent('second key owner')
    const idempotencyKey = `portal-content-studio:publish-now:${randomUUID()}`
    await invoke({ content: firstContent, idempotencyKey, targetAccountIds: [accountIDs[0]!] })

    await expect(
      invoke({ content: secondContent, idempotencyKey, targetAccountIds: [accountIDs[0]!] }),
    ).rejects.toMatchObject({
      code: 'content-studio-idempotency-conflict',
    } satisfies Partial<ContentStudioCommandError>)
  })

  it('blocks a new click after the same account reaches delivery_unknown', async () => {
    const content = await createApprovedContent('delivery unknown guard')
    const targetAccountIds = [accountIDs[0]!]
    const first = await invoke({
      content,
      idempotencyKey: `portal-content-studio:publish-now:${randomUUID()}`,
      targetAccountIds,
    })
    const publishJobId = first.jobs[0]?.job.id
    if (typeof publishJobId !== 'number') throw new Error('Expected one publication job')
    await payload.update({
      collection: 'publish-jobs',
      context: contentStudioInternalWriteContext,
      data: {
        deliveryUnknownAt: new Date().toISOString(),
        lastErrorCode: 'delivery_unknown',
        lastErrorSummary: 'Provider result requires manual reconciliation.',
        status: 'delivery_unknown',
      },
      id: publishJobId,
      overrideAccess: true,
    })
    const queueBefore = await pool().query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM jobs
       WHERE type = $1 AND payload->>'publishJobId' = $2`,
      [PLATFORM_PUBLICATION_JOB_TYPE, String(publishJobId)],
    )

    await expect(
      invoke({
        content,
        idempotencyKey: `portal-content-studio:publish-now:${randomUUID()}`,
        targetAccountIds,
      }),
    ).rejects.toMatchObject({
      code: 'content-studio-publication-already-exists',
      status: 409,
    } satisfies Partial<ContentStudioCommandError>)

    const jobs = await payload.find({
      collection: 'publish-jobs',
      depth: 0,
      overrideAccess: true,
      pagination: false,
      where: {
        and: [
          { content: { equals: content.id } },
          { platformAccount: { equals: targetAccountIds[0] } },
        ],
      },
    })
    expect(jobs.docs).toHaveLength(1)
    const queueAfter = await pool().query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM jobs
       WHERE type = $1 AND payload->>'publishJobId' = $2`,
      [PLATFORM_PUBLICATION_JOB_TYPE, String(publishJobId)],
    )
    expect(queueAfter.rows[0]?.count).toBe(queueBefore.rows[0]?.count)
  })

  it('serializes concurrent different click keys for the same content and account', async () => {
    const content = await createApprovedContent('concurrent different keys')
    const targetAccountIds = [accountIDs[0]!]
    const results = await Promise.allSettled([
      invoke({
        content,
        idempotencyKey: `portal-content-studio:publish-now:${randomUUID()}`,
        targetAccountIds,
      }),
      invoke({
        content,
        idempotencyKey: `portal-content-studio:publish-now:${randomUUID()}`,
        targetAccountIds,
      }),
    ])

    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1)
    expect(results.filter(({ status }) => status === 'rejected')).toHaveLength(1)
    expect(results.find(({ status }) => status === 'rejected')).toMatchObject({
      reason: {
        code: 'content-studio-publication-already-exists',
        status: 409,
      },
    })
    const jobs = await payload.find({
      collection: 'publish-jobs',
      depth: 0,
      overrideAccess: true,
      pagination: false,
      where: {
        and: [
          { content: { equals: content.id } },
          { platformAccount: { equals: targetAccountIds[0] } },
        ],
      },
    })
    expect(jobs.docs).toHaveLength(1)
  })

  it('rolls all platform and queue rows back when the command transaction fails', async () => {
    const draft = await createApprovedContent('generated private rollback', [], 'draft')
    const req = await createLocalReq({ user: admin }, payload)
    const generated = await generatePrivateImage(req)
    const content = await adoptAndApproveGeneratedImage({ draft, mediaID: generated.mediaID, req })
    const idempotencyKey = `portal-content-studio:publish-now:${randomUUID()}`
    const queueCountBefore = await pool().query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM jobs WHERE type = $1',
      [PLATFORM_PUBLICATION_JOB_TYPE],
    )
    const logCountBefore = await pool().query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM publish_logs WHERE summary = 'User requested immediate official API publication.'",
    )
    const auditCountBefore = await pool().query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM audit_logs WHERE resource = 'media' AND document_id = $1 AND action = 'update'",
      [String(generated.mediaID)],
    )
    await expect(
      invoke({
        content,
        idempotencyKey,
        operationAfter: () => {
          throw new Error('forced post-publication transaction failure')
        },
        targetAccountIds: [accountIDs[0]!],
      }),
    ).rejects.toThrow('forced post-publication transaction failure')

    const publishJobs = await pool().query('SELECT id FROM publish_jobs WHERE content_id = $1', [
      content.id,
    ])
    expect(publishJobs.rows).toHaveLength(0)
    const survivingContentJobs = await pool().query(
      `SELECT jobs.id
       FROM jobs
       JOIN publish_jobs ON publish_jobs.id = (jobs.payload->>'publishJobId')::int
       WHERE publish_jobs.content_id = $1`,
      [content.id],
    )
    expect(survivingContentJobs.rows).toHaveLength(0)
    const queueCountAfter = await pool().query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM jobs WHERE type = $1',
      [PLATFORM_PUBLICATION_JOB_TYPE],
    )
    expect(queueCountAfter.rows[0]?.count).toBe(queueCountBefore.rows[0]?.count)
    const logCountAfter = await pool().query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM publish_logs WHERE summary = 'User requested immediate official API publication.'",
    )
    expect(logCountAfter.rows[0]?.count).toBe(logCountBefore.rows[0]?.count)
    const rolledBackMedia = await payload.findByID({
      collection: 'media',
      depth: 0,
      id: generated.mediaID,
      overrideAccess: true,
    })
    expect(rolledBackMedia.isPublic).toBe(false)
    const auditCountAfter = await pool().query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM audit_logs WHERE resource = 'media' AND document_id = $1 AND action = 'update'",
      [String(generated.mediaID)],
    )
    expect(auditCountAfter.rows[0]?.count).toBe(auditCountBefore.rows[0]?.count)
    const receipt = await pool().query<{ error_code: string; status: string }>(
      'SELECT error_code, status FROM portal_command_receipts WHERE actor_id = $1 AND scope = $2 AND idempotency_key = $3',
      [admin.id, `portal.content-studio:publish-now:${content.id}`, idempotencyKey],
    )
    expect(receipt.rows).toEqual([{ error_code: 'portal-command-failed', status: 'failed' }])
  })

  it('fails concurrent cross-content reuse closed, then reports the stable key conflict', async () => {
    const firstContent = await createApprovedContent('concurrent first')
    const secondContent = await createApprovedContent('concurrent second')
    const idempotencyKey = `portal-content-studio:publish-now:${randomUUID()}`
    const results = await Promise.allSettled([
      invoke({ content: firstContent, idempotencyKey, targetAccountIds: [accountIDs[0]!] }),
      invoke({ content: secondContent, idempotencyKey, targetAccountIds: [accountIDs[0]!] }),
    ])

    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1)
    const rejected = results.find(({ status }) => status === 'rejected')
    expect(rejected).toMatchObject({
      reason: { code: 'content-studio-publication-processing', status: 409 },
      status: 'rejected',
    })
    const jobs = await pool().query(
      'SELECT id FROM publish_jobs WHERE content_id = ANY($1::int[])',
      [[firstContent.id, secondContent.id]],
    )
    expect(jobs.rows).toHaveLength(1)

    const successfulContent = results[0]?.status === 'fulfilled' ? firstContent : secondContent
    const conflictingContent =
      successfulContent.id === firstContent.id ? secondContent : firstContent
    await expect(
      invoke({
        content: conflictingContent,
        idempotencyKey,
        targetAccountIds: [accountIDs[0]!],
      }),
    ).rejects.toMatchObject({ code: 'content-studio-idempotency-conflict', status: 409 })
  })
})
