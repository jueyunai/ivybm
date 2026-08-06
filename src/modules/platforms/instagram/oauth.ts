import { randomBytes, timingSafeEqual } from 'node:crypto'

import {
  decryptPlatformCredential,
  encryptPlatformCredential,
  readPlatformCredentialEncryptionKey,
} from '@/modules/platforms/credentials'
import type { PlatformAccountKind } from '@/modules/platforms/readiness'

type Environment = Readonly<Record<string, string | undefined>>
type InstagramAccountKind = Extract<PlatformAccountKind, 'instagram-professional'>

export const INSTAGRAM_APP_ID_ENV = 'INSTAGRAM_APP_ID'
export const INSTAGRAM_APP_SECRET_ENV = 'INSTAGRAM_APP_SECRET'
export const INSTAGRAM_OAUTH_REDIRECT_URI_ENV = 'INSTAGRAM_OAUTH_REDIRECT_URI'
export const INSTAGRAM_OAUTH_CALLBACK_PATH = '/api/platforms/instagram/oauth/callback'
export const INSTAGRAM_OAUTH_TRANSACTION_COOKIE = 'ivybm_instagram_oauth'
export const INSTAGRAM_OAUTH_TRANSACTION_TTL_SECONDS = 10 * 60
export const INSTAGRAM_GRAPH_API_VERSION = 'v22.0'

const INSTAGRAM_AUTHORIZATION_ENDPOINT = 'https://www.instagram.com/oauth/authorize'
const INSTAGRAM_TOKEN_EXCHANGE_ORIGIN = 'https://api.instagram.com'
const INSTAGRAM_GRAPH_ORIGIN = 'https://graph.instagram.com'
const MAX_AUTHORIZATION_CODE_LENGTH = 4_096
const MAX_CREDENTIAL_LENGTH = 16_384
const MAX_PROVIDER_RESPONSE_LENGTH = 256 * 1_024
const MAX_TOKEN_TTL_SECONDS = 90 * 24 * 60 * 60
const OAUTH_TRANSACTION_VERSION = 1
const PROVIDER_TIMEOUT_MILLISECONDS = 15_000
const STATE_PATTERN = /^[A-Za-z0-9_-]{32,128}$/
const INSTAGRAM_ID_PATTERN = /^[1-9][0-9]{0,31}$/

export type InstagramOAuthErrorCode =
  | 'identity_mismatch'
  | 'identity_verification_failed'
  | 'invalid_configuration'
  | 'invalid_transaction'
  | 'required_permission_missing'
  | 'state_mismatch'
  | 'token_exchange_failed'
  | 'token_response_invalid'

const errorMessages: Record<InstagramOAuthErrorCode, string> = {
  identity_mismatch: 'Instagram OAuth identity does not match the configured account',
  identity_verification_failed: 'Instagram OAuth identity verification failed',
  invalid_configuration: 'Instagram OAuth is not configured',
  invalid_transaction: 'Instagram OAuth transaction is invalid or expired',
  required_permission_missing: 'Instagram OAuth did not grant the required permissions',
  state_mismatch: 'Instagram OAuth state validation failed',
  token_exchange_failed: 'Instagram OAuth token exchange failed',
  token_response_invalid: 'Instagram OAuth token response is invalid',
}

export class InstagramOAuthError extends Error {
  constructor(public readonly code: InstagramOAuthErrorCode) {
    super(errorMessages[code])
    this.name = 'InstagramOAuthError'
  }
}

export type InstagramOAuthConfiguration = {
  appId: string
  appSecret: string
  redirectUri: string
}

export type InstagramOAuthTransaction = {
  accountId: string
  accountKind: InstagramAccountKind
  expiresAtMilliseconds: number
  state: string
}

export type InstagramAuthorizedAccount = {
  accessToken: string
  accountId: string
  displayName: string
  scopes: string[]
}

export type InstagramUserToken = {
  accessToken: string
  expiresAt: string
}

const nonEmpty = (value: string | undefined, maximumLength = MAX_CREDENTIAL_LENGTH): string => {
  const normalized = value?.trim()
  if (!normalized || normalized.length > maximumLength) {
    throw new InstagramOAuthError('invalid_configuration')
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
    throw new InstagramOAuthError('invalid_configuration')
  }
}

const readRedirectUri = (value: string | undefined, environment: Environment): string => {
  const normalized = nonEmpty(value, 2_048)
  let redirect: URL
  try {
    redirect = new URL(normalized)
  } catch {
    throw new InstagramOAuthError('invalid_configuration')
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
    redirect.pathname !== INSTAGRAM_OAUTH_CALLBACK_PATH
  ) {
    throw new InstagramOAuthError('invalid_configuration')
  }
  return redirect.toString()
}

const readInstagramId = (value: string | undefined): string => {
  const normalized = nonEmpty(value, 32)
  if (!INSTAGRAM_ID_PATTERN.test(normalized)) {
    throw new InstagramOAuthError('invalid_configuration')
  }
  return normalized
}

export const readInstagramOAuthConfiguration = (
  environment: Environment = process.env,
): InstagramOAuthConfiguration => ({
  appId: readInstagramId(environment[INSTAGRAM_APP_ID_ENV]),
  appSecret: nonEmpty(environment[INSTAGRAM_APP_SECRET_ENV]),
  redirectUri: readRedirectUri(environment[INSTAGRAM_OAUTH_REDIRECT_URI_ENV], environment),
})

const INSTAGRAM_PROFESSIONAL_PERMISSIONS = [
  'instagram_business_basic',
  'instagram_business_manage_comments',
  'instagram_business_manage_messages',
] as const

export const requiredInstagramPermissions = (
  _accountKind: InstagramAccountKind,
): string[] => [...INSTAGRAM_PROFESSIONAL_PERMISSIONS]

const isInstagramAccountKind = (value: unknown): value is InstagramAccountKind =>
  value === 'instagram-professional'

const normalizedAccountId = (value: number | string): string => {
  const normalized = String(value).trim()
  const numeric = Number(normalized)
  if (
    !/^[1-9][0-9]*$/.test(normalized) ||
    !Number.isSafeInteger(numeric) ||
    String(numeric) !== normalized
  ) {
    throw new InstagramOAuthError('invalid_transaction')
  }
  return normalized
}

export const createInstagramOAuthTransaction = ({
  accountId,
  accountKind,
  environment = process.env,
  nowMilliseconds = Date.now(),
}: {
  accountId: number | string
  accountKind: InstagramAccountKind
  environment?: Environment
  nowMilliseconds?: number
}): { cookieValue: string; state: string } => {
  const state = randomBytes(32).toString('base64url')
  const transaction = {
    accountId: normalizedAccountId(accountId),
    accountKind,
    expiresAtMilliseconds: nowMilliseconds + INSTAGRAM_OAUTH_TRANSACTION_TTL_SECONDS * 1_000,
    state,
    version: OAUTH_TRANSACTION_VERSION,
  }

  try {
    const key = readPlatformCredentialEncryptionKey(environment)
    return {
      cookieValue: encryptPlatformCredential(JSON.stringify(transaction), key),
      state,
    }
  } catch {
    throw new InstagramOAuthError('invalid_configuration')
  }
}

const constantTimeStateMatch = (expected: string, actual: string): boolean => {
  if (!STATE_PATTERN.test(expected) || !STATE_PATTERN.test(actual)) return false
  const expectedBytes = Buffer.from(expected)
  const actualBytes = Buffer.from(actual)
  return expectedBytes.length === actualBytes.length && timingSafeEqual(expectedBytes, actualBytes)
}

export const verifyInstagramOAuthTransaction = ({
  cookieValue,
  environment = process.env,
  nowMilliseconds = Date.now(),
  returnedState,
}: {
  cookieValue: string | undefined
  environment?: Environment
  nowMilliseconds?: number
  returnedState: string | undefined
}): InstagramOAuthTransaction => {
  if (!cookieValue || !returnedState) throw new InstagramOAuthError('invalid_transaction')

  let candidate: unknown
  try {
    candidate = JSON.parse(
      decryptPlatformCredential(
        cookieValue,
        readPlatformCredentialEncryptionKey(environment),
      ),
    ) as unknown
  } catch {
    throw new InstagramOAuthError('invalid_transaction')
  }

  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    throw new InstagramOAuthError('invalid_transaction')
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
    !isInstagramAccountKind(transaction.accountKind) ||
    typeof transaction.expiresAtMilliseconds !== 'number' ||
    !Number.isSafeInteger(transaction.expiresAtMilliseconds) ||
    transaction.expiresAtMilliseconds <= nowMilliseconds ||
    typeof transaction.state !== 'string'
  ) {
    throw new InstagramOAuthError('invalid_transaction')
  }
  if (!constantTimeStateMatch(transaction.state, returnedState)) {
    throw new InstagramOAuthError('state_mismatch')
  }

  return {
    accountId: transaction.accountId,
    accountKind: transaction.accountKind,
    expiresAtMilliseconds: transaction.expiresAtMilliseconds,
    state: transaction.state,
  }
}

export const buildInstagramAuthorizationURL = ({
  config,
  state,
}: {
  config: InstagramOAuthConfiguration
  state: string
}): URL => {
  if (!STATE_PATTERN.test(state)) throw new InstagramOAuthError('invalid_transaction')

  const url = new URL(INSTAGRAM_AUTHORIZATION_ENDPOINT)
  url.searchParams.set('client_id', config.appId)
  url.searchParams.set('redirect_uri', config.redirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', requiredInstagramPermissions('instagram-professional').join(','))
  url.searchParams.set('state', state)
  return url
}

const parseProviderRecord = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new InstagramOAuthError('token_response_invalid')
  }
  return value as Record<string, unknown>
}

const readProviderJSON = async (
  response: Response,
  errorCode: 'identity_verification_failed' | 'token_exchange_failed',
): Promise<Record<string, unknown>> => {
  let body: string
  try {
    body = await response.text()
  } catch {
    throw new InstagramOAuthError(errorCode)
  }
  if (!response.ok) throw new InstagramOAuthError(errorCode)
  if (!body || body.length > MAX_PROVIDER_RESPONSE_LENGTH) {
    throw new InstagramOAuthError(
      errorCode === 'token_exchange_failed'
        ? 'token_response_invalid'
        : 'identity_verification_failed',
    )
  }
  try {
    return parseProviderRecord(JSON.parse(body) as unknown)
  } catch (error) {
    if (error instanceof InstagramOAuthError) throw error
    throw new InstagramOAuthError(
      errorCode === 'token_exchange_failed'
        ? 'token_response_invalid'
        : 'identity_verification_failed',
    )
  }
}

const readTokenPayload = (
  payload: Record<string, unknown>,
  nowMilliseconds: number,
): InstagramUserToken => {
  const accessToken = typeof payload.access_token === 'string' ? payload.access_token.trim() : ''
  const expiresIn = payload.expires_in
  if (
    !accessToken ||
    accessToken.length > MAX_CREDENTIAL_LENGTH ||
    typeof expiresIn !== 'number' ||
    !Number.isSafeInteger(expiresIn) ||
    expiresIn <= 0 ||
    expiresIn > MAX_TOKEN_TTL_SECONDS
  ) {
    throw new InstagramOAuthError('token_response_invalid')
  }
  return {
    accessToken,
    expiresAt: new Date(nowMilliseconds + expiresIn * 1_000).toISOString(),
  }
}

const exchangeCodeForShortToken = async ({
  code,
  config,
  fetcher,
}: {
  code: string
  config: InstagramOAuthConfiguration
  fetcher: typeof fetch
}): Promise<{ accessToken: string; userId: string }> => {
  const body = new URLSearchParams({
    client_id: config.appId,
    client_secret: config.appSecret,
    code,
    grant_type: 'authorization_code',
    redirect_uri: config.redirectUri,
  })

  let response: Response
  try {
    response = await fetcher(`${INSTAGRAM_TOKEN_EXCHANGE_ORIGIN}/oauth/access_token`, {
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
    throw new InstagramOAuthError('token_exchange_failed')
  }

  const payload = await readProviderJSON(response, 'token_exchange_failed')
  const accessToken = typeof payload.access_token === 'string' ? payload.access_token.trim() : ''
  const rawUserId = payload.user_id
  const userId =
    typeof rawUserId === 'number'
      ? String(rawUserId)
      : typeof rawUserId === 'string'
        ? rawUserId.trim()
        : ''
  if (
    !accessToken ||
    accessToken.length > MAX_CREDENTIAL_LENGTH ||
    !userId ||
    !INSTAGRAM_ID_PATTERN.test(userId)
  ) {
    throw new InstagramOAuthError('token_response_invalid')
  }
  return { accessToken, userId }
}

const exchangeShortTokenForLongToken = async ({
  accessToken,
  appSecret,
  fetcher,
  nowMilliseconds,
}: {
  accessToken: string
  appSecret: string
  fetcher: typeof fetch
  nowMilliseconds: number
}): Promise<InstagramUserToken> => {
  const url = new URL('/access_token', INSTAGRAM_GRAPH_ORIGIN)
  url.searchParams.set('grant_type', 'ig_exchange_token')
  url.searchParams.set('client_secret', appSecret)
  url.searchParams.set('access_token', accessToken)

  let response: Response
  try {
    response = await fetcher(url, {
      cache: 'no-store',
      headers: { accept: 'application/json' },
      method: 'GET',
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MILLISECONDS),
    })
  } catch {
    throw new InstagramOAuthError('token_exchange_failed')
  }

  const payload = await readProviderJSON(response, 'token_exchange_failed')
  return readTokenPayload(payload, nowMilliseconds)
}

export const exchangeInstagramAuthorizationCode = async ({
  code,
  config,
  fetcher = fetch,
  nowMilliseconds = Date.now(),
}: {
  code: string
  config: InstagramOAuthConfiguration
  fetcher?: typeof fetch
  nowMilliseconds?: number
}): Promise<InstagramUserToken> => {
  const normalizedCode = code?.trim()
  if (!normalizedCode || normalizedCode.length > MAX_AUTHORIZATION_CODE_LENGTH) {
    throw new InstagramOAuthError('token_exchange_failed')
  }

  const shortToken = await exchangeCodeForShortToken({
    code: normalizedCode,
    config,
    fetcher,
  })
  return exchangeShortTokenForLongToken({
    accessToken: shortToken.accessToken,
    appSecret: config.appSecret,
    fetcher,
    nowMilliseconds,
  })
}

const instagramGraphRequest = async ({
  accessToken,
  fetcher,
  path,
  searchParams,
}: {
  accessToken: string
  fetcher: typeof fetch
  path: string
  searchParams?: Record<string, string>
}): Promise<Record<string, unknown>> => {
  const url = new URL(`/${INSTAGRAM_GRAPH_API_VERSION}${path}`, INSTAGRAM_GRAPH_ORIGIN)
  url.searchParams.set('access_token', accessToken)
  for (const [key, value] of Object.entries(searchParams ?? {})) {
    url.searchParams.set(key, value)
  }

  let response: Response
  try {
    response = await fetcher(url, {
      cache: 'no-store',
      headers: { accept: 'application/json' },
      method: 'GET',
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MILLISECONDS),
    })
  } catch {
    throw new InstagramOAuthError('identity_verification_failed')
  }
  return readProviderJSON(response, 'identity_verification_failed')
}

const requireInstagramExternalId = (value: string): string => {
  const normalized = value.trim()
  if (!INSTAGRAM_ID_PATTERN.test(normalized)) throw new InstagramOAuthError('identity_mismatch')
  return normalized
}

export const resolveInstagramAuthorizedAccount = async ({
  externalAccountId,
  fetcher = fetch,
  userAccessToken,
}: {
  externalAccountId: string
  fetcher?: typeof fetch
  userAccessToken: string
}): Promise<InstagramAuthorizedAccount> => {
  const normalizedToken = userAccessToken.trim()
  const targetId = requireInstagramExternalId(externalAccountId)
  if (!normalizedToken || normalizedToken.length > MAX_CREDENTIAL_LENGTH) {
    throw new InstagramOAuthError('identity_verification_failed')
  }

  const profile = await instagramGraphRequest({
    accessToken: normalizedToken,
    fetcher,
    path: '/me',
    searchParams: { fields: 'id,username,account_type' },
  })

  const rawAccountId = profile.id
  const accountId =
    typeof rawAccountId === 'number'
      ? String(rawAccountId)
      : typeof rawAccountId === 'string'
        ? rawAccountId.trim()
        : ''
  const username =
    typeof profile.username === 'string' ? profile.username.trim() : ''
  const accountType =
    typeof profile.account_type === 'string' ? profile.account_type.trim() : ''
  if (!accountId || !INSTAGRAM_ID_PATTERN.test(accountId)) {
    throw new InstagramOAuthError('identity_verification_failed')
  }
  if (accountType !== 'BUSINESS' && accountType !== 'MEDIA_CREATOR') {
    throw new InstagramOAuthError('required_permission_missing')
  }
  if (accountId !== targetId) {
    throw new InstagramOAuthError('identity_mismatch')
  }

  return {
    accessToken: normalizedToken,
    accountId,
    displayName: username ? `@${username}` : accountId,
    scopes: requiredInstagramPermissions('instagram-professional'),
  }
}
