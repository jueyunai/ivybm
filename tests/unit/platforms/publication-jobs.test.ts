import { describe, expect, it, vi } from 'vitest'

import {
  classifyPublicationQueueObligation,
  enqueuePublicationExecution,
  enqueuePublicationRecovery,
  parsePlatformPublicationJobPayload,
  PLATFORM_PUBLICATION_JOB_TYPE,
} from '@/modules/platforms/publicationJobs'

describe('publication queue jobs', () => {
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

  it.each([
    [
      'a direct accepted checkpoint',
      {
        executionRevision: 1,
        executionRoute: 'facebook-photo-single',
        providerIOStartedAt: null,
        status: 'accepted',
      },
      0,
      'continuation',
    ],
    [
      'a direct publishing checkpoint',
      {
        executionRevision: 1,
        executionRoute: 'linkedin-text-single',
        providerIOStartedAt: null,
        status: 'publishing',
      },
      0,
      'continuation',
    ],
    [
      'an Instagram staged checkpoint',
      {
        executionRevision: 2,
        executionRoute: 'instagram-image-staged',
        providerIOStartedAt: null,
        status: 'publishing',
      },
      1,
      'continuation',
    ],
    [
      'a LinkedIn staged checkpoint',
      {
        executionRevision: 3,
        executionRoute: 'linkedin-image-staged',
        providerIOStartedAt: null,
        status: 'publishing',
      },
      2,
      'continuation',
    ],
    [
      'an unresolved provider marker',
      {
        executionRevision: 0,
        executionRoute: 'facebook-photo-single',
        providerIOStartedAt: '2026-08-22T10:00:00.000Z',
        status: 'scheduled',
      },
      0,
      'recovery',
    ],
    [
      'a terminal publication',
      {
        executionRevision: 1,
        executionRoute: 'facebook-photo-single',
        providerIOStartedAt: null,
        status: 'delivery_unknown',
      },
      0,
      'complete',
    ],
    [
      'the current non-terminal attempt itself',
      {
        executionRevision: 1,
        executionRoute: 'facebook-photo-single',
        providerIOStartedAt: null,
        status: 'accepted',
      },
      1,
      'unresolved',
    ],
  ] as const)('classifies %s without a success-path bypass', (_name, job, revision, expected) => {
    expect(classifyPublicationQueueObligation(job, revision)).toBe(expected)
  })
})
