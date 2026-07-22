import { randomUUID } from 'node:crypto'

import type { PostgresAdapter } from '@payloadcms/db-postgres'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { getPayload, type Payload } from 'payload'

import type { User } from '@/payload-types'
import config from '@/payload.config'
import { PayloadJobQueue } from '@/modules/jobs/claim'
import { JobQueueError } from '@/modules/jobs/contracts'
import { JobWorker } from '@/modules/jobs/worker'

let payload: Payload
let admin: User
const jobIDs: number[] = []

const database = (): PostgresAdapter => payload.db as unknown as PostgresAdapter

const trackJob = <T extends { id: number }>(job: T): T => {
  jobIDs.push(job.id)
  return job
}

describe.sequential('Task 10 durable job worker', () => {
  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required')

    payload = await getPayload({ config, disableOnInit: true, key: 'task10-jobs-integration' })
    admin = await payload.create({
      collection: 'users',
      context: { skipAudit: true },
      data: {
        email: `task10-admin-${randomUUID()}@example.invalid`,
        password: 'task10-admin-integration-password',
        role: 'admin',
      },
      overrideAccess: true,
    })
  })

  afterEach(async () => {
    if (jobIDs.length === 0) return

    const ids = [...jobIDs]
    await database().pool.query(
      `DELETE FROM audit_logs
       WHERE resource = 'jobs' AND document_id = ANY($1::text[])`,
      [ids.map(String)],
    )
    await database().pool.query('DELETE FROM jobs WHERE id = ANY($1::int[])', [ids])
    jobIDs.length = 0
  })

  afterAll(async () => {
    if (!payload) return

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
  })

  it('deduplicates enqueue and atomically gives one concurrent worker the claim', async () => {
    const now = new Date('2026-07-20T00:00:00.000Z')
    const queueA = new PayloadJobQueue({ clock: () => now, payload })
    const queueB = new PayloadJobQueue({ clock: () => now, payload })
    const key = `task10-concurrent-${randomUUID()}`

    const created = trackJob(
      (
        await queueA.enqueue({
          idempotencyKey: key,
          payload: { reference: 'handoff-event-1' },
          type: 'handoff.notify',
        })
      ).job,
    )
    const duplicate = await queueB.enqueue({
      idempotencyKey: key,
      payload: { reference: 'handoff-event-1' },
      type: 'handoff.notify',
    })

    expect(duplicate).toMatchObject({ job: { id: created.id }, state: 'duplicate' })

    const claims = (await Promise.all([queueA.claimNext(), queueB.claimNext()])).filter(
      (claim): claim is NonNullable<typeof claim> => claim !== null,
    )
    expect(claims).toHaveLength(1)
    expect(claims[0]).toMatchObject({ attempts: 1, id: created.id, status: 'processing' })

    await queueA.complete(claims[0])
    await expect(queueB.claimNext()).resolves.toBeNull()
    await expect(queueA.getByID(created.id)).resolves.toMatchObject({
      attempts: 1,
      status: 'succeeded',
    })
  })

  it('reclaims an expired lease and fences the prior owner from completing the job', async () => {
    let now = new Date('2026-07-20T00:00:00.000Z')
    const queueA = new PayloadJobQueue({ clock: () => now, leaseMs: 1_000, payload })
    const queueB = new PayloadJobQueue({ clock: () => now, leaseMs: 1_000, payload })
    const job = trackJob(
      (
        await queueA.enqueue({
          idempotencyKey: `task10-lease-${randomUUID()}`,
          payload: { reference: 'handoff-event-2' },
          type: 'handoff.notify',
        })
      ).job,
    )

    const first = await queueA.claimNext()
    if (!first) throw new Error('Expected the first worker to claim the job')

    now = new Date(now.getTime() + 1_001)
    const second = await queueB.claimNext()
    if (!second) throw new Error('Expected the second worker to reclaim the expired lease')

    expect(second).toMatchObject({ attempts: 2, id: job.id, status: 'processing' })
    expect(second.ownerToken).not.toBe(first.ownerToken)
    await expect(queueA.complete(first)).rejects.toMatchObject({
      code: 'conflict',
    } satisfies Partial<JobQueueError>)
    await expect(queueB.complete(second)).resolves.toMatchObject({ status: 'succeeded' })
  })

  it('stops a slow worker after another worker reclaims its expired lease', async () => {
    let now = new Date('2026-07-20T01:00:00.000Z')
    const queueA = new PayloadJobQueue({ clock: () => now, leaseMs: 1_000, payload })
    const queueB = new PayloadJobQueue({ clock: () => now, leaseMs: 1_000, payload })
    const job = trackJob(
      (
        await queueA.enqueue({
          idempotencyKey: `task10-worker-fence-${randomUUID()}`,
          payload: { reference: 'slow-handler' },
          type: 'handoff.notify',
        })
      ).job,
    )
    let releaseStarted: (() => void) | undefined
    const started = new Promise<void>((resolve) => {
      releaseStarted = resolve
    })
    const workerA = new JobWorker({
      handlers: {
        'handoff.notify': async (_claimed, execution) => {
          releaseStarted?.()
          await new Promise<void>((resolve) => {
            execution.signal.addEventListener('abort', () => resolve(), { once: true })
          })
          execution.assertLease()
        },
      },
      heartbeatIntervalMs: 10,
      queue: queueA,
    })

    const firstOutcome = workerA.runOnce()
    await started
    now = new Date(now.getTime() + 1_001)
    const reclaimed = await queueB.claimNext()
    if (!reclaimed) throw new Error('Expected the second worker to reclaim the slow job')

    await expect(firstOutcome).resolves.toBe('failed')
    expect(reclaimed).toMatchObject({ attempts: 2, id: job.id, status: 'processing' })
    await expect(queueB.complete(reclaimed)).resolves.toMatchObject({ status: 'succeeded' })
  })

  it('backs off failures, sends the final failed attempt to dead, and audits an admin retry', async () => {
    let now = new Date('2026-07-20T00:00:00.000Z')
    const queue = new PayloadJobQueue({ clock: () => now, payload })
    const handler = vi.fn(async () => {
      throw new Error('simulated downstream delivery failure')
    })
    const worker = new JobWorker({
      handlers: { 'handoff.notify': handler },
      queue,
    })
    const job = trackJob(
      (
        await queue.enqueue({
          idempotencyKey: `task10-dead-${randomUUID()}`,
          maxAttempts: 2,
          payload: { reference: 'handoff-event-3' },
          type: 'handoff.notify',
        })
      ).job,
    )

    await expect(worker.runOnce()).resolves.toBe('failed')
    const firstFailure = await queue.getByID(job.id)
    expect(firstFailure).toMatchObject({
      attempts: 1,
      status: 'failed',
    })
    expect(firstFailure?.nextRunAt).toBe('2026-07-20T00:00:01.000Z')

    now = new Date('2026-07-20T00:00:01.000Z')
    await expect(worker.runOnce()).resolves.toBe('failed')
    await expect(queue.getByID(job.id)).resolves.toMatchObject({
      attempts: 2,
      deadAt: '2026-07-20T00:00:01.000Z',
      status: 'dead',
    })
    expect(handler).toHaveBeenCalledTimes(2)

    await expect(
      queue.retryManually(job.id, { id: admin.id, role: 'operator' }),
    ).rejects.toMatchObject({
      code: 'forbidden',
    } satisfies Partial<JobQueueError>)
    await expect(
      queue.retryManually(job.id, { id: admin.id, role: 'admin' }),
    ).resolves.toMatchObject({
      attempts: 0,
      manualRetryCount: 1,
      status: 'pending',
    })

    const audit = await payload.find({
      collection: 'audit-logs',
      depth: 0,
      limit: 1,
      overrideAccess: true,
      where: {
        and: [
          { action: { equals: 'update' } },
          { documentId: { equals: String(job.id) } },
          { resource: { equals: 'jobs' } },
        ],
      },
    })
    expect(audit.docs[0]).toMatchObject({ action: 'update', actor: admin.id, resource: 'jobs' })
  })
})
