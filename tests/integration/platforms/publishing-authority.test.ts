import { randomUUID } from 'node:crypto'

import type { PostgresAdapter } from '@payloadcms/db-postgres'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { getPayload, type Payload } from 'payload'

import { contentStudioInternalWriteContext } from '@/access/contentStudio'
import { PayloadJobQueue } from '@/modules/jobs/claim'
import { JobWorker } from '@/modules/jobs/worker'
import { PayloadPlatformPublicationAuthority } from '@/modules/platforms/payloadPublishingAuthority'
import {
  createPlatformPublicationJobHandler,
  PLATFORM_PUBLICATION_JOB_TYPE,
} from '@/modules/platforms/publicationJobs'
import type {
  PlatformPublicationIntent,
  PlatformPublicationLeaseFence,
} from '@/modules/platforms/publishingAuthority'
import type { PlatformAccount, User } from '@/payload-types'
import config from '@/payload.config'

let payload: Payload
let admin: User
let account: PlatformAccount
const contentIDs: number[] = []
const jobIDs: number[] = []
const publishJobIDs: number[] = []

const pool = () => (payload.db as unknown as PostgresAdapter).pool

const createIntentAndLease = async () => {
  const suffix = randomUUID()
  const content = await payload.create({
    collection: 'generated-contents',
    context: contentStudioInternalWriteContext,
    data: {
      body: 'Facade project update',
      contentLocale: 'en',
      contentType: 'post',
      createdBy: admin.id,
      creationFingerprint: 'a'.repeat(64),
      idempotencyKey: `publishing-authority-content:${suffix}`,
      platform: 'facebook',
      status: 'approved',
      title: 'Publication authority fixture',
    },
    overrideAccess: true,
  })
  contentIDs.push(content.id)
  const snapshot = {
    assets: [
      {
        fileName: 'facade.jpg',
        id: 'asset-1',
        mimeType: 'image/jpeg' as const,
        sourceUrl: 'https://media.example.invalid/facade.jpg',
      },
    ],
    idempotencyKey: `publish:v1:${suffix.replaceAll('-', '')}:facebook`,
    platform: 'facebook' as const,
    platformAccountId: account.id,
    status: 'scheduled' as const,
    text: 'Facade project update',
  }
  const publishJob = await payload.create({
    collection: 'publish-jobs',
    context: contentStudioInternalWriteContext,
    data: {
      authorizationRevision: account.authorizationRevision,
      content: content.id,
      createdBy: admin.id,
      executionRevision: 0,
      executionRoute: 'facebook-photo-single',
      fencingGeneration: 0,
      idempotencyKey: snapshot.idempotencyKey,
      mode: 'automatic',
      platform: 'facebook',
      platformAccount: account.id,
      requestFingerprint: 'b'.repeat(64),
      requestSnapshot: snapshot,
      scheduledFor: new Date().toISOString(),
      status: 'scheduled',
    },
    overrideAccess: true,
  })
  publishJobIDs.push(publishJob.id)
  const queue = new PayloadJobQueue({ payload })
  const queued = await queue.enqueue({
    idempotencyKey: `publication-execute:${publishJob.id}:0`,
    maxAttempts: 2,
    payload: { expectedExecutionRevision: 0, publishJobId: publishJob.id },
    type: PLATFORM_PUBLICATION_JOB_TYPE,
  })
  jobIDs.push(queued.job.id)
  const claimed = await queue.claimNext()
  if (!claimed) throw new Error('Expected publication queue job claim')
  const intent: PlatformPublicationIntent = {
    expectedRevision: 0,
    publishJobId: publishJob.id,
    snapshot,
  }
  const lease: PlatformPublicationLeaseFence = {
    leaseExpiresAt: claimed.leaseExpiresAt,
    ownerToken: claimed.ownerToken,
    queueJobId: claimed.id,
  }
  return { authority: new PayloadPlatformPublicationAuthority({ payload }), intent, lease }
}

describe.sequential('Task 13 Payload publication authority', () => {
  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required')
    process.env.PLATFORM_CREDENTIAL_ENCRYPTION_KEY = 'e'.repeat(64)
    payload = await getPayload({ config, disableOnInit: true, key: 'task13-publishing-authority' })
    admin = await payload.create({
      collection: 'users',
      context: { skipAudit: true },
      data: {
        email: `publishing-authority-${randomUUID()}@example.invalid`,
        password: 'publishing-authority-test-password',
        role: 'admin',
      },
      overrideAccess: true,
    })
    account = await payload.create({
      collection: 'platform-accounts',
      data: {
        accountKind: 'facebook-page',
        authorization: {
          accessToken: 'test-token',
          accessTokenConfigured: false,
          appId: null,
          clearAccessToken: false,
          clearRefreshToken: false,
          expiresAt: null,
          refreshToken: null,
          refreshTokenConfigured: false,
          scopes: [{ scope: 'pages_manage_posts' }],
          state: 'connected',
        },
        authorizationRevision: 0,
        capabilities: { messagingInbound: 'not_started', publishing: 'approved' },
        connectionKey: null,
        externalAccountId: '129472283584550',
        name: `Authority page ${randomUUID()}`,
        notes: null,
        platformFamily: 'meta',
      },
      overrideAccess: true,
    })
  })

  afterAll(async () => {
    if (!payload) return
    await pool().query('DELETE FROM publish_logs WHERE publish_job_id = ANY($1::int[])', [
      publishJobIDs,
    ])
    await pool().query('DELETE FROM publish_jobs WHERE id = ANY($1::int[])', [publishJobIDs])
    await pool().query('DELETE FROM jobs WHERE id = ANY($1::int[])', [jobIDs])
    await pool().query('DELETE FROM generated_contents WHERE id = ANY($1::int[])', [contentIDs])
    await payload.delete({ collection: 'platform-accounts', id: account.id, overrideAccess: true })
    await payload.delete({
      collection: 'users',
      context: { skipAudit: true },
      id: admin.id,
      overrideAccess: true,
    })
    await payload.destroy()
  })

  it('commits the provider result only for the matching Jobs lease and PublishJob revision', async () => {
    const { authority, intent, lease } = await createIntentAndLease()
    const claimed = await authority.claimPublication(intent, lease)
    expect(claimed.status).toBe('claimed')
    if (claimed.status !== 'claimed') throw new Error('Expected publication claim')
    await expect(authority.markProviderIOStarted(claimed.claim)).resolves.toEqual({
      status: 'fenced',
    })
    await expect(
      authority.commitPublication(claimed.claim, {
        changed: true,
        event: 'accepted',
        externalPublicationId: '129472283584550_123456789',
        externalPublicationUrl: 'https://www.facebook.com/129472283584550/posts/123456789',
        status: 'accepted',
        summary: 'Provider accepted the publication command.',
      }),
    ).resolves.toEqual({ nextRevision: 1, status: 'committed' })

    const stored = await payload.findByID({
      collection: 'publish-jobs',
      depth: 0,
      id: intent.publishJobId,
      overrideAccess: true,
    })
    expect(stored).toMatchObject({
      acceptedAt: expect.any(String),
      claimId: null,
      executionRevision: 1,
      externalPublicationId: '129472283584550_123456789',
      externalPublicationUrl: 'https://www.facebook.com/129472283584550/posts/123456789',
      status: 'accepted',
    })
    const logs = await payload.find({
      collection: 'publish-logs',
      depth: 0,
      overrideAccess: true,
      where: { publishJob: { equals: intent.publishJobId } },
    })
    expect(logs.docs).toEqual([
      expect.objectContaining({
        event: 'accepted',
        summary: 'Provider accepted the publication command.',
      }),
    ])
  })

  it('rejects a forged queue lease without mutating the publication row', async () => {
    const { authority, intent, lease } = await createIntentAndLease()
    await expect(
      authority.claimPublication(intent, { ...lease, queueJobId: lease.queueJobId + 1 }),
    ).resolves.toEqual({ reason: 'lease_conflict', status: 'blocked' })
    const stored = await payload.findByID({
      collection: 'publish-jobs',
      depth: 0,
      id: intent.publishJobId,
      overrideAccess: true,
    })
    expect(stored).toMatchObject({ claimId: null, executionRevision: 0, status: 'scheduled' })
  })

  it('runs a claimed Jobs record through the worker, dispatcher, and Payload CAS exactly once', async () => {
    const suffix = randomUUID()
    const content = await payload.create({
      collection: 'generated-contents',
      context: contentStudioInternalWriteContext,
      data: {
        body: 'Worker publication update',
        contentLocale: 'en',
        contentType: 'post',
        createdBy: admin.id,
        creationFingerprint: 'c'.repeat(64),
        idempotencyKey: `publishing-worker-content:${suffix}`,
        platform: 'facebook',
        status: 'approved',
        title: 'Worker publication fixture',
      },
      overrideAccess: true,
    })
    contentIDs.push(content.id)
    const requestSnapshot = {
      assets: [
        {
          fileName: 'facade.jpg',
          id: 'asset-1',
          mimeType: 'image/jpeg',
          sourceUrl: 'https://media.example.invalid/facade.jpg',
        },
      ],
      idempotencyKey: `publish:v1:${suffix.replaceAll('-', '')}:facebook`,
      platform: 'facebook',
      platformAccountId: account.id,
      status: 'scheduled',
      text: 'Worker publication update',
    }
    const publishJob = await payload.create({
      collection: 'publish-jobs',
      context: contentStudioInternalWriteContext,
      data: {
        authorizationRevision: account.authorizationRevision,
        content: content.id,
        createdBy: admin.id,
        executionRevision: 0,
        executionRoute: 'facebook-photo-single',
        fencingGeneration: 0,
        idempotencyKey: requestSnapshot.idempotencyKey,
        mode: 'automatic',
        platform: 'facebook',
        platformAccount: account.id,
        requestFingerprint: 'd'.repeat(64),
        requestSnapshot,
        scheduledFor: new Date().toISOString(),
        status: 'scheduled',
      },
      overrideAccess: true,
    })
    publishJobIDs.push(publishJob.id)
    const queue = new PayloadJobQueue({ payload })
    const queued = await queue.enqueue({
      idempotencyKey: `publication-execute:${publishJob.id}:0`,
      maxAttempts: 2,
      payload: { expectedExecutionRevision: 0, publishJobId: publishJob.id },
      type: PLATFORM_PUBLICATION_JOB_TYPE,
    })
    jobIDs.push(queued.job.id)
    const publish = vi.fn().mockResolvedValue({
      externalPublicationId: '129472283584550_987654321',
      idempotencyKey: requestSnapshot.idempotencyKey,
      platform: 'facebook',
      platformAccountId: account.id,
      status: 'accepted',
    })
    const getStatus = vi.fn().mockResolvedValue({
      externalPublicationId: '129472283584550_987654321',
      externalPublicationUrl: 'https://www.facebook.com/129472283584550/posts/987654321',
      idempotencyKey: requestSnapshot.idempotencyKey,
      platform: 'facebook',
      platformAccountId: account.id,
      status: 'published',
    })
    const resolveRuntime = vi.fn(() => ({
      directService: {
        getCapability: vi.fn(),
        getStatus,
        prepareAssistedPublication: vi.fn(),
        publish,
      },
      linkedInTransport: {} as never,
      metaTransport: {} as never,
      readLinkedInAssetBytes: vi.fn(),
    }))
    const worker = new JobWorker({
      handlers: {
        [PLATFORM_PUBLICATION_JOB_TYPE]: createPlatformPublicationJobHandler({
          payload,
          queue,
          resolveRuntime,
        }),
      },
      queue,
    })

    await expect(worker.runOnce()).resolves.toBe('succeeded')
    expect(resolveRuntime).toHaveBeenCalledWith('facebook-photo-single')
    expect(publish).toHaveBeenCalledTimes(1)
    const queuedContinuation = await pool().query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM jobs WHERE idempotency_key = $1',
      [`publication-execute:${publishJob.id}:1`],
    )
    expect(queuedContinuation.rows[0]?.count).toBe('1')
    const continuationJob = await pool().query<{ id: number }>(
      'SELECT id FROM jobs WHERE idempotency_key = $1 LIMIT 1',
      [`publication-execute:${publishJob.id}:1`],
    )
    const continuationJobId = continuationJob.rows[0]?.id
    if (!continuationJobId) throw new Error('Expected direct status continuation')
    jobIDs.push(continuationJobId)
    await pool().query('UPDATE jobs SET next_run_at = $1 WHERE id = $2', [
      new Date(Date.now() - 1_000).toISOString(),
      continuationJobId,
    ])
    await expect(worker.runOnce()).resolves.toBe('succeeded')
    expect(getStatus).toHaveBeenCalledTimes(1)
    expect(publish).toHaveBeenCalledTimes(1)
    await expect(
      payload.findByID({
        collection: 'publish-jobs',
        depth: 0,
        id: publishJob.id,
        overrideAccess: true,
      }),
    ).resolves.toMatchObject({
      executionRevision: 2,
      externalPublicationId: '129472283584550_987654321',
      externalPublicationUrl: 'https://www.facebook.com/129472283584550/posts/987654321',
      status: 'published',
    })
  })
})
