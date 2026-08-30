import type { PostgresAdapter } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'

import {
  decryptMetaWebhookReplayBody,
  encryptMetaWebhookReplayBody,
  readMetaWebhookReplayEncryptionKey,
} from './replayCrypto'

const REPLAY_TTL_MILLISECONDS = 24 * 60 * 60 * 1_000
const REPLAY_ROW_CAP = 500

export type MetaWebhookReplayRecordInput = {
  body: Uint8Array
  bodySha256: string
  contentType: string
  errorCode: string
  providerObject: 'instagram' | 'page' | 'unknown'
  traceId: string
}

export type MetaWebhookReplayRecordResult = {
  recordId?: number
  status: 'capacity' | 'recorded'
}

export type MetaWebhookReplayStoredRecord = {
  body: Buffer
  bodySha256: string
  errorCode: string
  expiresAt: string
  id: number
  providerObject: string
  traceId: string
}

export interface MetaWebhookFailureRecorderPort {
  record(input: MetaWebhookReplayRecordInput): Promise<MetaWebhookReplayRecordResult>
}

const exactDigest = (value: string): string => {
  if (!/^[a-f0-9]{64}$/u.test(value)) throw new Error('Meta webhook replay digest is invalid')
  return value
}

const exactCode = (value: string): string => {
  if (!/^[a-z][a-z0-9_]{0,63}$/u.test(value)) throw new Error('Meta webhook replay code is invalid')
  return value
}

const exactTrace = (value: string): string => {
  if (!/^[a-f0-9-]{36}$/u.test(value)) throw new Error('Meta webhook replay trace is invalid')
  return value
}

export class PayloadMetaWebhookReplayRepository implements MetaWebhookFailureRecorderPort {
  private readonly key: Buffer
  private readonly now: () => Date
  private readonly pool: PostgresAdapter['pool']
  private readonly rowCap: number

  constructor({
    key = readMetaWebhookReplayEncryptionKey(),
    now = () => new Date(),
    payload,
    rowCap = REPLAY_ROW_CAP,
  }: {
    key?: Buffer
    now?: () => Date
    payload: Payload
    rowCap?: number
  }) {
    this.key = Buffer.from(key)
    if (this.key.length !== 32) throw new Error('Meta webhook replay encryption key is invalid')
    this.now = now
    if (!Number.isSafeInteger(rowCap) || rowCap <= 0 || rowCap > REPLAY_ROW_CAP) {
      throw new Error('Meta webhook replay row cap is invalid')
    }
    this.rowCap = rowCap
    this.pool = (payload.db as unknown as PostgresAdapter).pool
  }

  async record(input: MetaWebhookReplayRecordInput): Promise<MetaWebhookReplayRecordResult> {
    if (!input.body.byteLength || input.body.byteLength > 1_000_000) {
      throw new Error('Meta webhook replay body is invalid')
    }
    const traceId = exactTrace(input.traceId)
    const bodySha256 = exactDigest(input.bodySha256)
    const errorCode = exactCode(input.errorCode)
    const providerObject =
      input.providerObject === 'instagram' || input.providerObject === 'page'
        ? input.providerObject
        : 'unknown'
    const receivedAt = this.now()
    const expiresAt = new Date(receivedAt.getTime() + REPLAY_TTL_MILLISECONDS)
    const encryptedBody = encryptMetaWebhookReplayBody({
      body: input.body,
      context: traceId,
      key: this.key,
    })
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      await client.query("SET LOCAL statement_timeout = '2000ms'")
      await client.query("SELECT pg_advisory_xact_lock(hashtext('meta_webhook_replay_storage'))")
      await client.query('DELETE FROM meta_webhook_replays WHERE expires_at <= $1', [receivedAt])
      const updated = await client.query<{ id: number }>(
        `UPDATE meta_webhook_replays SET
           trace_id = $1,
           provider_object = $2,
           body_bytes = $3,
           content_type = $4,
           encrypted_body = $5,
           key_version = 1,
           last_received_at = $6,
           expires_at = $7,
           retry_count = retry_count + 1
         WHERE body_sha256 = $8 AND error_code = $9
         RETURNING id`,
        [
          traceId,
          providerObject,
          input.body.byteLength,
          input.contentType.slice(0, 120),
          encryptedBody,
          receivedAt,
          expiresAt,
          bodySha256,
          errorCode,
        ],
      )
      if (updated.rows[0]) {
        await client.query('COMMIT')
        return { recordId: updated.rows[0].id, status: 'recorded' }
      }
      const count = await client.query<{ count: string }>('SELECT count(*) FROM meta_webhook_replays')
      if (Number(count.rows[0]?.count ?? this.rowCap) >= this.rowCap) {
        await client.query('COMMIT')
        return { status: 'capacity' }
      }
      const inserted = await client.query<{ id: number }>(
        `INSERT INTO meta_webhook_replays (
           trace_id, provider_object, error_code, body_sha256, body_bytes, content_type,
           encrypted_body, key_version, received_at, last_received_at, expires_at, retry_count
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,1,$8,$8,$9,1)
         RETURNING id`,
        [
          traceId,
          providerObject,
          errorCode,
          bodySha256,
          input.body.byteLength,
          input.contentType.slice(0, 120),
          encryptedBody,
          receivedAt,
          expiresAt,
        ],
      )
      await client.query('COMMIT')
      return { recordId: inserted.rows[0]?.id, status: 'recorded' }
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  }

  async read(id: number): Promise<MetaWebhookReplayStoredRecord | undefined> {
    if (!Number.isSafeInteger(id) || id <= 0) return undefined
    const result = await this.pool.query<{
      body_sha256: string
      encrypted_body: string
      error_code: string
      expires_at: Date
      id: number
      provider_object: string
      trace_id: string
    }>(
      `SELECT id, trace_id, provider_object, error_code, body_sha256, encrypted_body, expires_at
       FROM meta_webhook_replays
       WHERE id = $1 AND expires_at > $2`,
      [id, this.now()],
    )
    const row = result.rows[0]
    if (!row) return undefined
    return {
      body: decryptMetaWebhookReplayBody({
        ciphertext: row.encrypted_body,
        context: row.trace_id,
        key: this.key,
      }),
      bodySha256: row.body_sha256,
      errorCode: row.error_code,
      expiresAt: row.expires_at.toISOString(),
      id: row.id,
      providerObject: row.provider_object,
      traceId: row.trace_id,
    }
  }
}
