import { NextRequest, NextResponse } from 'next/server'
import { sql, type PostgresAdapter } from '@payloadcms/db-postgres'
import {
  commitTransaction,
  createLocalReq,
  getPayload,
  initTransaction,
  killTransaction,
  type Payload,
  type RequiredDataFromCollectionSlug,
} from 'payload'

import {
  decryptFeishuCredential,
  encryptFeishuCredential,
  readFeishuCredentialEncryptionKey,
} from '@/modules/feishu/credentials'
import {
  completeFeishuAppRegistrationInTransaction,
  failFeishuAppRegistrationOAuth,
  readRegisteredAppCredentials,
  restartFeishuAppAuthorization,
} from '@/modules/feishu/appRegistration'
import { FeishuApiError, FeishuConfigurationError } from '@/modules/feishu/contracts'
import { exchangeFeishuOAuthCode, getFeishuOAuthUser, hashOAuthState } from '@/modules/feishu/oauth'
import { enqueueFeishuConnectionProvisionJob } from '@/modules/feishu/provisioning'
import config from '@/payload.config'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const adminURL = (request: NextRequest, result: string): URL => {
  const configuredOrigin = process.env.NEXT_PUBLIC_SERVER_URL?.trim()
  const origin =
    configuredOrigin || (process.env.NODE_ENV === 'production' ? undefined : request.url)
  if (!origin) throw new Error('public_server_url_not_configured')
  const url = new URL('/dashboard/leads', origin)
  url.searchParams.set('feishu', result)
  return url
}

const persistConnection = async ({
  connectionData,
  payload,
  registrationId,
  tenantKey,
}: {
  connectionData: RequiredDataFromCollectionSlug<'feishu-connections'>
  payload: Payload
  registrationId?: number
  tenantKey: string
}) => {
  const req = await createLocalReq({}, payload)
  await initTransaction(req)
  try {
    const transactionID = await req.transactionID
    const adapter = payload.db as unknown as PostgresAdapter
    const database = transactionID ? adapter.sessions[transactionID]?.db : undefined
    if (!database) throw new Error('feishu_connection_transaction_unavailable')
    await database.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${tenantKey}))`)
    const existingConnections = await payload.find({
      collection: 'feishu-connections',
      depth: 0,
      limit: 1,
      overrideAccess: true,
      req,
      where: { tenantKey: { equals: tenantKey } },
    })
    const existingConnection = existingConnections.docs[0]
    const connection = existingConnection
      ? await payload.update({
          collection: 'feishu-connections',
          data: connectionData,
          id: existingConnection.id,
          overrideAccess: true,
          req,
        })
      : await payload.create({
          collection: 'feishu-connections',
          data: connectionData,
          overrideAccess: true,
          req,
        })
    const mappings = await payload.find({
      collection: 'feishu-mappings',
      depth: 0,
      overrideAccess: true,
      pagination: false,
      req,
      where: { connection: { equals: connection.id } },
    })
    for (const mapping of mappings.docs) {
      if (mapping.status === 'active') {
        await payload.update({
          collection: 'feishu-mappings',
          data: { status: 'disabled' },
          id: mapping.id,
          overrideAccess: true,
          req,
        })
      }
    }
    if (registrationId !== undefined) {
      await completeFeishuAppRegistrationInTransaction({ payload, registrationId, req })
    }
    await commitTransaction(req)
    return connection
  } catch (error) {
    await killTransaction(req).catch(() => undefined)
    throw error
  }
}

const redirect = (request: NextRequest, result: string): Response =>
  NextResponse.redirect(adminURL(request, result), {
    headers: { 'cache-control': 'no-store' },
    status: 302,
  })

const oauthFailureCode = (error: unknown): string => {
  if (error instanceof FeishuApiError) {
    return `oauth_provider_${String(error.code)}`.slice(0, 120)
  }
  if (error instanceof FeishuConfigurationError) return 'oauth_configuration_invalid'
  if (error instanceof Error && error.message === 'invalid_oauth_state') {
    return 'oauth_invalid_state'
  }
  return 'oauth_failed'
}

const consumeOAuthState = async ({ payload, state }: { payload: Payload; state: string }) => {
  const req = await createLocalReq({}, payload)
  await initTransaction(req)
  try {
    const stateHash = hashOAuthState(state)
    const transactionID = await req.transactionID
    const adapter = payload.db as unknown as PostgresAdapter
    const database = transactionID ? adapter.sessions[transactionID]?.db : undefined
    if (!database) throw new Error('feishu_oauth_state_transaction_unavailable')
    await database.execute(sql`
      SELECT "id" FROM "feishu_oauth_states" WHERE "state_hash" = ${stateHash} FOR UPDATE
    `)
    const result = await payload.find({
      collection: 'feishu-oauth-states',
      depth: 0,
      limit: 2,
      overrideAccess: true,
      req,
      where: { stateHash: { equals: stateHash } },
    })
    const oauthState = result.docs[0]
    if (
      result.totalDocs !== 1 ||
      oauthState.usedAt ||
      Date.parse(oauthState.expiresAt) <= Date.now()
    ) {
      throw new Error('invalid_oauth_state')
    }
    const consumed = await payload.update({
      collection: 'feishu-oauth-states',
      data: { usedAt: new Date().toISOString() },
      id: oauthState.id,
      overrideAccess: true,
      req,
    })
    const verifier = decryptFeishuCredential(
      consumed.verifierEncrypted,
      readFeishuCredentialEncryptionKey(),
    )
    const registrationId =
      typeof consumed.registration === 'number' ? consumed.registration : consumed.registration?.id
    await commitTransaction(req)
    return { registrationId, verifier }
  } catch (error) {
    await killTransaction(req).catch(() => undefined)
    throw error
  }
}

export async function GET(request: NextRequest): Promise<Response> {
  const state = request.nextUrl.searchParams.get('state')?.trim()
  if (!state) return redirect(request, 'invalid_state')
  const providerError = request.nextUrl.searchParams.get('error')?.trim()
  const code = request.nextUrl.searchParams.get('code')?.trim()

  let registrationId: number | undefined
  let connectionPersisted = false
  try {
    const payload = await getPayload({ config })
    const consumed = await consumeOAuthState({ payload, state })
    registrationId = consumed.registrationId
    const registration = registrationId
      ? await payload.findByID({
          collection: 'feishu-app-registrations',
          depth: 0,
          id: registrationId,
          overrideAccess: true,
        })
      : undefined
    if (registration && registration.status !== 'authorization_ready') {
      throw new Error('invalid_registration_state')
    }
    if (providerError || !code) {
      if (registration) {
        await restartFeishuAppAuthorization(
          payload,
          registration.id,
          providerError ? 'oauth_denied' : 'oauth_missing_code',
        )
      }
      return redirect(request, providerError ? 'denied' : 'missing_code')
    }
    const registeredCredentials = registration
      ? readRegisteredAppCredentials(registration)
      : undefined
    const appId = registeredCredentials?.appId ?? process.env.FEISHU_APP_ID?.trim()
    const appSecret = registeredCredentials?.appSecret ?? process.env.FEISHU_APP_SECRET?.trim()
    const redirectURI = process.env.FEISHU_OAUTH_REDIRECT_URI?.trim()
    if (!appId || !appSecret || !redirectURI) throw new Error('oauth_not_configured')

    const token = await exchangeFeishuOAuthCode({
      appId,
      appSecret,
      code,
      ...(registration ? {} : { codeVerifier: consumed.verifier }),
      redirectURI,
    })
    const user = await getFeishuOAuthUser({ accessToken: token.accessToken })
    const key = readFeishuCredentialEncryptionKey()
    const connectedAt = new Date().toISOString()
    const connectionData = {
      accessTokenEncrypted: encryptFeishuCredential(token.accessToken, key),
      accessTokenExpiresAt: token.expiresAt,
      ...(registration
        ? {
            appId,
            appSecretEncrypted: encryptFeishuCredential(appSecret, key),
            authMode: 'qr_registered' as const,
          }
        : { appId: null, appSecretEncrypted: null, authMode: 'store_oauth' as const }),
      installerOpenId: user.openId,
      lastConnectedAt: connectedAt,
      lastErrorCode: null,
      name: user.name ? `${user.name} 的飞书` : `飞书租户 ${user.tenantKey}`,
      refreshTokenEncrypted: encryptFeishuCredential(token.refreshToken, key),
      refreshTokenExpiresAt: token.refreshTokenExpiresAt ?? null,
      scopes: token.scopes.map((scope) => ({ scope })),
      status: 'provisioning' as const,
      tenantKey: user.tenantKey,
    }
    const connection = await persistConnection({
      connectionData,
      payload,
      ...(registration ? { registrationId: registration.id } : {}),
      tenantKey: user.tenantKey,
    })
    connectionPersisted = true
    await enqueueFeishuConnectionProvisionJob({
      connection: connection as unknown as Record<string, unknown>,
      payload,
    })
    return redirect(request, 'provisioning')
  } catch (error) {
    if (connectionPersisted) {
      return redirect(request, 'provisioning')
    }
    if (registrationId) {
      const failedRegistrationId = registrationId
      const payload = await getPayload({ config }).catch(() => undefined)
      if (payload) {
        const failureCode = oauthFailureCode(error)
        payload.logger.error({
          code: failureCode,
          message: 'Feishu OAuth callback failed',
          ...(error instanceof FeishuApiError ? { status: error.status } : {}),
        })
        await restartFeishuAppAuthorization(payload, failedRegistrationId, failureCode).catch(() =>
          failFeishuAppRegistrationOAuth(payload, failedRegistrationId).catch(() => undefined),
        )
      }
    }
    return redirect(
      request,
      oauthFailureCode(error) === 'oauth_invalid_state' ? 'invalid_state' : 'failed',
    )
  }
}
