import { describe, expect, it, vi } from 'vitest'

import {
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

  it('creates an independent recovery job scoped to the failed source claim', async () => {
    const enqueue = vi.fn().mockResolvedValue({ job: { id: 10 }, state: 'created' })
    const nextRunAt = new Date('2026-08-22T10:00:00.001Z')
    await expect(
      enqueuePublicationRecovery({
        nextRunAt,
        publishJobId: 42,
        queue: { enqueue },
        revision: 7,
        sourceQueueJobId: 9,
      }),
    ).resolves.toMatchObject({ state: 'created' })
    expect(enqueue).toHaveBeenCalledWith({
      idempotencyKey: 'publication-recovery:42:7:after:9',
      maxAttempts: 2,
      nextRunAt,
      payload: { expectedExecutionRevision: 7, publishJobId: 42 },
      type: PLATFORM_PUBLICATION_JOB_TYPE,
    })
  })
})
