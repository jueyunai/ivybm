import { randomUUID } from 'node:crypto'

import { sql, type PostgresAdapter } from '@payloadcms/db-postgres'
import {
  commitTransaction,
  createLocalReq,
  initTransaction,
  killTransaction,
  type Payload,
  type PayloadRequest,
} from 'payload'

import type { Job, User } from '@/payload-types'

import {
  type ClaimedJob,
  type CreateJobInput,
  type JobFailure,
  JobQueueError,
  type JobRecord,
  type JobRetryActor,
  type JobStatus,
} from './contracts'
import {
  manualRetryState,
  transitionAfterFailure,
  validateMaxAttempts,
  type RetryOptions,
} from './retry'

const DEFAULT_JOB_LEASE_MS = 120_000

const jobColumnNames = [
  'id',
  'type',
  'idempotency_key',
  'payload',
  'status',
  'attempts',
  'max_attempts',
  'next_run_at',
  'lease_expires_at',
  'owner_token',
  'last_error',
  'completed_at',
  'dead_at',
  'manual_retry_count',
  'updated_at',
  'created_at',
]

const selectedJobColumns = jobColumnNames.map((column) => `"${column}"`).join(', ')
const selectedJobColumnsFrom = (alias: string): string =>
  jobColumnNames.map((column) => `${alias}."${column}"`).join(', ')

type JobDatabaseRow = {
  attempts: number | string
  completed_at: Date | string | null
  created_at: Date | string
  dead_at: Date | string | null
  id: number
  idempotency_key: string | null
  last_error: string | null
  lease_expires_at: Date | string | null
  manual_retry_count: number | string
  max_attempts: number | string
  next_run_at: Date | string | null
  owner_token: string | null
  payload: unknown
  status: JobStatus
  type: string
  updated_at: Date | string
}

export type PayloadJobQueueOptions = {
  clock?: () => Date
  leaseMs?: number
  payload: Payload
  retryOptions?: RetryOptions
}

export type EnsureRunnableJobOptions = {
  rearmSucceeded?: boolean
}

const toDateString = (value: Date | string | null): string | null => {
  if (value === null) return null
  const date = value instanceof Date ? value : new Date(value)

  if (Number.isNaN(date.getTime())) {
    throw new JobQueueError('validation', 'Job date is invalid')
  }

  return date.toISOString()
}

const toNumber = (value: number | string, field: string): number => {
  const number = Number(value)
  if (!Number.isFinite(number)) {
    throw new JobQueueError('validation', `Job ${field} is invalid`)
  }

  return number
}

const toPayload = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new JobQueueError('validation', 'Job payload must be an object')
  }

  return value as Record<string, unknown>
}

const mapDatabaseJob = (row: JobDatabaseRow): JobRecord => ({
  attempts: toNumber(row.attempts, 'attempts'),
  completedAt: toDateString(row.completed_at),
  createdAt: toDateString(row.created_at) ?? '',
  deadAt: toDateString(row.dead_at),
  id: row.id,
  idempotencyKey: row.idempotency_key,
  lastError: row.last_error,
  leaseExpiresAt: toDateString(row.lease_expires_at),
  manualRetryCount: toNumber(row.manual_retry_count, 'manualRetryCount'),
  maxAttempts: toNumber(row.max_attempts, 'maxAttempts'),
  nextRunAt: toDateString(row.next_run_at),
  ownerToken: row.owner_token,
  payload: toPayload(row.payload),
  status: row.status,
  type: row.type,
  updatedAt: toDateString(row.updated_at) ?? '',
})

const mapPayloadJob = (job: Job): JobRecord => ({
  attempts: job.attempts,
  completedAt: job.completedAt ?? null,
  createdAt: job.createdAt,
  deadAt: job.deadAt ?? null,
  id: job.id,
  idempotencyKey: job.idempotencyKey ?? null,
  lastError: job.lastError ?? null,
  leaseExpiresAt: job.leaseExpiresAt ?? null,
  manualRetryCount: job.manualRetryCount,
  maxAttempts: job.maxAttempts,
  nextRunAt: job.nextRunAt ?? null,
  ownerToken: job.ownerToken ?? null,
  payload: toPayload(job.payload),
  status: job.status,
  type: job.type,
  updatedAt: job.updatedAt,
})

const requireClaimedJob = (job: JobRecord): ClaimedJob => {
  if (!job.ownerToken) {
    throw new JobQueueError('conflict', `Job ${job.id} was claimed without an owner token`)
  }

  return job as ClaimedJob
}

const errorMessage = (error: Error): string => error.message.slice(0, 2_000)

export type ManualRetryOptions = {
  beforeRetry?: (job: Job, req: PayloadRequest) => Promise<Date | undefined>
  afterRetry?: (job: Job, retried: JobRecord, req: PayloadRequest) => Promise<void>
}

export class PayloadJobQueue {
  private readonly clock: () => Date
  private readonly leaseMs: number
  private readonly payload: Payload
  private readonly retryOptions?: RetryOptions

  constructor(options: PayloadJobQueueOptions) {
    this.clock = options.clock ?? (() => new Date())
    this.leaseMs = options.leaseMs ?? DEFAULT_JOB_LEASE_MS
    this.payload = options.payload
    this.retryOptions = options.retryOptions

    if (!Number.isInteger(this.leaseMs) || this.leaseMs < 1_000) {
      throw new RangeError('leaseMs must be an integer of at least 1000')
    }
  }

  private get pool() {
    return (this.payload.db as unknown as PostgresAdapter).pool
  }

  private async transactionDatabase(req?: PayloadRequest) {
    const transactionID = await req?.transactionID
    if (!transactionID) return null

    const adapter = this.payload.db as unknown as PostgresAdapter
    const database = adapter.sessions[transactionID]?.db
    if (!database) {
      throw new JobQueueError('conflict', 'Job queue transaction session is unavailable')
    }
    return database
  }

  private async transaction<T>(
    actor: User,
    operation: (req: PayloadRequest) => Promise<T>,
  ): Promise<T> {
    const req = await createLocalReq({ user: actor }, this.payload)
    await initTransaction(req)
    try {
      const result = await operation(req)
      await commitTransaction(req)
      return result
    } catch (error) {
      await killTransaction(req).catch(() => undefined)
      throw error
    }
  }

  async enqueue(
    input: CreateJobInput,
    req?: PayloadRequest,
  ): Promise<{ job: JobRecord; state: 'created' | 'duplicate' }> {
    if (!input.type.trim()) {
      throw new JobQueueError('validation', 'Job type is required')
    }

    const now = this.clock()
    const nextRunAt = input.nextRunAt ?? now
    const maxAttempts = validateMaxAttempts(input.maxAttempts ?? 5)
    const idempotencyKey = input.idempotencyKey ?? null

    const transactionDatabase = await this.transactionDatabase(req)
    if (transactionDatabase) {
      const inserted = await transactionDatabase.execute<JobDatabaseRow>(sql`
        INSERT INTO "jobs" (
          "type", "idempotency_key", "payload", "status", "attempts", "max_attempts", "next_run_at",
          "manual_retry_count", "updated_at", "created_at"
        ) VALUES (
          ${input.type}, ${idempotencyKey}, ${JSON.stringify(input.payload)}::jsonb, 'pending', 0,
          ${maxAttempts}, ${nextRunAt.toISOString()}, 0, ${now.toISOString()}, ${now.toISOString()}
        )
        ON CONFLICT ("type", "idempotency_key") DO NOTHING
        RETURNING ${sql.raw(selectedJobColumns)}
      `)

      if (inserted.rows[0]) {
        return { job: mapDatabaseJob(inserted.rows[0]), state: 'created' }
      }

      if (!idempotencyKey) {
        throw new JobQueueError('conflict', 'Job insert did not return a row')
      }

      const existing = await transactionDatabase.execute<JobDatabaseRow>(sql`
        SELECT ${sql.raw(selectedJobColumns)}
        FROM "jobs"
        WHERE "type" = ${input.type} AND "idempotency_key" = ${idempotencyKey}
        LIMIT 1
      `)
      if (!existing.rows[0]) {
        throw new JobQueueError('conflict', 'Idempotent job was not found after insert conflict')
      }

      return { job: mapDatabaseJob(existing.rows[0]), state: 'duplicate' }
    }

    const inserted = await this.pool.query<JobDatabaseRow>(
      `INSERT INTO jobs (
        type, idempotency_key, payload, status, attempts, max_attempts, next_run_at,
        manual_retry_count, updated_at, created_at
      ) VALUES ($1, $2, $3::jsonb, 'pending', 0, $4, $5, 0, $6, $6)
      ON CONFLICT (type, idempotency_key) DO NOTHING
      RETURNING ${selectedJobColumns}`,
      [
        input.type,
        idempotencyKey,
        JSON.stringify(input.payload),
        maxAttempts,
        nextRunAt.toISOString(),
        now.toISOString(),
      ],
    )

    if (inserted.rows[0]) {
      return { job: mapDatabaseJob(inserted.rows[0]), state: 'created' }
    }

    if (!idempotencyKey) {
      throw new JobQueueError('conflict', 'Job insert did not return a row')
    }

    const existing = await this.pool.query<JobDatabaseRow>(
      `SELECT ${selectedJobColumns}
       FROM jobs
       WHERE type = $1 AND idempotency_key = $2
       LIMIT 1`,
      [input.type, idempotencyKey],
    )
    if (!existing.rows[0]) {
      throw new JobQueueError('conflict', 'Idempotent job was not found after insert conflict')
    }

    return { job: mapDatabaseJob(existing.rows[0]), state: 'duplicate' }
  }

  /**
   * Create or repair a revision-scoped successor without trusting the
   * requested schedule over the row that won the idempotency race. This is
   * intentionally narrow: failed/pending rows keep their attempt budget and
   * only move later, while an anomalous succeeded status-only row may be
   * rearmed because status reconciliation is read-only and idempotent.
   */
  async ensureRunnable(
    input: CreateJobInput,
    options: EnsureRunnableJobOptions = {},
  ): Promise<{ job: JobRecord; state: 'created' | 'duplicate' }> {
    const queued = await this.enqueue(input)
    const idempotencyKey = input.idempotencyKey
    if (!idempotencyKey) return queued

    const now = this.clock().toISOString()
    const nextRunAt = (input.nextRunAt ?? this.clock()).toISOString()
    const rearmSucceeded = options.rearmSucceeded === true
    const repaired = await this.pool.query<JobDatabaseRow>(
      `UPDATE jobs
       SET
         status = CASE WHEN $4::boolean AND status = 'succeeded' THEN 'pending' ELSE status END,
         attempts = CASE WHEN $4::boolean AND status = 'succeeded' THEN 0 ELSE attempts END,
         completed_at = CASE WHEN $4::boolean AND status = 'succeeded' THEN NULL ELSE completed_at END,
         dead_at = CASE WHEN $4::boolean AND status = 'succeeded' THEN NULL ELSE dead_at END,
         last_error = CASE WHEN $4::boolean AND status = 'succeeded' THEN NULL ELSE last_error END,
         next_run_at = CASE
           WHEN $4::boolean AND status = 'succeeded' THEN $2
           ELSE GREATEST(COALESCE(next_run_at, $2), $2)
         END,
         updated_at = $1
       WHERE type = $5 AND idempotency_key = $3
         AND (
           (status IN ('pending', 'failed') AND attempts < max_attempts)
           OR ($4::boolean AND status = 'succeeded')
         )
       RETURNING ${selectedJobColumns}`,
      [now, nextRunAt, idempotencyKey, rearmSucceeded, input.type],
    )
    if (repaired.rows[0]) {
      return { job: mapDatabaseJob(repaired.rows[0]), state: queued.state }
    }

    // The row may be processing, dead, or otherwise outside the narrow repair
    // envelope. Return the actual persisted row so callers can require a
    // registered manual compensation path instead of assuming it is runnable.
    const existing = await this.pool.query<JobDatabaseRow>(
      `SELECT ${selectedJobColumns}
       FROM jobs
       WHERE type = $1 AND idempotency_key = $2
       LIMIT 1`,
      [input.type, idempotencyKey],
    )
    if (!existing.rows[0]) {
      throw new JobQueueError('conflict', 'Idempotent job was not found after successor repair')
    }
    return { job: mapDatabaseJob(existing.rows[0]), state: 'duplicate' }
  }

  async claimNext(allowedTypes?: readonly string[]): Promise<ClaimedJob | null> {
    const normalizedTypes = allowedTypes
      ? [...new Set(allowedTypes.map((type) => type.trim()).filter(Boolean))]
      : null
    const now = this.clock()
    const nowISO = now.toISOString()
    const leaseExpiresAt = new Date(now.getTime() + this.leaseMs).toISOString()
    const token = randomUUID()
    const result = await this.pool.query<JobDatabaseRow>(
      `WITH expired_final_attempts AS (
        UPDATE jobs
        SET
          status = 'dead',
          dead_at = $1,
          lease_expires_at = NULL,
          owner_token = NULL,
          last_error = COALESCE(last_error, 'Lease expired after the final allowed attempt'),
          updated_at = $1
        WHERE status = 'processing'
          AND lease_expires_at <= $1
          AND attempts >= max_attempts
      ),
      candidate AS (
        SELECT id
        FROM jobs
        WHERE attempts < max_attempts
          AND ($4::text[] IS NULL OR type = ANY($4::text[]))
          AND (
            (status IN ('pending', 'failed') AND next_run_at <= $1)
            OR (status = 'processing' AND lease_expires_at <= $1)
          )
        ORDER BY next_run_at ASC NULLS LAST, created_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      UPDATE jobs AS job
      SET
        attempts = job.attempts + 1,
        lease_expires_at = $2,
        owner_token = $3,
        status = 'processing',
        updated_at = $1
      FROM candidate
      WHERE job.id = candidate.id
      RETURNING ${selectedJobColumnsFrom('job')}`,
      [nowISO, leaseExpiresAt, token, normalizedTypes],
    )

    return result.rows[0] ? requireClaimedJob(mapDatabaseJob(result.rows[0])) : null
  }

  async renew(job: ClaimedJob): Promise<ClaimedJob> {
    const now = this.clock()
    const result = await this.pool.query<JobDatabaseRow>(
      `UPDATE jobs
       SET lease_expires_at = $1, updated_at = $2
       WHERE id = $3
         AND status = 'processing'
         AND owner_token = $4
         AND lease_expires_at > $2
       RETURNING ${selectedJobColumns}`,
      [
        new Date(now.getTime() + this.leaseMs).toISOString(),
        now.toISOString(),
        job.id,
        job.ownerToken,
      ],
    )

    if (!result.rows[0]) {
      throw new JobQueueError('conflict', `Job ${job.id} lease was reclaimed before renewal`)
    }

    return requireClaimedJob(mapDatabaseJob(result.rows[0]))
  }

  async complete(job: ClaimedJob): Promise<JobRecord> {
    const now = this.clock().toISOString()
    const result = await this.pool.query<JobDatabaseRow>(
      `UPDATE jobs
       SET
         completed_at = $1,
         lease_expires_at = NULL,
         next_run_at = NULL,
         owner_token = NULL,
         status = 'succeeded',
         updated_at = $1
       WHERE id = $2 AND status = 'processing' AND owner_token = $3
       RETURNING ${selectedJobColumns}`,
      [now, job.id, job.ownerToken],
    )

    if (!result.rows[0]) {
      throw new JobQueueError('conflict', `Job ${job.id} lease was reclaimed before completion`)
    }

    return mapDatabaseJob(result.rows[0])
  }

  async fail({ error, job, retryNotBefore }: JobFailure): Promise<JobRecord> {
    const now = this.clock()
    const transition = transitionAfterFailure({
      attempts: job.attempts,
      maxAttempts: job.maxAttempts,
      now,
      retryNotBefore,
      retryOptions: this.retryOptions,
    })
    const result = await this.pool.query<JobDatabaseRow>(
      `UPDATE jobs
       SET
         dead_at = $1,
         last_error = $2,
         lease_expires_at = NULL,
         next_run_at = $3,
         owner_token = NULL,
         status = $4,
         updated_at = $5
       WHERE id = $6 AND status = 'processing' AND owner_token = $7
       RETURNING ${selectedJobColumns}`,
      [
        transition.deadAt?.toISOString() ?? null,
        errorMessage(error),
        transition.nextRunAt?.toISOString() ?? null,
        transition.status,
        now.toISOString(),
        job.id,
        job.ownerToken,
      ],
    )

    if (!result.rows[0]) {
      throw new JobQueueError(
        'conflict',
        `Job ${job.id} lease was reclaimed before failure handling`,
      )
    }

    return mapDatabaseJob(result.rows[0])
  }

  async getByID(id: number): Promise<JobRecord | null> {
    const result = await this.pool.query<JobDatabaseRow>(
      `SELECT ${selectedJobColumns} FROM jobs WHERE id = $1 LIMIT 1`,
      [id],
    )
    return result.rows[0] ? mapDatabaseJob(result.rows[0]) : null
  }

  async retryManually(
    id: number,
    actor: JobRetryActor,
    req?: PayloadRequest,
    options?: ManualRetryOptions,
  ): Promise<JobRecord> {
    if (actor.role !== 'admin') {
      throw new JobQueueError('forbidden', 'Only administrators may retry failed jobs')
    }

    const operation = async (transactionReq: PayloadRequest): Promise<JobRecord> => {
      const found = await this.payload.find({
        collection: 'jobs',
        depth: 0,
        limit: 1,
        overrideAccess: true,
        req: transactionReq,
        where: { id: { equals: id } },
      })
      const job = found.docs[0]
      if (!job) {
        throw new JobQueueError('not_found', `Job ${id} does not exist`)
      }

      const nextRunAt = await options?.beforeRetry?.(job, transactionReq)
      const next = manualRetryState(job, this.clock(), nextRunAt)
      const updated = await this.payload.update({
        collection: 'jobs',
        data: {
          ...next,
          nextRunAt: next.nextRunAt?.toISOString() ?? null,
        },
        overrideAccess: true,
        req: transactionReq,
        where: {
          and: [
            { id: { equals: job.id } },
            { manualRetryCount: { equals: job.manualRetryCount } },
            { status: { equals: job.status } },
          ],
        },
      })
      if (updated.docs.length !== 1) {
        throw new JobQueueError('conflict', `Job ${id} changed before it could be retried`)
      }

      const retried = mapPayloadJob(updated.docs[0])
      await options?.afterRetry?.(job, retried, transactionReq)
      return retried
    }

    const transactionDatabase = await this.transactionDatabase(req)
    if (transactionDatabase && req) return operation(req)
    return this.transaction(actor as User, operation)
  }
}
