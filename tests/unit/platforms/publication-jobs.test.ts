import { describe, expect, it, vi } from 'vitest'

import type { JobRecord } from '@/modules/jobs/contracts'
import {
  classifyPublicationQueueObligation,
  enqueuePublicationExecution,
  enqueuePublicationRecovery,
  enqueuePublicationStatusSuccessor,
  isPublicationStatusRecoveryKey,
  isRunnableSuccessor,
  parsePlatformPublicationJobPayload,
  PLATFORM_PUBLICATION_JOB_TYPE,
} from '@/modules/platforms/publicationJobs'

const makeJob = (overrides: Partial<JobRecord> = {}): JobRecord => ({
  attempts: 0,
  completedAt: null,
  createdAt: '2026-08-22T10:00:00.000Z',
  deadAt: null,
  id: 101,
  idempotencyKey: 'test-key',
  lastError: null,
  leaseExpiresAt: null,
  manualRetryCount: 0,
  maxAttempts: 2,
  nextRunAt: '2026-08-22T10:00:00.000Z',
  ownerToken: null,
  payload: {},
  status: 'pending',
  type: PLATFORM_PUBLICATION_JOB_TYPE,
  updatedAt: '2026-08-22T10:00:00.000Z',
  ...overrides,
})

describe('publication queue jobs', () => {
  it('recognizes the bounded status recovery identity', () => {
    expect(isPublicationStatusRecoveryKey('publication-status:42:1', 42, 1)).toBe(true)
    expect(isPublicationStatusRecoveryKey('publication-status:42:2', 42, 1)).toBe(false)
    expect(isPublicationStatusRecoveryKey('publication-execute:42:1', 42, 1)).toBe(false)
  })
  it('parses the queue revision separately from the PublishJob identity', () => {
    expect(
      parsePlatformPublicationJobPayload({ expectedExecutionRevision: 7, publishJobId: 42 }),
    ).toEqual({ expectedExecutionRevision: 7, publishJobId: 42 })
    expect(() =>
      parsePlatformPublicationJobPayload({ expectedExecutionRevision: -1, publishJobId: 42 }),
    ).toThrow('expectedExecutionRevision')
    expect(() =>
      parsePlatformPublicationJobPayload({ expectedExecutionRevision: 0, publishJobId: 0 }),
    ).toThrow('publishJobId')
  })

  it('creates one revision-scoped queue job with only one proven-pre-IO retry', async () => {
    const enqueue = vi.fn().mockResolvedValue({ job: { id: 9 }, state: 'created' })
    await expect(
      enqueuePublicationExecution({ publishJobId: 42, queue: { enqueue }, revision: 7 }),
    ).resolves.toMatchObject({ state: 'created' })
    expect(enqueue).toHaveBeenCalledWith(
      {
        idempotencyKey: 'publication-execute:42:7',
        maxAttempts: 2,
        payload: { expectedExecutionRevision: 7, publishJobId: 42 },
        type: PLATFORM_PUBLICATION_JOB_TYPE,
      },
      undefined,
    )
  })

  it('creates one recovery job scoped to the logical publication revision', async () => {
    const enqueue = vi.fn().mockResolvedValue({ job: { id: 10 }, state: 'created' })
    const nextRunAt = new Date('2026-08-22T10:00:00.001Z')
    await expect(
      enqueuePublicationRecovery({
        nextRunAt,
        publishJobId: 42,
        queue: { enqueue },
        revision: 7,
      }),
    ).resolves.toMatchObject({ state: 'created' })
    expect(enqueue).toHaveBeenCalledWith({
      idempotencyKey: 'publication-recovery:42:7',
      maxAttempts: 2,
      nextRunAt,
      payload: { expectedExecutionRevision: 7, publishJobId: 42 },
      type: PLATFORM_PUBLICATION_JOB_TYPE,
    })
  })

  it('creates one status successor job scoped to the logical publication revision', async () => {
    const enqueue = vi.fn().mockResolvedValue({ job: { id: 11 }, state: 'created' })
    const nextRunAt = new Date('2026-08-22T10:02:00.001Z')
    await expect(
      enqueuePublicationStatusSuccessor({
        nextRunAt,
        publishJobId: 42,
        queue: { enqueue },
        revision: 7,
      }),
    ).resolves.toMatchObject({ state: 'created' })
    expect(enqueue).toHaveBeenCalledWith({
      idempotencyKey: 'publication-status:42:7',
      maxAttempts: 2,
      nextRunAt,
      payload: { expectedExecutionRevision: 7, publishJobId: 42 },
      type: PLATFORM_PUBLICATION_JOB_TYPE,
    })
  })

  it.each([
    [
      'a direct accepted checkpoint',
      {
        executionRevision: 1,
        executionRoute: 'facebook-photo-single' as const,
        providerIOStartedAt: null,
        status: 'accepted' as const,
      },
      0,
      'continuation',
    ],
    [
      'a direct publishing checkpoint',
      {
        executionRevision: 1,
        executionRoute: 'linkedin-text-single' as const,
        providerIOStartedAt: null,
        status: 'publishing' as const,
      },
      0,
      'continuation',
    ],
    [
      'an Instagram staged checkpoint',
      {
        executionRevision: 2,
        executionRoute: 'instagram-image-staged' as const,
        providerIOStartedAt: null,
        status: 'publishing' as const,
      },
      1,
      'continuation',
    ],
    [
      'a LinkedIn staged checkpoint',
      {
        executionRevision: 3,
        executionRoute: 'linkedin-image-staged' as const,
        providerIOStartedAt: null,
        status: 'publishing' as const,
      },
      2,
      'continuation',
    ],
    [
      'an unresolved provider marker',
      {
        executionRevision: 0,
        executionRoute: 'facebook-photo-single' as const,
        providerIOStartedAt: '2026-08-22T10:00:00.000Z',
        status: 'scheduled' as const,
      },
      0,
      'recovery',
    ],
    [
      'a terminal publication',
      {
        executionRevision: 1,
        executionRoute: 'facebook-photo-single' as const,
        providerIOStartedAt: null,
        status: 'delivery_unknown' as const,
      },
      0,
      'complete',
    ],
    [
      'the current non-terminal attempt itself with released claim',
      {
        claimId: null,
        claimLeaseExpiresAt: null,
        executionRevision: 1,
        executionRoute: 'facebook-photo-single' as const,
        providerIOStartedAt: null,
        status: 'accepted' as const,
      },
      1,
      'status-successor',
    ],
    [
      'the current non-terminal attempt with retained active claim',
      {
        claimId: 'claim-active',
        claimLeaseExpiresAt: '2026-08-22T10:02:00.000Z',
        executionRevision: 1,
        executionRoute: 'facebook-photo-single' as const,
        providerIOStartedAt: null,
        status: 'accepted' as const,
      },
      1,
      'status-successor',
    ],
    [
      'the current non-terminal attempt with expired claim',
      {
        claimId: 'claim-expired',
        claimLeaseExpiresAt: '2026-08-22T09:59:00.000Z',
        executionRevision: 1,
        executionRoute: 'facebook-photo-single' as const,
        providerIOStartedAt: null,
        status: 'accepted' as const,
      },
      1,
      'status-successor',
    ],
  ] as const)('classifies %s without a success-path bypass', (_name, job, revision, expected) => {
    const now = new Date('2026-08-22T10:00:00.000Z')
    expect(classifyPublicationQueueObligation(job, revision, now)).toBe(expected)
  })

  describe('isRunnableSuccessor predicate', () => {
    const now = new Date('2026-08-22T10:00:00.000Z')

    it('accepts pending and failed jobs with remaining attempts', () => {
      expect(
        isRunnableSuccessor(makeJob({ attempts: 0, maxAttempts: 2, status: 'pending' }), now),
      ).toBe(true)
      expect(
        isRunnableSuccessor(makeJob({ attempts: 1, maxAttempts: 2, status: 'failed' }), now),
      ).toBe(true)
    })

    it('rejects pending and failed jobs with exhausted attempts', () => {
      expect(
        isRunnableSuccessor(makeJob({ attempts: 2, maxAttempts: 2, status: 'pending' }), now),
      ).toBe(false)
      expect(
        isRunnableSuccessor(makeJob({ attempts: 2, maxAttempts: 2, status: 'failed' }), now),
      ).toBe(false)
    })

    it('rejects dead and succeeded jobs', () => {
      expect(isRunnableSuccessor(makeJob({ status: 'dead' }), now)).toBe(false)
      expect(isRunnableSuccessor(makeJob({ status: 'succeeded' }), now)).toBe(false)
    })

    it('accepts processing job with remaining attempts and valid lease', () => {
      expect(
        isRunnableSuccessor(
          makeJob({
            attempts: 1,
            leaseExpiresAt: '2026-08-22T10:02:00.000Z',
            maxAttempts: 2,
            ownerToken: 'worker-1',
            status: 'processing',
          }),
          now,
        ),
      ).toBe(true)
    })

    it('accepts processing job on final attempt when lease is unexpired', () => {
      expect(
        isRunnableSuccessor(
          makeJob({
            attempts: 2,
            leaseExpiresAt: '2026-08-22T10:02:00.000Z',
            maxAttempts: 2,
            ownerToken: 'worker-1',
            status: 'processing',
          }),
          now,
        ),
      ).toBe(true)
    })

    it('rejects processing job on final attempt when lease is expired (matches claimNext dead transition)', () => {
      expect(
        isRunnableSuccessor(
          makeJob({
            attempts: 2,
            leaseExpiresAt: '2026-08-22T09:59:00.000Z',
            maxAttempts: 2,
            ownerToken: 'worker-1',
            status: 'processing',
          }),
          now,
        ),
      ).toBe(false)
    })

    it('rejects processing job without owner token or lease', () => {
      expect(
        isRunnableSuccessor(
          makeJob({
            attempts: 1,
            leaseExpiresAt: null,
            maxAttempts: 2,
            ownerToken: null,
            status: 'processing',
          }),
          now,
        ),
      ).toBe(false)
    })
  })
})
