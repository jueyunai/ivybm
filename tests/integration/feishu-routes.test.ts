import { randomUUID } from 'node:crypto'

import { NextRequest } from 'next/server'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { getPayload, type Payload } from 'payload'

import { GET as feishuCallback } from '@/app/api/integrations/feishu/callback/route'
import { GET as feishuConnect } from '@/app/api/integrations/feishu/connect/route'
import { POST as feishuDisconnect } from '@/app/api/integrations/feishu/disconnect/route'
import { GET as feishuStatus } from '@/app/api/integrations/feishu/status/route'
import {
  encryptFeishuCredential,
  readFeishuCredentialEncryptionKey,
} from '@/modules/feishu/credentials'
import { FeishuApiError } from '@/modules/feishu/contracts'
import type { ClaimedJob, JobRecord } from '@/modules/jobs/contracts'
import { PayloadJobQueue } from '@/modules/jobs/claim'
import { JobWorker } from '@/modules/jobs/worker'
import { hashOAuthState } from '@/modules/feishu/oauth'
import {
  createFeishuConnectionProvisionJobHandler,
  enqueueFeishuConnectionProvisionJob,
  enqueuePendingFeishuConnectionProvisionJobs,
  FEISHU_CONNECTION_PROVISION_JOB_TYPE,
} from '@/modules/feishu/provisioning'
import config from '@/payload.config'

const response = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
    status,
  })

const context = { skipAudit: true }
const suffix = randomUUID()
const adminEmail = `task11-routes-${suffix}@example.invalid`
const adminPassword = 'task11-feishu-routes-password'
const oauthState = `task11-state-${suffix}`
const tenantKey = `task11-tenant-${suffix}`

let payload: Payload
let adminID: number
let operatorID: number
let authorization: string
let operatorAuthorization: string
let callbackConnectionID: number
let callbackJobID: number
const connectionIDs = new Set<number>()
const jobIDs = new Set<number>()
const mappingIDs = new Set<number>()

const claimed = (job: JobRecord, attempts = 1, maxAttempts = job.maxAttempts): ClaimedJob => ({
  ...job,
  attempts,
  leaseExpiresAt: '2026-07-31T12:00:00.000Z',
  maxAttempts,
  ownerToken: `task11-route-owner-${job.id}-${attempts}`,
  status: 'processing',
})

const execution = () => ({
  assertLease: vi.fn(),
  renewLease: vi.fn(),
  signal: new AbortController().signal,
})

const connectionFixture = async (name: string) => {
  const key = readFeishuCredentialEncryptionKey()
  const revision = new Date(Date.now() + Math.floor(Math.random() * 10_000)).toISOString()
  const connection = await payload.create({
    collection: 'feishu-connections',
    context,
    data: {
      accessTokenEncrypted: encryptFeishuCredential(`access-${name}`, key),
      accessTokenExpiresAt: new Date(Date.now() + 60 * 60 * 1_000).toISOString(),
      authMode: 'store_oauth',
      installerOpenId: `open-${name}`,
      lastConnectedAt: revision,
      name: `Feishu ${name}`,
      refreshTokenEncrypted: encryptFeishuCredential(`refresh-${name}`, key),
      refreshTokenExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1_000).toISOString(),
      status: 'provisioning',
      tenantKey: `tenant-${name}-${suffix}`,
    },
    overrideAccess: true,
  })
  const enqueued = await enqueueFeishuConnectionProvisionJob({
    connection: connection as unknown as Record<string, unknown>,
    payload,
  })
  connectionIDs.add(connection.id)
  jobIDs.add(enqueued.job.id)
  return { connection, job: enqueued.job, revision }
}

describe.sequential('Task 11 Feishu OAuth routes and provisioning job', () => {
  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required')
    process.env.FEISHU_APP_ID = 'cli_task11_routes'
    process.env.FEISHU_APP_SECRET = 'secret_task11_routes'
    process.env.FEISHU_OAUTH_REDIRECT_URI = 'http://localhost/api/integrations/feishu/callback'
    process.env.FEISHU_CREDENTIAL_ENCRYPTION_KEY = 'a'.repeat(64)
    payload = await getPayload({ config, disableOnInit: true, key: 'task11-feishu-routes' })
    const admin = await payload.create({
      collection: 'users',
      context,
      data: { email: adminEmail, password: adminPassword, role: 'admin' },
      overrideAccess: true,
    })
    adminID = admin.id
    const operator = await payload.create({
      collection: 'users',
      context,
      data: {
        email: `task11-routes-operator-${suffix}@example.invalid`,
        password: adminPassword,
        role: 'operator',
      },
      overrideAccess: true,
    })
    operatorID = operator.id
    const login = await payload.login({
      collection: 'users',
      data: { email: adminEmail, password: adminPassword },
    })
    authorization = `JWT ${login.token}`
    const operatorLogin = await payload.login({
      collection: 'users',
      data: { email: operator.email, password: adminPassword },
    })
    operatorAuthorization = `JWT ${operatorLogin.token}`
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  afterAll(async () => {
    if (!payload) return
    if (jobIDs.size > 0)
      await payload.delete({
        collection: 'jobs',
        context,
        overrideAccess: true,
        where: { id: { in: [...jobIDs] } },
      })
    if (mappingIDs.size > 0)
      await payload.delete({
        collection: 'feishu-mappings',
        context,
        overrideAccess: true,
        where: { id: { in: [...mappingIDs] } },
      })
    await payload.delete({
      collection: 'feishu-oauth-states',
      context,
      overrideAccess: true,
      where: { requestedBy: { equals: adminID } },
    })
    if (connectionIDs.size > 0)
      await payload.delete({
        collection: 'feishu-connections',
        context,
        overrideAccess: true,
        where: { id: { in: [...connectionIDs] } },
      })
    await payload.delete({
      collection: 'audit-logs',
      overrideAccess: true,
      where: { actor: { in: [adminID, operatorID] } },
    })
    await payload.delete({
      collection: 'users',
      context,
      overrideAccess: true,
      where: { id: { in: [adminID, operatorID] } },
    })
    await payload.destroy()
    delete process.env.FEISHU_APP_ID
    delete process.env.FEISHU_APP_SECRET
    delete process.env.FEISHU_OAUTH_REDIRECT_URI
    delete process.env.FEISHU_CREDENTIAL_ENCRYPTION_KEY
  })

  it('enforces admin auth and persists OAuth as one asynchronous provisioning job', async () => {
    const unauthenticated = await feishuConnect(
      new NextRequest('http://localhost/api/integrations/feishu/connect'),
    )
    expect(unauthenticated.status).toBe(401)
    const forbiddenConnect = await feishuConnect(
      new NextRequest('http://localhost/api/integrations/feishu/connect', {
        headers: { authorization: operatorAuthorization },
      }),
    )
    expect(forbiddenConnect.status).toBe(403)

    const stateBefore = await payload.count({
      collection: 'feishu-oauth-states',
      overrideAccess: true,
      where: { requestedBy: { equals: adminID } },
    })
    const authorizedConnect = await feishuConnect(
      new NextRequest('http://localhost/api/integrations/feishu/connect', {
        headers: { authorization },
      }),
    )
    expect(authorizedConnect.status).toBe(302)
    expect(authorizedConnect.headers.get('location')).toContain('accounts.feishu.cn')
    const stateAfter = await payload.count({
      collection: 'feishu-oauth-states',
      overrideAccess: true,
      where: { requestedBy: { equals: adminID } },
    })
    expect(stateAfter.totalDocs).toBe(stateBefore.totalDocs + 1)

    await payload.create({
      collection: 'feishu-oauth-states',
      context,
      data: {
        expiresAt: new Date(Date.now() + 5 * 60 * 1_000).toISOString(),
        requestedBy: adminID,
        stateHash: hashOAuthState(oauthState),
        verifierEncrypted: encryptFeishuCredential(
          'v'.repeat(64),
          readFeishuCredentialEncryptionKey(),
        ),
      },
      overrideAccess: true,
    })
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        response({
          access_token: 'task11-callback-access',
          code: 0,
          expires_in: 7200,
          refresh_token: 'task11-callback-refresh',
          refresh_token_expires_in: 604800,
          scope: 'auth:user.id:read bitable:app offline_access',
        }),
      )
      .mockResolvedValueOnce(
        response({
          code: 0,
          data: { name: 'Route Admin', open_id: `open-${suffix}`, tenant_key: tenantKey },
        }),
      )
    vi.stubGlobal('fetch', fetch)

    const callbackRequest = () =>
      new NextRequest(
        `http://localhost/api/integrations/feishu/callback?state=${oauthState}&code=single-use-code`,
      )
    const callback = await feishuCallback(callbackRequest())
    expect(callback.status).toBe(302)
    expect(callback.headers.get('location')).toContain('result=provisioning')
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(fetch.mock.calls.map(([url]) => String(url))).not.toContain(
      'https://open.feishu.cn/open-apis/bitable/v1/apps',
    )

    const connections = await payload.find({
      collection: 'feishu-connections',
      depth: 0,
      limit: 1,
      overrideAccess: true,
      where: { tenantKey: { equals: tenantKey } },
    })
    const connection = connections.docs[0]
    if (!connection) throw new Error('Expected callback connection')
    callbackConnectionID = connection.id
    connectionIDs.add(connection.id)
    expect(connection).toMatchObject({ baseURL: null, status: 'provisioning', tableId: null })

    const jobs = await payload.find({
      collection: 'jobs',
      depth: 0,
      limit: 2,
      overrideAccess: true,
      where: {
        and: [
          { type: { equals: FEISHU_CONNECTION_PROVISION_JOB_TYPE } },
          { 'payload.connectionId': { equals: callbackConnectionID } },
        ],
      },
    })
    expect(jobs.totalDocs).toBe(1)
    callbackJobID = jobs.docs[0]!.id
    jobIDs.add(callbackJobID)
    await expect(
      enqueueFeishuConnectionProvisionJob({
        connection: connection as unknown as Record<string, unknown>,
        payload,
      }),
    ).resolves.toMatchObject({ job: { id: callbackJobID }, state: 'duplicate' })
    await expect(enqueuePendingFeishuConnectionProvisionJobs({ payload })).resolves.toEqual({
      created: 0,
      duplicate: 1,
    })

    const replay = await feishuCallback(callbackRequest())
    expect(replay.headers.get('location')).toContain('result=failed')
    expect(fetch).toHaveBeenCalledTimes(2)

    const unauthenticatedStatus = await feishuStatus(
      new NextRequest('http://localhost/api/integrations/feishu/status'),
    )
    expect(unauthenticatedStatus.status).toBe(401)
    const forbiddenStatus = await feishuStatus(
      new NextRequest('http://localhost/api/integrations/feishu/status', {
        headers: { authorization: operatorAuthorization },
      }),
    )
    expect(forbiddenStatus.status).toBe(403)
    const status = await feishuStatus(
      new NextRequest('http://localhost/api/integrations/feishu/status', {
        headers: { authorization },
      }),
    )
    expect(status.status).toBe(200)
    await expect(status.json()).resolves.toMatchObject({
      connections: [
        expect.objectContaining({
          credentialsUsable: true,
          id: callbackConnectionID,
          status: 'provisioning',
        }),
      ],
      oauthConfigured: true,
    })
  })

  it('creates the Base and table in the worker, then disconnects without a stale retry', async () => {
    const queue = new PayloadJobQueue({ payload })
    const job = await queue.getByID(callbackJobID)
    if (!job) throw new Error('Expected callback provisioning job')
    const createBase = vi.fn(async () => ({
      appToken: `base-${suffix}`,
      baseURL: `https://tenant.example.invalid/base/${suffix}`,
    }))
    const createTable = vi.fn(async () => ({ tableId: `table-${suffix}` }))
    const handler = createFeishuConnectionProvisionJobHandler({
      accessToken: async () => 'task11-user-token',
      createBase,
      createTable,
      payload,
    })
    await handler(claimed(job), execution())

    const connection = await payload.findByID({
      collection: 'feishu-connections',
      depth: 0,
      id: callbackConnectionID,
      overrideAccess: true,
    })
    expect(connection).toMatchObject({
      appToken: `base-${suffix}`,
      status: 'connected',
      tableId: `table-${suffix}`,
    })
    const mappings = await payload.find({
      collection: 'feishu-mappings',
      depth: 0,
      limit: 1,
      overrideAccess: true,
      where: { connection: { equals: callbackConnectionID } },
    })
    expect(mappings.docs[0]).toMatchObject({
      appToken: `base-${suffix}`,
      connection: callbackConnectionID,
      status: 'active',
      tableId: `table-${suffix}`,
    })
    mappingIDs.add(mappings.docs[0]!.id)

    const unauthenticatedDisconnect = await feishuDisconnect(
      new NextRequest('http://localhost/api/integrations/feishu/disconnect', {
        body: JSON.stringify({ connectionId: callbackConnectionID }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      }),
    )
    expect(unauthenticatedDisconnect.status).toBe(401)
    const forbiddenDisconnect = await feishuDisconnect(
      new NextRequest('http://localhost/api/integrations/feishu/disconnect', {
        body: JSON.stringify({ connectionId: callbackConnectionID }),
        headers: {
          authorization: operatorAuthorization,
          'content-type': 'application/json',
        },
        method: 'POST',
      }),
    )
    expect(forbiddenDisconnect.status).toBe(403)
    const missingConnectionID = await feishuDisconnect(
      new NextRequest('http://localhost/api/integrations/feishu/disconnect', {
        body: JSON.stringify({}),
        headers: { authorization, 'content-type': 'application/json' },
        method: 'POST',
      }),
    )
    expect(missingConnectionID.status).toBe(400)

    const disconnected = await feishuDisconnect(
      new NextRequest('http://localhost/api/integrations/feishu/disconnect', {
        body: JSON.stringify({ connectionId: callbackConnectionID }),
        headers: { authorization, 'content-type': 'application/json' },
        method: 'POST',
      }),
    )
    expect(disconnected.status).toBe(200)
    await expect(disconnected.json()).resolves.toEqual({ disconnected: true })
    const disconnectedConnection = await payload.findByID({
      collection: 'feishu-connections',
      depth: 0,
      id: callbackConnectionID,
      overrideAccess: true,
    })
    expect(disconnectedConnection).toMatchObject({
      accessTokenEncrypted: null,
      refreshTokenEncrypted: null,
      status: 'disconnected',
    })
    await expect(
      payload.findByID({
        collection: 'feishu-mappings',
        depth: 0,
        id: mappings.docs[0]!.id,
        overrideAccess: true,
      }),
    ).resolves.toMatchObject({ status: 'disabled' })

    await handler(claimed(job, 2), execution())
    expect(createBase).toHaveBeenCalledTimes(1)
    expect(createTable).toHaveBeenCalledTimes(1)
    await payload.delete({ collection: 'jobs', context, id: job.id, overrideAccess: true })
  })

  it('resumes after a partial Base success without creating a duplicate Base', async () => {
    const fixture = await connectionFixture(`resume-${randomUUID()}`)
    const createBase = vi.fn(async () => ({
      appToken: `resume-base-${suffix}`,
      baseURL: `https://tenant.example.invalid/base/resume-${suffix}`,
    }))
    const createTable = vi
      .fn()
      .mockRejectedValueOnce(
        new FeishuApiError({
          code: 1254290,
          message: 'rate limited fixture',
          retryable: true,
          status: 429,
        }),
      )
      .mockResolvedValueOnce({ tableId: `resume-table-${suffix}` })
    const handler = createFeishuConnectionProvisionJobHandler({
      accessToken: async () => 'resume-user-token',
      createBase,
      createTable,
      payload,
    })

    await expect(handler(claimed(fixture.job, 1, 2), execution())).rejects.toMatchObject({
      code: 1254290,
    })
    await expect(
      payload.findByID({
        collection: 'feishu-connections',
        depth: 0,
        id: fixture.connection.id,
        overrideAccess: true,
      }),
    ).resolves.toMatchObject({
      appToken: `resume-base-${suffix}`,
      lastErrorCode: '1254290',
      status: 'provisioning',
      tableId: null,
    })

    await handler(claimed(fixture.job, 2, 2), execution())
    expect(createBase).toHaveBeenCalledTimes(1)
    expect(createTable).toHaveBeenCalledTimes(2)
    await expect(
      payload.findByID({
        collection: 'feishu-connections',
        depth: 0,
        id: fixture.connection.id,
        overrideAccess: true,
      }),
    ).resolves.toMatchObject({ status: 'connected', tableId: `resume-table-${suffix}` })
    const mapping = await payload.find({
      collection: 'feishu-mappings',
      depth: 0,
      limit: 1,
      overrideAccess: true,
      where: { connection: { equals: fixture.connection.id } },
    })
    if (mapping.docs[0]) mappingIDs.add(mapping.docs[0].id)
    await payload.delete({
      collection: 'jobs',
      context,
      id: fixture.job.id,
      overrideAccess: true,
    })
  })

  it('moves a final failure to dead and lets an administrator retry the same job', async () => {
    const fixture = await connectionFixture(`dead-${randomUUID()}`)
    await payload.update({
      collection: 'jobs',
      context,
      data: { maxAttempts: 2 },
      id: fixture.job.id,
      overrideAccess: true,
    })
    let now = new Date(Date.now() + 1_000)
    const queue = new PayloadJobQueue({ clock: () => now, payload })
    const createBase = vi
      .fn()
      .mockRejectedValueOnce(
        new FeishuApiError({
          code: 1254290,
          message: 'provider body must not enter Jobs',
          retryable: true,
          status: 429,
        }),
      )
      .mockRejectedValueOnce(
        new FeishuApiError({
          code: 1254290,
          message: 'provider body must not enter Jobs',
          retryable: true,
          status: 429,
        }),
      )
      .mockResolvedValueOnce({
        appToken: `manual-base-${suffix}`,
        baseURL: `https://tenant.example.invalid/base/manual-${suffix}`,
      })
    const handler = createFeishuConnectionProvisionJobHandler({
      accessToken: async () => 'dead-user-token',
      createBase,
      createTable: async () => ({ tableId: `manual-table-${suffix}` }),
      payload,
    })
    const worker = new JobWorker({
      handlers: { [FEISHU_CONNECTION_PROVISION_JOB_TYPE]: handler },
      queue,
    })

    await expect(worker.runOnce()).resolves.toBe('failed')
    await expect(queue.getByID(fixture.job.id)).resolves.toMatchObject({
      attempts: 1,
      lastError: 'Feishu connection provisioning failed',
      status: 'failed',
    })
    now = new Date(now.getTime() + 1_000)
    await expect(worker.runOnce()).resolves.toBe('failed')
    await expect(queue.getByID(fixture.job.id)).resolves.toMatchObject({
      attempts: 2,
      lastError: 'Feishu connection provisioning failed',
      status: 'dead',
    })
    await expect(
      payload.findByID({
        collection: 'feishu-connections',
        depth: 0,
        id: fixture.connection.id,
        overrideAccess: true,
      }),
    ).resolves.toMatchObject({ lastErrorCode: '1254290', status: 'error' })

    await expect(
      queue.retryManually(fixture.job.id, { id: operatorID, role: 'operator' }),
    ).rejects.toMatchObject({ code: 'forbidden' })
    await expect(
      queue.retryManually(fixture.job.id, { id: adminID, role: 'admin' }),
    ).resolves.toMatchObject({ attempts: 0, manualRetryCount: 1, status: 'pending' })
    await expect(worker.runOnce()).resolves.toBe('succeeded')
    await expect(queue.getByID(fixture.job.id)).resolves.toMatchObject({
      attempts: 1,
      manualRetryCount: 1,
      status: 'succeeded',
    })
    await expect(
      payload.findByID({
        collection: 'feishu-connections',
        depth: 0,
        id: fixture.connection.id,
        overrideAccess: true,
      }),
    ).resolves.toMatchObject({ status: 'connected', tableId: `manual-table-${suffix}` })
  })
})
