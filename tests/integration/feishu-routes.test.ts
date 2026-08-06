import { randomUUID } from 'node:crypto'

import { NextRequest } from 'next/server'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { getPayload, type Payload } from 'payload'

import { GET as feishuCallback } from '@/app/api/integrations/feishu/callback/route'
import { GET as feishuConnect } from '@/app/api/integrations/feishu/connect/route'
import {
  disconnectFeishuConnection,
  POST as feishuDisconnect,
} from '@/app/api/integrations/feishu/disconnect/route'
import { GET as feishuStatus } from '@/app/api/integrations/feishu/status/route'
import { POST as feishuRegistrationStart } from '@/app/api/portal/feishu/registration/route'
import { GET as feishuRegistrationStatus } from '@/app/api/portal/feishu/registration/[id]/route'
import {
  completeFeishuAppRegistration,
  FEISHU_APP_CONFIGURATION_TTL_MS,
  FEISHU_OAUTH_CALLBACK_PROCESSING_TTL_MS,
  findOrCreateFeishuAppRegistration,
  getFeishuAppRegistration,
  recoverStaleFeishuOAuthCallbacks,
  restartFeishuAppAuthorization,
  runFeishuAppRegistration,
} from '@/modules/feishu/appRegistration'
import {
  decryptFeishuCredential,
  encryptFeishuCredential,
  readFeishuCredentialEncryptionKey,
} from '@/modules/feishu/credentials'
import { FeishuApiError } from '@/modules/feishu/contracts'
import { PayloadFeishuTokenProvider } from '@/modules/feishu/connectionClient'
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
const registrationIDs = new Set<number>()

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
    process.env.NEXT_PUBLIC_SERVER_URL = 'http://localhost'
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
    if (registrationIDs.size > 0)
      await payload.delete({
        collection: 'feishu-app-registrations',
        context,
        overrideAccess: true,
        where: { id: { in: [...registrationIDs] } },
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
    delete process.env.FEISHU_QR_REGISTRATION_ENABLED
    delete process.env.NEXT_PUBLIC_SERVER_URL
  })

  it('registers a tenant app by QR, stores only encrypted credentials, and completes OAuth once', async () => {
    process.env.FEISHU_QR_REGISTRATION_ENABLED = 'false'
    const disabled = await feishuRegistrationStart(
      new NextRequest('http://localhost/api/portal/feishu/registration', { method: 'POST' }),
    )
    expect(disabled.status).toBe(503)

    process.env.FEISHU_QR_REGISTRATION_ENABLED = 'true'
    const unauthenticated = await feishuRegistrationStart(
      new NextRequest('http://localhost/api/portal/feishu/registration', { method: 'POST' }),
    )
    expect(unauthenticated.status).toBe(401)
    const forbidden = await feishuRegistrationStart(
      new NextRequest('http://localhost/api/portal/feishu/registration', {
        headers: { authorization: operatorAuthorization, origin: 'http://localhost' },
        method: 'POST',
      }),
    )
    expect(forbidden.status).toBe(403)
    const missingOrigin = await feishuRegistrationStart(
      new NextRequest('http://localhost/api/portal/feishu/registration', {
        headers: { authorization },
        method: 'POST',
      }),
    )
    expect(missingOrigin.status).toBe(403)

    const registrationCountBeforeConfigurationFailure = await payload.count({
      collection: 'feishu-app-registrations',
      overrideAccess: true,
      where: { requestedBy: { equals: adminID } },
    })
    process.env.FEISHU_CREDENTIAL_ENCRYPTION_KEY = 'invalid'
    const notConfigured = await feishuRegistrationStart(
      new NextRequest('http://localhost/api/portal/feishu/registration', {
        headers: { authorization, origin: 'http://localhost' },
        method: 'POST',
      }),
    )
    expect(notConfigured.status).toBe(503)
    await expect(notConfigured.json()).resolves.toMatchObject({
      error: { code: 'feishu-registration-not-configured' },
    })
    await expect(
      payload.count({
        collection: 'feishu-app-registrations',
        overrideAccess: true,
        where: { requestedBy: { equals: adminID } },
      }),
    ).resolves.toEqual(registrationCountBeforeConfigurationFailure)
    process.env.FEISHU_CREDENTIAL_ENCRYPTION_KEY = 'a'.repeat(64)

    const admin = await payload.findByID({
      collection: 'users',
      id: adminID,
      overrideAccess: true,
    })
    const started = await findOrCreateFeishuAppRegistration({ payload, user: admin })
    registrationIDs.add(started.registration.id)
    const registerPort = vi.fn(
      async (options: { onQRCodeReady: (info: { expireIn: number; url: string }) => void }) => {
        options.onQRCodeReady({ expireIn: 600, url: 'https://open.feishu.cn/qr/fixture' })
        return { client_id: 'cli_qr_registered', client_secret: 'qr-app-secret-fixture' }
      },
    )
    const configureFetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(response({ code: 0, tenant_access_token: 'tenant-config-token' }))
      .mockResolvedValueOnce(response({ code: 0 }))

    await runFeishuAppRegistration({
      fetch: configureFetch,
      payload,
      register: registerPort as never,
      registrationId: started.registration.id,
    })
    expect(registerPort).toHaveBeenCalledTimes(1)
    const registered = await payload.findByID({
      collection: 'feishu-app-registrations',
      depth: 0,
      id: started.registration.id,
      overrideAccess: true,
    })
    expect(registered).toMatchObject({
      appId: 'cli_qr_registered',
      qrUrl: null,
      status: 'authorization_ready',
    })
    expect(registered.appSecretEncrypted).not.toContain('qr-app-secret-fixture')
    expect(
      decryptFeishuCredential(registered.appSecretEncrypted!, readFeishuCredentialEncryptionKey()),
    ).toBe('qr-app-secret-fixture')

    const refreshedAuthorization = await getFeishuAppRegistration({
      clock: () => new Date(Date.now() + 10 * 60 * 1_000),
      payload,
      registrationId: started.registration.id,
      user: admin,
    })
    expect(refreshedAuthorization).toMatchObject({ status: 'authorization_ready' })
    expect(refreshedAuthorization?.authorizeURL).not.toBe(registered.authorizeUrl)
    const reusedExpiredAuthorization = await findOrCreateFeishuAppRegistration({
      clock: () => new Date(Date.now() + 20 * 60 * 1_000),
      payload,
      user: admin,
    })
    expect(reusedExpiredAuthorization).toMatchObject({
      created: false,
      registration: { id: started.registration.id, status: 'authorization_ready' },
    })
    expect(reusedExpiredAuthorization.registration.authorizeUrl).not.toBe(
      refreshedAuthorization?.authorizeURL,
    )

    const registrationStatus = await feishuRegistrationStatus(
      new NextRequest(
        `http://localhost/api/portal/feishu/registration/${started.registration.id}`,
        { headers: { authorization } },
      ),
      { params: Promise.resolve({ id: String(started.registration.id) }) },
    )
    expect(registrationStatus.status).toBe(200)
    const registrationBody = (await registrationStatus.json()) as {
      registration: { authorizeURL: string }
    }
    const state = new URL(registrationBody.registration.authorizeURL).searchParams.get('state')
    expect(state).toBeTruthy()

    const deniedCallback = await feishuCallback(
      new NextRequest(
        `http://localhost/api/integrations/feishu/callback?state=${state}&error=access_denied`,
      ),
    )
    expect(deniedCallback.headers.get('location')).toContain('feishu=denied')
    const deniedRegistration = await payload.findByID({
      collection: 'feishu-app-registrations',
      depth: 0,
      id: started.registration.id,
      overrideAccess: true,
    })
    const deniedRetryState = new URL(deniedRegistration.authorizeUrl!).searchParams.get('state')
    expect(deniedRetryState).toBeTruthy()
    expect(deniedRetryState).not.toBe(state)

    const transientFailureFetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(response({ code: 99991400, msg: 'temporary provider failure' }, 503))
    vi.stubGlobal('fetch', transientFailureFetch)
    const failedCallback = await feishuCallback(
      new NextRequest(
        `http://localhost/api/integrations/feishu/callback?state=${deniedRetryState}&code=temporary-code`,
      ),
    )
    expect(failedCallback.headers.get('location')).toContain('feishu=failed')
    const retryRegistration = await payload.findByID({
      collection: 'feishu-app-registrations',
      depth: 0,
      id: started.registration.id,
      overrideAccess: true,
    })
    expect(retryRegistration).toMatchObject({
      lastErrorCode: 'oauth_provider_99991400',
      status: 'authorization_ready',
    })
    const retryState = new URL(retryRegistration.authorizeUrl!).searchParams.get('state')
    expect(retryState).toBeTruthy()
    expect(retryState).not.toBe(deniedRetryState)

    const qrTenantKey = `task11-qr-tenant-${suffix}`
    const oauthFetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        response({
          access_token: 'task11-qr-access',
          code: 0,
          expires_in: 7200,
          refresh_token: 'task11-qr-refresh',
          refresh_token_expires_in: 604800,
          scope: 'auth:user.id:read bitable:app offline_access',
        }),
      )
      .mockResolvedValueOnce(
        response({
          code: 0,
          data: { name: 'QR Admin', open_id: `open-qr-${suffix}`, tenant_key: qrTenantKey },
        }),
      )
    vi.stubGlobal('fetch', oauthFetch)
    const callback = await feishuCallback(
      new NextRequest(
        `http://localhost/api/integrations/feishu/callback?state=${retryState}&code=qr-code-fixture`,
      ),
    )
    expect(callback.status).toBe(302)
    expect(callback.headers.get('location')).toContain('feishu=provisioning')

    const connections = await payload.find({
      collection: 'feishu-connections',
      depth: 0,
      limit: 1,
      overrideAccess: true,
      where: { tenantKey: { equals: qrTenantKey } },
    })
    const connection = connections.docs[0]
    if (!connection) throw new Error('Expected QR connection')
    connectionIDs.add(connection.id)
    expect(connection).toMatchObject({ appId: 'cli_qr_registered', authMode: 'qr_registered' })
    expect(
      decryptFeishuCredential(connection.appSecretEncrypted!, readFeishuCredentialEncryptionKey()),
    ).toBe('qr-app-secret-fixture')
    const completed = await payload.findByID({
      collection: 'feishu-app-registrations',
      depth: 0,
      id: started.registration.id,
      overrideAccess: true,
    })
    expect(completed).toMatchObject({ appSecretEncrypted: null, status: 'completed' })
    const callbackStates = await payload.find({
      collection: 'feishu-oauth-states',
      depth: 0,
      limit: 20,
      overrideAccess: true,
      where: { registration: { equals: started.registration.id } },
    })
    expect(callbackStates.docs.filter((state) => state.usedAt)).toEqual(
      expect.arrayContaining([expect.objectContaining({ processingAt: null })]),
    )

    const jobs = await payload.find({
      collection: 'jobs',
      depth: 0,
      limit: 2,
      overrideAccess: true,
      where: { 'payload.connectionId': { equals: connection.id } },
    })
    expect(jobs.totalDocs).toBe(1)
    const qrJobID = jobs.docs[0]!.id
    await payload.delete({ collection: 'jobs', context, id: qrJobID, overrideAccess: true })
    await payload.delete({
      collection: 'feishu-connections',
      context,
      id: connection.id,
      overrideAccess: true,
    })
    connectionIDs.delete(connection.id)
  })

  it('retries a failed register without credentials before the registration TTL expires', async () => {
    const admin = await payload.findByID({
      collection: 'users',
      id: adminID,
      overrideAccess: true,
    })
    const started = await findOrCreateFeishuAppRegistration({ payload, user: admin })
    registrationIDs.add(started.registration.id)

    const qrURLs: string[] = []
    const registerPort = vi
      .fn()
      .mockImplementationOnce(
        async (options: { onQRCodeReady: (info: { expireIn: number; url: string }) => void }) => {
          const qrURL = 'https://open.feishu.cn/qr/failed-register-fixture'
          qrURLs.push(qrURL)
          options.onQRCodeReady({ expireIn: 600, url: qrURL })
          throw new Error('registerApp failed before returning credentials')
        },
      )
      .mockImplementationOnce(
        async (options: { onQRCodeReady: (info: { expireIn: number; url: string }) => void }) => {
          const qrURL = 'https://open.feishu.cn/qr/retry-register-fixture'
          qrURLs.push(qrURL)
          options.onQRCodeReady({ expireIn: 600, url: qrURL })
          return { client_id: 'cli_retry_registered', client_secret: 'retry-app-secret-fixture' }
        },
      )

    await runFeishuAppRegistration({
      payload,
      register: registerPort as never,
      registrationId: started.registration.id,
    })
    await expect(
      payload.findByID({
        collection: 'feishu-app-registrations',
        depth: 0,
        id: started.registration.id,
        overrideAccess: true,
      }),
    ).resolves.toMatchObject({
      appId: null,
      appSecretEncrypted: null,
      lastErrorCode: 'registration_failed',
      status: 'failed',
    })

    const retry = await findOrCreateFeishuAppRegistration({ payload, user: admin })
    expect(retry).toMatchObject({
      created: false,
      registration: { id: started.registration.id, status: 'pending' },
    })

    await runFeishuAppRegistration({
      fetch: vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValueOnce(response({ code: 0, tenant_access_token: 'retry-tenant-token' }))
        .mockResolvedValueOnce(response({ code: 0 })),
      payload,
      register: registerPort as never,
      registrationId: retry.registration.id,
    })

    expect(registerPort).toHaveBeenCalledTimes(2)
    expect(qrURLs).toEqual([
      'https://open.feishu.cn/qr/failed-register-fixture',
      'https://open.feishu.cn/qr/retry-register-fixture',
    ])
    await expect(
      payload.findByID({
        collection: 'feishu-app-registrations',
        depth: 0,
        id: retry.registration.id,
        overrideAccess: true,
      }),
    ).resolves.toMatchObject({
      appId: 'cli_retry_registered',
      authorizeUrl: expect.any(String),
      lastErrorCode: null,
      status: 'authorization_ready',
    })

    // The next case asserts that concurrent starts create exactly one fresh registration.
    // Remove this case's active authorization so it cannot be reused as that registration.
    await payload.delete({
      collection: 'feishu-oauth-states',
      context,
      overrideAccess: true,
      where: { registration: { equals: retry.registration.id } },
    })
    await payload.delete({
      collection: 'feishu-app-registrations',
      context,
      id: retry.registration.id,
      overrideAccess: true,
    })
    registrationIDs.delete(retry.registration.id)
  })

  it('deduplicates concurrent registration starts and persists provider expiry safely', async () => {
    const admin = await payload.findByID({
      collection: 'users',
      id: adminID,
      overrideAccess: true,
    })
    const [first, second] = await Promise.all([
      findOrCreateFeishuAppRegistration({ payload, user: admin }),
      findOrCreateFeishuAppRegistration({ payload, user: admin }),
    ])
    expect(first.registration.id).toBe(second.registration.id)
    expect([first.created, second.created].filter(Boolean)).toHaveLength(1)
    registrationIDs.add(first.registration.id)

    const registerPort = vi.fn(async () => {
      throw Object.assign(new Error('provider detail must not be persisted'), {
        code: 'expired_token',
      })
    })
    await Promise.all([
      runFeishuAppRegistration({
        payload,
        register: registerPort as never,
        registrationId: first.registration.id,
      }),
      runFeishuAppRegistration({
        payload,
        register: registerPort as never,
        registrationId: first.registration.id,
      }),
    ])
    expect(registerPort).toHaveBeenCalledTimes(1)
    await expect(
      payload.findByID({
        collection: 'feishu-app-registrations',
        depth: 0,
        id: first.registration.id,
        overrideAccess: true,
      }),
    ).resolves.toMatchObject({
      appSecretEncrypted: null,
      lastErrorCode: 'registration_expired',
      status: 'expired',
    })

    const retry = await findOrCreateFeishuAppRegistration({ payload, user: admin })
    registrationIDs.add(retry.registration.id)
    const failedConfigurationRegister = vi.fn(async () => ({
      client_id: 'cli_failed_configuration',
      client_secret: 'must-be-preserved-after-failure',
    }))
    await runFeishuAppRegistration({
      fetch: vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValue(response({ code: 99991400, msg: 'temporary failure' }, 503)),
      payload,
      register: failedConfigurationRegister as never,
      registrationId: retry.registration.id,
    })
    const failedConfiguration = await payload.findByID({
      collection: 'feishu-app-registrations',
      depth: 0,
      id: retry.registration.id,
      overrideAccess: true,
    })
    expect(failedConfiguration).toMatchObject({
      appId: 'cli_failed_configuration',
      lastErrorCode: 'provider_99991400',
      status: 'failed',
    })
    expect(
      decryptFeishuCredential(
        failedConfiguration.appSecretEncrypted!,
        readFeishuCredentialEncryptionKey(),
      ),
    ).toBe('must-be-preserved-after-failure')

    const resumed = await findOrCreateFeishuAppRegistration({ payload, user: admin })
    expect(resumed).toMatchObject({
      created: false,
      registration: { id: retry.registration.id, status: 'failed' },
    })
    const unexpectedSecondRegistration = vi.fn()
    await runFeishuAppRegistration({
      fetch: vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValueOnce(response({ code: 0, tenant_access_token: 'tenant-retry-token' }))
        .mockResolvedValueOnce(response({ code: 0 })),
      payload,
      register: unexpectedSecondRegistration as never,
      registrationId: resumed.registration.id,
    })
    expect(unexpectedSecondRegistration).not.toHaveBeenCalled()
    await expect(
      payload.findByID({
        collection: 'feishu-app-registrations',
        depth: 0,
        id: resumed.registration.id,
        overrideAccess: true,
      }),
    ).resolves.toMatchObject({
      appId: 'cli_failed_configuration',
      lastErrorCode: null,
      status: 'authorization_ready',
    })
    await completeFeishuAppRegistration(payload, resumed.registration.id)
  })

  it('recovers a stale OAuth callback attempt by issuing a fresh authorization state', async () => {
    const admin = await payload.findByID({
      collection: 'users',
      id: adminID,
      overrideAccess: true,
    })
    const started = await findOrCreateFeishuAppRegistration({ payload, user: admin })
    registrationIDs.add(started.registration.id)
    await runFeishuAppRegistration({
      fetch: vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValueOnce(response({ code: 0, tenant_access_token: 'tenant-recovery-token' }))
        .mockResolvedValueOnce(response({ code: 0 })),
      payload,
      register: vi.fn(async () => ({
        client_id: 'cli_recovery_registration',
        client_secret: 'recovery-app-secret-fixture',
      })) as never,
      registrationId: started.registration.id,
    })

    const authorizationReady = await payload.findByID({
      collection: 'feishu-app-registrations',
      depth: 0,
      id: started.registration.id,
      overrideAccess: true,
    })
    const states = await payload.find({
      collection: 'feishu-oauth-states',
      depth: 0,
      limit: 20,
      overrideAccess: true,
      where: {
        and: [{ registration: { equals: started.registration.id } }, { usedAt: { exists: false } }],
      },
    })
    const state = states.docs[0]
    if (!state) throw new Error('Expected authorization state')
    const processingAt = new Date().toISOString()
    await payload.update({
      collection: 'feishu-oauth-states',
      context,
      data: { processingAt, usedAt: processingAt },
      id: state.id,
      overrideAccess: true,
    })
    await payload.update({
      collection: 'feishu-app-registrations',
      context,
      data: { authorizeExpiresAt: new Date(Date.now() - 1_000).toISOString() },
      id: started.registration.id,
      overrideAccess: true,
    })

    await getFeishuAppRegistration({
      payload,
      registrationId: started.registration.id,
      user: admin,
    })
    await expect(
      payload.findByID({
        collection: 'feishu-oauth-states',
        depth: 0,
        id: state.id,
        overrideAccess: true,
      }),
    ).resolves.toMatchObject({ processingAt, usedAt: processingAt })

    const staleAt = new Date(
      Date.now() - FEISHU_OAUTH_CALLBACK_PROCESSING_TTL_MS - 1_000,
    ).toISOString()
    await payload.update({
      collection: 'feishu-oauth-states',
      context,
      data: { processingAt: staleAt },
      id: state.id,
      overrideAccess: true,
    })

    const recoveredCount = await recoverStaleFeishuOAuthCallbacks({ payload })
    expect(recoveredCount).toBe(1)
    const recoveredRegistration = await payload.findByID({
      collection: 'feishu-app-registrations',
      depth: 0,
      id: started.registration.id,
      overrideAccess: true,
    })
    expect(recoveredRegistration).toMatchObject({
      lastErrorCode: 'oauth_callback_stale',
      status: 'authorization_ready',
    })
    expect(recoveredRegistration.authorizeUrl).not.toBe(authorizationReady.authorizeUrl)
    await expect(
      payload.findByID({
        collection: 'feishu-oauth-states',
        depth: 0,
        id: state.id,
        overrideAccess: true,
      }),
    ).resolves.toMatchObject({ processingAt: null, usedAt: processingAt })
    const authorizationAfterRecovery = await payload.findByID({
      collection: 'feishu-app-registrations',
      depth: 0,
      id: started.registration.id,
      overrideAccess: true,
    })
    await restartFeishuAppAuthorization(
      payload,
      started.registration.id,
      'late_callback_failure',
      state.id,
    )
    await expect(
      payload.findByID({
        collection: 'feishu-app-registrations',
        depth: 0,
        id: started.registration.id,
        overrideAccess: true,
      }),
    ).resolves.toMatchObject({
      authorizeUrl: authorizationAfterRecovery.authorizeUrl,
      status: 'authorization_ready',
    })
    await completeFeishuAppRegistration(payload, started.registration.id)
  })

  it('does not overwrite a configuration that completed before the stale CAS', async () => {
    const admin = await payload.findByID({
      collection: 'users',
      id: adminID,
      overrideAccess: true,
    })
    const started = await findOrCreateFeishuAppRegistration({ payload, user: admin })
    registrationIDs.add(started.registration.id)
    const key = readFeishuCredentialEncryptionKey()
    const staleStartedAt = '2026-08-05T10:00:00.000Z'
    await payload.update({
      collection: 'feishu-app-registrations',
      context,
      data: {
        appId: 'cli_cas_registration',
        appSecretEncrypted: encryptFeishuCredential('cas-secret-fixture', key),
        configuringStartedAt: staleStartedAt,
        status: 'configuring',
      },
      id: started.registration.id,
      overrideAccess: true,
    })

    const originalFindByID = payload.findByID.bind(payload)
    let raced = false
    payload.findByID = (async (args) => {
      const found = await originalFindByID(args)
      if (
        !raced &&
        args.collection === 'feishu-app-registrations' &&
        args.id === started.registration.id
      ) {
        raced = true
        await payload.update({
          collection: 'feishu-app-registrations',
          context,
          data: {
            authorizeExpiresAt: '2026-08-05T12:00:00.000Z',
            authorizeUrl: 'https://accounts.feishu.cn/authorize/cas-fixture',
            status: 'authorization_ready',
          },
          id: started.registration.id,
          overrideAccess: true,
        })
      }
      return found
    }) as typeof payload.findByID

    try {
      await expect(
        getFeishuAppRegistration({
          clock: () => new Date('2026-08-05T11:00:00.000Z'),
          payload,
          registrationId: started.registration.id,
          user: admin,
        }),
      ).resolves.toMatchObject({
        authorizeURL: 'https://accounts.feishu.cn/authorize/cas-fixture',
        status: 'authorization_ready',
      })
    } finally {
      payload.findByID = originalFindByID
    }
  })

  it('re-reads a registration after locking before POST stale conversion', async () => {
    const admin = await payload.findByID({
      collection: 'users',
      id: adminID,
      overrideAccess: true,
    })
    const started = await findOrCreateFeishuAppRegistration({ payload, user: admin })
    registrationIDs.add(started.registration.id)
    const key = readFeishuCredentialEncryptionKey()
    await payload.update({
      collection: 'feishu-app-registrations',
      context,
      data: {
        appId: 'cli_post_cas_registration',
        appSecretEncrypted: encryptFeishuCredential('post-cas-secret-fixture', key),
        configuringStartedAt: '2026-08-06T00:00:00.000Z',
        status: 'configuring',
      },
      id: started.registration.id,
      overrideAccess: true,
    })

    const originalFind = payload.find.bind(payload)
    let raced = false
    payload.find = (async (args) => {
      const found = await originalFind(args)
      if (!raced && args.collection === 'feishu-app-registrations') {
        raced = true
        await payload.update({
          collection: 'feishu-app-registrations',
          context,
          data: {
            authorizeExpiresAt: '2026-08-06T02:00:00.000Z',
            authorizeUrl: 'https://accounts.feishu.cn/authorize/post-cas-fixture',
            status: 'authorization_ready',
          },
          id: started.registration.id,
          overrideAccess: true,
        })
      }
      return found
    }) as typeof payload.find

    try {
      await expect(
        findOrCreateFeishuAppRegistration({
          clock: () => new Date('2026-08-06T01:00:00.000Z'),
          payload,
          user: admin,
        }),
      ).resolves.toMatchObject({
        created: false,
        registration: {
          authorizeUrl: 'https://accounts.feishu.cn/authorize/post-cas-fixture',
          status: 'authorization_ready',
        },
      })
    } finally {
      payload.find = originalFind
    }
  })

  it('uses the persisted configuring lease to deduplicate concurrent runners', async () => {
    const admin = await payload.findByID({
      collection: 'users',
      id: adminID,
      overrideAccess: true,
    })
    const started = await findOrCreateFeishuAppRegistration({ payload, user: admin })
    registrationIDs.add(started.registration.id)
    const key = readFeishuCredentialEncryptionKey()
    await payload.update({
      collection: 'feishu-app-registrations',
      context,
      data: {
        appId: 'cli_live_lease_registration',
        appSecretEncrypted: encryptFeishuCredential('live-lease-secret-fixture', key),
        lastErrorCode: 'previous_failure',
        status: 'failed',
      },
      id: started.registration.id,
      overrideAccess: true,
    })

    let markFetchStarted!: () => void
    let releaseFetch!: (value: Response) => void
    const fetchStarted = new Promise<void>((resolve) => {
      markFetchStarted = resolve
    })
    const fetchResponse = new Promise<Response>((resolve) => {
      releaseFetch = resolve
    })
    const firstFetch = vi.fn<typeof globalThis.fetch>(async () => {
      markFetchStarted()
      return fetchResponse
    })
    const secondFetch = vi.fn<typeof globalThis.fetch>(async () =>
      response({ code: 888, msg: 'second runner must not call provider' }, 503),
    )
    const claimStartedAt = new Date('2026-08-06T01:00:00.000Z')
    const firstRun = runFeishuAppRegistration({
      clock: () => claimStartedAt,
      fetch: firstFetch,
      payload,
      register: vi.fn() as never,
      registrationId: started.registration.id,
    })

    await fetchStarted
    await runFeishuAppRegistration({
      clock: () => claimStartedAt,
      fetch: secondFetch,
      payload,
      register: vi.fn() as never,
      registrationId: started.registration.id,
    })
    expect(secondFetch).not.toHaveBeenCalled()

    releaseFetch(response({ code: 777, msg: 'first runner failure' }, 503))
    await firstRun
    expect(firstFetch).toHaveBeenCalledOnce()
    await expect(
      payload.findByID({
        collection: 'feishu-app-registrations',
        depth: 0,
        id: started.registration.id,
        overrideAccess: true,
      }),
    ).resolves.toMatchObject({ lastErrorCode: 'provider_777', status: 'failed' })
  })

  it('does not revive an expired registration after a late QR register result', async () => {
    const admin = await payload.findByID({
      collection: 'users',
      id: adminID,
      overrideAccess: true,
    })
    const started = await findOrCreateFeishuAppRegistration({ payload, user: admin })
    registrationIDs.add(started.registration.id)

    // Keep this race test independent from the active registration left by earlier
    // sequential cases. `findOrCreate...` intentionally reuses a live qr_ready row;
    // without resetting it here runFeishuAppRegistration has nothing to claim and
    // the test waits forever for registerStarted (the observed 30s timeout).
    await payload.update({
      collection: 'feishu-app-registrations',
      context,
      data: {
        appId: null,
        appSecretEncrypted: null,
        authorizeExpiresAt: null,
        authorizeUrl: null,
        configuringStartedAt: null,
        lastErrorCode: null,
        qrExpiresAt: null,
        qrUrl: null,
        status: 'pending',
      },
      id: started.registration.id,
      overrideAccess: true,
    })

    let markRegisterStarted!: () => void
    let releaseRegister!: (result: { client_id: string; client_secret: string }) => void
    const registerResult = new Promise<{ client_id: string; client_secret: string }>((resolve) => {
      releaseRegister = resolve
    })
    const registerStarted = new Promise<void>((resolve) => {
      markRegisterStarted = resolve
    })
    const registerPort = vi.fn(async () => {
      markRegisterStarted()
      return registerResult
    })
    const run = runFeishuAppRegistration({
      clock: () => new Date('2026-08-06T01:00:00.000Z'),
      payload,
      register: registerPort as never,
      registrationId: started.registration.id,
    })

    await registerStarted
    await payload.update({
      collection: 'feishu-app-registrations',
      context,
      data: {
        lastErrorCode: 'registration_expired',
        qrUrl: null,
        status: 'expired',
      },
      id: started.registration.id,
      overrideAccess: true,
    })
    releaseRegister({ client_id: 'cli_late_register', client_secret: 'late-register-secret' })
    await run

    await expect(
      payload.findByID({
        collection: 'feishu-app-registrations',
        depth: 0,
        id: started.registration.id,
        overrideAccess: true,
      }),
    ).resolves.toMatchObject({
      appId: null,
      appSecretEncrypted: null,
      lastErrorCode: 'registration_expired',
      status: 'expired',
    })
  })

  it('fences a runner after a stale configuring lease is reclaimed', async () => {
    const admin = await payload.findByID({
      collection: 'users',
      id: adminID,
      overrideAccess: true,
    })
    const started = await findOrCreateFeishuAppRegistration({ payload, user: admin })
    registrationIDs.add(started.registration.id)
    const key = readFeishuCredentialEncryptionKey()
    await payload.update({
      collection: 'feishu-app-registrations',
      context,
      data: {
        appId: 'cli_stale_lease_registration',
        appSecretEncrypted: encryptFeishuCredential('stale-lease-secret-fixture', key),
        lastErrorCode: 'previous_failure',
        status: 'failed',
      },
      id: started.registration.id,
      overrideAccess: true,
    })

    let markFetchStarted!: () => void
    let releaseFirstFetch!: (value: Response) => void
    const fetchStarted = new Promise<void>((resolve) => {
      markFetchStarted = resolve
    })
    const firstResponse = new Promise<Response>((resolve) => {
      releaseFirstFetch = resolve
    })
    const firstFetch = vi.fn<typeof globalThis.fetch>(async () => {
      markFetchStarted()
      return firstResponse
    })
    const secondFetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(response({ code: 0, tenant_access_token: 'new-runner-token' }))
      .mockResolvedValueOnce(response({ code: 0 }))
    const firstClaimAt = new Date('2026-08-06T01:00:00.000Z')
    const firstRun = runFeishuAppRegistration({
      clock: () => firstClaimAt,
      fetch: firstFetch,
      payload,
      register: vi.fn() as never,
      registrationId: started.registration.id,
    })

    await fetchStarted
    await runFeishuAppRegistration({
      clock: () => new Date(firstClaimAt.getTime() + FEISHU_APP_CONFIGURATION_TTL_MS + 1_000),
      fetch: secondFetch,
      payload,
      register: vi.fn() as never,
      registrationId: started.registration.id,
    })
    await expect(
      payload.findByID({
        collection: 'feishu-app-registrations',
        depth: 0,
        id: started.registration.id,
        overrideAccess: true,
      }),
    ).resolves.toMatchObject({ status: 'authorization_ready' })

    releaseFirstFetch(response({ code: 777, msg: 'stale runner failure' }, 503))
    await firstRun
    expect(firstFetch).toHaveBeenCalledOnce()
    await expect(
      payload.findByID({
        collection: 'feishu-app-registrations',
        depth: 0,
        id: started.registration.id,
        overrideAccess: true,
      }),
    ).resolves.toMatchObject({ status: 'authorization_ready' })
  })

  it('keeps the replacement runner controller after the old runner finishes', async () => {
    const admin = await payload.findByID({
      collection: 'users',
      id: adminID,
      overrideAccess: true,
    })
    const started = await findOrCreateFeishuAppRegistration({ payload, user: admin })
    registrationIDs.add(started.registration.id)
    const key = readFeishuCredentialEncryptionKey()
    await payload.update({
      collection: 'feishu-app-registrations',
      context,
      data: {
        appId: 'cli_controller_owner_registration',
        appSecretEncrypted: encryptFeishuCredential('controller-owner-secret-fixture', key),
        lastErrorCode: 'previous_failure',
        status: 'failed',
      },
      id: started.registration.id,
      overrideAccess: true,
    })

    let markFirstFetchStarted!: () => void
    let releaseFirstFetch!: (value: Response) => void
    const firstFetchStarted = new Promise<void>((resolve) => {
      markFirstFetchStarted = resolve
    })
    const firstResponse = new Promise<Response>((resolve) => {
      releaseFirstFetch = resolve
    })
    const firstFetch = vi.fn<typeof globalThis.fetch>(async () => {
      markFirstFetchStarted()
      return firstResponse
    })

    let markSecondFetchStarted!: () => void
    let releaseSecondFetch!: (value: Response) => void
    let secondFetchAborted = false
    const secondFetchStarted = new Promise<void>((resolve) => {
      markSecondFetchStarted = resolve
    })
    const secondFetch = vi.fn<typeof globalThis.fetch>(async (_input, init) => {
      markSecondFetchStarted()
      return new Promise<Response>((resolve) => {
        releaseSecondFetch = resolve
        init?.signal?.addEventListener(
          'abort',
          () => {
            secondFetchAborted = true
            resolve(response({ code: 777, msg: 'replacement runner aborted' }, 503))
          },
          { once: true },
        )
      })
    })

    const firstClaimAt = new Date('2026-08-06T01:00:00.000Z')
    const replacementClaimAt = new Date(
      firstClaimAt.getTime() + FEISHU_APP_CONFIGURATION_TTL_MS + 1_000,
    )
    const firstRun = runFeishuAppRegistration({
      clock: () => firstClaimAt,
      fetch: firstFetch,
      payload,
      register: vi.fn() as never,
      registrationId: started.registration.id,
    })
    await firstFetchStarted

    const replacementRun = runFeishuAppRegistration({
      clock: () => replacementClaimAt,
      fetch: secondFetch,
      payload,
      register: vi.fn() as never,
      registrationId: started.registration.id,
    })
    await secondFetchStarted

    releaseFirstFetch(response({ code: 777, msg: 'stale runner failure' }, 503))
    await firstRun

    await expect(
      getFeishuAppRegistration({
        clock: () =>
          new Date(replacementClaimAt.getTime() + FEISHU_APP_CONFIGURATION_TTL_MS + 1_000),
        payload,
        registrationId: started.registration.id,
        user: admin,
      }),
    ).resolves.toMatchObject({ status: 'failed' })
    expect(secondFetchAborted).toBe(true)
    if (!secondFetchAborted) {
      releaseSecondFetch(response({ code: 778, msg: 'test cleanup' }, 503))
    }
    await replacementRun
  })

  it('does not let a late callback invalidate the authorization recovered by the worker', async () => {
    const admin = await payload.findByID({
      collection: 'users',
      id: adminID,
      overrideAccess: true,
    })
    const started = await findOrCreateFeishuAppRegistration({ payload, user: admin })
    registrationIDs.add(started.registration.id)
    await runFeishuAppRegistration({
      fetch: vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValueOnce(response({ code: 0, tenant_access_token: 'tenant-late-token' }))
        .mockResolvedValueOnce(response({ code: 0 })),
      payload,
      register: vi.fn(async () => ({
        client_id: 'cli_late_callback_registration',
        client_secret: 'late-callback-secret-fixture',
      })) as never,
      registrationId: started.registration.id,
    })

    const authorizationReady = await payload.findByID({
      collection: 'feishu-app-registrations',
      depth: 0,
      id: started.registration.id,
      overrideAccess: true,
    })
    const states = await payload.find({
      collection: 'feishu-oauth-states',
      depth: 0,
      limit: 20,
      overrideAccess: true,
      where: {
        and: [{ registration: { equals: started.registration.id } }, { usedAt: { exists: false } }],
      },
    })
    const state = states.docs[0]
    if (!state) throw new Error('Expected authorization state')
    let markTokenRequestStarted!: () => void
    let releaseTokenRequest!: (value: Response) => void
    const tokenRequestStarted = new Promise<void>((resolve) => {
      markTokenRequestStarted = resolve
    })
    const tokenResponse = new Promise<Response>((resolve) => {
      releaseTokenRequest = resolve
    })
    const slowOAuthFetch = vi.fn<typeof globalThis.fetch>(async (input) => {
      if (String(input).includes('/oauth/v3/token')) {
        markTokenRequestStarted()
        return tokenResponse
      }
      return response({
        code: 0,
        data: {
          name: 'Late Callback',
          open_id: `open-late-${suffix}`,
          tenant_key: `late-${suffix}`,
        },
      })
    })
    vi.stubGlobal('fetch', slowOAuthFetch)

    const stateURL = new URL(authorizationReady.authorizeUrl!).searchParams.get('state')
    if (!stateURL) throw new Error('Expected authorization state URL')
    const callbackPromise = feishuCallback(
      new NextRequest(
        `http://localhost/api/integrations/feishu/callback?state=${stateURL}&code=late-code`,
      ),
    )
    await tokenRequestStarted

    const staleAt = new Date(
      Date.now() - FEISHU_OAUTH_CALLBACK_PROCESSING_TTL_MS - 1_000,
    ).toISOString()
    await payload.update({
      collection: 'feishu-oauth-states',
      context,
      data: { processingAt: staleAt },
      id: state.id,
      overrideAccess: true,
    })
    expect(await recoverStaleFeishuOAuthCallbacks({ payload })).toBe(1)
    const recoveredRegistration = await payload.findByID({
      collection: 'feishu-app-registrations',
      depth: 0,
      id: started.registration.id,
      overrideAccess: true,
    })
    const recoveredAuthorizationURL = recoveredRegistration.authorizeUrl
    releaseTokenRequest(
      response({
        access_token: 'late-access',
        code: 0,
        expires_in: 7_200,
        refresh_token: 'late-refresh',
        refresh_token_expires_in: 604_800,
        scope: 'auth:user.id:read bitable:app offline_access',
      }),
    )
    const lateCallback = await callbackPromise
    expect(lateCallback).toMatchObject({ status: 302 })
    expect(lateCallback.headers.get('location')).toContain('feishu=failed')
    await expect(
      payload.findByID({
        collection: 'feishu-app-registrations',
        depth: 0,
        id: started.registration.id,
        overrideAccess: true,
      }),
    ).resolves.toMatchObject({
      authorizeUrl: recoveredAuthorizationURL,
      status: 'authorization_ready',
    })
    await completeFeishuAppRegistration(payload, started.registration.id)
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
    const callbackResults = await Promise.all([
      feishuCallback(callbackRequest()),
      feishuCallback(callbackRequest()),
    ])
    expect(callbackResults.map((result) => result.status)).toEqual([302, 302])
    expect(callbackResults.map((result) => result.headers.get('location')).sort()).toEqual([
      expect.stringContaining('feishu=invalid_state'),
      expect.stringContaining('feishu=provisioning'),
    ])
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

    await payload.delete({
      collection: 'jobs',
      id: callbackJobID,
      overrideAccess: true,
    })
    jobIDs.delete(callbackJobID)
    await expect(enqueuePendingFeishuConnectionProvisionJobs({ payload })).resolves.toEqual({
      created: 1,
      duplicate: 0,
    })
    const recoveredJobs = await payload.find({
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
    expect(recoveredJobs.totalDocs).toBe(1)
    callbackJobID = recoveredJobs.docs[0]!.id
    jobIDs.add(callbackJobID)

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

    const crossOriginDisconnect = await feishuDisconnect(
      new NextRequest('http://localhost/api/integrations/feishu/disconnect', {
        body: JSON.stringify({ connectionId: callbackConnectionID }),
        headers: {
          authorization,
          'content-type': 'application/json',
          origin: 'https://attacker.example.invalid',
        },
        method: 'POST',
      }),
    )
    expect(crossOriginDisconnect.status).toBe(403)

    const admin = await payload.findByID({
      collection: 'users',
      depth: 0,
      id: adminID,
      overrideAccess: true,
    })
    await expect(
      disconnectFeishuConnection({
        connectionId: callbackConnectionID,
        payload,
        updateMapping: async () => {
          throw new Error('injected mapping update failure')
        },
        user: admin,
      }),
    ).rejects.toThrow('injected mapping update failure')
    await expect(
      payload.findByID({
        collection: 'feishu-connections',
        depth: 0,
        id: callbackConnectionID,
        overrideAccess: true,
      }),
    ).resolves.toMatchObject({ status: 'connected' })
    await expect(
      payload.findByID({
        collection: 'feishu-mappings',
        depth: 0,
        id: mappings.docs[0]!.id,
        overrideAccess: true,
      }),
    ).resolves.toMatchObject({ status: 'active' })

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
      appId: null,
      appSecretEncrypted: null,
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

  it.each([20024, 20026])(
    'marks refresh token error %s as reconnect_required in a committed transaction',
    async (code) => {
      const fixture = await connectionFixture(`refresh-${code}-${randomUUID()}`)
      const fetch = vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValue(response({ code, error: 'refresh token invalid fixture' }, 400))
      const provider = new PayloadFeishuTokenProvider({
        connectionId: fixture.connection.id,
        fetch,
        payload,
      })

      await expect(provider.getToken('base', undefined, true)).rejects.toMatchObject({ code })
      await expect(
        payload.findByID({
          collection: 'feishu-connections',
          depth: 0,
          id: fixture.connection.id,
          overrideAccess: true,
        }),
      ).resolves.toMatchObject({ lastErrorCode: String(code), status: 'reconnect_required' })
      await payload.delete({
        collection: 'jobs',
        context,
        id: fixture.job.id,
        overrideAccess: true,
      })
    },
  )

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
