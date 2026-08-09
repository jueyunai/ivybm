// @vitest-environment node

import { describe, expect, it, vi } from 'vitest'
import type { Payload, PayloadRequest } from 'payload'

import { PayloadJobQueue } from '@/modules/jobs/claim'

const jobRow = {
  attempts: 0,
  completed_at: null,
  created_at: '2026-08-09T00:00:00.000Z',
  dead_at: null,
  id: 42,
  idempotency_key: 'transactional-enqueue-test',
  last_error: null,
  lease_expires_at: null,
  manual_retry_count: 0,
  max_attempts: 5,
  next_run_at: '2026-08-09T00:00:00.000Z',
  owner_token: null,
  payload: { sourceId: 7 },
  status: 'pending' as const,
  type: 'knowledge.ingest',
  updated_at: '2026-08-09T00:00:00.000Z',
}

describe('PayloadJobQueue transactional enqueue', () => {
  it('writes through the active Payload session and remains invisible to the pool until commit', async () => {
    let committed = false
    const transactionExecute = vi.fn(async () => ({ rows: [jobRow] }))
    const poolQuery = vi.fn(async () => ({ rows: committed ? [jobRow] : [] }))
    const payload = {
      db: {
        pool: { query: poolQuery },
        sessions: { ingest: { db: { execute: transactionExecute } } },
      },
    } as unknown as Payload
    const req = {
      transactionID: Promise.resolve('ingest'),
    } as unknown as PayloadRequest
    const queue = new PayloadJobQueue({
      clock: () => new Date('2026-08-09T00:00:00.000Z'),
      payload,
    })

    await expect(queue.enqueue({
      idempotencyKey: jobRow.idempotency_key,
      payload: { sourceId: 7 },
      type: jobRow.type,
    }, req)).resolves.toMatchObject({
      job: { id: jobRow.id, idempotencyKey: jobRow.idempotency_key, status: 'pending' },
      state: 'created',
    })

    expect(transactionExecute).toHaveBeenCalledTimes(1)
    expect(poolQuery).not.toHaveBeenCalled()
    expect((await poolQuery()).rows).toHaveLength(0)

    // The caller owns the Payload transaction boundary. Once it commits, a
    // worker using the pool can observe the queued job.
    committed = true
    expect((await poolQuery()).rows).toHaveLength(1)
  })
})
