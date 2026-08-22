import { describe, expect, it, vi } from 'vitest'
import type { Payload, PayloadRequest } from 'payload'

import {
  getJobCompensation,
  parsePublicationRecoveryIdempotencyKey,
} from '@/modules/jobs/compensation/contracts'
import {
  parseSafeJobQuery,
  toSafeJobSummary,
} from '@/admin-portal/modules/operations/getSafeJobPage'
import type { Job, User } from '@/payload-types'
import {
  OperationsCommandError,
  retryPortalJob,
} from '@/admin-portal/modules/operations/operationsCommands'

const job = (overrides: Partial<Job> = {}): Job => ({
  attempts: 5,
  completedAt: null,
  createdAt: '2026-07-30T00:00:00.000Z',
  deadAt: '2026-07-30T00:00:00.000Z',
  id: 17,
  idempotencyKey: 'safe-job-test',
  lastError: 'token=never-return-this',
  leaseExpiresAt: null,
  manualRetryCount: 0,
  maxAttempts: 5,
  nextRunAt: null,
  ownerToken: 'never-return-this',
  payload: { private: 'never-return-this' },
  status: 'dead',
  type: 'knowledge.index',
  updatedAt: '2026-07-30T00:00:00.000Z',
  ...overrides,
})

describe('Portal operations', () => {
  it('only registers compensation for a terminal knowledge index job or publication recovery job', () => {
    expect(getJobCompensation({ status: 'dead', type: 'knowledge.index' })).toMatchObject({
      action: 'retry-knowledge-index',
    })
    expect(getJobCompensation({ status: 'processing', type: 'knowledge.index' })).toBeNull()
    expect(getJobCompensation({ status: 'dead', type: 'publish.external' })).toBeNull()

    // Publication recovery compensation
    expect(
      getJobCompensation({
        idempotencyKey: 'publication-recovery:42:0',
        status: 'dead',
        type: 'platform.publication.execute',
      }),
    ).toMatchObject({
      action: 'retry-publication-recovery',
    })
    expect(
      getJobCompensation({
        idempotencyKey: 'publication-recovery:42:0',
        status: 'failed',
        type: 'platform.publication.execute',
      }),
    ).toMatchObject({
      action: 'retry-publication-recovery',
    })
    // Normal execution job is rejected
    expect(
      getJobCompensation({
        idempotencyKey: 'publication-execute:42:0',
        status: 'dead',
        type: 'platform.publication.execute',
      }),
    ).toBeNull()
    // Non-terminal publication recovery is rejected
    expect(
      getJobCompensation({
        idempotencyKey: 'publication-recovery:42:0',
        status: 'processing',
        type: 'platform.publication.execute',
      }),
    ).toBeNull()
  })

  it('parses publication recovery idempotency keys strictly', () => {
    expect(parsePublicationRecoveryIdempotencyKey('publication-recovery:42:0')).toEqual({
      publishJobId: 42,
      revision: 0,
    })
    expect(parsePublicationRecoveryIdempotencyKey('publication-recovery:101:3')).toEqual({
      publishJobId: 101,
      revision: 3,
    })
    expect(parsePublicationRecoveryIdempotencyKey('publication-execute:42:0')).toBeNull()
    expect(parsePublicationRecoveryIdempotencyKey('publication-recovery:0:0')).toBeNull()
    expect(parsePublicationRecoveryIdempotencyKey('publication-recovery:42:-1')).toBeNull()
    expect(parsePublicationRecoveryIdempotencyKey('publication-recovery:abc:0')).toBeNull()
    expect(parsePublicationRecoveryIdempotencyKey(null)).toBeNull()
  })

  it('maps jobs to a DTO without payload, lease token, or raw error details', () => {
    const summary = toSafeJobSummary(job())
    const serialized = JSON.stringify(summary)

    expect(summary.lastErrorSummary).toContain('Failure recorded')
    expect(serialized).not.toContain('never-return-this')
    expect(serialized).not.toContain('ownerToken')
    expect(serialized).not.toContain('payload')

    const recoverySummary = toSafeJobSummary(
      job({
        id: 99,
        idempotencyKey: 'publication-recovery:42:1',
        type: 'platform.publication.execute',
      }),
    )
    expect(recoverySummary.reference).toBe('Publication recovery job #99')
    expect(recoverySummary.compensation).toEqual({
      action: 'retry-publication-recovery',
      label: 'Retry publication recovery',
    })
  })

  it('bounds operations query parameters', () => {
    expect(parseSafeJobQuery({ page: '3', status: 'dead' })).toEqual({ page: 3, status: 'dead' })
    expect(parseSafeJobQuery({ page: '-1', status: 'outside' })).toEqual({ page: 1, status: 'all' })
  })

  it('executes only the registered knowledge compensation with the authenticated admin', async () => {
    const retry = vi.fn().mockResolvedValue({
      job: { id: 29, status: 'pending' },
      state: 'created',
    })
    const req = { user: { id: 3, role: 'admin' } } as unknown as PayloadRequest
    const user = { collection: 'users', id: 3, role: 'admin' } as User
    const payload = {
      findByID: vi.fn().mockResolvedValue(
        job({
          payload: {
            documentId: 44,
            documentRevision: 'revision-44',
            embeddingConfigurationKey: 'embedding-config-44',
            requestedBy: 3,
          },
        }),
      ),
    } as unknown as Payload

    await expect(
      retryPortalJob({
        enqueueKnowledgeIndex: retry,
        id: 17,
        input: { updatedAt: '2026-07-30T00:00:00.000Z' },
        payload,
        req,
        user,
      }),
    ).resolves.toEqual({ action: 'retry-knowledge-index', jobId: 29, status: 'pending' })
    expect(retry).toHaveBeenCalledWith(
      expect.objectContaining({
        documentId: 44,
        manualRetryActor: { id: 3, role: 'admin' },
        payload,
        requestedBy: 3,
      }),
    )
  })

  it('resets the same publication recovery job without creating a second job or replaying provider I/O', async () => {
    const req = { user: { id: 3, role: 'admin' } } as unknown as PayloadRequest
    const user = { collection: 'users', id: 3, role: 'admin' } as User
    const recoveryJob = job({
      id: 88,
      idempotencyKey: 'publication-recovery:42:0',
      payload: { expectedExecutionRevision: 0, publishJobId: 42 },
      status: 'dead',
      type: 'platform.publication.execute',
    })
    const publishJobDoc = {
      executionRevision: 0,
      id: 42,
      providerIOStartedAt: '2026-08-22T10:00:00.000Z',
      status: 'scheduled',
    }

    const payload = {
      findByID: vi
        .fn()
        .mockImplementation(async ({ collection, id }: { collection: string; id: number }) => {
          if (collection === 'jobs' && id === 88) return recoveryJob
          if (collection === 'publish-jobs' && id === 42) return publishJobDoc
          return null
        }),
    } as unknown as Payload

    const retryManually = vi.fn().mockResolvedValue({
      attempts: 0,
      id: 88,
      status: 'pending',
    })
    const queue = { retryManually }

    await expect(
      retryPortalJob({
        id: 88,
        input: { updatedAt: '2026-07-30T00:00:00.000Z' },
        payload,
        queue,
        req,
        user,
      }),
    ).resolves.toEqual({
      action: 'retry-publication-recovery',
      jobId: 88,
      status: 'pending',
    })

    expect(retryManually).toHaveBeenCalledTimes(1)
    expect(retryManually).toHaveBeenCalledWith(88, { id: 3, role: 'admin' }, req)
  })

  it('rejects publication recovery retry on invalid or mismatched conditions', async () => {
    const req = { user: { id: 3, role: 'admin' } } as unknown as PayloadRequest
    const user = { collection: 'users', id: 3, role: 'admin' } as User
    const queue = { retryManually: vi.fn() }

    // 1. Normal publication execute job has no registered compensation
    const executeJob = job({
      id: 77,
      idempotencyKey: 'publication-execute:42:0',
      payload: { expectedExecutionRevision: 0, publishJobId: 42 },
      status: 'dead',
      type: 'platform.publication.execute',
    })
    const payloadExecute = {
      findByID: vi.fn().mockResolvedValue(executeJob),
    } as unknown as Payload
    await expect(
      retryPortalJob({
        id: 77,
        input: { updatedAt: '2026-07-30T00:00:00.000Z' },
        payload: payloadExecute,
        queue,
        req,
        user,
      }),
    ).rejects.toThrow(OperationsCommandError)

    // 2. Mismatched payload revision
    const payloadMismatchJob = job({
      id: 89,
      idempotencyKey: 'publication-recovery:42:0',
      payload: { expectedExecutionRevision: 1, publishJobId: 42 },
      status: 'dead',
      type: 'platform.publication.execute',
    })
    const payloadMismatch = {
      findByID: vi.fn().mockResolvedValue(payloadMismatchJob),
    } as unknown as Payload
    await expect(
      retryPortalJob({
        id: 89,
        input: { updatedAt: '2026-07-30T00:00:00.000Z' },
        payload: payloadMismatch,
        queue,
        req,
        user,
      }),
    ).rejects.toThrow('The publication recovery payload does not match its idempotency key')

    // 3. Missing providerIOStartedAt marker on PublishJob
    const recoveryJob = job({
      id: 90,
      idempotencyKey: 'publication-recovery:42:0',
      payload: { expectedExecutionRevision: 0, publishJobId: 42 },
      status: 'dead',
      type: 'platform.publication.execute',
    })
    const publishJobNoMarker = {
      executionRevision: 0,
      id: 42,
      providerIOStartedAt: null,
      status: 'scheduled',
    }
    const payloadNoMarker = {
      findByID: vi.fn().mockImplementation(async ({ collection }: { collection: string }) => {
        if (collection === 'jobs') return recoveryJob
        if (collection === 'publish-jobs') return publishJobNoMarker
        return null
      }),
    } as unknown as Payload
    await expect(
      retryPortalJob({
        id: 90,
        input: { updatedAt: '2026-07-30T00:00:00.000Z' },
        payload: payloadNoMarker,
        queue,
        req,
        user,
      }),
    ).rejects.toThrow('The publication job state does not match the recovery requirement')
  })
})
