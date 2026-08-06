import { sql, type PostgresAdapter } from '@payloadcms/db-postgres'
import {
  commitTransaction,
  createLocalReq,
  initTransaction,
  killTransaction,
  type Payload,
  type PayloadRequest,
} from 'payload'

import { FeishuClient, createFeishuClientFromEnv } from './client'
import type { FeishuAccessTokenPurpose, FeishuMappingConfig } from './contracts'
import { FeishuApiError, FeishuConfigurationError } from './contracts'
import {
  decryptFeishuCredential,
  encryptFeishuCredential,
  readFeishuCredentialEncryptionKey,
} from './credentials'
import { refreshFeishuOAuthToken } from './oauth'

type FetchLike = typeof fetch
type UnknownRecord = Record<string, unknown>

const record = (value: unknown): UnknownRecord | undefined =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as UnknownRecord) : undefined
const string = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined
const number = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined

const requiredEnvironment = (name: string): string => {
  const value = process.env[name]?.trim()
  if (!value) throw new FeishuConfigurationError(`${name} is required for Feishu OAuth`)
  return value
}

const connectionCredential = (connection: UnknownRecord, field: string): string => {
  const encrypted = string(connection[field])
  if (!encrypted) throw new FeishuConfigurationError(`Feishu connection ${field} is missing`)
  return decryptFeishuCredential(encrypted, readFeishuCredentialEncryptionKey())
}

const connectionAppCredentials = (
  connection: UnknownRecord,
): { appId: string; appSecret: string; authMode: 'qr_registered' | 'store_oauth' } => {
  if (connection.authMode === 'qr_registered') {
    const appId = string(connection.appId)
    if (!appId) throw new FeishuConfigurationError('Feishu connection appId is missing')
    return {
      appId,
      appSecret: connectionCredential(connection, 'appSecretEncrypted'),
      authMode: 'qr_registered',
    }
  }
  return {
    appId: requiredEnvironment('FEISHU_APP_ID'),
    appSecret: requiredEnvironment('FEISHU_APP_SECRET'),
    authMode: 'store_oauth',
  }
}

const expiresSoon = (value: unknown): boolean => {
  if (typeof value !== 'string') return true
  const expiresAt = Date.parse(value)
  return !Number.isFinite(expiresAt) || expiresAt <= Date.now() + 60_000
}

const canUseUserToken = (status: unknown): boolean =>
  status === 'connected' || status === 'provisioning' || status === 'error'

const RECONNECT_REQUIRED_CODES = new Set([20024, 20026, 20037, 20064, 20073, 20074])

export class PayloadFeishuTokenProvider {
  private appToken?: { expiresAt: number; value: string }
  private readonly connectionId: number | string
  private readonly fetch: FetchLike
  private readonly payload: Payload
  private tenantToken?: { expiresAt: number; value: string }

  constructor({
    connectionId,
    fetch: fetchImpl = globalThis.fetch,
    payload,
  }: {
    connectionId: number | string
    fetch?: FetchLike
    payload: Payload
  }) {
    this.connectionId = connectionId
    this.fetch = fetchImpl
    this.payload = payload
  }

  private async findConnection(req?: PayloadRequest): Promise<UnknownRecord> {
    const connection = await this.payload.findByID({
      collection: 'feishu-connections',
      depth: 0,
      id: this.connectionId,
      overrideAccess: true,
      ...(req ? { req } : {}),
    })
    return connection as unknown as UnknownRecord
  }

  private async markReconnectRequired(code: number | string): Promise<void> {
    const req = await createLocalReq({}, this.payload)
    await initTransaction(req)
    try {
      await this.payload.update({
        collection: 'feishu-connections',
        data: { lastErrorCode: String(code), status: 'reconnect_required' },
        id: this.connectionId,
        overrideAccess: true,
        req,
      })
      await commitTransaction(req)
    } catch (error) {
      await killTransaction(req).catch(() => undefined)
      throw error
    }
  }

  private async refreshUserAccessToken(force = false): Promise<string> {
    const req = await createLocalReq({}, this.payload)
    await initTransaction(req)
    try {
      const transactionID = await req.transactionID
      const adapter = this.payload.db as unknown as PostgresAdapter
      const database = transactionID ? adapter.sessions[transactionID]?.db : undefined
      if (!database)
        throw new FeishuConfigurationError('Feishu token refresh transaction is unavailable')
      await database.execute(sql`
        SELECT "id" FROM "feishu_connections" WHERE "id" = ${this.connectionId} FOR UPDATE
      `)
      const connection = await this.findConnection(req)
      if (!canUseUserToken(connection.status)) {
        throw new FeishuConfigurationError('Feishu connection requires authorization')
      }
      if (!force && !expiresSoon(connection.accessTokenExpiresAt)) {
        const token = connectionCredential(connection, 'accessTokenEncrypted')
        await commitTransaction(req)
        return token
      }

      const refreshed = await refreshFeishuOAuthToken({
        ...connectionAppCredentials(connection),
        fetch: this.fetch,
        refreshToken: connectionCredential(connection, 'refreshTokenEncrypted'),
      })
      const key = readFeishuCredentialEncryptionKey()
      await this.payload.update({
        collection: 'feishu-connections',
        data: {
          accessTokenEncrypted: encryptFeishuCredential(refreshed.accessToken, key),
          accessTokenExpiresAt: refreshed.expiresAt,
          lastRefreshedAt: new Date().toISOString(),
          refreshTokenEncrypted: encryptFeishuCredential(refreshed.refreshToken, key),
          refreshTokenExpiresAt: refreshed.refreshTokenExpiresAt ?? null,
          scopes: refreshed.scopes.map((scope) => ({ scope })),
        },
        id: this.connectionId,
        overrideAccess: true,
        req,
      })
      await commitTransaction(req)
      return refreshed.accessToken
    } catch (error) {
      await killTransaction(req).catch(() => undefined)
      if (error instanceof FeishuApiError && RECONNECT_REQUIRED_CODES.has(Number(error.code))) {
        try {
          await this.markReconnectRequired(error.code)
        } catch {
          this.payload.logger.error('Failed to persist Feishu reconnect-required state')
          throw new FeishuConfigurationError(
            'Feishu connection authorization state could not be persisted',
          )
        }
      }
      throw error
    }
  }

  private async userAccessToken(forceRefresh = false): Promise<string> {
    const connection = await this.findConnection()
    if (!canUseUserToken(connection.status)) {
      throw new FeishuConfigurationError('Feishu connection requires authorization')
    }
    if (forceRefresh || expiresSoon(connection.accessTokenExpiresAt)) {
      return this.refreshUserAccessToken(forceRefresh)
    }
    return connectionCredential(connection, 'accessTokenEncrypted')
  }

  private async appAccessToken(signal?: AbortSignal, forceRefresh = false): Promise<string> {
    if (!forceRefresh && this.appToken && this.appToken.expiresAt > Date.now() + 60_000) {
      return this.appToken.value
    }
    const connection = await this.findConnection()
    const credentials = connectionAppCredentials(connection)
    if (credentials.authMode !== 'store_oauth') {
      throw new FeishuConfigurationError('App access token is only used by Store App connections')
    }
    const response = await this.fetch('https://open.feishu.cn/open-apis/auth/v3/app_access_token', {
      body: JSON.stringify({
        app_id: credentials.appId,
        app_secret: credentials.appSecret,
      }),
      headers: { 'content-type': 'application/json; charset=utf-8' },
      method: 'POST',
      signal,
    })
    const body = record(await response.json().catch(() => undefined)) ?? {}
    const value = string(body.app_access_token)
    if (!response.ok || number(body.code) !== 0 || !value) {
      throw new FeishuApiError({
        code: number(body.code) ?? response.status,
        message: 'Feishu app token request failed',
        retryable: response.status >= 500,
        status: response.status,
      })
    }
    this.appToken = { expiresAt: Date.now() + (number(body.expire) ?? 7_200) * 1_000, value }
    return value
  }

  private async tenantAccessToken(signal?: AbortSignal, forceRefresh = false): Promise<string> {
    if (!forceRefresh && this.tenantToken && this.tenantToken.expiresAt > Date.now() + 60_000) {
      return this.tenantToken.value
    }
    const connection = await this.findConnection()
    const tenantKey = string(connection.tenantKey)
    if (connection.status !== 'connected' || !tenantKey) {
      throw new FeishuConfigurationError('Feishu tenant connection is unavailable')
    }
    const credentials = connectionAppCredentials(connection)
    if (credentials.authMode === 'qr_registered') {
      const response = await this.fetch(
        'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal',
        {
          body: JSON.stringify({
            app_id: credentials.appId,
            app_secret: credentials.appSecret,
          }),
          headers: { 'content-type': 'application/json; charset=utf-8' },
          method: 'POST',
          signal,
        },
      )
      const body = record(await response.json().catch(() => undefined)) ?? {}
      const value = string(body.tenant_access_token)
      if (!response.ok || number(body.code) !== 0 || !value) {
        throw new FeishuApiError({
          code: number(body.code) ?? response.status,
          message: 'Feishu tenant token request failed',
          retryable: response.status >= 500,
          status: response.status,
        })
      }
      this.tenantToken = {
        expiresAt: Date.now() + (number(body.expire) ?? 7_200) * 1_000,
        value,
      }
      return value
    }
    const response = await this.fetch(
      'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token',
      {
        body: JSON.stringify({
          app_access_token: await this.appAccessToken(signal, forceRefresh),
          tenant_key: tenantKey,
        }),
        headers: { 'content-type': 'application/json; charset=utf-8' },
        method: 'POST',
        signal,
      },
    )
    const body = record(await response.json().catch(() => undefined)) ?? {}
    const value = string(body.tenant_access_token)
    if (!response.ok || number(body.code) !== 0 || !value) {
      throw new FeishuApiError({
        code: number(body.code) ?? response.status,
        message: 'Feishu tenant token request failed',
        retryable: response.status >= 500,
        status: response.status,
      })
    }
    this.tenantToken = { expiresAt: Date.now() + (number(body.expire) ?? 7_200) * 1_000, value }
    return value
  }

  getToken = (
    purpose: FeishuAccessTokenPurpose,
    signal?: AbortSignal,
    forceRefresh = false,
  ): Promise<string> =>
    purpose === 'base'
      ? this.userAccessToken(forceRefresh)
      : this.tenantAccessToken(signal, forceRefresh)
}

export const createFeishuClientForMapping = ({
  mapping,
  payload,
}: {
  mapping: FeishuMappingConfig
  payload: Payload
}): FeishuClient => {
  if (!mapping.connectionId) return createFeishuClientFromEnv()
  const provider = new PayloadFeishuTokenProvider({ connectionId: mapping.connectionId, payload })
  return new FeishuClient({ tokenProvider: provider.getToken })
}
