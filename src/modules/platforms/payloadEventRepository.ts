import type { PostgresAdapter } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'

import { PLATFORM_EVENT_JOB_TYPE } from './eventJobs'
import type {
  EnqueuePlatformEventResult,
  PersistedPlatformEvent,
  PlatformEventRepository,
} from './ports'
import { platformEventKey } from './types'

const PLATFORM_EVENT_JOB_MAX_ATTEMPTS = 5

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined

const assertPersistedEvent = (persisted: PersistedPlatformEvent): void => {
  const expectedKey = platformEventKey(
    persisted.event.platform,
    persisted.event.externalEventId,
  )
  if (persisted.event.idempotencyKey !== expectedKey) {
    throw new Error('Platform event idempotency key is invalid')
  }
  if (!/^[a-f0-9]{64}$/i.test(persisted.eventDigest) || !/^[a-f0-9]{64}$/i.test(persisted.rawPayloadDigest)) {
    throw new Error('Platform event digests are invalid')
  }
}

export class PayloadPlatformEventRepository implements PlatformEventRepository {
  private readonly clock: () => Date
  private readonly payload: Payload

  constructor({ clock = () => new Date(), payload }: { clock?: () => Date; payload: Payload }) {
    this.clock = clock
    this.payload = payload
  }

  async enqueueBatch(events: PersistedPlatformEvent[]): Promise<EnqueuePlatformEventResult[]> {
    if (events.length === 0) return []
    events.forEach(assertPersistedEvent)

    const pool = (this.payload.db as unknown as PostgresAdapter).pool
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const results: EnqueuePlatformEventResult[] = []
      const now = this.clock().toISOString()

      for (const persisted of events) {
        const idempotencyKey = persisted.event.idempotencyKey
        const inserted = await client.query<{ id: number }>(
          `INSERT INTO jobs (
            type, idempotency_key, payload, status, attempts, max_attempts, next_run_at,
            manual_retry_count, updated_at, created_at
          ) VALUES ($1, $2, $3::jsonb, 'pending', 0, $4, $5, 0, $5, $5)
          ON CONFLICT (type, idempotency_key) DO NOTHING
          RETURNING id`,
          [
            PLATFORM_EVENT_JOB_TYPE,
            idempotencyKey,
            JSON.stringify({
              event: persisted.event,
              eventDigest: persisted.eventDigest,
              rawPayloadDigest: persisted.rawPayloadDigest,
            }),
            PLATFORM_EVENT_JOB_MAX_ATTEMPTS,
            now,
          ],
        )
        if (inserted.rows[0]) {
          results.push({ idempotencyKey, status: 'accepted' })
          continue
        }

        const existing = await client.query<{ payload: unknown }>(
          `SELECT payload FROM jobs
           WHERE type = $1 AND idempotency_key = $2
           FOR UPDATE`,
          [PLATFORM_EVENT_JOB_TYPE, idempotencyKey],
        )
        const knownDigest = asRecord(existing.rows[0]?.payload)?.eventDigest
        if (typeof knownDigest !== 'string' || knownDigest !== persisted.eventDigest) {
          await client.query('ROLLBACK')
          return [{ idempotencyKey, status: 'conflict' }]
        }
        results.push({ idempotencyKey, status: 'duplicate' })
      }

      await client.query('COMMIT')
      return results
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  }
}
