import { randomUUID } from 'node:crypto'

import type { PostgresAdapter } from '@payloadcms/db-postgres'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { getPayload, type Payload } from 'payload'

import { contentStudioInternalWriteContext } from '@/access/contentStudio'
import { PayloadJobQueue } from '@/modules/jobs/claim'
import { JobWorker } from '@/modules/jobs/worker'
import { PayloadPlatformPublicationAuthority } from '@/modules/platforms/payloadPublishingAuthority'
import { PayloadPublishingAccountResolver } from '@/modules/platforms/publishingAccountResolver'
import {
  createPlatformPublicationJobHandler,
  PLATFORM_PUBLICATION_JOB_TYPE,
} from '@/modules/platforms/publicationJobs'
import type {
  PlatformPublicationIntent,
  PlatformPublicationLeaseFence,
} from '@/modules/platforms/publishingAuthority'
import { createPlatformPublishingService } from '@/modules/platforms/publishingServiceAdapter'
import { retryPortalJob } from '@/admin-portal/modules/operations/operationsCommands'
import type { PlatformAccount, User } from '@/payload-types'
import config from '@/payload.config'

let payload: Payload
let admin: User
let account: PlatformAccount
const contentIDs: number[] = []
const jobIDs: number[] = []
const publishJobIDs: number[] = []

const pool = () => (payload.db as unknown as PostgresAdapter).pool

const createIntentAndLease = async ({ claimQueueJob = true }: { claimQueueJob?: boolean } = {}) => {
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
    expectedAuthorizationRevision: account.authorizationRevision,
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
  const claimed = claimQueueJob ? await queue.claimNext() : null
  if (claimQueueJob && !claimed) throw new Error('Expected publication queue job claim')
  const intent: PlatformPublicationIntent = {
    expectedRevision: 0,
    publishJobId: publishJob.id,
    snapshot,
  }
  const lease: PlatformPublicationLeaseFence = {
    leaseExpiresAt: claimed?.leaseExpiresAt ?? new Date(Date.now() + 120_000).toISOString(),
    ownerToken: claimed?.ownerToken ?? 'unclaimed-test-lease',
    queueJobId: claimed?.id ?? queued.job.id,
  }
  return {
    authority: new PayloadPlatformPublicationAuthority({ payload }),
    intent,
    lease,
    queue,
    queuedJob: queued.job,
  }
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
    const getStatus = vi.fn().mockImplementation(async (lookup) => {
      const current = await pool().query<{ authorization_revision: number }>(
        'SELECT authorization_revision FROM platform_accounts WHERE id = $1',
        [account.id],
      )
      if (lookup.expectedAuthorizationRevision !== current.rows[0]?.authorization_revision) {
        return {
          errorCode: 'delivery_unknown' as const,
          externalPublicationId: '129472283584550_987654321',
          idempotencyKey: requestSnapshot.idempotencyKey,
          platform: 'facebook' as const,
          platformAccountId: account.id,
          retryable: false as const,
          status: 'delivery_unknown' as const,
        }
      }
      return {
        externalPublicationId: '129472283584550_987654321',
        externalPublicationUrl: 'https://www.facebook.com/129472283584550/posts/987654321',
        idempotencyKey: requestSnapshot.idempotencyKey,
        platform: 'facebook' as const,
        platformAccountId: account.id,
        status: 'published' as const,
      }
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
    expect(getStatus).not.toHaveBeenCalled()
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
    await pool().query(
      'UPDATE platform_accounts SET authorization_revision = authorization_revision + 1 WHERE id = $1',
      [account.id],
    )
    await pool().query('UPDATE jobs SET next_run_at = $1 WHERE id = $2', [
      new Date(Date.now() - 1_000).toISOString(),
      continuationJobId,
    ])
    await expect(worker.runOnce()).resolves.toBe('succeeded')
    expect(getStatus).toHaveBeenCalledTimes(1)
    expect(getStatus).toHaveBeenCalledWith(
      expect.objectContaining({ expectedAuthorizationRevision: account.authorizationRevision }),
    )
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
      lastErrorCode: 'delivery_unknown',
      status: 'delivery_unknown',
    })
  })

  it.each(['before-insert', 'after-insert', 'dead-duplicate', 'expired-final-processing'] as const)(
    'repairs a committed checkpoint after continuation enqueue %s without replaying provider I/O',
    async (failureMode) => {
      const { intent, queue, queuedJob } = await createIntentAndLease({ claimQueueJob: false })
      await pool().query(
        `UPDATE jobs
         SET status = 'dead', dead_at = NOW(), next_run_at = NULL,
             owner_token = NULL, lease_expires_at = NULL
         WHERE type = $1 AND id <> $2 AND status IN ('pending', 'failed', 'processing')`,
        [PLATFORM_PUBLICATION_JOB_TYPE, queuedJob.id],
      )
      const continuationKey = `publication-execute:${intent.publishJobId}:1`
      let rejectContinuation = true
      const enqueue = vi.fn(async (...args: Parameters<PayloadJobQueue['enqueue']>) => {
        const [input, req] = args
        if (rejectContinuation && input.idempotencyKey === continuationKey) {
          rejectContinuation = false
          if (failureMode !== 'before-insert') await queue.enqueue(input, req)
          throw new Error('Injected continuation enqueue failure')
        }
        return queue.enqueue(input, req)
      })
      const publish = vi.fn().mockResolvedValue({
        externalPublicationId: '129472283584550_777777777',
        idempotencyKey: intent.snapshot.idempotencyKey,
        platform: 'facebook' as const,
        platformAccountId: account.id,
        status: 'accepted' as const,
      })
      const getStatus = vi.fn()
      const worker = new JobWorker({
        handlers: {
          [PLATFORM_PUBLICATION_JOB_TYPE]: createPlatformPublicationJobHandler({
            payload,
            queue: { enqueue },
            resolveRuntime: () => ({
              directService: {
                getCapability: vi.fn(),
                getStatus,
                prepareAssistedPublication: vi.fn(),
                publish,
              },
              linkedInTransport: {} as never,
              metaTransport: {} as never,
              readLinkedInAssetBytes: vi.fn(),
            }),
          }),
        },
        queue,
      })

      await expect(worker.runOnce()).resolves.toBe('failed')
      expect(publish).toHaveBeenCalledTimes(1)
      await expect(
        payload.findByID({
          collection: 'publish-jobs',
          depth: 0,
          id: intent.publishJobId,
          overrideAccess: true,
        }),
      ).resolves.toMatchObject({ executionRevision: 1, status: 'accepted' })

      let continuations = await pool().query<{ id: number; status: string }>(
        'SELECT id, status FROM jobs WHERE type = $1 AND idempotency_key = $2',
        [PLATFORM_PUBLICATION_JOB_TYPE, continuationKey],
      )
      expect(continuations.rowCount).toBe(failureMode === 'before-insert' ? 0 : 1)
      if (failureMode === 'dead-duplicate') {
        await pool().query(
          `UPDATE jobs SET status = 'dead', dead_at = NOW(), next_run_at = NULL WHERE id = $1`,
          [continuations.rows[0]!.id],
        )
      } else if (failureMode === 'expired-final-processing') {
        await pool().query(
          `UPDATE jobs
           SET status = 'processing', attempts = 2, max_attempts = 2,
               owner_token = 'stale-worker', lease_expires_at = NOW() - INTERVAL '5 seconds',
               next_run_at = NULL
           WHERE id = $1`,
          [continuations.rows[0]!.id],
        )
      }
      await pool().query(
        "UPDATE jobs SET next_run_at = NOW() - INTERVAL '1 second' WHERE id = $1",
        [queuedJob.id],
      )

      await expect(worker.runOnce()).resolves.toBe(
        failureMode === 'dead-duplicate' || failureMode === 'expired-final-processing'
          ? 'failed'
          : 'succeeded',
      )
      expect(publish).toHaveBeenCalledTimes(1)
      expect(getStatus).not.toHaveBeenCalled()
      continuations = await pool().query<{ id: number; status: string }>(
        'SELECT id, status FROM jobs WHERE type = $1 AND idempotency_key = $2',
        [PLATFORM_PUBLICATION_JOB_TYPE, continuationKey],
      )
      expect(continuations.rowCount).toBe(1)
      jobIDs.push(continuations.rows[0]!.id)
      expect(continuations.rows[0]!.status).toBe(
        failureMode === 'dead-duplicate' || failureMode === 'expired-final-processing'
          ? 'dead'
          : 'pending',
      )
      const source = await pool().query<{ attempts: string; status: string }>(
        'SELECT attempts::text, status FROM jobs WHERE id = $1',
        [queuedJob.id],
      )
      expect(source.rows[0]).toMatchObject({
        attempts: '2',
        status:
          failureMode === 'dead-duplicate' || failureMode === 'expired-final-processing'
            ? 'dead'
            : 'succeeded',
      })
    },
  )

  it('fails the attempt after a checkpoint conflict and recovers durably without republishing', async () => {
    const { intent, queue, queuedJob } = await createIntentAndLease({ claimQueueJob: false })
    const publish = vi.fn().mockImplementation(async () => {
      // Make the CAS checkpoint miss its Jobs lease predicate after provider
      // acceptance. This simulates a concurrent lease/transaction conflict.
      await pool().query(
        `UPDATE jobs
         SET status = 'failed', next_run_at = NOW(), owner_token = NULL, lease_expires_at = NULL
         WHERE id = $1`,
        [queuedJob.id],
      )
      return {
        externalPublicationId: '129472283584550_555555555',
        idempotencyKey: intent.snapshot.idempotencyKey,
        platform: 'facebook' as const,
        platformAccountId: account.id,
        status: 'accepted' as const,
      }
    })
    const getStatus = vi.fn()
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

    await expect(worker.runOnce()).resolves.toBe('failed')
    expect(publish).toHaveBeenCalledTimes(1)
    await expect(
      payload.findByID({
        collection: 'publish-jobs',
        depth: 0,
        id: intent.publishJobId,
        overrideAccess: true,
      }),
    ).resolves.toMatchObject({
      claimId: null,
      executionRevision: 0,
      providerIOStartedAt: expect.any(String),
      status: 'scheduled',
    })
    const firstQueueState = await pool().query<{ status: string; attempts: number | string }>(
      'SELECT status, attempts FROM jobs WHERE id = $1',
      [queuedJob.id],
    )
    expect(firstQueueState.rows[0]).toMatchObject({ attempts: '1', status: 'failed' })
    const recovery = await pool().query<{ id: number }>(
      'SELECT id FROM jobs WHERE type = $1 AND idempotency_key = $2 LIMIT 1',
      [PLATFORM_PUBLICATION_JOB_TYPE, `publication-recovery:${intent.publishJobId}:0`],
    )
    if (!recovery.rows[0]) throw new Error('Expected durable publication recovery job')
    jobIDs.push(recovery.rows[0].id)

    await expect(worker.runOnce()).resolves.toBe('succeeded')
    expect(publish).toHaveBeenCalledTimes(1)
    expect(getStatus).not.toHaveBeenCalled()
    await expect(
      payload.findByID({
        collection: 'publish-jobs',
        depth: 0,
        id: intent.publishJobId,
        overrideAccess: true,
      }),
    ).resolves.toMatchObject({
      claimId: null,
      deliveryUnknownAt: expect.any(String),
      executionRevision: 1,
      status: 'delivery_unknown',
    })
    const logs = await payload.find({
      collection: 'publish-logs',
      depth: 0,
      overrideAccess: true,
      where: { publishJob: { equals: intent.publishJobId } },
    })
    expect(logs.docs).toEqual(
      expect.arrayContaining([expect.objectContaining({ event: 'delivery-unknown' })]),
    )
    await pool().query(
      `UPDATE jobs
       SET status = 'dead', dead_at = NOW(), next_run_at = NULL
       WHERE id = $1 AND status = 'failed'`,
      [queuedJob.id],
    )
  })

  it.each([
    ['blocked', 'success'],
    ['blocked', 'false'],
    ['blocked', 'throw'],
    ['throw', 'success'],
    ['throw', 'false'],
    ['throw', 'throw'],
  ] as const)(
    'survives commit %s and cleanup %s until durable recovery completes',
    async (commitFailure, cleanupFailure) => {
      const { intent, queue, queuedJob } = await createIntentAndLease({ claimQueueJob: false })
      const publish = vi.fn().mockResolvedValue({
        externalPublicationId: '129472283584550_666666666',
        idempotencyKey: intent.snapshot.idempotencyKey,
        platform: 'facebook' as const,
        platformAccountId: account.id,
        status: 'accepted' as const,
      })
      const getStatus = vi.fn()
      const payloadAuthority = new PayloadPlatformPublicationAuthority({ payload })
      let failCommit = true
      let failCleanup = true
      await pool().query(
        `UPDATE jobs
       SET status = 'dead', dead_at = NOW(), next_run_at = NULL,
           owner_token = NULL, lease_expires_at = NULL
       WHERE type = $1 AND id <> $2 AND status IN ('pending', 'failed', 'processing')`,
        [PLATFORM_PUBLICATION_JOB_TYPE, queuedJob.id],
      )
      const worker = new JobWorker({
        handlers: {
          [PLATFORM_PUBLICATION_JOB_TYPE]: createPlatformPublicationJobHandler({
            createDirectAuthority: () => ({
              claimPublication: (...args) => payloadAuthority.claimPublication(...args),
              commitPublication: (...args) => {
                if (!failCommit) return payloadAuthority.commitPublication(...args)
                failCommit = false
                if (commitFailure === 'throw') {
                  throw new Error('Injected publication checkpoint failure')
                }
                return Promise.resolve({ reason: 'claim_conflict', status: 'blocked' })
              },
              markProviderIOStarted: (...args) => payloadAuthority.markProviderIOStarted(...args),
              recoverFailedCommit: (...args) => {
                if (!failCleanup) return payloadAuthority.recoverFailedCommit(...args)
                failCleanup = false
                if (cleanupFailure === 'throw') {
                  throw new Error('Injected publication cleanup failure')
                }
                if (cleanupFailure === 'false') {
                  return Promise.resolve({
                    retryNotBefore: args[0].leaseFence.leaseExpiresAt,
                    status: 'claim_retained',
                  })
                }
                return payloadAuthority.recoverFailedCommit(...args)
              },
              releasePublication: (...args) => payloadAuthority.releasePublication(...args),
            }),
            payload,
            queue,
            resolveRuntime: () => ({
              directService: {
                getCapability: vi.fn(),
                getStatus,
                prepareAssistedPublication: vi.fn(),
                publish,
              },
              linkedInTransport: {} as never,
              metaTransport: {} as never,
              readLinkedInAssetBytes: vi.fn(),
            }),
          }),
        },
        queue,
      })

      await expect(worker.runOnce()).resolves.toBe('failed')
      expect(publish).toHaveBeenCalledTimes(1)
      const retained = await payload.findByID({
        collection: 'publish-jobs',
        depth: 0,
        id: intent.publishJobId,
        overrideAccess: true,
      })
      expect(retained).toMatchObject({
        claimId: cleanupFailure === 'success' ? null : expect.any(String),
        claimLeaseExpiresAt: cleanupFailure === 'success' ? null : expect.any(String),
        executionRevision: 0,
        providerIOStartedAt: expect.any(String),
        status: 'scheduled',
      })

      const recovery = await pool().query<{
        id: number
        next_run_at: Date | string
        status: string
      }>(
        'SELECT id, next_run_at, status FROM jobs WHERE type = $1 AND idempotency_key = $2 LIMIT 1',
        [PLATFORM_PUBLICATION_JOB_TYPE, `publication-recovery:${intent.publishJobId}:0`],
      )
      const recoveryJob = recovery.rows[0]
      if (!recoveryJob) throw new Error('Expected lease-delayed publication recovery job')
      jobIDs.push(recoveryJob.id)
      expect(recoveryJob.status).toBe('pending')
      if (cleanupFailure === 'success') {
        expect(Number.isFinite(new Date(recoveryJob.next_run_at).getTime())).toBe(true)
      } else {
        expect(new Date(recoveryJob.next_run_at).getTime()).toBeGreaterThanOrEqual(
          Date.parse(retained.claimLeaseExpiresAt!),
        )
        await pool().query(
          "UPDATE jobs SET next_run_at = NOW() - INTERVAL '1 second' WHERE id = $1",
          [queuedJob.id],
        )
        await expect(worker.runOnce()).resolves.toBe('failed')
        expect(publish).toHaveBeenCalledTimes(1)
        expect(getStatus).not.toHaveBeenCalled()
        const exhausted = await pool().query<{ attempts: number | string; status: string }>(
          'SELECT attempts, status FROM jobs WHERE id = $1',
          [queuedJob.id],
        )
        expect(exhausted.rows[0]).toMatchObject({ attempts: '2', status: 'dead' })
        await pool().query(
          `UPDATE publish_jobs
         SET claim_lease_expires_at = NOW() - INTERVAL '1 second'
         WHERE id = $1`,
          [intent.publishJobId],
        )
      }
      await pool().query(
        "UPDATE jobs SET next_run_at = NOW() - INTERVAL '1 second' WHERE id = $1",
        [recoveryJob.id],
      )
      await expect(worker.runOnce()).resolves.toBe('succeeded')
      expect(publish).toHaveBeenCalledTimes(1)
      expect(getStatus).not.toHaveBeenCalled()
      await expect(
        payload.findByID({
          collection: 'publish-jobs',
          depth: 0,
          id: intent.publishJobId,
          overrideAccess: true,
        }),
      ).resolves.toMatchObject({
        claimId: null,
        deliveryUnknownAt: expect.any(String),
        executionRevision: 1,
        status: 'delivery_unknown',
      })
      if (cleanupFailure === 'success') {
        await pool().query(
          "UPDATE jobs SET next_run_at = NOW() - INTERVAL '1 second' WHERE id = $1",
          [queuedJob.id],
        )
        await expect(worker.runOnce()).resolves.toBe('succeeded')
      }
      const queueStates = await pool().query<{ id: number; status: string }>(
        'SELECT id, status FROM jobs WHERE id = ANY($1::int[]) ORDER BY id',
        [[queuedJob.id, recoveryJob.id]],
      )
      expect(queueStates.rows).toEqual(
        expect.arrayContaining([
          {
            id: queuedJob.id,
            status: cleanupFailure === 'success' ? 'succeeded' : 'dead',
          },
          { id: recoveryJob.id, status: 'succeeded' },
        ]),
      )
      const logs = await payload.find({
        collection: 'publish-logs',
        depth: 0,
        overrideAccess: true,
        where: { publishJob: { equals: intent.publishJobId } },
      })
      expect(logs.docs).toEqual(
        expect.arrayContaining([expect.objectContaining({ event: 'delivery-unknown' })]),
      )
    },
  )

  it.each(['released', 'retained'] as const)(
    'bounds persistent recovery checkpoint failure with a %s claim',
    async (cleanupMode) => {
      const { intent, queue, queuedJob } = await createIntentAndLease({ claimQueueJob: false })
      await pool().query(
        `UPDATE jobs
         SET status = 'dead', dead_at = NOW(), next_run_at = NULL,
             owner_token = NULL, lease_expires_at = NULL
         WHERE type = $1 AND id <> $2 AND status IN ('pending', 'failed', 'processing')`,
        [PLATFORM_PUBLICATION_JOB_TYPE, queuedJob.id],
      )
      const publish = vi.fn().mockResolvedValue({
        externalPublicationId: '129472283584550_888888888',
        idempotencyKey: intent.snapshot.idempotencyKey,
        platform: 'facebook' as const,
        platformAccountId: account.id,
        status: 'accepted' as const,
      })
      const getStatus = vi.fn()
      const payloadAuthority = new PayloadPlatformPublicationAuthority({ payload })
      const commitPublication = vi
        .fn()
        .mockResolvedValue({ reason: 'claim_conflict' as const, status: 'blocked' as const })
      const worker = new JobWorker({
        handlers: {
          [PLATFORM_PUBLICATION_JOB_TYPE]: createPlatformPublicationJobHandler({
            createDirectAuthority: () => ({
              claimPublication: (...args) => payloadAuthority.claimPublication(...args),
              commitPublication,
              markProviderIOStarted: (...args) => payloadAuthority.markProviderIOStarted(...args),
              recoverFailedCommit: (...args) =>
                cleanupMode === 'released'
                  ? payloadAuthority.recoverFailedCommit(...args)
                  : Promise.resolve({
                      retryNotBefore: args[0].leaseFence.leaseExpiresAt,
                      status: 'claim_retained' as const,
                    }),
              releasePublication: (...args) => payloadAuthority.releasePublication(...args),
            }),
            payload,
            queue,
            resolveRuntime: () => ({
              directService: {
                getCapability: vi.fn(),
                getStatus,
                prepareAssistedPublication: vi.fn(),
                publish,
              },
              linkedInTransport: {} as never,
              metaTransport: {} as never,
              readLinkedInAssetBytes: vi.fn(),
            }),
          }),
        },
        queue,
      })

      await expect(worker.runOnce()).resolves.toBe('failed')
      expect(publish).toHaveBeenCalledTimes(1)
      const recoveryKey = `publication-recovery:${intent.publishJobId}:0`
      const recovery = await pool().query<{ id: number }>(
        'SELECT id FROM jobs WHERE type = $1 AND idempotency_key = $2 LIMIT 1',
        [PLATFORM_PUBLICATION_JOB_TYPE, recoveryKey],
      )
      const recoveryJobId = recovery.rows[0]?.id
      if (!recoveryJobId) throw new Error('Expected bounded publication recovery job')
      jobIDs.push(recoveryJobId)

      for (let attempt = 0; attempt < 2; attempt += 1) {
        await pool().query(
          `UPDATE jobs
           SET next_run_at = CASE WHEN id = $1 THEN NOW() - INTERVAL '1 second'
                                  ELSE NOW() + INTERVAL '1 hour' END
           WHERE id = ANY($2::int[])`,
          [recoveryJobId, [recoveryJobId, queuedJob.id]],
        )
        if (cleanupMode === 'retained') {
          await pool().query(
            `UPDATE publish_jobs
             SET claim_lease_expires_at = NOW() - INTERVAL '1 second'
             WHERE id = $1`,
            [intent.publishJobId],
          )
        }
        await expect(worker.runOnce()).resolves.toBe('failed')
      }

      const exhaustedRecovery = await pool().query<{
        attempts: string
        last_error: string | null
        status: string
      }>('SELECT attempts::text, last_error, status FROM jobs WHERE id = $1', [recoveryJobId])
      expect(exhaustedRecovery.rows[0]).toMatchObject({
        attempts: '2',
        last_error: expect.stringContaining('checkpoint is unresolved'),
        status: 'dead',
      })

      await pool().query(
        "UPDATE jobs SET next_run_at = NOW() - INTERVAL '1 second' WHERE id = $1",
        [queuedJob.id],
      )
      await expect(worker.runOnce()).resolves.toBe('failed')
      const source = await pool().query<{ attempts: string; status: string }>(
        'SELECT attempts::text, status FROM jobs WHERE id = $1',
        [queuedJob.id],
      )
      expect(source.rows[0]).toMatchObject({ attempts: '2', status: 'dead' })
      await expect(worker.runOnce()).resolves.toBe('idle')
      const recoveryCount = await pool().query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM jobs
         WHERE type = $1 AND idempotency_key LIKE $2`,
        [PLATFORM_PUBLICATION_JOB_TYPE, `publication-recovery:${intent.publishJobId}:%`],
      )
      expect(recoveryCount.rows[0]?.count).toBe('1')
      expect(publish).toHaveBeenCalledTimes(1)
      expect(getStatus).not.toHaveBeenCalled()
      await expect(
        payload.findByID({
          collection: 'publish-jobs',
          depth: 0,
          id: intent.publishJobId,
          overrideAccess: true,
        }),
      ).resolves.toMatchObject({
        executionRevision: 0,
        providerIOStartedAt: expect.any(String),
        status: 'scheduled',
      })
    },
  )

  it.each(['released', 'retained'] as const)(
    'handles direct status checkpoint commit failure with a %s claim without replaying mutation',
    async (claimMode) => {
      const { intent, queue, queuedJob } = await createIntentAndLease({ claimQueueJob: false })
      await pool().query(
        `UPDATE jobs
         SET status = 'dead', dead_at = NOW(), next_run_at = NULL,
             owner_token = NULL, lease_expires_at = NULL
         WHERE type = $1 AND id <> $2 AND status IN ('pending', 'failed', 'processing')`,
        [PLATFORM_PUBLICATION_JOB_TYPE, queuedJob.id],
      )
      const publish = vi.fn().mockResolvedValue({
        externalPublicationId: '129472283584550_111222333',
        idempotencyKey: intent.snapshot.idempotencyKey,
        platform: 'facebook' as const,
        platformAccountId: account.id,
        status: 'accepted' as const,
      })
      const getStatus = vi.fn().mockResolvedValue({
        externalPublicationId: '129472283584550_111222333',
        externalPublicationUrl: 'https://www.facebook.com/129472283584550/posts/111222333',
        idempotencyKey: intent.snapshot.idempotencyKey,
        platform: 'facebook' as const,
        platformAccountId: account.id,
        status: 'published' as const,
      })
      const payloadAuthority = new PayloadPlatformPublicationAuthority({ payload })
      let failStatusCommit = true
      const worker = new JobWorker({
        handlers: {
          [PLATFORM_PUBLICATION_JOB_TYPE]: createPlatformPublicationJobHandler({
            createDirectAuthority: () => ({
              claimPublication: (...args) => payloadAuthority.claimPublication(...args),
              commitPublication: (...args) => {
                if (failStatusCommit && args[0].intent.snapshot.status === 'accepted') {
                  failStatusCommit = false
                  return Promise.resolve({ reason: 'claim_conflict', status: 'blocked' as const })
                }
                return payloadAuthority.commitPublication(...args)
              },
              markProviderIOStarted: (...args) => payloadAuthority.markProviderIOStarted(...args),
              recoverFailedCommit: (...args) =>
                claimMode === 'released'
                  ? payloadAuthority.recoverFailedCommit(...args)
                  : Promise.resolve({
                      retryNotBefore: args[0].leaseFence.leaseExpiresAt,
                      status: 'claim_retained' as const,
                    }),
              releasePublication: (...args) => payloadAuthority.releasePublication(...args),
            }),
            payload,
            queue,
            resolveRuntime: () => ({
              directService: {
                getCapability: vi.fn(),
                getStatus,
                prepareAssistedPublication: vi.fn(),
                publish,
              },
              linkedInTransport: {} as never,
              metaTransport: {} as never,
              readLinkedInAssetBytes: vi.fn(),
            }),
          }),
        },
        queue,
      })

      // Step 1: initial publish runs and succeeds with accepted (revision 0 -> 1)
      await expect(worker.runOnce()).resolves.toBe('succeeded')
      expect(publish).toHaveBeenCalledTimes(1)
      expect(getStatus).not.toHaveBeenCalled()

      const continuationKey = `publication-execute:${intent.publishJobId}:1`
      const continuation = await pool().query<{ id: number }>(
        'SELECT id FROM jobs WHERE type = $1 AND idempotency_key = $2 LIMIT 1',
        [PLATFORM_PUBLICATION_JOB_TYPE, continuationKey],
      )
      const continuationJobId = continuation.rows[0]?.id
      if (!continuationJobId) throw new Error('Expected direct status continuation job')
      jobIDs.push(continuationJobId)

      // Step 2: run continuation - its status commit will fail
      await pool().query(
        "UPDATE jobs SET next_run_at = NOW() - INTERVAL '1 second' WHERE id = $1",
        [continuationJobId],
      )
      await expect(worker.runOnce()).resolves.toBe('failed')
      expect(publish).toHaveBeenCalledTimes(1)
      expect(getStatus).toHaveBeenCalledTimes(1)

      if (claimMode === 'released') {
        // With claim released, the continuation job can immediately retry on attempt 2 and succeed
        await pool().query(
          "UPDATE jobs SET next_run_at = NOW() - INTERVAL '1 second' WHERE id = $1",
          [continuationJobId],
        )
        await expect(worker.runOnce()).resolves.toBe('succeeded')
        expect(publish).toHaveBeenCalledTimes(1)
        expect(getStatus).toHaveBeenCalledTimes(2)
        await expect(
          payload.findByID({
            collection: 'publish-jobs',
            depth: 0,
            id: intent.publishJobId,
            overrideAccess: true,
          }),
        ).resolves.toMatchObject({
          claimId: null,
          executionRevision: 2,
          externalPublicationId: '129472283584550_111222333',
          status: 'published',
        })
      } else {
        // With claim retained, a status successor was enqueued for when the lease expires
        const statusSuccessorKey = `publication-status:${intent.publishJobId}:1`
        const successor = await pool().query<{
          id: number
          next_run_at: Date | string
          status: string
        }>(
          'SELECT id, next_run_at, status FROM jobs WHERE type = $1 AND idempotency_key = $2 LIMIT 1',
          [PLATFORM_PUBLICATION_JOB_TYPE, statusSuccessorKey],
        )
        const successorJob = successor.rows[0]
        if (!successorJob) throw new Error('Expected durable status successor job')
        jobIDs.push(successorJob.id)
        expect(successorJob.status).toBe('pending')

        // Continuation attempt 2 fails due to lease conflict and becomes dead
        await pool().query(
          "UPDATE jobs SET next_run_at = NOW() - INTERVAL '1 second' WHERE id = $1",
          [continuationJobId],
        )
        await expect(worker.runOnce()).resolves.toBe('failed')
        const continuationState = await pool().query<{ attempts: string; status: string }>(
          'SELECT attempts::text, status FROM jobs WHERE id = $1',
          [continuationJobId],
        )
        expect(continuationState.rows[0]).toMatchObject({ attempts: '2', status: 'dead' })

        // Now expire the claim on PublishJob and run the status successor
        await pool().query(
          "UPDATE publish_jobs SET claim_lease_expires_at = NOW() - INTERVAL '1 second' WHERE id = $1",
          [intent.publishJobId],
        )
        await pool().query(
          "UPDATE jobs SET next_run_at = NOW() - INTERVAL '1 second' WHERE id = $1",
          [successorJob.id],
        )
        await expect(worker.runOnce()).resolves.toBe('succeeded')
        expect(publish).toHaveBeenCalledTimes(1)
        expect(getStatus).toHaveBeenCalledTimes(2)
        await expect(
          payload.findByID({
            collection: 'publish-jobs',
            depth: 0,
            id: intent.publishJobId,
            overrideAccess: true,
          }),
        ).resolves.toMatchObject({
          claimId: null,
          executionRevision: 2,
          externalPublicationId: '129472283584550_111222333',
          status: 'published',
        })
      }
    },
  )

  it('allows manual compensation retry for a dead publication recovery job and finishes without provider replay', async () => {
    const { intent, queue, queuedJob } = await createIntentAndLease({ claimQueueJob: false })
    await pool().query(
      `UPDATE jobs
       SET status = 'dead', dead_at = NOW(), next_run_at = NULL,
           owner_token = NULL, lease_expires_at = NULL
       WHERE type = $1 AND id <> $2 AND status IN ('pending', 'failed', 'processing')`,
      [PLATFORM_PUBLICATION_JOB_TYPE, queuedJob.id],
    )
    const publish = vi.fn().mockResolvedValue({
      externalPublicationId: '129472283584550_999000111',
      idempotencyKey: intent.snapshot.idempotencyKey,
      platform: 'facebook' as const,
      platformAccountId: account.id,
      status: 'accepted' as const,
    })
    const getStatus = vi.fn()
    const payloadAuthority = new PayloadPlatformPublicationAuthority({ payload })
    let blockCommit = true
    const worker = new JobWorker({
      handlers: {
        [PLATFORM_PUBLICATION_JOB_TYPE]: createPlatformPublicationJobHandler({
          createDirectAuthority: () => ({
            claimPublication: (...args) => payloadAuthority.claimPublication(...args),
            commitPublication: (...args) => {
              if (blockCommit) {
                return Promise.resolve({ reason: 'claim_conflict', status: 'blocked' as const })
              }
              return payloadAuthority.commitPublication(...args)
            },
            markProviderIOStarted: (...args) => payloadAuthority.markProviderIOStarted(...args),
            recoverFailedCommit: (...args) => payloadAuthority.recoverFailedCommit(...args),
            releasePublication: (...args) => payloadAuthority.releasePublication(...args),
          }),
          payload,
          queue,
          resolveRuntime: () => ({
            directService: {
              getCapability: vi.fn(),
              getStatus,
              prepareAssistedPublication: vi.fn(),
              publish,
            },
            linkedInTransport: {} as never,
            metaTransport: {} as never,
            readLinkedInAssetBytes: vi.fn(),
          }),
        }),
      },
      queue,
    })

    // Step 1: source job runs, publish accepted, commit fails -> schedules recovery job
    await expect(worker.runOnce()).resolves.toBe('failed')
    expect(publish).toHaveBeenCalledTimes(1)
    const recoveryKey = `publication-recovery:${intent.publishJobId}:0`
    const recovery = await pool().query<{ id: number }>(
      'SELECT id FROM jobs WHERE type = $1 AND idempotency_key = $2 LIMIT 1',
      [PLATFORM_PUBLICATION_JOB_TYPE, recoveryKey],
    )
    const recoveryJobId = recovery.rows[0]?.id
    if (!recoveryJobId) throw new Error('Expected publication recovery job')
    jobIDs.push(recoveryJobId)

    // Step 2: exhaust recovery attempts so it becomes dead
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await pool().query(
        "UPDATE jobs SET next_run_at = NOW() - INTERVAL '1 second' WHERE id = $1",
        [recoveryJobId],
      )
      await expect(worker.runOnce()).resolves.toBe('failed')
    }

    const deadRecovery = await pool().query<{
      attempts: string
      status: string
      updated_at: Date | string
    }>('SELECT attempts::text, status, updated_at FROM jobs WHERE id = $1', [recoveryJobId])
    expect(deadRecovery.rows[0]).toMatchObject({ attempts: '2', status: 'dead' })

    // Step 3: Admin uses retryPortalJob to manually retry the dead recovery job
    blockCommit = false
    const retryResult = await retryPortalJob({
      id: recoveryJobId,
      input: { updatedAt: new Date(deadRecovery.rows[0]!.updated_at).toISOString() },
      payload,
      queue,
      req: { user: { id: admin.id, role: 'admin' } } as unknown as Parameters<
        typeof retryPortalJob
      >[0]['req'],
      user: admin,
    })

    expect(retryResult).toEqual({
      action: 'retry-publication-recovery',
      jobId: recoveryJobId,
      status: 'pending',
    })

    // Assert recovery job count is STILL 1 (same job reset, no second job created)
    const recoveryJobCount = await pool().query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM jobs WHERE type = $1 AND idempotency_key = $2',
      [PLATFORM_PUBLICATION_JOB_TYPE, recoveryKey],
    )
    expect(recoveryJobCount.rows[0]?.count).toBe('1')

    // Step 4: Worker runs the retried recovery job and completes delivery_unknown
    await expect(worker.runOnce()).resolves.toBe('succeeded')
    expect(publish).toHaveBeenCalledTimes(1) // ZERO replays!
    expect(getStatus).not.toHaveBeenCalled()

    await expect(
      payload.findByID({
        collection: 'publish-jobs',
        depth: 0,
        id: intent.publishJobId,
        overrideAccess: true,
      }),
    ).resolves.toMatchObject({
      claimId: null,
      deliveryUnknownAt: expect.any(String),
      executionRevision: 1,
      status: 'delivery_unknown',
    })
  })

  it('delays manual publication recovery until a retained claim lease expires', async () => {
    const { intent, queue, queuedJob } = await createIntentAndLease({ claimQueueJob: false })
    await pool().query(
      `UPDATE jobs
       SET status = 'dead', dead_at = NOW(), next_run_at = NULL,
           owner_token = NULL, lease_expires_at = NULL
       WHERE id = $1`,
      [queuedJob.id],
    )
    const retainedLease = new Date(Date.now() + 300_000)
    await pool().query(
      `UPDATE publish_jobs
       SET claim_job_id = $1, claim_id = 'manual-recovery-retained',
           claim_owner_token = 'expired-worker', claim_lease_expires_at = $2,
           provider_i_o_started_at = NOW()
       WHERE id = $3`,
      [queuedJob.id, retainedLease.toISOString(), intent.publishJobId],
    )
    const recovery = await queue.enqueue({
      idempotencyKey: `publication-recovery:${intent.publishJobId}:0`,
      maxAttempts: 2,
      payload: { expectedExecutionRevision: 0, publishJobId: intent.publishJobId },
      type: PLATFORM_PUBLICATION_JOB_TYPE,
    })
    jobIDs.push(recovery.job.id)
    await pool().query(
      `UPDATE jobs
       SET attempts = max_attempts, status = 'dead', dead_at = NOW(), next_run_at = NULL,
           owner_token = NULL, lease_expires_at = NULL
       WHERE id = $1`,
      [recovery.job.id],
    )
    const deadRecovery = await pool().query<{ updated_at: Date | string }>(
      'SELECT updated_at FROM jobs WHERE id = $1',
      [recovery.job.id],
    )
    const publish = vi.fn()
    const getStatus = vi.fn()
    const worker = new JobWorker({
      handlers: {
        [PLATFORM_PUBLICATION_JOB_TYPE]: createPlatformPublicationJobHandler({
          payload,
          queue,
          resolveRuntime: () => ({
            directService: {
              getCapability: vi.fn(),
              getStatus,
              prepareAssistedPublication: vi.fn(),
              publish,
            },
            linkedInTransport: {} as never,
            metaTransport: {} as never,
            readLinkedInAssetBytes: vi.fn(),
          }),
        }),
      },
      queue,
    })

    await expect(
      retryPortalJob({
        id: recovery.job.id,
        input: { updatedAt: new Date(deadRecovery.rows[0]!.updated_at).toISOString() },
        payload,
        queue,
        req: { user: { id: admin.id, role: 'admin' } } as unknown as Parameters<
          typeof retryPortalJob
        >[0]['req'],
        user: admin,
      }),
    ).resolves.toMatchObject({ action: 'retry-publication-recovery', status: 'pending' })

    const rearmed = await pool().query<{
      attempts: string
      next_run_at: Date | string
      status: string
    }>('SELECT attempts::text, next_run_at, status FROM jobs WHERE id = $1', [recovery.job.id])
    expect(rearmed.rows[0]).toMatchObject({ attempts: '0', status: 'pending' })
    expect(new Date(rearmed.rows[0]!.next_run_at).getTime()).toBeGreaterThanOrEqual(
      retainedLease.getTime() + 1,
    )
    await expect(worker.runOnce()).resolves.toBe('idle')
    expect(publish).not.toHaveBeenCalled()
    expect(getStatus).not.toHaveBeenCalled()

    await pool().query(
      "UPDATE publish_jobs SET claim_lease_expires_at = NOW() - INTERVAL '1 second' WHERE id = $1",
      [intent.publishJobId],
    )
    await pool().query("UPDATE jobs SET next_run_at = NOW() - INTERVAL '1 second' WHERE id = $1", [
      recovery.job.id,
    ])
    await expect(worker.runOnce()).resolves.toBe('succeeded')
    expect(publish).not.toHaveBeenCalled()
    expect(getStatus).not.toHaveBeenCalled()
    await expect(
      payload.findByID({
        collection: 'publish-jobs',
        depth: 0,
        id: intent.publishJobId,
        overrideAccess: true,
      }),
    ).resolves.toMatchObject({ executionRevision: 1, status: 'delivery_unknown' })
    const logs = await payload.find({
      collection: 'publish-logs',
      depth: 0,
      overrideAccess: true,
      where: { publishJob: { equals: intent.publishJobId } },
    })
    expect(logs.docs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actor: admin.id,
          event: 'status-updated',
          summary: expect.stringContaining('Manual publication recovery rearmed'),
        }),
      ]),
    )
  })

  it.each(['released', 'retained'] as const)(
    'bounds persistent direct status failure with a %s claim and exposes one safe recovery action',
    async (claimMode) => {
      const { intent, queue, queuedJob } = await createIntentAndLease({ claimQueueJob: false })
      await pool().query(
        `UPDATE jobs
         SET status = 'dead', dead_at = NOW(), next_run_at = NULL,
             owner_token = NULL, lease_expires_at = NULL
         WHERE type = $1 AND id <> $2 AND status IN ('pending', 'failed', 'processing')`,
        [PLATFORM_PUBLICATION_JOB_TYPE, queuedJob.id],
      )
      const publish = vi.fn().mockResolvedValue({
        externalPublicationId: '129472283584550_777000111',
        idempotencyKey: intent.snapshot.idempotencyKey,
        platform: 'facebook' as const,
        platformAccountId: account.id,
        status: 'accepted' as const,
      })
      const getStatus = vi.fn().mockResolvedValue({
        externalPublicationId: '129472283584550_777000111',
        externalPublicationUrl: 'https://www.facebook.com/129472283584550/posts/777000111',
        idempotencyKey: intent.snapshot.idempotencyKey,
        platform: 'facebook' as const,
        platformAccountId: account.id,
        status: 'published' as const,
      })
      const payloadAuthority = new PayloadPlatformPublicationAuthority({ payload })
      let blockStatusCommit = true
      const worker = new JobWorker({
        handlers: {
          [PLATFORM_PUBLICATION_JOB_TYPE]: createPlatformPublicationJobHandler({
            createDirectAuthority: () => ({
              claimPublication: (...args) => payloadAuthority.claimPublication(...args),
              commitPublication: (...args) => {
                if (blockStatusCommit && args[0].intent.snapshot.status === 'accepted') {
                  return Promise.resolve({ reason: 'claim_conflict', status: 'blocked' as const })
                }
                return payloadAuthority.commitPublication(...args)
              },
              markProviderIOStarted: (...args) => payloadAuthority.markProviderIOStarted(...args),
              recoverFailedCommit: (...args) =>
                claimMode === 'released'
                  ? payloadAuthority.recoverFailedCommit(...args)
                  : Promise.resolve({
                      retryNotBefore: args[0].leaseFence.leaseExpiresAt,
                      status: 'claim_retained' as const,
                    }),
              releasePublication: (...args) => payloadAuthority.releasePublication(...args),
            }),
            payload,
            queue,
            resolveRuntime: () => ({
              directService: {
                getCapability: vi.fn(),
                getStatus,
                prepareAssistedPublication: vi.fn(),
                publish,
              },
              linkedInTransport: {} as never,
              metaTransport: {} as never,
              readLinkedInAssetBytes: vi.fn(),
            }),
          }),
        },
        queue,
      })

      await expect(worker.runOnce()).resolves.toBe('succeeded')
      expect(publish).toHaveBeenCalledTimes(1)
      const continuation = await pool().query<{ id: number }>(
        'SELECT id FROM jobs WHERE type = $1 AND idempotency_key = $2 LIMIT 1',
        [PLATFORM_PUBLICATION_JOB_TYPE, `publication-execute:${intent.publishJobId}:1`],
      )
      const continuationJobId = continuation.rows[0]?.id
      if (!continuationJobId) throw new Error('Expected direct status continuation job')
      jobIDs.push(continuationJobId)
      await pool().query(
        "UPDATE jobs SET next_run_at = NOW() - INTERVAL '1 second' WHERE id = $1",
        [continuationJobId],
      )
      await expect(worker.runOnce()).resolves.toBe('failed')

      const statusKey = `publication-status:${intent.publishJobId}:1`
      const statusResult = await pool().query<{ id: number }>(
        'SELECT id FROM jobs WHERE type = $1 AND idempotency_key = $2 LIMIT 1',
        [PLATFORM_PUBLICATION_JOB_TYPE, statusKey],
      )
      const statusJobId = statusResult.rows[0]?.id
      if (!statusJobId) throw new Error('Expected bounded status recovery job')
      jobIDs.push(statusJobId)

      if (claimMode === 'retained') {
        // The successor is scheduled after the first retained lease. Make that
        // lease expired before the first status-only attempt, then verify a
        // later retained lease is respected by the bounded retry.
        await pool().query(
          "UPDATE publish_jobs SET claim_lease_expires_at = NOW() - INTERVAL '1 second' WHERE id = $1",
          [intent.publishJobId],
        )
      }
      await pool().query(
        "UPDATE jobs SET next_run_at = NOW() - INTERVAL '1 second' WHERE id = $1",
        [statusJobId],
      )
      await expect(worker.runOnce()).resolves.toBe('failed')

      if (claimMode === 'retained') {
        const delayedRetry = await pool().query<{
          attempts: string
          next_run_at: Date | string
          status: string
        }>('SELECT attempts::text, next_run_at, status FROM jobs WHERE id = $1', [statusJobId])
        const retained = await payload.findByID({
          collection: 'publish-jobs',
          depth: 0,
          id: intent.publishJobId,
          overrideAccess: true,
        })
        expect(delayedRetry.rows[0]).toMatchObject({ attempts: '1', status: 'failed' })
        expect(new Date(delayedRetry.rows[0]!.next_run_at).getTime()).toBeGreaterThanOrEqual(
          Date.parse(retained.claimLeaseExpiresAt!) + 1,
        )
        await pool().query(
          "UPDATE publish_jobs SET claim_lease_expires_at = NOW() - INTERVAL '1 second' WHERE id = $1",
          [intent.publishJobId],
        )
      }

      await pool().query(
        "UPDATE jobs SET next_run_at = NOW() - INTERVAL '1 second' WHERE id = $1",
        [statusJobId],
      )
      await expect(worker.runOnce()).resolves.toBe('failed')

      const deadStatus = await pool().query<{
        attempts: string
        status: string
        updated_at: Date | string
      }>('SELECT attempts::text, status, updated_at FROM jobs WHERE id = $1', [statusJobId])
      expect(deadStatus.rows[0]).toMatchObject({ attempts: '2', status: 'dead' })
      expect(publish).toHaveBeenCalledTimes(1)
      expect(getStatus).toHaveBeenCalledTimes(3)
      await expect(
        payload.findByID({
          collection: 'publish-jobs',
          depth: 0,
          id: intent.publishJobId,
          overrideAccess: true,
        }),
      ).resolves.toMatchObject({ executionRevision: 1, status: 'accepted' })

      blockStatusCommit = false
      const retried = await retryPortalJob({
        id: statusJobId,
        input: { updatedAt: new Date(deadStatus.rows[0]!.updated_at).toISOString() },
        payload,
        queue,
        req: { user: { id: admin.id, role: 'admin' } } as unknown as Parameters<
          typeof retryPortalJob
        >[0]['req'],
        user: admin,
      })
      expect(retried).toEqual({
        action: 'retry-publication-status-recovery',
        jobId: statusJobId,
        status: 'pending',
      })
      const rearmed = await pool().query<{
        attempts: string
        next_run_at: Date | string
        status: string
      }>('SELECT attempts::text, next_run_at, status FROM jobs WHERE id = $1', [statusJobId])
      expect(rearmed.rows[0]).toMatchObject({ attempts: '0', status: 'pending' })
      if (claimMode === 'retained') {
        const retained = await payload.findByID({
          collection: 'publish-jobs',
          depth: 0,
          id: intent.publishJobId,
          overrideAccess: true,
        })
        expect(new Date(rearmed.rows[0]!.next_run_at).getTime()).toBeGreaterThanOrEqual(
          Date.parse(retained.claimLeaseExpiresAt!) + 1,
        )
        await pool().query(
          "UPDATE publish_jobs SET claim_lease_expires_at = NOW() - INTERVAL '1 second' WHERE id = $1",
          [intent.publishJobId],
        )
      }
      await pool().query(
        "UPDATE jobs SET next_run_at = NOW() - INTERVAL '1 second' WHERE id = $1",
        [statusJobId],
      )
      await expect(worker.runOnce()).resolves.toBe('succeeded')
      expect(publish).toHaveBeenCalledTimes(1)
      expect(getStatus).toHaveBeenCalledTimes(4)
      const logs = await payload.find({
        collection: 'publish-logs',
        depth: 0,
        overrideAccess: true,
        where: { publishJob: { equals: intent.publishJobId } },
      })
      expect(logs.docs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            actor: admin.id,
            event: 'status-updated',
            summary: expect.stringContaining('provider mutation will not be replayed'),
          }),
        ]),
      )
    },
  )

  it('blocks a queued direct publication when only the account authorization revision changes', async () => {
    const suffix = randomUUID()
    const content = await payload.create({
      collection: 'generated-contents',
      context: contentStudioInternalWriteContext,
      data: {
        body: 'Stale authorization publication update',
        contentLocale: 'en',
        contentType: 'post',
        createdBy: admin.id,
        creationFingerprint: 'e'.repeat(64),
        idempotencyKey: `stale-authorization-content:${suffix}`,
        platform: 'facebook',
        status: 'approved',
        title: 'Stale authorization publication fixture',
      },
      overrideAccess: true,
    })
    contentIDs.push(content.id)
    const requestSnapshot = {
      assets: [
        {
          fileName: 'facade.jpg',
          id: 'asset-stale-authorization',
          mimeType: 'image/jpeg',
          sourceUrl: 'https://media.example.invalid/facade.jpg',
        },
      ],
      idempotencyKey: `publish:v1:${suffix.replaceAll('-', '')}:facebook`,
      platform: 'facebook',
      platformAccountId: account.id,
      status: 'scheduled',
      text: 'Stale authorization publication update',
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
        requestFingerprint: 'f'.repeat(64),
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

    const publishFacebookPagePhoto = vi.fn()
    const getFacebookPagePostPermalink = vi.fn()
    const accountResolver = new PayloadPublishingAccountResolver({ payload })
    const resolveAccount = vi.spyOn(accountResolver, 'resolve')
    const directService = createPlatformPublishingService({
      accountResolver,
      linkedInTransport: {} as never,
      metaTransport: {
        createInstagramMedia: vi.fn(),
        getFacebookPagePostPermalink,
        getInstagramContainerStatus: vi.fn(),
        getInstagramMediaPermalink: vi.fn(),
        publishFacebookPagePhoto,
        publishInstagramMedia: vi.fn(),
      },
    })
    const worker = new JobWorker({
      handlers: {
        [PLATFORM_PUBLICATION_JOB_TYPE]: createPlatformPublicationJobHandler({
          payload,
          queue,
          resolveRuntime: () => ({
            directService,
            linkedInTransport: {} as never,
            metaTransport: {} as never,
            readLinkedInAssetBytes: vi.fn(),
          }),
        }),
      },
      queue,
    })

    await pool().query(
      'UPDATE platform_accounts SET authorization_revision = authorization_revision + 1 WHERE id = $1',
      [account.id],
    )
    try {
      await expect(worker.runOnce()).resolves.toBe('succeeded')
      expect(resolveAccount).toHaveBeenCalledWith(
        expect.objectContaining({
          expectedAuthorizationRevision: account.authorizationRevision,
          platform: 'facebook',
          platformAccountId: account.id,
        }),
      )
      expect(publishFacebookPagePhoto).not.toHaveBeenCalled()
      expect(getFacebookPagePostPermalink).not.toHaveBeenCalled()
      await expect(
        payload.findByID({
          collection: 'publish-jobs',
          depth: 0,
          id: publishJob.id,
          overrideAccess: true,
        }),
      ).resolves.toMatchObject({
        executionRevision: 1,
        lastErrorCode: 'authorization_required',
        status: 'failed',
      })
      const continuations = await pool().query<{ count: string }>(
        'SELECT COUNT(*)::text AS count FROM jobs WHERE idempotency_key = $1',
        [`publication-execute:${publishJob.id}:1`],
      )
      expect(continuations.rows[0]?.count).toBe('0')
    } finally {
      await pool().query('UPDATE platform_accounts SET authorization_revision = $1 WHERE id = $2', [
        account.authorizationRevision,
        account.id,
      ])
    }
  })
})
