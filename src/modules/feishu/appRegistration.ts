import { registerApp } from '@larksuiteoapi/node-sdk'
import { sql, type PostgresAdapter } from '@payloadcms/db-postgres'
import {
  commitTransaction,
  createLocalReq,
  initTransaction,
  killTransaction,
  NotFound,
  type Payload,
  type PayloadRequest,
} from 'payload'

import type { FeishuAppRegistration, FeishuOauthState, User } from '@/payload-types'

import { FeishuApiError, FeishuConfigurationError } from './contracts'
import {
  decryptFeishuCredential,
  encryptFeishuCredential,
  readFeishuCredentialEncryptionKey,
} from './credentials'
import { buildFeishuAuthorizeURL, createOAuthAttempt } from './oauth'

type FetchLike = typeof fetch
type JsonRecord = Record<string, unknown>

export const FEISHU_QR_REGISTRATION_TTL_MS = 10 * 60 * 1_000
export const FEISHU_APP_CONFIG_PROPAGATION_DELAY_MS = 3_000
export const FEISHU_APP_CONFIG_REQUEST_TIMEOUT_MS = 30_000
export const FEISHU_APP_CONFIGURATION_TTL_MS =
  FEISHU_APP_CONFIG_REQUEST_TIMEOUT_MS * 2 + FEISHU_APP_CONFIG_PROPAGATION_DELAY_MS + 5_000
export const FEISHU_OAUTH_CALLBACK_PROCESSING_TTL_MS = 2 * 60_000
export const FEISHU_OAUTH_CALLBACK_RECOVERY_INTERVAL_MS = 30_000
export const FEISHU_REGISTER_APP_BEGIN_TIMEOUT_MS = 30_000
export const FEISHU_OAUTH_CALLBACK_PATH = '/api/integrations/feishu/callback'
export const FEISHU_QR_TENANT_SCOPES = [
  'application:application:patch',
  'im:message:send_as_bot',
] as const
export const FEISHU_QR_USER_SCOPES = ['auth:user.id:read', 'bitable:app', 'offline_access'] as const

export type FeishuRegisterAppResult = {
  client_id: string
  client_secret: string
  user_info?: { open_id?: string; tenant_brand?: 'feishu' | 'lark' }
}

export type FeishuRegisterAppPort = (options: {
  addons: {
    preset: false
    scopes: { tenant: string[]; user: string[] }
  }
  appPreset: { desc: string; name: string }
  createOnly: true
  onQRCodeReady: (info: { expireIn: number; url: string }) => void
  onStatusChange: (info: {
    interval?: number
    status: 'domain_switched' | 'polling' | 'slow_down'
  }) => void
  signal: AbortSignal
  source: string
}) => Promise<FeishuRegisterAppResult>

export const buildFeishuRegisterAppOptions = ({
  onQRCodeReady,
  signal,
}: {
  onQRCodeReady: (info: { expireIn: number; url: string }) => void
  signal: AbortSignal
}): Parameters<FeishuRegisterAppPort>[0] => ({
  addons: {
    preset: false,
    scopes: {
      tenant: [...FEISHU_QR_TENANT_SCOPES],
      user: [...FEISHU_QR_USER_SCOPES],
    },
  },
  appPreset: {
    desc: 'IVYBM 客户线索、飞书多维表格与销售提醒',
    name: 'IVYBM CRM - {user}',
  },
  createOnly: true,
  onQRCodeReady,
  onStatusChange: () => undefined,
  signal,
  source: 'ivybm-crm',
})

export type FeishuRegistrationDTO = {
  authorizeExpiresAt: null | string
  authorizeURL: null | string
  id: number
  lastErrorCode: null | string
  qrExpiresAt: null | string
  qrURL: null | string
  status: FeishuAppRegistration['status']
}

const registrationProcesses = new Map<number, AbortController>()

const withLockedRegistration = async <T>({
  payload,
  registrationId,
  run,
}: {
  payload: Payload
  registrationId: number
  run: (registration: FeishuAppRegistration, req: PayloadRequest) => Promise<T>
}): Promise<T> => {
  const req = await createLocalReq({}, payload)
  await initTransaction(req)
  try {
    const transactionID = await req.transactionID
    const adapter = payload.db as unknown as PostgresAdapter
    const database = transactionID ? adapter.sessions[transactionID]?.db : undefined
    if (!database) {
      throw new FeishuConfigurationError('Feishu registration transaction is unavailable')
    }
    await database.execute(sql`
      SELECT "id" FROM "feishu_app_registrations" WHERE "id" = ${registrationId} FOR UPDATE
    `)
    const registration = await payload.findByID({
      collection: 'feishu-app-registrations',
      depth: 0,
      id: registrationId,
      overrideAccess: true,
      req,
    })
    const result = await run(registration, req)
    await commitTransaction(req)
    return result
  } catch (error) {
    await killTransaction(req).catch(() => undefined)
    throw error
  }
}

const withLockedOAuthState = async <T>({
  payload,
  run,
  stateId,
}: {
  payload: Payload
  run: (state: FeishuOauthState, req: PayloadRequest) => Promise<T>
  stateId: number
}): Promise<T> => {
  const req = await createLocalReq({}, payload)
  await initTransaction(req)
  try {
    const transactionID = await req.transactionID
    const adapter = payload.db as unknown as PostgresAdapter
    const database = transactionID ? adapter.sessions[transactionID]?.db : undefined
    if (!database) {
      throw new FeishuConfigurationError('Feishu OAuth state transaction is unavailable')
    }
    await database.execute(sql`
      SELECT "id" FROM "feishu_oauth_states" WHERE "id" = ${stateId} FOR UPDATE
    `)
    const state = await payload.findByID({
      collection: 'feishu-oauth-states',
      depth: 0,
      id: stateId,
      overrideAccess: true,
      req,
    })
    const result = await run(state, req)
    await commitTransaction(req)
    return result
  } catch (error) {
    await killTransaction(req).catch(() => undefined)
    throw error
  }
}

const findLockedOAuthState = async ({
  payload,
  req,
  stateId,
}: {
  payload: Payload
  req: PayloadRequest
  stateId: number
}): Promise<FeishuOauthState> => {
  const transactionID = await req.transactionID
  const adapter = payload.db as unknown as PostgresAdapter
  const database = transactionID ? adapter.sessions[transactionID]?.db : undefined
  if (!database) {
    throw new FeishuConfigurationError('Feishu OAuth state transaction is unavailable')
  }
  await database.execute(sql`
    SELECT "id" FROM "feishu_oauth_states" WHERE "id" = ${stateId} FOR UPDATE
  `)
  return payload.findByID({
    collection: 'feishu-oauth-states',
    depth: 0,
    id: stateId,
    overrideAccess: true,
    req,
  })
}

export const clearFeishuOAuthStateProcessing = (
  payload: Payload,
  stateId: number,
): Promise<FeishuOauthState> =>
  withLockedOAuthState({
    payload,
    run: (state, req) => {
      if (!state.processingAt) return Promise.resolve(state)
      return payload.update({
        collection: 'feishu-oauth-states',
        data: { processingAt: null },
        id: state.id,
        overrideAccess: true,
        req,
      })
    },
    stateId,
  })

const updateLockedRegistration = (
  payload: Payload,
  registrationId: number,
  data: Record<string, unknown>,
): Promise<FeishuAppRegistration> =>
  withLockedRegistration({
    payload,
    registrationId,
    run: (registration, req) =>
      payload.update({
        collection: 'feishu-app-registrations',
        data,
        id: registration.id,
        overrideAccess: true,
        req,
      }),
  })

const completeFeishuAppRegistrationLocked = ({
  payload,
  registration,
  req,
}: {
  payload: Payload
  registration: FeishuAppRegistration
  req: PayloadRequest
}): Promise<FeishuAppRegistration> => {
  if (registration.status === 'completed') return Promise.resolve(registration)
  if (registration.status !== 'authorization_ready') {
    throw new FeishuConfigurationError('Feishu registration cannot be completed')
  }
  return payload.update({
    collection: 'feishu-app-registrations',
    data: {
      appSecretEncrypted: null,
      authorizeUrl: null,
      completedAt: new Date().toISOString(),
      lastErrorCode: null,
      status: 'completed',
    },
    id: registration.id,
    overrideAccess: true,
    req,
  })
}

export const completeFeishuAppRegistration = (
  payload: Payload,
  registrationId: number,
): Promise<FeishuAppRegistration> =>
  withLockedRegistration({
    payload,
    registrationId,
    run: (registration, req) => completeFeishuAppRegistrationLocked({ payload, registration, req }),
  })

export const completeFeishuAppRegistrationInTransaction = async ({
  payload,
  registrationId,
  req,
}: {
  payload: Payload
  registrationId: number
  req: PayloadRequest
}): Promise<FeishuAppRegistration> => {
  const transactionID = await req.transactionID
  const adapter = payload.db as unknown as PostgresAdapter
  const database = transactionID ? adapter.sessions[transactionID]?.db : undefined
  if (!database) {
    throw new FeishuConfigurationError('Feishu registration transaction is unavailable')
  }
  await database.execute(sql`
    SELECT "id" FROM "feishu_app_registrations" WHERE "id" = ${registrationId} FOR UPDATE
  `)
  const registration = await payload.findByID({
    collection: 'feishu-app-registrations',
    depth: 0,
    id: registrationId,
    overrideAccess: true,
    req,
  })
  return completeFeishuAppRegistrationLocked({ payload, registration, req })
}

export const failFeishuAppRegistrationOAuth = (
  payload: Payload,
  registrationId: number,
): Promise<FeishuAppRegistration> =>
  withLockedRegistration({
    payload,
    registrationId,
    run: (registration, req) => {
      if (registration.status === 'completed') return Promise.resolve(registration)
      if (registration.status !== 'authorization_ready' && registration.status !== 'failed') {
        throw new FeishuConfigurationError('Feishu registration cannot record OAuth failure')
      }
      return payload.update({
        collection: 'feishu-app-registrations',
        data: { lastErrorCode: 'oauth_failed', status: 'failed' },
        id: registration.id,
        overrideAccess: true,
        req,
      })
    },
  })

const prepareFeishuAuthorizationLocked = async ({
  clock = () => new Date(),
  lastErrorCode = null,
  payload,
  processingStateId,
  registration,
  req,
  validStatuses,
}: {
  clock?: () => Date
  lastErrorCode?: null | string
  payload: Payload
  processingStateId?: number
  registration: FeishuAppRegistration
  req: PayloadRequest
  validStatuses: FeishuAppRegistration['status'][]
}): Promise<FeishuAppRegistration> => {
  if (!validStatuses.includes(registration.status)) {
    throw new FeishuConfigurationError('Feishu registration cannot start authorization')
  }
  if (processingStateId !== undefined) {
    // A late callback carries its old state ID. Once recovery clears that marker,
    // it must not restart or invalidate the newer authorization state.
    let processingState: FeishuOauthState | null
    try {
      processingState = await findLockedOAuthState({ payload, req, stateId: processingStateId })
    } catch (error) {
      if (!(error instanceof NotFound)) throw error
      processingState = null
    }
    if (!processingState?.usedAt || !processingState.processingAt) return registration
  }
  const attempt = createOAuthAttempt(clock)
  const requestedBy = relationshipID(registration.requestedBy)
  if (!requestedBy || !registration.appId) {
    throw new FeishuConfigurationError('Feishu registration owner or App ID is missing')
  }
  const priorStates = await payload.find({
    collection: 'feishu-oauth-states',
    depth: 0,
    limit: 100,
    overrideAccess: true,
    req,
    where: {
      and: [
        { registration: { equals: registration.id } },
        {
          or: [
            { usedAt: { exists: false } },
            ...(processingStateId === undefined ? [] : [{ id: { equals: processingStateId } }]),
          ],
        },
      ],
    },
  })
  const invalidatedAt = clock().toISOString()
  for (const priorState of priorStates.docs) {
    await payload.update({
      collection: 'feishu-oauth-states',
      data: {
        ...(priorState.usedAt ? {} : { usedAt: invalidatedAt }),
        processingAt: null,
      },
      id: priorState.id,
      overrideAccess: true,
      req,
    })
  }
  await payload.create({
    collection: 'feishu-oauth-states',
    data: {
      expiresAt: attempt.expiresAt,
      registration: registration.id,
      requestedBy,
      stateHash: attempt.stateHash,
      verifierEncrypted: encryptFeishuCredential(
        attempt.verifier,
        readFeishuCredentialEncryptionKey(),
      ),
    },
    overrideAccess: true,
    req,
  })
  return payload.update({
    collection: 'feishu-app-registrations',
    data: {
      authorizeExpiresAt: attempt.expiresAt,
      authorizeUrl: buildFeishuAuthorizeURL({
        appId: registration.appId,
        redirectURI: requireRedirectURI(),
        state: attempt.state,
      }),
      lastErrorCode,
      qrExpiresAt: null,
      configuringStartedAt: null,
      status: 'authorization_ready',
    },
    id: registration.id,
    overrideAccess: true,
    req,
  })
}

const prepareFeishuAuthorization = ({
  clock = () => new Date(),
  lastErrorCode = null,
  payload,
  processingStateId,
  registrationId,
  validStatuses,
}: {
  clock?: () => Date
  lastErrorCode?: null | string
  payload: Payload
  processingStateId?: number
  registrationId: number
  validStatuses: FeishuAppRegistration['status'][]
}): Promise<FeishuAppRegistration> =>
  withLockedRegistration({
    payload,
    registrationId,
    run: (registration, req) =>
      prepareFeishuAuthorizationLocked({
        clock,
        lastErrorCode,
        payload,
        processingStateId,
        registration,
        req,
        validStatuses,
      }),
  })

export const restartFeishuAppAuthorization = (
  payload: Payload,
  registrationId: number,
  lastErrorCode = 'oauth_failed',
  processingStateId?: number,
): Promise<FeishuAppRegistration> =>
  prepareFeishuAuthorization({
    lastErrorCode,
    payload,
    processingStateId,
    registrationId,
    validStatuses: ['authorization_ready', 'failed'],
  })

const refreshFeishuAppAuthorization = (
  payload: Payload,
  registrationId: number,
): Promise<FeishuAppRegistration> =>
  prepareFeishuAuthorization({
    payload,
    registrationId,
    validStatuses: ['authorization_ready'],
  })

const record = (value: unknown): JsonRecord | undefined =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonRecord) : undefined

const string = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined

const number = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined

const relationshipID = (value: unknown): number | undefined => {
  if (typeof value === 'number') return value
  const relation = record(value)
  return typeof relation?.id === 'number' ? relation.id : undefined
}

const isStaleOAuthCallbackProcessing = (state: FeishuOauthState, now: Date): boolean => {
  if (!state.usedAt || !state.processingAt) return false
  const processingStartedAt = Date.parse(state.processingAt)
  return (
    !Number.isFinite(processingStartedAt) ||
    processingStartedAt + FEISHU_OAUTH_CALLBACK_PROCESSING_TTL_MS <= now.getTime()
  )
}

const recoverStaleRegisteredOAuthState = async ({
  clock,
  now,
  payload,
  registrationId,
  stateId,
}: {
  clock: () => Date
  now: Date
  payload: Payload
  registrationId: number
  stateId: number
}): Promise<boolean> =>
  withLockedRegistration({
    payload,
    registrationId,
    run: async (registration, req) => {
      const state = await findLockedOAuthState({ payload, req, stateId })
      if (!isStaleOAuthCallbackProcessing(state, now)) return false

      if (registration.status === 'authorization_ready' || registration.status === 'failed') {
        await prepareFeishuAuthorizationLocked({
          clock,
          lastErrorCode: 'oauth_callback_stale',
          payload,
          processingStateId: state.id,
          registration,
          req,
          validStatuses: [registration.status],
        })
      } else {
        await payload.update({
          collection: 'feishu-oauth-states',
          data: { processingAt: null },
          id: state.id,
          overrideAccess: true,
          req,
        })
      }
      return true
    },
  })

export const recoverStaleFeishuOAuthCallbacks = async ({
  clock = () => new Date(),
  payload,
}: {
  clock?: () => Date
  payload: Payload
}): Promise<number> => {
  const now = clock()
  const states = await payload.find({
    collection: 'feishu-oauth-states',
    depth: 0,
    limit: 1_000,
    overrideAccess: true,
    pagination: false,
    where: { processingAt: { exists: true } },
  })
  let recovered = 0
  for (const state of states.docs) {
    if (!isStaleOAuthCallbackProcessing(state, now)) continue
    const registrationId = relationshipID(state.registration)
    try {
      if (registrationId) {
        if (
          await recoverStaleRegisteredOAuthState({
            clock,
            now,
            payload,
            registrationId,
            stateId: state.id,
          })
        ) {
          recovered += 1
        }
      } else {
        await clearFeishuOAuthStateProcessing(payload, state.id)
        recovered += 1
      }
    } catch {
      payload.logger.error('Stale Feishu OAuth callback recovery failed')
    }
  }
  return recovered
}

const requireRedirectURI = (
  environment: Record<string, string | undefined> = process.env,
): string => {
  const value = environment.FEISHU_OAUTH_REDIRECT_URI?.trim()
  if (!value) throw new FeishuConfigurationError('FEISHU_OAUTH_REDIRECT_URI is required')
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new FeishuConfigurationError('FEISHU_OAUTH_REDIRECT_URI must be an absolute URL')
  }
  if (environment.NODE_ENV === 'production' && url.protocol !== 'https:') {
    throw new FeishuConfigurationError('Feishu OAuth redirect URI must use HTTPS in production')
  }
  return url.toString()
}

export const preflightFeishuQRRegistrationConfiguration = (
  environment: Record<string, string | undefined> = process.env,
): void => {
  const redirectURI = requireRedirectURI(environment)
  const publicServerURL = environment.NEXT_PUBLIC_SERVER_URL?.trim()
  if (!publicServerURL) {
    throw new FeishuConfigurationError('NEXT_PUBLIC_SERVER_URL is required')
  }

  let expectedRedirectURI: string
  try {
    const serverURL = new URL(publicServerURL)
    if (!['http:', 'https:'].includes(serverURL.protocol)) {
      throw new Error('invalid protocol')
    }
    expectedRedirectURI = new URL(FEISHU_OAUTH_CALLBACK_PATH, serverURL).toString()
  } catch {
    throw new FeishuConfigurationError('NEXT_PUBLIC_SERVER_URL must be an absolute HTTP(S) URL')
  }
  if (redirectURI !== expectedRedirectURI) {
    throw new FeishuConfigurationError(
      'FEISHU_OAUTH_REDIRECT_URI must match the canonical Feishu callback',
    )
  }
  readFeishuCredentialEncryptionKey(environment)
}

const validatedFeishuQRURL = (value: string): string => {
  const url = new URL(value)
  const hostname = url.hostname.toLowerCase()
  const allowed =
    hostname === 'feishu.cn' ||
    hostname.endsWith('.feishu.cn') ||
    hostname === 'larksuite.com' ||
    hostname.endsWith('.larksuite.com')
  if (url.protocol !== 'https:' || !allowed) {
    throw new FeishuConfigurationError('Feishu registration QR URL is invalid')
  }
  return url.toString()
}

export const isFeishuQRRegistrationEnabled = (
  env: Record<string, string | undefined> = process.env,
): boolean => env.FEISHU_QR_REGISTRATION_ENABLED === 'true'

const registrationDTO = (registration: FeishuAppRegistration): FeishuRegistrationDTO => ({
  authorizeExpiresAt: registration.authorizeExpiresAt ?? null,
  authorizeURL: registration.authorizeUrl ?? null,
  id: registration.id,
  lastErrorCode: registration.lastErrorCode ?? null,
  qrExpiresAt: registration.qrExpiresAt ?? null,
  qrURL: registration.qrUrl ?? null,
  status: registration.status,
})

export const activeRegistrationExpired = (
  registration: FeishuAppRegistration,
  now: Date,
): boolean => {
  if (registration.status === 'authorization_ready') {
    return (
      !registration.authorizeExpiresAt ||
      Date.parse(registration.authorizeExpiresAt) <= now.getTime()
    )
  }
  if (registration.status === 'qr_ready') {
    return !registration.qrExpiresAt || Date.parse(registration.qrExpiresAt) <= now.getTime()
  }
  if (registration.status === 'configuring') {
    const configuringStartedAt = registration.configuringStartedAt ?? registration.updatedAt
    const configuringStartedAtMs = configuringStartedAt ? Date.parse(configuringStartedAt) : NaN
    return (
      !Number.isFinite(configuringStartedAtMs) ||
      configuringStartedAtMs + FEISHU_APP_CONFIGURATION_TTL_MS <= now.getTime()
    )
  }
  return Date.parse(registration.createdAt) + FEISHU_QR_REGISTRATION_TTL_MS <= now.getTime()
}

export const findOrCreateFeishuAppRegistration = async ({
  clock = () => new Date(),
  payload,
  user,
}: {
  clock?: () => Date
  payload: Payload
  user: User
}): Promise<{ created: boolean; registration: FeishuAppRegistration }> => {
  const req = await createLocalReq({ user }, payload)
  await initTransaction(req)
  try {
    const transactionID = await req.transactionID
    const adapter = payload.db as unknown as PostgresAdapter
    const database = transactionID ? adapter.sessions[transactionID]?.db : undefined
    if (!database) {
      throw new FeishuConfigurationError('Feishu registration transaction is unavailable')
    }
    await database.execute(sql`SELECT pg_advisory_xact_lock(74110511)`)
    const active = await payload.find({
      collection: 'feishu-app-registrations',
      depth: 0,
      limit: 1,
      overrideAccess: true,
      req,
      sort: '-createdAt',
      where: {
        status: {
          in: [
            'pending',
            'registering',
            'qr_ready',
            'configuring',
            'authorization_ready',
            'failed',
          ],
        },
      },
    })
    const existing = active.docs[0]
    const recoverableConfiguration =
      existing &&
      (existing.status === 'configuring' || existing.status === 'failed') &&
      typeof existing.appId === 'string' &&
      typeof existing.appSecretEncrypted === 'string'
    const staleConfiguration =
      existing?.status === 'configuring' && activeRegistrationExpired(existing, clock())
    if (recoverableConfiguration && !staleConfiguration) {
      await commitTransaction(req)
      return { created: false, registration: existing }
    }
    if (staleConfiguration) {
      const stale = await payload.update({
        collection: 'feishu-app-registrations',
        data: { lastErrorCode: 'registration_stale', status: 'failed' },
        id: existing.id,
        overrideAccess: true,
        req,
      })
      await commitTransaction(req)
      return { created: false, registration: stale }
    }
    if (existing && !activeRegistrationExpired(existing, clock())) {
      await commitTransaction(req)
      return { created: false, registration: existing }
    }
    if (existing) {
      if (existing.status === 'authorization_ready') {
        const refreshed = await prepareFeishuAuthorizationLocked({
          clock,
          payload,
          registration: existing,
          req,
          validStatuses: ['authorization_ready'],
        })
        await commitTransaction(req)
        return { created: false, registration: refreshed }
      }
      await payload.update({
        collection: 'feishu-app-registrations',
        data: { lastErrorCode: 'registration_expired', status: 'expired' },
        id: existing.id,
        overrideAccess: true,
        req,
      })
    }
    const registration = await payload.create({
      collection: 'feishu-app-registrations',
      data: { requestedBy: user.id, status: 'pending' },
      overrideAccess: true,
      req,
    })
    await commitTransaction(req)
    return { created: true, registration }
  } catch (error) {
    await killTransaction(req).catch(() => undefined)
    throw error
  }
}

const readFeishuJSON = async (response: Response, signal: AbortSignal): Promise<JsonRecord> => {
  try {
    return record(await response.json()) ?? {}
  } catch (error) {
    if (signal.aborted) throw error
    return {}
  }
}

const withFeishuRequestTimeout = async <T>({
  operation,
  signal: externalSignal,
  timeoutMs,
}: {
  operation: (signal: AbortSignal) => Promise<T>
  signal?: AbortSignal
  timeoutMs: number
}): Promise<T> => {
  const timeoutController = new AbortController()
  const signal = externalSignal
    ? AbortSignal.any([timeoutController.signal, externalSignal])
    : timeoutController.signal

  return await new Promise<T>((resolve, reject) => {
    let settled = false
    const finish = (callback: () => void): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      externalSignal?.removeEventListener('abort', onExternalAbort)
      callback()
    }
    const onExternalAbort = (): void => {
      finish(() => {
        const reason = externalSignal?.reason
        if (reason instanceof Error && 'code' in reason) {
          reject(reason)
          return
        }
        reject(
          Object.assign(new Error('Feishu registration request was aborted'), { code: 'abort' }),
        )
      })
    }
    const timer = setTimeout(() => {
      timeoutController.abort()
      finish(() =>
        reject(
          new FeishuApiError({
            code: 'timeout',
            message: 'Feishu registration request timed out',
            retryable: true,
          }),
        ),
      )
    }, timeoutMs)
    externalSignal?.addEventListener('abort', onExternalAbort, { once: true })
    if (externalSignal?.aborted) {
      onExternalAbort()
      return
    }

    operation(signal).then(
      (value) => finish(() => resolve(value)),
      (error: unknown) => {
        if (externalSignal?.aborted) {
          onExternalAbort()
          return
        }
        finish(() => reject(error))
      },
    )
  })
}

const feishuAbortError = (): FeishuApiError =>
  new FeishuApiError({
    code: 'abort',
    message: 'Feishu registration request was aborted',
    retryable: true,
  })

export const runBoundedFeishuRegisterApp = async ({
  onBeginTimeout,
  options,
  register,
  signal,
  timeoutMs = FEISHU_REGISTER_APP_BEGIN_TIMEOUT_MS,
}: {
  onBeginTimeout?: () => void
  options: Parameters<FeishuRegisterAppPort>[0]
  register: FeishuRegisterAppPort
  signal: AbortSignal
  timeoutMs?: number
}): Promise<FeishuRegisterAppResult> => {
  if (signal.aborted) throw feishuAbortError()

  let qrReady = false
  let beginTimer: ReturnType<typeof setTimeout> | undefined
  let removeAbortListener: (() => void) | undefined
  const registerPromise = Promise.resolve().then(() =>
    register({
      ...options,
      onQRCodeReady: (info) => {
        qrReady = true
        if (beginTimer) clearTimeout(beginTimer)
        options.onQRCodeReady(info)
      },
    }),
  )
  const beginWatchdog = new Promise<never>((_, reject) => {
    beginTimer = setTimeout(() => {
      if (qrReady) return
      reject(
        new FeishuApiError({
          code: 'timeout',
          message: 'Feishu app registration begin request timed out',
          retryable: true,
        }),
      )
      onBeginTimeout?.()
    }, timeoutMs)
  })
  const externalAbort = new Promise<never>((_, reject) => {
    const onAbort = (): void => reject(feishuAbortError())
    signal.addEventListener('abort', onAbort, { once: true })
    removeAbortListener = () => signal.removeEventListener('abort', onAbort)
  })

  try {
    return await Promise.race([registerPromise, beginWatchdog, externalAbort])
  } finally {
    if (beginTimer) clearTimeout(beginTimer)
    removeAbortListener?.()
    void registerPromise.catch(() => undefined)
  }
}

const settleFeishuAppConfiguration = async ({
  delay,
  settle,
  signal,
}: {
  delay: number
  settle: (delay: number) => Promise<void>
  signal?: AbortSignal
}): Promise<void> => {
  if (!signal) {
    await settle(delay)
    return
  }
  if (signal.aborted) throw feishuAbortError()

  await new Promise<void>((resolve, reject) => {
    let settled = false
    const finish = (callback: () => void): void => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', onAbort)
      callback()
    }
    const onAbort = (): void => finish(() => reject(feishuAbortError()))
    signal.addEventListener('abort', onAbort, { once: true })
    settle(delay).then(
      () => finish(resolve),
      (error: unknown) => finish(() => reject(error)),
    )
  })
}

const requestTenantToken = async ({
  appId,
  appSecret,
  fetch: fetchImpl,
  signal,
  timeoutMs,
}: {
  appId: string
  appSecret: string
  fetch: FetchLike
  signal?: AbortSignal
  timeoutMs: number
}): Promise<string> => {
  const { body, response } = await withFeishuRequestTimeout({
    operation: async (requestSignal) => {
      const response = await fetchImpl(
        'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal',
        {
          body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
          headers: { 'content-type': 'application/json; charset=utf-8' },
          method: 'POST',
          signal: requestSignal,
        },
      )
      return { body: await readFeishuJSON(response, requestSignal), response }
    },
    signal,
    timeoutMs,
  })
  const token = string(body.tenant_access_token)
  if (!response.ok || number(body.code) !== 0 || !token) {
    throw new FeishuApiError({
      code: number(body.code) ?? response.status,
      message: 'Feishu registration tenant token request failed',
      retryable: response.status >= 500,
      status: response.status,
    })
  }
  return token
}

export const configureRegisteredFeishuApp = async ({
  appId,
  appSecret,
  fetch: fetchImpl = globalThis.fetch,
  redirectURI = requireRedirectURI(),
  settle = (delay) => new Promise((resolve) => setTimeout(resolve, delay)),
  signal,
  timeoutMs = FEISHU_APP_CONFIG_REQUEST_TIMEOUT_MS,
}: {
  appId: string
  appSecret: string
  fetch?: FetchLike
  redirectURI?: string
  settle?: (delay: number) => Promise<void>
  signal?: AbortSignal
  timeoutMs?: number
}): Promise<void> => {
  const tenantToken = await requestTenantToken({
    appId,
    appSecret,
    fetch: fetchImpl,
    signal,
    timeoutMs,
  })
  const { body, response } = await withFeishuRequestTimeout({
    operation: async (requestSignal) => {
      const response = await fetchImpl(
        `https://open.feishu.cn/open-apis/application/v7/applications/${encodeURIComponent(appId)}/config`,
        {
          body: JSON.stringify({
            security: {
              add: { redirect_urls: [redirectURI] },
              allow_refresh_token: true,
            },
          }),
          headers: {
            authorization: `Bearer ${tenantToken}`,
            'content-type': 'application/json; charset=utf-8',
          },
          method: 'PATCH',
          signal: requestSignal,
        },
      )
      return { body: await readFeishuJSON(response, requestSignal), response }
    },
    signal,
    timeoutMs,
  })
  if (!response.ok || number(body.code) !== 0) {
    throw new FeishuApiError({
      code: number(body.code) ?? response.status,
      message: 'Feishu registered app configuration failed',
      retryable: response.status >= 500 || response.status === 429,
      status: response.status,
    })
  }
  await settleFeishuAppConfiguration({
    delay: FEISHU_APP_CONFIG_PROPAGATION_DELAY_MS,
    settle,
    signal,
  })
}

const registrationErrorCode = (error: unknown): string => {
  const code = string(record(error)?.code)
  if (code === 'access_denied') return 'registration_denied'
  if (code === 'expired_token') return 'registration_expired'
  if (code === 'abort') return 'registration_cancelled'
  if (error instanceof FeishuApiError && error.code === 'timeout') return 'registration_timeout'
  if (error instanceof FeishuApiError) return `provider_${String(error.code)}`.slice(0, 120)
  if (error instanceof FeishuConfigurationError) return 'registration_configuration_invalid'
  return 'registration_failed'
}

const registrationFailureStatus = (
  code: string,
): Extract<FeishuAppRegistration['status'], 'cancelled' | 'expired' | 'failed'> =>
  code === 'registration_expired'
    ? 'expired'
    : code === 'registration_cancelled'
      ? 'cancelled'
      : 'failed'

export const runFeishuAppRegistration = async ({
  clock = () => new Date(),
  fetch: fetchImpl = globalThis.fetch,
  payload,
  register = registerApp as FeishuRegisterAppPort,
  registrationId,
}: {
  clock?: () => Date
  fetch?: FetchLike
  payload: Payload
  register?: FeishuRegisterAppPort
  registrationId: number
}): Promise<void> => {
  const controller = registrationProcesses.get(registrationId) ?? new AbortController()
  registrationProcesses.set(registrationId, controller)
  try {
    const claimed = await withLockedRegistration({
      payload,
      registrationId,
      run: async (registration, req) => {
        if (registration.status === 'pending') {
          await payload.update({
            collection: 'feishu-app-registrations',
            data: { lastErrorCode: null, status: 'registering' },
            id: registration.id,
            overrideAccess: true,
            req,
          })
          return { mode: 'register' as const }
        }
        if (
          (registration.status === 'configuring' || registration.status === 'failed') &&
          registration.appId &&
          registration.appSecretEncrypted
        ) {
          const appSecret = decryptFeishuCredential(
            registration.appSecretEncrypted,
            readFeishuCredentialEncryptionKey(),
          )
          if (registration.status === 'failed') {
            await payload.update({
              collection: 'feishu-app-registrations',
              data: {
                configuringStartedAt: clock().toISOString(),
                lastErrorCode: null,
                status: 'configuring',
              },
              id: registration.id,
              overrideAccess: true,
              req,
            })
          } else {
            await payload.update({
              collection: 'feishu-app-registrations',
              data: { configuringStartedAt: clock().toISOString() },
              id: registration.id,
              overrideAccess: true,
              req,
            })
          }
          return { appId: registration.appId, appSecret, mode: 'configure' as const }
        }
        return null
      },
    })
    if (!claimed) return

    let appId: string
    let appSecret: string
    if (claimed.mode === 'register') {
      let qrPersistence = Promise.resolve()
      const result = await runBoundedFeishuRegisterApp({
        onBeginTimeout: () => controller.abort(),
        options: buildFeishuRegisterAppOptions({
          onQRCodeReady: ({ expireIn, url }) => {
            const expiresAt = new Date(clock().getTime() + expireIn * 1_000).toISOString()
            const qrUrl = validatedFeishuQRURL(url)
            qrPersistence = qrPersistence.then(() =>
              withLockedRegistration({
                payload,
                registrationId,
                run: async (registration, req) => {
                  if (registration.status !== 'registering' && registration.status !== 'qr_ready') {
                    return
                  }
                  await payload.update({
                    collection: 'feishu-app-registrations',
                    data: {
                      lastErrorCode: null,
                      qrExpiresAt: expiresAt,
                      qrUrl,
                      status: 'qr_ready',
                    },
                    id: registration.id,
                    overrideAccess: true,
                    req,
                  })
                },
              }),
            )
            void qrPersistence.catch(() =>
              payload.logger.error('Feishu registration QR state could not be persisted'),
            )
          },
          signal: controller.signal,
        }),
        register,
        signal: controller.signal,
      })
      await qrPersistence
      appId = result.client_id?.trim()
      appSecret = result.client_secret?.trim()
      if (!appId || !appSecret) {
        throw new FeishuConfigurationError('Feishu registration response is incomplete')
      }
      const key = readFeishuCredentialEncryptionKey()
      await updateLockedRegistration(payload, registrationId, {
        appId,
        appSecretEncrypted: encryptFeishuCredential(appSecret, key),
        configuringStartedAt: clock().toISOString(),
        lastErrorCode: null,
        qrUrl: null,
        status: 'configuring',
      })
    } else {
      appId = claimed.appId
      appSecret = claimed.appSecret
    }
    await configureRegisteredFeishuApp({
      appId,
      appSecret,
      fetch: fetchImpl,
      signal: controller.signal,
    })

    if (controller.signal.aborted) throw feishuAbortError()
    await prepareFeishuAuthorization({
      clock,
      payload,
      registrationId,
      validStatuses: ['configuring'],
    })
  } catch (error) {
    const code = registrationErrorCode(error)
    await withLockedRegistration({
      payload,
      registrationId,
      run: (registration, req) => {
        if (
          registration.status === 'completed' ||
          registration.status === 'expired' ||
          registration.status === 'cancelled' ||
          (registration.status === 'failed' && registration.lastErrorCode === 'registration_stale')
        ) {
          return Promise.resolve(registration)
        }
        const hasRegisteredApp = Boolean(registration.appId && registration.appSecretEncrypted)
        return payload.update({
          collection: 'feishu-app-registrations',
          data: {
            ...(hasRegisteredApp ? {} : { appId: null, appSecretEncrypted: null }),
            authorizeUrl: null,
            lastErrorCode: code,
            qrUrl: null,
            status: registrationFailureStatus(code),
          },
          id: registration.id,
          overrideAccess: true,
          req,
        })
      },
    }).catch(() => payload.logger.error('Feishu registration failure state could not be persisted'))
  } finally {
    registrationProcesses.delete(registrationId)
  }
}

export const launchFeishuAppRegistration = (input: {
  payload: Payload
  registrationId: number
}): void => {
  if (registrationProcesses.has(input.registrationId)) return
  const controller = new AbortController()
  registrationProcesses.set(input.registrationId, controller)
  void runFeishuAppRegistration(input)
}

const expireActiveRegistrationIfStale = async ({
  now,
  payload,
  registrationId,
}: {
  now: Date
  payload: Payload
  registrationId: number
}): Promise<FeishuAppRegistration> => {
  let expired = false
  const registration = await withLockedRegistration({
    payload,
    registrationId,
    run: (latest, req) => {
      if (
        !['pending', 'registering', 'qr_ready', 'configuring'].includes(latest.status) ||
        !activeRegistrationExpired(latest, now)
      ) {
        return Promise.resolve(latest)
      }
      expired = true
      const configuring = latest.status === 'configuring'
      return payload.update({
        collection: 'feishu-app-registrations',
        data: {
          lastErrorCode: configuring ? 'registration_stale' : 'registration_expired',
          qrUrl: null,
          status: configuring ? 'failed' : 'expired',
        },
        id: latest.id,
        overrideAccess: true,
        req,
      })
    },
  })
  if (expired) registrationProcesses.get(registrationId)?.abort()
  return registration
}

export const getFeishuAppRegistration = async ({
  clock = () => new Date(),
  payload,
  registrationId,
  user,
}: {
  clock?: () => Date
  payload: Payload
  registrationId: number
  user: User
}): Promise<FeishuRegistrationDTO | null> => {
  const registration = await payload
    .findByID({
      collection: 'feishu-app-registrations',
      depth: 0,
      id: registrationId,
      overrideAccess: true,
    })
    .catch(() => null)
  if (!registration || user.role !== 'admin') return null
  const now = clock()
  if (
    ['pending', 'registering', 'qr_ready', 'configuring', 'authorization_ready'].includes(
      registration.status,
    ) &&
    activeRegistrationExpired(registration, now)
  ) {
    if (registration.status === 'authorization_ready') {
      return registrationDTO(await refreshFeishuAppAuthorization(payload, registration.id))
    }
    return registrationDTO(
      await expireActiveRegistrationIfStale({
        now,
        payload,
        registrationId: registration.id,
      }),
    )
  }
  return registrationDTO(registration)
}

export const readRegisteredAppCredentials = (registration: FeishuAppRegistration) => {
  if (!registration.appId || !registration.appSecretEncrypted) {
    throw new FeishuConfigurationError('Feishu registered app credentials are unavailable')
  }
  return {
    appId: registration.appId,
    appSecret: decryptFeishuCredential(
      registration.appSecretEncrypted,
      readFeishuCredentialEncryptionKey(),
    ),
  }
}
