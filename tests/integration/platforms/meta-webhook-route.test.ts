import { createHmac, randomUUID } from 'node:crypto'

import type { PostgresAdapter } from '@payloadcms/db-postgres'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { getPayload, type Payload } from 'payload'

import { createMetaWebhookHandlers } from '@/modules/platforms/meta/http'
import { PLATFORM_EVENT_JOB_TYPE } from '@/modules/platforms/eventJobs'
import { platformEventKeyV2 } from '@/modules/platforms/types'
import config from '@/payload.config'

const appSecret = 'integration-meta-app-secret'
const verifyToken = 'integration-meta-verify-token'
const now = Date.UTC(2026, 6, 22, 8, 0, 0)

let payload: Payload
const jobKeys: string[] = []

const pool = (): PostgresAdapter['pool'] => (payload.db as unknown as PostgresAdapter).pool

const signatureFor = (rawBody: string): string =>
  `sha256=${createHmac('sha256', appSecret).update(rawBody).digest('hex')}`

describe.sequential('Meta webhook route durable ingress', () => {
  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required')
    payload = await getPayload({ config, disableOnInit: true, key: 'task13-meta-webhook-route' })
  })

  afterEach(async () => {
    if (jobKeys.length === 0) return
    await pool().query(
      'DELETE FROM jobs WHERE type = $1 AND idempotency_key = ANY($2::text[])',
      [PLATFORM_EVENT_JOB_TYPE, jobKeys],
    )
    jobKeys.length = 0
  })

  afterAll(async () => {
    await payload?.destroy()
  })

  it('accepts a 36-hour-delayed Meta retry and creates exactly one durable job', async () => {
    const suffix = randomUUID()
    const accountExternalId = `page-${suffix}`
    const externalEventId = `message-${suffix}`
    const idempotencyKey = platformEventKeyV2(
      'facebook-messenger',
      accountExternalId,
      externalEventId,
    )
    jobKeys.push(idempotencyKey)
    const rawBody = JSON.stringify({
      object: 'page',
      entry: [{
        id: accountExternalId,
        messaging: [{
          message: { mid: externalEventId, text: 'Please share available finishes.' },
          recipient: { id: accountExternalId },
          sender: { id: `sender-${suffix}` },
          timestamp: now - (36 * 60 * 60 * 1_000),
        }],
      }],
    })
    const handlers = createMetaWebhookHandlers({
      allowedAccountExternalIds: [accountExternalId],
      appSecret,
      now: () => now,
      payloadProvider: async () => payload,
      rateLimiter: { consume: async () => true },
      verifyToken,
    })
    const request = () => new Request('https://ivybm.example.invalid/api/webhooks/meta', {
      body: rawBody,
      headers: {
        'content-type': 'application/json',
        'x-hub-signature-256': signatureFor(rawBody),
      },
      method: 'POST',
    })

    const accepted = await handlers.POST(request())
    expect(accepted.status).toBe(200)
    await expect(accepted.json()).resolves.toEqual({ accepted: 1, duplicates: 0, total: 1 })

    const duplicate = await handlers.POST(request())
    expect(duplicate.status).toBe(200)
    await expect(duplicate.json()).resolves.toEqual({ accepted: 0, duplicates: 1, total: 1 })

    const jobs = await pool().query<{
      idempotency_key: string
      status: string
      type: string
    }>(
      'SELECT type, idempotency_key, status FROM jobs WHERE type = $1 AND idempotency_key = $2',
      [PLATFORM_EVENT_JOB_TYPE, idempotencyKey],
    )
    expect(jobs.rows).toEqual([{
      idempotency_key: idempotencyKey,
      status: 'pending',
      type: PLATFORM_EVENT_JOB_TYPE,
    }])
  })
})
