import { createHmac, randomUUID } from 'node:crypto'

import type { PostgresAdapter } from '@payloadcms/db-postgres'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { getPayload, type Payload } from 'payload'

import { createMetaWebhookHandlers } from '@/modules/platforms/meta/http'
import { PLATFORM_EVENT_JOB_TYPE } from '@/modules/platforms/eventJobs'
import { platformEventKeyV2 } from '@/modules/platforms/types'
import config from '@/payload.config'
import { platformMessagingIdentityWriteContextKey } from '@/collections/PlatformAccounts'

const appSecret = 'integration-meta-app-secret'
const verifyToken = 'integration-meta-verify-token'
const replayEncryptionKey = 'a'.repeat(64)
const now = Date.UTC(2026, 6, 22, 8, 0, 0)

let payload: Payload
let originalEncryptionKey: string | undefined
const accountIDs: Array<number | string> = []
const jobKeys: string[] = []

const pool = (): PostgresAdapter['pool'] => (payload.db as unknown as PostgresAdapter).pool

const signatureFor = (rawBody: string, secret = appSecret): string =>
  `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`

describe.sequential('Meta webhook route durable ingress', () => {
  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required')
    originalEncryptionKey = process.env.PLATFORM_CREDENTIAL_ENCRYPTION_KEY
    process.env.PLATFORM_CREDENTIAL_ENCRYPTION_KEY = 'a'.repeat(64)
    payload = await getPayload({ config, disableOnInit: true, key: 'task13-meta-webhook-route' })
  })

  afterEach(async () => {
    if (jobKeys.length > 0) {
      await pool().query('DELETE FROM jobs WHERE type = $1 AND idempotency_key = ANY($2::text[])', [
        PLATFORM_EVENT_JOB_TYPE,
        jobKeys,
      ])
    }
    if (accountIDs.length > 0) {
      await payload.delete({
        collection: 'platform-accounts',
        context: { skipAudit: true },
        overrideAccess: true,
        where: { id: { in: accountIDs } },
      })
    }
    accountIDs.length = 0
    jobKeys.length = 0
  })

  afterAll(async () => {
    await payload?.destroy()
    if (originalEncryptionKey === undefined) delete process.env.PLATFORM_CREDENTIAL_ENCRYPTION_KEY
    else process.env.PLATFORM_CREDENTIAL_ENCRYPTION_KEY = originalEncryptionKey
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
    const account = await payload.create({
      collection: 'platform-accounts',
      context: { skipAudit: true },
      data: {
        accountKind: 'facebook-page',
        authorizationRevision: 0,
        authorization: {
          accessToken: `meta-route-access-token-${suffix}`,
          accessTokenConfigured: false,
          appId: null,
          clearAccessToken: false,
          clearRefreshToken: false,
          expiresAt: null,
          refreshToken: null,
          refreshTokenConfigured: false,
          scopes: [],
          state: 'connected',
        },
        capabilities: { messagingInbound: 'pending', publishing: 'not_started' },
        connectionKey: null,
        externalAccountId: accountExternalId,
        name: `Meta route Page ${suffix}`,
        notes: null,
        platformFamily: 'meta',
      },
      overrideAccess: true,
    })
    accountIDs.push(account.id)
    const rawBody = JSON.stringify({
      object: 'page',
      entry: [
        {
          id: accountExternalId,
          messaging: [
            {
              message: { mid: externalEventId, text: 'Please share available finishes.' },
              recipient: { id: accountExternalId },
              sender: { id: `sender-${suffix}` },
              timestamp: now - 36 * 60 * 60 * 1_000,
            },
          ],
        },
      ],
    })
    const handlers = createMetaWebhookHandlers({
      allowedAccountExternalIds: [accountExternalId],
      appSecret,
      now: () => now,
      payloadProvider: async () => payload,
      rateLimiter: { consume: async () => true },
      replayEncryptionKey,
      verifyToken,
    })
    const request = () =>
      new Request('https://ivybm.example.invalid/api/webhooks/meta', {
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
    }>('SELECT type, idempotency_key, status FROM jobs WHERE type = $1 AND idempotency_key = $2', [
      PLATFORM_EVENT_JOB_TYPE,
      idempotencyKey,
    ])
    expect(jobs.rows).toEqual([
      {
        idempotency_key: idempotencyKey,
        status: 'pending',
        type: PLATFORM_EVENT_JOB_TYPE,
      },
    ])
  })

  it('rejects an entire signed batch when a later PlatformAccounts record is blocked', async () => {
    const suffix = randomUUID()
    const connectedAccountExternalId = `connected-page-${suffix}`
    const blockedAccountExternalId = `blocked-page-${suffix}`
    const connectedEventId = `connected-message-${suffix}`
    const blockedEventId = `blocked-message-${suffix}`
    const idempotencyKeys = [
      platformEventKeyV2(
        'facebook-messenger',
        connectedAccountExternalId,
        connectedEventId,
      ),
      platformEventKeyV2(
        'facebook-messenger',
        blockedAccountExternalId,
        blockedEventId,
      ),
    ]
    jobKeys.push(...idempotencyKeys)
    const connectedAccount = await payload.create({
      collection: 'platform-accounts',
      context: { skipAudit: true },
      data: {
        accountKind: 'facebook-page',
        authorizationRevision: 0,
        authorization: {
          accessToken: `connected-meta-route-token-${suffix}`,
          accessTokenConfigured: false,
          appId: null,
          clearAccessToken: false,
          clearRefreshToken: false,
          expiresAt: null,
          refreshToken: null,
          refreshTokenConfigured: false,
          scopes: [],
          state: 'connected',
        },
        capabilities: { messagingInbound: 'pending', publishing: 'not_started' },
        connectionKey: null,
        externalAccountId: connectedAccountExternalId,
        name: `Connected Meta route Page ${suffix}`,
        notes: null,
        platformFamily: 'meta',
      },
      overrideAccess: true,
    })
    accountIDs.push(connectedAccount.id)
    const blockedAccount = await payload.create({
      collection: 'platform-accounts',
      context: { skipAudit: true },
      data: {
        accountKind: 'facebook-page',
        authorizationRevision: 0,
        authorization: {
          accessToken: null,
          accessTokenConfigured: false,
          appId: null,
          clearAccessToken: false,
          clearRefreshToken: false,
          expiresAt: null,
          refreshToken: null,
          refreshTokenConfigured: false,
          scopes: [],
          state: 'blocked',
        },
        capabilities: { messagingInbound: 'approved', publishing: 'not_started' },
        connectionKey: null,
        externalAccountId: blockedAccountExternalId,
        name: `Blocked Meta route Page ${suffix}`,
        notes: null,
        platformFamily: 'meta',
      },
      overrideAccess: true,
    })
    accountIDs.push(blockedAccount.id)
    const rawBody = JSON.stringify({
      entry: [
        {
          id: connectedAccountExternalId,
          messaging: [
            {
              message: { mid: connectedEventId, text: 'This event must roll back.' },
              recipient: { id: connectedAccountExternalId },
              sender: { id: `connected-sender-${suffix}` },
              timestamp: now,
            },
          ],
        },
        {
          id: blockedAccountExternalId,
          messaging: [
            {
              message: { mid: blockedEventId, text: 'This event must not enqueue.' },
              recipient: { id: blockedAccountExternalId },
              sender: { id: `blocked-sender-${suffix}` },
              timestamp: now,
            },
          ],
        },
      ],
      object: 'page',
    })
    const handlers = createMetaWebhookHandlers({
      allowedAccountExternalIds: [connectedAccountExternalId, blockedAccountExternalId],
      appSecret,
      now: () => now,
      payloadProvider: async () => payload,
      rateLimiter: { consume: async () => true },
      replayEncryptionKey,
      verifyToken,
    })

    const response = await handlers.POST(
      new Request('https://ivybm.example.invalid/api/webhooks/meta', {
        body: rawBody,
        headers: {
          'content-type': 'application/json',
          'x-hub-signature-256': signatureFor(rawBody),
        },
        method: 'POST',
      }),
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: { code: 'unauthorized_account' } })
    const jobs = await pool().query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM jobs WHERE type = $1 AND idempotency_key = ANY($2::text[])',
      [PLATFORM_EVENT_JOB_TYPE, idempotencyKeys],
    )
    expect(jobs.rows).toEqual([{ count: '0' }])
  })

  it('accepts Instagram by its distinct Messaging ID without an OAuth-ID env allowlist', async () => {
    const suffix = randomUUID()
    const oauthAccountId = '27656145620744697'
    const messagingAccountId = `1${Date.now()}${Math.floor(Math.random() * 1000)}`
    const externalEventId = `instagram-message-${suffix}`
    const idempotencyKey = platformEventKeyV2('instagram', messagingAccountId, externalEventId)
    jobKeys.push(idempotencyKey)
    const account = await payload.create({
      collection: 'platform-accounts',
      context: { [platformMessagingIdentityWriteContextKey]: true, skipAudit: true },
      data: {
        accountKind: 'instagram-professional',
        authorizationRevision: 0,
        authorization: {
          accessToken: `instagram-route-token-${suffix}`,
          accessTokenConfigured: false,
          appId: null,
          clearAccessToken: false,
          clearRefreshToken: false,
          expiresAt: null,
          refreshToken: null,
          refreshTokenConfigured: false,
          scopes: [],
          state: 'connected',
        },
        capabilities: { messagingInbound: 'approved', publishing: 'not_started' },
        connectionKey: null,
        externalAccountId: oauthAccountId,
        messagingConnectionKey: null,
        messagingExternalAccountId: messagingAccountId,
        name: `Instagram route account ${suffix}`,
        notes: null,
        platformFamily: 'meta',
      },
      overrideAccess: true,
    })
    accountIDs.push(account.id)
    const instagramSecret = 'integration-instagram-app-secret'
    const rawBody = JSON.stringify({
      entry: [
        {
          id: 'instagram-entry-alias',
          messaging: [
            {
              message: { mid: externalEventId, text: 'Instagram fixture message.' },
              recipient: { id: messagingAccountId },
              sender: { id: `sender-${suffix}` },
              timestamp: now,
            },
          ],
        },
      ],
      object: 'instagram',
    })
    const handlers = createMetaWebhookHandlers({
      allowedAccountExternalIds: [],
      instagramAppSecret: instagramSecret,
      now: () => now,
      payloadProvider: async () => payload,
      rateLimiter: { consume: async () => true },
      replayEncryptionKey,
      verifyToken,
    })
    const response = await handlers.POST(
      new Request('https://ivybm.example.invalid/api/webhooks/meta', {
        body: rawBody,
        headers: {
          'content-type': 'application/json',
          'x-hub-signature-256': signatureFor(rawBody, instagramSecret),
        },
        method: 'POST',
      }),
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ accepted: 1, duplicates: 0, total: 1 })
    const jobs = await pool().query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM jobs WHERE type = $1 AND idempotency_key = $2',
      [PLATFORM_EVENT_JOB_TYPE, idempotencyKey],
    )
    expect(jobs.rows).toEqual([{ count: '1' }])
  })
})
