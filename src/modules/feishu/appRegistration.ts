import { registerApp } from '@larksuiteoapi/node-sdk'
import { sql, type PostgresAdapter } from '@payloadcms/db-postgres'
import {
  commitTransaction,
  createLocalReq,
  initTransaction,
  killTransaction,
  type Payload,
  type PayloadRequest,
} from 'payload'

import type { FeishuAppRegistration, User } from '@/payload-types'

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

export const completeFeishuAppRegistration = (
  payload: Payload,
  registrationId: number,
): Promise<FeishuAppRegistration> =>
  withLockedRegistration({
    payload,
    registrationId,
    run: (registration, req) => {
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
    },
  })

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
  registration,
  req,
  validStatuses,
}: {
  clock?: () => Date
  lastErrorCode?: null | string
  payload: Payload
  registration: FeishuAppRegistration
  req: PayloadRequest
  validStatuses: FeishuAppRegistration['status'][]
}): Promise<FeishuAppRegistration> => {
  const attempt = createOAuthAttempt(clock)
  if (!validStatuses.includes(registration.status)) {
    throw new FeishuConfigurationError('Feishu registration cannot start authorization')
  }
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
      and: [{ registration: { equals: registration.id } }, { usedAt: { exists: false } }],
    },
  })
  const invalidatedAt = clock().toISOString()
  for (const priorState of priorStates.docs) {
    await payload.update({
      collection: 'feishu-oauth-states',
      data: { usedAt: invalidatedAt },
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
  registrationId,
  validStatuses,
}: {
  clock?: () => Date
  lastErrorCode?: null | string
  payload: Payload
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
        registration,
        req,
        validStatuses,
      }),
  })

export const restartFeishuAppAuthorization = (
  payload: Payload,
  registrationId: number,
  lastErrorCode = 'oauth_failed',
): Promise<FeishuAppRegistration> =>
  prepareFeishuAuthorization({
    lastErrorCode,
    payload,
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

const requireRedirectURI = (): string => {
  const value = process.env.FEISHU_OAUTH_REDIRECT_URI?.trim()
  if (!value) throw new FeishuConfigurationError('FEISHU_OAUTH_REDIRECT_URI is required')
  const url = new URL(value)
  if (process.env.NODE_ENV === 'production' && url.protocol !== 'https:') {
    throw new FeishuConfigurationError('Feishu OAuth redirect URI must use HTTPS in production')
  }
  return url.toString()
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

const activeRegistrationExpired = (registration: FeishuAppRegistration, now: Date): boolean => {
  if (registration.status === 'authorization_ready') {
    return (
      !registration.authorizeExpiresAt ||
      Date.parse(registration.authorizeExpiresAt) <= now.getTime()
    )
  }
  if (registration.status === 'qr_ready') {
    return !registration.qrExpiresAt || Date.parse(registration.qrExpiresAt) <= now.getTime()
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
    if (recoverableConfiguration) {
      await commitTransaction(req)
      return { created: false, registration: existing }
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

const requestTenantToken = async ({
  appId,
  appSecret,
  fetch: fetchImpl,
}: {
  appId: string
  appSecret: string
  fetch: FetchLike
}): Promise<string> => {
  const response = await fetchImpl(
    'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal',
    {
      body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
      headers: { 'content-type': 'application/json; charset=utf-8' },
      method: 'POST',
    },
  )
  const body = record(await response.json().catch(() => undefined)) ?? {}
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
}: {
  appId: string
  appSecret: string
  fetch?: FetchLike
  redirectURI?: string
  settle?: (delay: number) => Promise<void>
}): Promise<void> => {
  const tenantToken = await requestTenantToken({ appId, appSecret, fetch: fetchImpl })
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
    },
  )
  const body = record(await response.json().catch(() => undefined)) ?? {}
  if (!response.ok || number(body.code) !== 0) {
    throw new FeishuApiError({
      code: number(body.code) ?? response.status,
      message: 'Feishu registered app configuration failed',
      retryable: response.status >= 500 || response.status === 429,
      status: response.status,
    })
  }
  await settle(FEISHU_APP_CONFIG_PROPAGATION_DELAY_MS)
}

const registrationErrorCode = (error: unknown): string => {
  const code = string(record(error)?.code)
  if (code === 'access_denied') return 'registration_denied'
  if (code === 'expired_token') return 'registration_expired'
  if (code === 'abort') return 'registration_cancelled'
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
              data: { lastErrorCode: null, status: 'configuring' },
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
      const result = await register(
        buildFeishuRegisterAppOptions({
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
      )
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
        lastErrorCode: null,
        qrUrl: null,
        status: 'configuring',
      })
    } else {
      appId = claimed.appId
      appSecret = claimed.appSecret
    }
    await configureRegisteredFeishuApp({ appId, appSecret, fetch: fetchImpl })

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
  if (
    ['pending', 'registering', 'qr_ready', 'authorization_ready'].includes(registration.status) &&
    activeRegistrationExpired(registration, clock())
  ) {
    if (registration.status === 'authorization_ready') {
      return registrationDTO(await refreshFeishuAppAuthorization(payload, registration.id))
    }
    registrationProcesses.get(registration.id)?.abort()
    const expired = await updateLockedRegistration(payload, registration.id, {
      lastErrorCode: 'registration_expired',
      qrUrl: null,
      status: 'expired',
    })
    return registrationDTO(expired)
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
