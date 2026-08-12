import { randomUUID } from 'node:crypto'

import type { PostgresAdapter } from '@payloadcms/db-postgres'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createLocalReq, getPayload, type Payload } from 'payload'

import { contentStudioInternalWriteContext } from '@/access/contentStudio'
import { executePortalCommand } from '@/admin-portal/core/commands/portalCommandReceipts'
import { ContentStudioCommandError } from '@/admin-portal/modules/content-studio/contentStudioCommands'
import { publishContentStudioNow } from '@/admin-portal/modules/content-studio/publishContentStudio'
import { PLATFORM_PUBLICATION_JOB_TYPE } from '@/modules/platforms/publicationJobs'
import type { GeneratedContent, Media, User } from '@/payload-types'
import config from '@/payload.config'

let payload: Payload
let admin: User
let media: Media
let originalEncryptionKey: string | undefined
let originalServerURL: string | undefined
const accountIDs: number[] = []
const contentIDs: number[] = []

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

const createApprovedContent = async (label: string): Promise<GeneratedContent> => {
  const content = await payload.create({
    collection: 'generated-contents',
    context: contentStudioInternalWriteContext,
    data: {
      assets: [media.id],
      body: `Approved facade update ${label}`,
      contentLocale: 'en',
      contentType: 'post',
      createdBy: admin.id,
      creationFingerprint: 'a'.repeat(64),
      idempotencyKey: `content-studio-publish-content:${randomUUID()}`,
      platform: 'facebook',
      sourceReferences: [{ claim: 'Project update', source: 'Reviewed internal source' }],
      status: 'approved',
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
}: {
  content: GeneratedContent
  idempotencyKey: string
  now?: Date
  operationAfter?: () => never
  targetAccountIds?: number[]
}) => {
  const req = await createLocalReq({ user: admin }, payload)
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
      await pool().query(
        "DELETE FROM portal_command_receipts WHERE scope LIKE 'portal.content-studio:publish-now:%'",
      )
      await pool().query(
        "DELETE FROM publish_logs WHERE summary = 'User requested immediate official API publication.'",
      )
      await pool().query(
        "DELETE FROM jobs WHERE type = $1 AND idempotency_key LIKE 'publication-execute:%'",
        [PLATFORM_PUBLICATION_JOB_TYPE],
      )
      await pool().query('DELETE FROM publish_jobs WHERE content_id = ANY($1::int[])', [contentIDs])
      await pool().query('DELETE FROM generated_contents WHERE id = ANY($1::int[])', [contentIDs])
      await payload.delete({ collection: 'media', id: media.id, overrideAccess: true })
      await payload.delete({
        collection: 'platform-accounts',
        context: { skipAudit: true },
        overrideAccess: true,
        where: { id: { in: accountIDs } },
      })
      await payload.delete({
        collection: 'audit-logs',
        overrideAccess: true,
        where: { actor: { equals: admin.id } },
      })
      await payload.delete({
        collection: 'users',
        context: { skipAudit: true },
        id: admin.id,
        overrideAccess: true,
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

  it('rolls all platform and queue rows back when the command transaction fails', async () => {
    const content = await createApprovedContent('rollback')
    const idempotencyKey = `portal-content-studio:publish-now:${randomUUID()}`
    const queueCountBefore = await pool().query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM jobs WHERE type = $1',
      [PLATFORM_PUBLICATION_JOB_TYPE],
    )
    await expect(
      invoke({
        content,
        idempotencyKey,
        operationAfter: () => {
          throw new Error('forced post-publication transaction failure')
        },
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
