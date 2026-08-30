import { randomUUID } from 'node:crypto'

import type { PostgresAdapter } from '@payloadcms/db-postgres'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { getPayload, type Payload } from 'payload'

import config from '@/payload.config'
import { PayloadMetaWebhookReplayRepository } from '@/modules/platforms/meta/replayStorage'

let payload: Payload
const key = Buffer.alloc(32, 6)

const pool = (): PostgresAdapter['pool'] => (payload.db as unknown as PostgresAdapter).pool

describe.sequential('Meta webhook encrypted replay storage', () => {
  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required')
    payload = await getPayload({ config, disableOnInit: true, key: 'meta-webhook-replay-integration' })
  })

  beforeEach(async () => {
    await pool().query('DELETE FROM meta_webhook_replays')
  })

  afterEach(async () => {
    await pool().query('DELETE FROM meta_webhook_replays')
  })

  afterAll(async () => {
    await payload?.destroy()
  })

  it('encrypts, deduplicates, decrypts and expires signature-verified failures', async () => {
    let now = new Date('2026-08-30T00:00:00.000Z')
    const repository = new PayloadMetaWebhookReplayRepository({
      key,
      now: () => now,
      payload,
    })
    const traceId = randomUUID()
    const body = Buffer.from(JSON.stringify({ object: 'instagram', text: 'private customer text' }))
    const input = {
      body,
      bodySha256: 'a'.repeat(64),
      contentType: 'application/json',
      errorCode: 'unauthorized_account',
      providerObject: 'instagram' as const,
      traceId,
    }
    const first = await repository.record(input)
    const second = await repository.record({ ...input, traceId: randomUUID() })
    expect(first).toMatchObject({ recordId: expect.any(Number), status: 'recorded' })
    expect(second).toMatchObject({ recordId: first.recordId, status: 'recorded' })

    const stored = await pool().query<{
      encrypted_body: string
      retry_count: number
    }>('SELECT encrypted_body, retry_count FROM meta_webhook_replays WHERE id = $1', [first.recordId])
    expect(stored.rows).toHaveLength(1)
    expect(stored.rows[0]?.retry_count).toBe(2)
    expect(stored.rows[0]?.encrypted_body).not.toContain('private customer text')
    await expect(repository.read(first.recordId!)).resolves.toMatchObject({ body })

    now = new Date('2026-08-31T00:00:00.001Z')
    await expect(repository.read(first.recordId!)).resolves.toBeUndefined()
    await repository.record({ ...input, bodySha256: 'b'.repeat(64), traceId: randomUUID() })
    const remaining = await pool().query<{ count: string }>(
      'SELECT count(*) FROM meta_webhook_replays',
    )
    expect(Number(remaining.rows[0]?.count)).toBe(1)
  })

  it('fails closed when the replay key cannot authenticate stored ciphertext', async () => {
    const repository = new PayloadMetaWebhookReplayRepository({ key, payload })
    const recorded = await repository.record({
      body: Buffer.from('{"object":"page"}'),
      bodySha256: 'c'.repeat(64),
      contentType: 'application/json',
      errorCode: 'invalid_payload',
      providerObject: 'page',
      traceId: randomUUID(),
    })
    const wrongKeyRepository = new PayloadMetaWebhookReplayRepository({
      key: Buffer.alloc(32, 8),
      payload,
    })
    await expect(wrongKeyRepository.read(recorded.recordId!)).rejects.toThrow(
      'Meta webhook replay payload cannot be decrypted',
    )
  })

  it('caps retained replay records without dropping retries for an existing digest', async () => {
    const repository = new PayloadMetaWebhookReplayRepository({ key, payload, rowCap: 1 })
    const first = await repository.record({
      body: Buffer.from('{"object":"page","fixture":1}'),
      bodySha256: 'a'.repeat(64),
      contentType: 'application/json',
      errorCode: 'invalid_payload',
      providerObject: 'page',
      traceId: randomUUID(),
    })
    const capped = await repository.record({
      body: Buffer.from('{"object":"page","fixture":2}'),
      bodySha256: 'b'.repeat(64),
      contentType: 'application/json',
      errorCode: 'invalid_payload',
      providerObject: 'page',
      traceId: randomUUID(),
    })
    const duplicate = await repository.record({
      body: Buffer.from('{"object":"page","fixture":1}'),
      bodySha256: 'a'.repeat(64),
      contentType: 'application/json',
      errorCode: 'invalid_payload',
      providerObject: 'page',
      traceId: randomUUID(),
    })

    expect(first.status).toBe('recorded')
    expect(capped).toEqual({ status: 'capacity' })
    expect(duplicate).toMatchObject({ recordId: first.recordId, status: 'recorded' })
    const rows = await pool().query<{ body_sha256: string; retry_count: number }>(
      'SELECT body_sha256, retry_count FROM meta_webhook_replays',
    )
    expect(rows.rows).toEqual([{ body_sha256: 'a'.repeat(64), retry_count: 2 }])
  })
})
