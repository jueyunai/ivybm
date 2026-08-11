import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

import {
  decryptPlatformCredential,
  encryptPlatformCredential,
  readPlatformCredentialEncryptionKey,
} from '@/modules/platforms/credentials'
import type { PlatformAccountKind } from '@/modules/platforms/readiness'

type Environment = Readonly<Record<string, string | undefined>>
type MetaAccountKind = Extract<PlatformAccountKind, 'facebook-page'>

export const META_APP_ID_ENV = 'META_APP_ID'
export const META_APP_SECRET_ENV = 'META_WEBHOOK_APP_SECRET'
export const META_LOGIN_CONFIG_ID_ENV = 'META_LOGIN_CONFIG_ID'
export const META_OAUTH_REDIRECT_URI_ENV = 'META_OAUTH_REDIRECT_URI'
export const META_OAUTH_CALLBACK_PATH = '/api/platforms/meta/oauth/callback'
export const META_OAUTH_TRANSACTION_COOKIE = 'ivybm_meta_oauth'
export const META_OAUTH_TRANSACTION_TTL_SECONDS = 10 * 60
export const META_GRAPH_API_VERSION = 'v25.0'

const META_AUTHORIZATION_ENDPOINT = `https://www.facebook.com/${META_GRAPH_API_VERSION}/dialog/oauth`
const META_GRAPH_ORIGIN = 'https://graph.facebook.com'
const MAX_AUTHORIZATION_CODE_LENGTH = 4_096
const MAX_CREDENTIAL_LENGTH = 16_384
const MAX_PROVIDER_RESPONSE_LENGTH = 256 * 1_024
const MAX_TOKEN_TTL_SECONDS = 90 * 24 * 60 * 60
const OAUTH_TRANSACTION_VERSION = 2
const PROVIDER_TIMEOUT_MILLISECONDS = 15_000
const STATE_PATTERN = /^[A-Za-z0-9_-]{32,128}$/
const META_ID_PATTERN = /^[1-9][0-9]{0,31}$/
const SAFE_PROVIDER_RESPONSE_KEYS = new Set([
  'access_token',
  'data',
  'error',
  'expires_in',
  'id',
  'name',
  'paging',
  'tasks',
  'token_type',
])

export type MetaOAuthErrorCode =
  | 'identity_mismatch'
  | 'identity_verification_failed'
  | 'invalid_configuration'
  | 'invalid_transaction'
  | 'required_permission_missing'
  | 'state_mismatch'
  | 'token_exchange_failed'
  | 'token_response_invalid'

export type MetaOAuthDiagnosticStage =
  'page_direct' | 'pages_list' | 'permissions' | 'token_exchange_long' | 'token_exchange_short'

export type MetaOAuthDiagnostic = {
  grantedScopes?: string[]
  missingScopes?: string[]
  providerErrorCode?: number
  providerErrorSubcode?: number
  providerResponseKeys?: string[]
  providerStatus?: number
  returnedPageIds?: string[]
  stage: MetaOAuthDiagnosticStage
  targetPageId?: string
}

const errorMessages: Record<MetaOAuthErrorCode, string> = {
  identity_mismatch: 'Meta OAuth identity does not match the configured account',
  identity_verification_failed: 'Meta OAuth identity verification failed',
  invalid_configuration: 'Meta OAuth is not configured',
  invalid_transaction: 'Meta OAuth transaction is invalid or expired',
  required_permission_missing: 'Meta OAuth did not grant the required permissions',
  state_mismatch: 'Meta OAuth state validation failed',
  token_exchange_failed: 'Meta OAuth token exchange failed',
  token_response_invalid: 'Meta OAuth token response is invalid',
}

export class MetaOAuthError extends Error {
  constructor(
    public readonly code: MetaOAuthErrorCode,
    public readonly diagnostic?: MetaOAuthDiagnostic,
  ) {
    super(errorMessages[code])
    this.name = 'MetaOAuthError'
  }
}

export type MetaOAuthConfiguration = {
  appId: string
  appSecret: string
  loginConfigId: string
  redirectUri: string
}

export type MetaOAuthTransaction = {
  accountId: string
  accountKind: MetaAccountKind
  authorizationRevision: number
  expiresAtMilliseconds: number
  externalAccountId: string
  state: string
}

export type MetaAuthorizedAccount = {
  accessToken: string
  displayName: string
  pageId: string
  scopes: string[]
}

export type MetaUserToken = {
  accessToken: string
  expiresAt: string
}

const nonEmpty = (value: string | undefined, maximumLength = MAX_CREDENTIAL_LENGTH): string => {
  const normalized = value?.trim()
  if (!normalized || normalized.length > maximumLength) {
    throw new MetaOAuthError('invalid_configuration')
  }
  return normalized
}

const readPublicOrigin = (value: string | undefined): string | undefined => {
  const normalized = value?.trim()
  if (!normalized) return undefined
  try {
    const url = new URL(normalized)
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
      throw new Error('invalid public origin')
    }
    return url.origin
  } catch {
    throw new MetaOAuthError('invalid_configuration')
  }
}

const readRedirectUri = (value: string | undefined, environment: Environment): string => {
  const normalized = nonEmpty(value, 2_048)
  let redirect: URL
  try {
    redirect = new URL(normalized)
  } catch {
    throw new MetaOAuthError('invalid_configuration')
  }

  const localHttp =
    redirect.protocol === 'http:' &&
    (redirect.hostname === 'localhost' || redirect.hostname === '127.0.0.1')
  const publicOrigin = readPublicOrigin(environment.NEXT_PUBLIC_SERVER_URL)
  if (
    (!localHttp && redirect.protocol !== 'https:') ||
    (!localHttp && (!publicOrigin || redirect.origin !== publicOrigin)) ||
    redirect.username ||
    redirect.password ||
    redirect.hash ||
    redirect.search ||
    redirect.pathname !== META_OAUTH_CALLBACK_PATH
  ) {
    throw new MetaOAuthError('invalid_configuration')
  }
  return redirect.toString()
}

const readMetaId = (value: string | undefined): string => {
  const normalized = nonEmpty(value, 32)
  if (!META_ID_PATTERN.test(normalized)) throw new MetaOAuthError('invalid_configuration')
  return normalized
}

export const readMetaOAuthConfiguration = (
  environment: Environment = process.env,
): MetaOAuthConfiguration => ({
  appId: readMetaId(environment[META_APP_ID_ENV]),
  appSecret: nonEmpty(environment[META_APP_SECRET_ENV]),
  loginConfigId: nonEmpty(environment[META_LOGIN_CONFIG_ID_ENV], 240),
  redirectUri: readRedirectUri(environment[META_OAUTH_REDIRECT_URI_ENV], environment),
})

const FACEBOOK_PAGE_PERMISSIONS = [
  'pages_show_list',
  'pages_manage_metadata',
  'pages_messaging',
  'pages_read_engagement',
] as const

export const requiredMetaPermissions = (_accountKind: MetaAccountKind): string[] => [
  ...FACEBOOK_PAGE_PERMISSIONS,
]

const isMetaAccountKind = (value: unknown): value is MetaAccountKind => value === 'facebook-page'

const normalizedAccountId = (value: number | string): string => {
  const normalized = String(value).trim()
  const numeric = Number(normalized)
  if (
    !/^[1-9][0-9]*$/.test(normalized) ||
    !Number.isSafeInteger(numeric) ||
    String(numeric) !== normalized
  ) {
    throw new MetaOAuthError('invalid_transaction')
  }
  return normalized
}

const normalizedAuthorizationRevision = (value: number | undefined): number => {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new MetaOAuthError('invalid_transaction')
  }
  return Number(value)
}

export const createMetaOAuthTransaction = ({
  accountId,
  accountKind,
  authorizationRevision,
  environment = process.env,
  externalAccountId,
  nowMilliseconds = Date.now(),
}: {
  accountId: number | string
  accountKind: MetaAccountKind
  authorizationRevision: number
  environment?: Environment
  externalAccountId: string
  nowMilliseconds?: number
}): { cookieValue: string; state: string } => {
  const state = randomBytes(32).toString('base64url')
  const normalizedExternalAccountId = externalAccountId.trim()
  const transaction = {
    accountId: normalizedAccountId(accountId),
    accountKind,
    authorizationRevision: normalizedAuthorizationRevision(authorizationRevision),
    expiresAtMilliseconds: nowMilliseconds + META_OAUTH_TRANSACTION_TTL_SECONDS * 1_000,
    externalAccountId: normalizedExternalAccountId,
    state,
    version: OAUTH_TRANSACTION_VERSION,
  }
  if (!META_ID_PATTERN.test(normalizedExternalAccountId)) {
    throw new MetaOAuthError('invalid_transaction')
  }

  try {
    const key = readPlatformCredentialEncryptionKey(environment)
    return {
      cookieValue: encryptPlatformCredential(JSON.stringify(transaction), key),
      state,
    }
  } catch {
    throw new MetaOAuthError('invalid_configuration')
  }
}

const constantTimeStateMatch = (expected: string, actual: string): boolean => {
  if (!STATE_PATTERN.test(expected) || !STATE_PATTERN.test(actual)) return false
  const expectedBytes = Buffer.from(expected)
  const actualBytes = Buffer.from(actual)
  return expectedBytes.length === actualBytes.length && timingSafeEqual(expectedBytes, actualBytes)
}

export const verifyMetaOAuthTransaction = ({
  cookieValue,
  environment = process.env,
  nowMilliseconds = Date.now(),
  returnedState,
}: {
  cookieValue: string | undefined
  environment?: Environment
  nowMilliseconds?: number
  returnedState: string | undefined
}): MetaOAuthTransaction => {
  if (!cookieValue || !returnedState) throw new MetaOAuthError('invalid_transaction')

  let candidate: unknown
  try {
    candidate = JSON.parse(
      decryptPlatformCredential(cookieValue, readPlatformCredentialEncryptionKey(environment)),
    ) as unknown
  } catch {
    throw new MetaOAuthError('invalid_transaction')
  }

  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    throw new MetaOAuthError('invalid_transaction')
  }
  const transaction = candidate as Record<string, unknown>
  const numericAccountId =
    typeof transaction.accountId === 'string' ? Number(transaction.accountId) : Number.NaN
  if (
    transaction.version !== OAUTH_TRANSACTION_VERSION ||
    typeof transaction.accountId !== 'string' ||
    !/^[1-9][0-9]*$/.test(transaction.accountId) ||
    !Number.isSafeInteger(numericAccountId) ||
    String(numericAccountId) !== transaction.accountId ||
    !isMetaAccountKind(transaction.accountKind) ||
    typeof transaction.authorizationRevision !== 'number' ||
    !Number.isSafeInteger(transaction.authorizationRevision) ||
    transaction.authorizationRevision < 0 ||
    typeof transaction.expiresAtMilliseconds !== 'number' ||
    !Number.isSafeInteger(transaction.expiresAtMilliseconds) ||
    transaction.expiresAtMilliseconds <= nowMilliseconds ||
    typeof transaction.externalAccountId !== 'string' ||
    !META_ID_PATTERN.test(transaction.externalAccountId) ||
    typeof transaction.state !== 'string'
  ) {
    throw new MetaOAuthError('invalid_transaction')
  }
  if (!constantTimeStateMatch(transaction.state, returnedState)) {
    throw new MetaOAuthError('state_mismatch')
  }

  return {
    accountId: transaction.accountId,
    accountKind: transaction.accountKind,
    authorizationRevision: transaction.authorizationRevision,
    expiresAtMilliseconds: transaction.expiresAtMilliseconds,
    externalAccountId: transaction.externalAccountId,
    state: transaction.state,
  }
}

export const buildMetaAuthorizationURL = ({
  config,
  state,
}: {
  config: MetaOAuthConfiguration
  state: string
}): URL => {
  if (!STATE_PATTERN.test(state)) throw new MetaOAuthError('invalid_transaction')

  const url = new URL(META_AUTHORIZATION_ENDPOINT)
  url.searchParams.set('client_id', config.appId)
  url.searchParams.set('config_id', config.loginConfigId)
  url.searchParams.set('redirect_uri', config.redirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('state', state)
  return url
}

const parseProviderRecord = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new MetaOAuthError('token_response_invalid')
  }
  return value as Record<string, unknown>
}

const boundedProviderKeys = (payload: Record<string, unknown>): string[] =>
  Object.keys(payload)
    .filter((key) => SAFE_PROVIDER_RESPONSE_KEYS.has(key))
    .sort()

const numericProviderField = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isSafeInteger(value) ? value : undefined

const providerDiagnostic = ({
  payload,
  stage,
  status,
}: {
  payload: Record<string, unknown>
  stage: MetaOAuthDiagnosticStage
  status: number
}): MetaOAuthDiagnostic => {
  const error =
    payload.error && typeof payload.error === 'object' && !Array.isArray(payload.error)
      ? (payload.error as Record<string, unknown>)
      : undefined
  const providerErrorCode = numericProviderField(error?.code)
  const providerErrorSubcode = numericProviderField(error?.error_subcode)
  return {
    stage,
    providerStatus: status,
    providerResponseKeys: boundedProviderKeys(payload),
    ...(providerErrorCode === undefined ? {} : { providerErrorCode }),
    ...(providerErrorSubcode === undefined ? {} : { providerErrorSubcode }),
  }
}

const readProviderJSON = async (
  response: Response,
  errorCode: 'identity_verification_failed' | 'token_exchange_failed',
  stage?: MetaOAuthDiagnosticStage,
): Promise<Record<string, unknown>> => {
  let body: string
  try {
    body = await response.text()
  } catch {
    throw new MetaOAuthError(
      errorCode,
      stage ? { providerStatus: response.status, stage } : undefined,
    )
  }
  if (!body || body.length > MAX_PROVIDER_RESPONSE_LENGTH) {
    throw new MetaOAuthError(
      errorCode === 'token_exchange_failed'
        ? 'token_response_invalid'
        : 'identity_verification_failed',
      stage ? { providerStatus: response.status, stage } : undefined,
    )
  }
  if (!response.ok) {
    let errorPayload: Record<string, unknown> | undefined
    try {
      errorPayload = parseProviderRecord(JSON.parse(body) as unknown)
    } catch {
      throw new MetaOAuthError(
        errorCode,
        stage ? { providerStatus: response.status, stage } : undefined,
      )
    }
    throw new MetaOAuthError(
      errorCode,
      stage
        ? providerDiagnostic({ payload: errorPayload, stage, status: response.status })
        : undefined,
    )
  }
  let payload: Record<string, unknown>
  try {
    payload = parseProviderRecord(JSON.parse(body) as unknown)
  } catch {
    throw new MetaOAuthError(
      errorCode === 'token_exchange_failed'
        ? 'token_response_invalid'
        : 'identity_verification_failed',
      stage ? { providerStatus: response.status, stage } : undefined,
    )
  }
  return payload
}

const tokenResponseDiagnostic = (
  payload: Record<string, unknown>,
  stage: Extract<MetaOAuthDiagnosticStage, 'token_exchange_long' | 'token_exchange_short'>,
): MetaOAuthDiagnostic => ({
  providerResponseKeys: boundedProviderKeys(payload),
  providerStatus: 200,
  stage,
})

const readAccessToken = (
  payload: Record<string, unknown>,
  stage: Extract<MetaOAuthDiagnosticStage, 'token_exchange_long' | 'token_exchange_short'>,
): string => {
  const accessToken = typeof payload.access_token === 'string' ? payload.access_token.trim() : ''
  if (!accessToken || accessToken.length > MAX_CREDENTIAL_LENGTH) {
    throw new MetaOAuthError('token_response_invalid', tokenResponseDiagnostic(payload, stage))
  }
  return accessToken
}

const readExpiresInSeconds = (value: unknown): number | undefined => {
  const normalized =
    typeof value === 'string' && /^(?:0|[1-9][0-9]*)$/.test(value) ? Number(value) : value
  return typeof normalized === 'number' && Number.isSafeInteger(normalized) && normalized > 0
    ? normalized
    : undefined
}

const readLongLivedTokenPayload = (
  payload: Record<string, unknown>,
  nowMilliseconds: number,
): MetaUserToken => {
  const stage = 'token_exchange_long'
  const accessToken = readAccessToken(payload, stage)
  const expiresIn = readExpiresInSeconds(payload.expires_in)
  if (expiresIn === undefined || expiresIn > MAX_TOKEN_TTL_SECONDS) {
    throw new MetaOAuthError('token_response_invalid', tokenResponseDiagnostic(payload, stage))
  }
  return {
    accessToken,
    expiresAt: new Date(nowMilliseconds + expiresIn * 1_000).toISOString(),
  }
}

const exchangeTokenRequest = async ({
  body,
  fetcher,
  stage,
}: {
  body: URLSearchParams
  fetcher: typeof fetch
  stage: Extract<MetaOAuthDiagnosticStage, 'token_exchange_long' | 'token_exchange_short'>
}): Promise<Record<string, unknown>> => {
  let response: Response
  try {
    response = await fetcher(`${META_GRAPH_ORIGIN}/${META_GRAPH_API_VERSION}/oauth/access_token`, {
      body,
      cache: 'no-store',
      headers: {
        accept: 'application/json',
        'content-type': 'application/x-www-form-urlencoded',
      },
      method: 'POST',
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MILLISECONDS),
    })
  } catch {
    throw new MetaOAuthError('token_exchange_failed', { stage })
  }
  return readProviderJSON(response, 'token_exchange_failed', stage)
}

export const exchangeMetaAuthorizationCode = async ({
  code,
  config,
  fetcher = fetch,
  nowMilliseconds = Date.now(),
}: {
  code: string
  config: MetaOAuthConfiguration
  fetcher?: typeof fetch
  nowMilliseconds?: number
}): Promise<MetaUserToken> => {
  const normalizedCode = code?.trim()
  if (!normalizedCode || normalizedCode.length > MAX_AUTHORIZATION_CODE_LENGTH) {
    throw new MetaOAuthError('token_exchange_failed')
  }

  const shortPayload = await exchangeTokenRequest({
    body: new URLSearchParams({
      client_id: config.appId,
      client_secret: config.appSecret,
      code: normalizedCode,
      redirect_uri: config.redirectUri,
    }),
    fetcher,
    stage: 'token_exchange_short',
  })
  const shortAccessToken = readAccessToken(shortPayload, 'token_exchange_short')
  const longPayload = await exchangeTokenRequest({
    body: new URLSearchParams({
      client_id: config.appId,
      client_secret: config.appSecret,
      fb_exchange_token: shortAccessToken,
      grant_type: 'fb_exchange_token',
    }),
    fetcher,
    stage: 'token_exchange_long',
  })
  return readLongLivedTokenPayload(longPayload, nowMilliseconds)
}

const graphRequest = async ({
  accessToken,
  appSecretProof,
  fetcher,
  path,
  searchParams,
  stage,
}: {
  accessToken: string
  appSecretProof: string
  fetcher: typeof fetch
  path: string
  searchParams?: Record<string, string>
  stage: MetaOAuthDiagnosticStage
}): Promise<Record<string, unknown>> => {
  const url = new URL(`/${META_GRAPH_API_VERSION}${path}`, META_GRAPH_ORIGIN)
  url.searchParams.set('appsecret_proof', appSecretProof)
  for (const [key, value] of Object.entries(searchParams ?? {})) url.searchParams.set(key, value)

  let response: Response
  try {
    response = await fetcher(url, {
      cache: 'no-store',
      headers: { accept: 'application/json', authorization: `Bearer ${accessToken}` },
      method: 'GET',
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MILLISECONDS),
    })
  } catch {
    throw new MetaOAuthError('identity_verification_failed', { stage })
  }
  return readProviderJSON(response, 'identity_verification_failed', stage)
}

const providerArray = (value: unknown): Record<string, unknown>[] => {
  if (!Array.isArray(value) || value.length > 100) {
    throw new MetaOAuthError('identity_verification_failed')
  }
  return value.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new MetaOAuthError('identity_verification_failed')
    }
    return item as Record<string, unknown>
  })
}

const requireMetaExternalId = (value: string): string => {
  const normalized = value.trim()
  if (!META_ID_PATTERN.test(normalized)) throw new MetaOAuthError('identity_mismatch')
  return normalized
}

export const resolveMetaAuthorizedAccount = async ({
  accountKind,
  appSecret,
  externalAccountId,
  fetcher = fetch,
  userAccessToken,
}: {
  accountKind: MetaAccountKind
  appSecret: string
  externalAccountId: string
  fetcher?: typeof fetch
  userAccessToken: string
}): Promise<MetaAuthorizedAccount> => {
  const normalizedToken = userAccessToken.trim()
  const normalizedSecret = appSecret.trim()
  const targetId = requireMetaExternalId(externalAccountId)
  if (
    !normalizedToken ||
    normalizedToken.length > MAX_CREDENTIAL_LENGTH ||
    !normalizedSecret ||
    normalizedSecret.length > MAX_CREDENTIAL_LENGTH
  ) {
    throw new MetaOAuthError('identity_verification_failed')
  }
  const appSecretProof = createHmac('sha256', normalizedSecret)
    .update(normalizedToken)
    .digest('hex')

  const permissionPayload = await graphRequest({
    accessToken: normalizedToken,
    appSecretProof,
    fetcher,
    path: '/me/permissions',
    searchParams: { limit: '100' },
    stage: 'permissions',
  })
  const requiredPermissions = requiredMetaPermissions(accountKind)
  const requiredPermissionSet = new Set(requiredPermissions)
  const grantedPermissionSet = new Set<string>()
  for (const item of providerArray(permissionPayload.data)) {
    if (
      item.status === 'granted' &&
      typeof item.permission === 'string' &&
      requiredPermissionSet.has(item.permission)
    ) {
      grantedPermissionSet.add(item.permission)
    }
  }
  const grantedPermissions = requiredPermissions.filter((permission) =>
    grantedPermissionSet.has(permission),
  )
  const missingPermissions = requiredPermissions.filter(
    (permission) => !grantedPermissionSet.has(permission),
  )
  if (missingPermissions.length > 0) {
    throw new MetaOAuthError('required_permission_missing', {
      grantedScopes: [...new Set(grantedPermissions)].sort(),
      missingScopes: missingPermissions,
      providerStatus: 200,
      stage: 'permissions',
    })
  }

  const pagesPayload = await graphRequest({
    accessToken: normalizedToken,
    appSecretProof,
    fetcher,
    path: '/me/accounts',
    searchParams: {
      fields: 'id,name,access_token,tasks',
      limit: '100',
    },
    stage: 'pages_list',
  })
  const pages = providerArray(pagesPayload.data)
  let page = pages.find((candidate) => candidate.id === targetId)
  let pageResolutionStage: MetaOAuthDiagnosticStage = 'pages_list'
  if (!page) {
    pageResolutionStage = 'page_direct'
    const returnedPageIds = pages
      .map((candidate) => (typeof candidate.id === 'string' ? candidate.id.trim() : ''))
      .filter((id) => META_ID_PATTERN.test(id))
      .slice(0, 100)
    try {
      page = await graphRequest({
        accessToken: normalizedToken,
        appSecretProof,
        fetcher,
        path: `/${targetId}`,
        searchParams: { fields: 'id,name,access_token,tasks' },
        stage: 'page_direct',
      })
    } catch (error) {
      if (error instanceof MetaOAuthError) {
        throw new MetaOAuthError(error.code, {
          ...error.diagnostic,
          returnedPageIds,
          stage: 'page_direct',
          targetPageId: targetId,
        })
      }
      throw error
    }
    if (page.id !== targetId) {
      throw new MetaOAuthError('identity_mismatch', {
        returnedPageIds,
        stage: 'page_direct',
        targetPageId: targetId,
      })
    }
  }

  const pageId = typeof page.id === 'string' ? page.id.trim() : ''
  const pageAccessToken = typeof page.access_token === 'string' ? page.access_token.trim() : ''
  if (
    !META_ID_PATTERN.test(pageId) ||
    !pageAccessToken ||
    pageAccessToken.length > MAX_CREDENTIAL_LENGTH
  ) {
    throw new MetaOAuthError('identity_verification_failed', {
      returnedPageIds: pageId ? [pageId] : [],
      stage: pageResolutionStage,
      targetPageId: targetId,
    })
  }

  const displayName = typeof page.name === 'string' ? page.name.trim() : ''

  return {
    accessToken: pageAccessToken,
    displayName: displayName || targetId,
    pageId,
    scopes: [...new Set(grantedPermissions)],
  }
}
