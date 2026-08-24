import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ClaimedJob, JobQueue, JobRecord } from '@/modules/jobs/contracts'
import { JobQueueError, JobRetryNotBeforeError } from '@/modules/jobs/contracts'
import { JobWorker } from '@/modules/jobs/worker'

const claimedJob = (): ClaimedJob => ({
  attempts: 1,
  completedAt: null,
  createdAt: '2026-07-21T00:00:00.000Z',
  deadAt: null,
  id: 1,
  idempotencyKey: 'worker-test',
  lastError: null,
  leaseExpiresAt: '2026-07-21T00:02:00.000Z',
  manualRetryCount: 0,
  maxAttempts: 5,
  nextRunAt: '2026-07-21T00:00:00.000Z',
  ownerToken: 'owner-a',
  payload: {},
  status: 'processing',
  type: 'test.job',
  updatedAt: '2026-07-21T00:00:00.000Z',
})

const queueFor = (job: ClaimedJob): JobQueue => ({
  claimNext: vi.fn().mockResolvedValue(job),
  complete: vi
    .fn()
    .mockResolvedValue({ ...job, ownerToken: null, status: 'succeeded' } as JobRecord),
  fail: vi.fn().mockResolvedValue({ ...job, ownerToken: null, status: 'failed' } as JobRecord),
  renew: vi.fn().mockResolvedValue(job),
})

afterEach(() => {
  vi.useRealTimers()
})

describe('JobWorker lease heartbeat', () => {
  it('renews by elapsed time while a slow handler is still running', async () => {
    vi.useFakeTimers()
    const job = claimedJob()
    const queue = queueFor(job)
    const worker = new JobWorker({
      handlers: {
        'test.job': async () => {
          await new Promise<void>((resolve) => setTimeout(resolve, 35))
        },
      },
      heartbeatIntervalMs: 10,
      queue,
    })

    const outcome = worker.runOnce()
    await vi.advanceTimersByTimeAsync(35)

    await expect(outcome).resolves.toBe('succeeded')
    expect(queue.renew).toHaveBeenCalledTimes(3)
    expect(queue.complete).toHaveBeenCalledTimes(1)
    expect(queue.claimNext).toHaveBeenCalledWith(['test.job'])
  })

  it('asks the queue to claim only registered handler types', async () => {
    const job = claimedJob()
    const queue = queueFor(job)
    const worker = new JobWorker({
      handlers: { 'test.job': async () => undefined, 'another.job': async () => undefined },
      queue,
    })

    await expect(worker.runOnce()).resolves.toBe('succeeded')
    expect(queue.claimNext).toHaveBeenCalledWith(['test.job', 'another.job'])
  })

  it('aborts and fences a handler after heartbeat renewal loses the lease', async () => {
    vi.useFakeTimers()
    const job = claimedJob()
    const queue = queueFor(job)
    vi.mocked(queue.renew).mockRejectedValue(new JobQueueError('conflict', 'lease was reclaimed'))
    const observedAbort = vi.fn()
    const worker = new JobWorker({
      handlers: {
        'test.job': async (_job, execution) => {
          await new Promise<void>((resolve) => {
            execution.signal.addEventListener(
              'abort',
              () => {
                observedAbort(execution.signal.reason)
                resolve()
              },
              { once: true },
            )
          })
          execution.assertLease()
        },
      },
      heartbeatIntervalMs: 10,
      queue,
    })

    const outcome = worker.runOnce()
    await vi.advanceTimersByTimeAsync(10)

    await expect(outcome).resolves.toBe('failed')
    expect(observedAbort).toHaveBeenCalledTimes(1)
    expect(queue.complete).not.toHaveBeenCalled()
    expect(queue.fail).not.toHaveBeenCalled()
  })

  it('treats a completion conflict as a fenced outcome without failing the new owner', async () => {
    const job = claimedJob()
    const queue = queueFor(job)
    vi.mocked(queue.complete).mockRejectedValue(
      new JobQueueError('conflict', 'lease was reclaimed before completion'),
    )
    const worker = new JobWorker({
      handlers: { 'test.job': async () => undefined },
      heartbeatIntervalMs: 60_000,
      queue,
    })

    await expect(worker.runOnce()).resolves.toBe('failed')
    expect(queue.fail).not.toHaveBeenCalled()
  })

  it('treats an unknown-handler failure conflict as a fenced outcome', async () => {
    const job = { ...claimedJob(), type: 'unknown.job' }
    const queue = queueFor(job)
    vi.mocked(queue.fail).mockRejectedValue(
      new JobQueueError('conflict', 'lease was reclaimed before unknown handler failure'),
    )
    const worker = new JobWorker({
      handlers: {},
      heartbeatIntervalMs: 60_000,
      queue,
    })

    await expect(worker.runOnce()).resolves.toBe('failed')
    expect(queue.fail).toHaveBeenCalledTimes(1)
  })

  it('passes a lease-aware retry boundary from the handler to the queue', async () => {
    const job = claimedJob()
    const queue = queueFor(job)
    const retryNotBefore = new Date('2026-07-21T00:05:00.001Z')
    const error = new JobRetryNotBeforeError('Wait for the retained claim lease', retryNotBefore)
    const worker = new JobWorker({
      handlers: {
        'test.job': async () => {
          throw error
        },
      },
      queue,
    })

    await expect(worker.runOnce()).resolves.toBe('failed')
    expect(queue.fail).toHaveBeenCalledWith({ error, job, retryNotBefore })
  })
})
