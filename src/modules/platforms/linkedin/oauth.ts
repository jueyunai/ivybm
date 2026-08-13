import { randomBytes, timingSafeEqual } from 'node:crypto'

import {
  decryptPlatformCredential,
  encryptPlatformCredential,
  readPlatformCredentialEncryptionKey,
} from '@/modules/platforms/credentials'
import type { PlatformAccountKind } from '@/modules/platforms/readiness'

type Environment = Readonly<Record<string, string | undefined>>
type LinkedInAccountKind = Extract<PlatformAccountKind, 'linkedin-member' | 'linkedin-organization'>

export const LINKEDIN_APP_ID_ENV = 'LINKEDIN_APP_ID'
export const LINKEDIN_APP_SECRET_ENV = 'LINKEDIN_APP_SECRET'
export const LINKEDIN_OAUTH_REDIRECT_URI_ENV = 'LINKEDIN_OAUTH_REDIRECT_URI'
export const LINKEDIN_API_VERSION_ENV = 'LINKEDIN_API_VERSION'
export const LINKEDIN_OAUTH_CALLBACK_PATH = '/api/platforms/linkedin/oauth/callback'
export const LINKEDIN_OAUTH_TRANSACTION_COOKIE = 'ivybm_linkedin_oauth'
export const LINKEDIN_OAUTH_TRANSACTION_TTL_SECONDS = 10 * 60

const LINKEDIN_AUTHORIZATION_ENDPOINT = 'https://www.linkedin.com/oauth/v2/authorization'
const LINKEDIN_TOKEN_ENDPOINT = 'https://www.linkedin.com/oauth/v2/accessToken'
const LINKEDIN_API_ORIGIN = 'https://api.linkedin.com'
const MAX_AUTHORIZATION_CODE_LENGTH = 4_096
const MAX_CREDENTIAL_LENGTH = 8_192
const MAX_PROVIDER_RESPONSE_LENGTH = 256 * 1_024
const MAX_TOKEN_TTL_SECONDS = 90 * 24 * 60 * 60
const OAUTH_TRANSACTION_VERSION = 1
const PROVIDER_TIMEOUT_MILLISECONDS = 15_000
const STATE_PATTERN = /^[A-Za-z0-9_-]{32,128}$/
const LINKEDIN_VERSION_PATTERN = /^20\d{2}(0[1-9]|1[0-2])$/
const LINKEDIN_APP_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/
const LINKEDIN_ORGANIZATION_ID_PATTERN = /^[0-9]{1,32}$/
const LINKEDIN_MEMBER_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/

export type LinkedInOAuthErrorCode =
  | 'identity_mismatch'
  | 'identity_verification_failed'
  | 'invalid_configuration'
  | 'invalid_transaction'
  | 'required_permission_missing'
  | 'state_mismatch'
  | 'token_exchange_failed'
  | 'token_response_invalid'

export type LinkedInOAuthDiagnosticStage =
  'organization_verification' | 'token_exchange' | 'userinfo_verification'

export type LinkedInOAuthDiagnostic = {
  grantedScopes?: string[]
  missingScopes?: string[]
  providerErrorCode?: string
  providerResponseKeys?: string[]
  providerStatus?: number
  stage: LinkedInOAuthDiagnosticStage
}

const errorMessages: Record<LinkedInOAuthErrorCode, string> = {
  identity_mismatch: 'LinkedIn OAuth identity does not match the configured account',
  identity_verification_failed: 'LinkedIn OAuth identity verification failed',
  invalid_configuration: 'LinkedIn OAuth is not configured',
  invalid_transaction: 'LinkedIn OAuth transaction is invalid or expired',
  required_permission_missing: 'LinkedIn OAuth did not grant the required permissions',
  state_mismatch: 'LinkedIn OAuth state validation failed',
  token_exchange_failed: 'LinkedIn OAuth token exchange failed',
  token_response_invalid: 'LinkedIn OAuth token response is invalid',
}

export class LinkedInOAuthError extends Error {
  constructor(
    public readonly code: LinkedInOAuthErrorCode,
    public readonly diagnostic?: LinkedInOAuthDiagnostic,
  ) {
    super(errorMessages[code])
    this.name = 'LinkedInOAuthError'
  }
}

export type LinkedInOAuthConfiguration = {
  apiVersion: string
  appId: string
  appSecret: string
  redirectUri: string
}

export type LinkedInOAuthTransaction = {
  accountId: string
  accountKind: LinkedInAccountKind
  authorizationRevision: number
  expiresAtMilliseconds: number
  externalAccountId: string
  requestedScopes: string[]
  state: string
}

export type LinkedInAuthorizedAccount = {
  accessToken: string
  displayName: string
  externalAccountId: string
  scopes: string[]
}

export type LinkedInUserToken = {
  accessToken: string
  expiresAt: string | null
  scopes: string[]
}

const nonEmpty = (value: string | undefined, maximumLength = MAX_CREDENTIAL_LENGTH): string => {
  const normalized = value?.trim()
  if (!normalized || normalized.length > maximumLength) {
    throw new LinkedInOAuthError('invalid_configuration')
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
    throw new LinkedInOAuthError('invalid_configuration')
  }
}

const readRedirectUri = (value: string | undefined, environment: Environment): string => {
  const normalized = nonEmpty(value, 2_048)
  let redirect: URL
  try {
    redirect = new URL(normalized)
  } catch {
    throw new LinkedInOAuthError('invalid_configuration')
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
    redirect.pathname !== LINKEDIN_OAUTH_CALLBACK_PATH
  ) {
    throw new LinkedInOAuthError('invalid_configuration')
  }
  return redirect.toString()
}

const readLinkedInAppId = (value: string | undefined): string => {
  const normalized = nonEmpty(value, 240)
  if (!LINKEDIN_APP_ID_PATTERN.test(normalized)) {
    throw new LinkedInOAuthError('invalid_configuration')
  }
  return normalized
}

const readLinkedInApiVersion = (value: string | undefined): string => {
  const normalized = nonEmpty(value, 16)
  if (!LINKEDIN_VERSION_PATTERN.test(normalized)) {
    throw new LinkedInOAuthError('invalid_configuration')
  }
  return normalized
}

export const readLinkedInOAuthConfiguration = (
  environment: Environment = process.env,
): LinkedInOAuthConfiguration => ({
  apiVersion: readLinkedInApiVersion(environment[LINKEDIN_API_VERSION_ENV]),
  appId: readLinkedInAppId(environment[LINKEDIN_APP_ID_ENV]),
  appSecret: nonEmpty(environment[LINKEDIN_APP_SECRET_ENV]),
  redirectUri: readRedirectUri(environment[LINKEDIN_OAUTH_REDIRECT_URI_ENV], environment),
})

const LINKEDIN_MEMBER_PERMISSIONS = ['openid', 'profile', 'w_member_social'] as const
const LINKEDIN_ORGANIZATION_PERMISSIONS = [
  'r_organization_social',
  'w_organization_social',
] as const
const LINKEDIN_ORGANIZATION_POST_ROLES = new Set([
  'ADMINISTRATOR',
  'CONTENT_ADMIN',
  'DIRECT_SPONSORED_CONTENT_POSTER',
])

export const requiredLinkedInPermissions = (accountKind: LinkedInAccountKind): string[] =>
  accountKind === 'linkedin-organization'
    ? [...LINKEDIN_ORGANIZATION_PERMISSIONS]
    : [...LINKEDIN_MEMBER_PERMISSIONS]

const isLinkedInAccountKind = (value: unknown): value is LinkedInAccountKind =>
  value === 'linkedin-member' || value === 'linkedin-organization'

const normalizedAccountId = (value: number | string): string => {
  const normalized = String(value).trim()
  const numeric = Number(normalized)
  if (
    !/^[1-9][0-9]*$/.test(normalized) ||
    !Number.isSafeInteger(numeric) ||
    String(numeric) !== normalized
  ) {
    throw new LinkedInOAuthError('invalid_transaction')
  }
  return normalized
}

const normalizedAuthorizationRevision = (value: number | undefined): number => {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new LinkedInOAuthError('invalid_transaction')
  }
  return Number(value)
}

const normalizedRequestedScopes = (value: unknown, accountKind: LinkedInAccountKind): string[] => {
  const expected = requiredLinkedInPermissions(accountKind)
  if (
    !Array.isArray(value) ||
    value.length !== expected.length ||
    value.some((scope, index) => scope !== expected[index])
  ) {
    throw new LinkedInOAuthError('invalid_transaction')
  }
  return [...expected]
}

const validateExternalAccountId = (
  accountKind: LinkedInAccountKind,
  externalAccountId: string,
): void => {
  if (accountKind === 'linkedin-organization') {
    if (!LINKEDIN_ORGANIZATION_ID_PATTERN.test(externalAccountId)) {
      throw new LinkedInOAuthError('invalid_transaction')
    }
  } else if (!LINKEDIN_MEMBER_ID_PATTERN.test(externalAccountId)) {
    throw new LinkedInOAuthError('invalid_transaction')
  }
}

export const createLinkedInOAuthTransaction = ({
  accountId,
  accountKind,
  authorizationRevision,
  environment = process.env,
  externalAccountId,
  nowMilliseconds = Date.now(),
}: {
  accountId: number | string
  accountKind: LinkedInAccountKind
  authorizationRevision: number
  environment?: Environment
  externalAccountId: string
  nowMilliseconds?: number
}): { cookieValue: string; state: string } => {
  const state = randomBytes(32).toString('base64url')
  const normalizedExternalAccountId = externalAccountId.trim()
  validateExternalAccountId(accountKind, normalizedExternalAccountId)
  const transaction = {
    accountId: normalizedAccountId(accountId),
    accountKind,
    authorizationRevision: normalizedAuthorizationRevision(authorizationRevision),
    expiresAtMilliseconds: nowMilliseconds + LINKEDIN_OAUTH_TRANSACTION_TTL_SECONDS * 1_000,
    externalAccountId: normalizedExternalAccountId,
    requestedScopes: requiredLinkedInPermissions(accountKind),
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
    throw new LinkedInOAuthError('invalid_configuration')
  }
}

const constantTimeStateMatch = (expected: string, actual: string): boolean => {
  if (!STATE_PATTERN.test(expected) || !STATE_PATTERN.test(actual)) return false
  const expectedBytes = Buffer.from(expected)
  const actualBytes = Buffer.from(actual)
  return expectedBytes.length === actualBytes.length && timingSafeEqual(expectedBytes, actualBytes)
}

export const verifyLinkedInOAuthTransaction = ({
  cookieValue,
  environment = process.env,
  nowMilliseconds = Date.now(),
  returnedState,
}: {
  cookieValue: string | undefined
  environment?: Environment
  nowMilliseconds?: number
  returnedState: string | undefined
}): LinkedInOAuthTransaction => {
  if (!cookieValue || !returnedState) throw new LinkedInOAuthError('invalid_transaction')

  let candidate: unknown
  try {
    candidate = JSON.parse(
      decryptPlatformCredential(cookieValue, readPlatformCredentialEncryptionKey(environment)),
    ) as unknown
  } catch {
    throw new LinkedInOAuthError('invalid_transaction')
  }

  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    throw new LinkedInOAuthError('invalid_transaction')
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
    !isLinkedInAccountKind(transaction.accountKind) ||
    typeof transaction.authorizationRevision !== 'number' ||
    !Number.isSafeInteger(transaction.authorizationRevision) ||
    transaction.authorizationRevision < 0 ||
    typeof transaction.expiresAtMilliseconds !== 'number' ||
    !Number.isSafeInteger(transaction.expiresAtMilliseconds) ||
    transaction.expiresAtMilliseconds <= nowMilliseconds ||
    typeof transaction.externalAccountId !== 'string' ||
    typeof transaction.state !== 'string'
  ) {
    throw new LinkedInOAuthError('invalid_transaction')
  }
  validateExternalAccountId(transaction.accountKind, transaction.externalAccountId)
  if (!constantTimeStateMatch(transaction.state, returnedState)) {
    throw new LinkedInOAuthError('state_mismatch')
  }

  return {
    accountId: transaction.accountId,
    accountKind: transaction.accountKind,
    authorizationRevision: transaction.authorizationRevision,
    expiresAtMilliseconds: transaction.expiresAtMilliseconds,
    externalAccountId: transaction.externalAccountId,
    requestedScopes: normalizedRequestedScopes(
      transaction.requestedScopes,
      transaction.accountKind,
    ),
    state: transaction.state,
  }
}

export const buildLinkedInAuthorizationURL = ({
  config,
  scopes,
  state,
}: {
  config: LinkedInOAuthConfiguration
  scopes: string[]
  state: string
}): URL => {
  if (!STATE_PATTERN.test(state)) throw new LinkedInOAuthError('invalid_transaction')

  const url = new URL(LINKEDIN_AUTHORIZATION_ENDPOINT)
  url.searchParams.set('client_id', config.appId)
  url.searchParams.set('redirect_uri', config.redirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', scopes.join(' '))
  url.searchParams.set('state', state)
  return url
}

const parseProviderRecord = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new LinkedInOAuthError('token_response_invalid')
  }
  return value as Record<string, unknown>
}

const boundedProviderKeys = (payload: Record<string, unknown>): string[] => {
  const topLevelKeys = Object.keys(payload).filter((key) =>
    ['access_token', 'expires_in', 'scope', 'error', 'error_description', 'error_uri'].includes(
      key,
    ),
  )
  return topLevelKeys.sort()
}

const asProviderRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined

const providerDiagnostic = ({
  payload,
  stage,
  status,
}: {
  payload?: Record<string, unknown>
  stage: LinkedInOAuthDiagnosticStage
  status?: number
}): LinkedInOAuthDiagnostic => {
  const errorRecord = payload ? asProviderRecord(payload.error) : undefined
  const providerErrorCode =
    typeof errorRecord?.error === 'string' && errorRecord.error.trim()
      ? errorRecord.error.trim()
      : typeof payload?.error === 'string' && payload.error.trim()
        ? payload.error.trim()
        : undefined
  return {
    stage,
    ...(status === undefined ? {} : { providerStatus: status }),
    ...(providerErrorCode === undefined ? {} : { providerErrorCode }),
    ...(payload ? { providerResponseKeys: boundedProviderKeys(payload) } : {}),
  }
}

const readProviderJSON = async (
  response: Response,
  errorCode: 'identity_verification_failed' | 'token_exchange_failed',
  stage: LinkedInOAuthDiagnosticStage,
): Promise<Record<string, unknown>> => {
  const invalidResponseCode =
    errorCode === 'token_exchange_failed'
      ? 'token_response_invalid'
      : 'identity_verification_failed'
  let body: string
  try {
    body = await response.text()
  } catch {
    throw new LinkedInOAuthError(errorCode, providerDiagnostic({ stage, status: response.status }))
  }
  if (!body || body.length > MAX_PROVIDER_RESPONSE_LENGTH) {
    throw new LinkedInOAuthError(
      response.ok ? invalidResponseCode : errorCode,
      providerDiagnostic({ stage, status: response.status }),
    )
  }
  let payload: Record<string, unknown>
  try {
    payload = parseProviderRecord(JSON.parse(body) as unknown)
  } catch {
    throw new LinkedInOAuthError(
      response.ok ? invalidResponseCode : errorCode,
      providerDiagnostic({ stage, status: response.status }),
    )
  }
  if (!response.ok) {
    throw new LinkedInOAuthError(
      errorCode,
      providerDiagnostic({ payload, stage, status: response.status }),
    )
  }
  return payload
}

const readAccessToken = (
  payload: Record<string, unknown>,
  diagnostic: LinkedInOAuthDiagnostic,
): string => {
  const accessToken = typeof payload.access_token === 'string' ? payload.access_token.trim() : ''
  if (!accessToken || accessToken.length > MAX_CREDENTIAL_LENGTH) {
    throw new LinkedInOAuthError('token_response_invalid', diagnostic)
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

const readGrantedScopes = (
  payload: Record<string, unknown>,
  diagnostic: LinkedInOAuthDiagnostic,
): string[] => {
  const rawScope = typeof payload.scope === 'string' ? payload.scope.trim() : ''
  if (!rawScope) {
    throw new LinkedInOAuthError('token_response_invalid', diagnostic)
  }
  const scopes = rawScope.split(/\s+/u).filter(Boolean)
  if (scopes.length === 0 || scopes.length > 100) {
    throw new LinkedInOAuthError('token_response_invalid', diagnostic)
  }
  return scopes
}

const readTokenPayload = (
  payload: Record<string, unknown>,
  nowMilliseconds: number,
  diagnostic: LinkedInOAuthDiagnostic,
): LinkedInUserToken => {
  const accessToken = readAccessToken(payload, diagnostic)
  const scopes = readGrantedScopes(payload, diagnostic)
  let expiresAt: string | null = null
  if (payload.expires_in !== undefined) {
    const expiresIn = readExpiresInSeconds(payload.expires_in)
    if (expiresIn === undefined || expiresIn > MAX_TOKEN_TTL_SECONDS) {
      throw new LinkedInOAuthError('token_response_invalid', diagnostic)
    }
    expiresAt = new Date(nowMilliseconds + expiresIn * 1_000).toISOString()
  }
  return { accessToken, expiresAt, scopes }
}

export const exchangeLinkedInAuthorizationCode = async ({
  code,
  config,
  fetcher = fetch,
  nowMilliseconds = Date.now(),
}: {
  code: string
  config: LinkedInOAuthConfiguration
  fetcher?: typeof fetch
  nowMilliseconds?: number
}): Promise<LinkedInUserToken> => {
  const normalizedCode = code?.trim()
  if (!normalizedCode || normalizedCode.length > MAX_AUTHORIZATION_CODE_LENGTH) {
    throw new LinkedInOAuthError(
      'token_exchange_failed',
      providerDiagnostic({ stage: 'token_exchange' }),
    )
  }

  const body = new URLSearchParams({
    client_id: config.appId,
    client_secret: config.appSecret,
    code: normalizedCode,
    grant_type: 'authorization_code',
    redirect_uri: config.redirectUri,
  })

  let response: Response
  try {
    response = await fetcher(LINKEDIN_TOKEN_ENDPOINT, {
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
    throw new LinkedInOAuthError(
      'token_exchange_failed',
      providerDiagnostic({ stage: 'token_exchange' }),
    )
  }

  const payload = await readProviderJSON(response, 'token_exchange_failed', 'token_exchange')
  return readTokenPayload(
    payload,
    nowMilliseconds,
    providerDiagnostic({ payload, stage: 'token_exchange', status: response.status }),
  )
}

const linkedInApiRequest = async ({
  accessToken,
  config,
  fetcher,
  path,
  stage,
}: {
  accessToken: string
  config: LinkedInOAuthConfiguration
  fetcher: typeof fetch
  path: string
  stage: LinkedInOAuthDiagnosticStage
}): Promise<Record<string, unknown>> => {
  const url = new URL(path, LINKEDIN_API_ORIGIN)
  let response: Response
  try {
    response = await fetcher(url, {
      cache: 'no-store',
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${accessToken}`,
        'linkedin-version': config.apiVersion,
        'x-restli-protocol-version': '2.0.0',
      },
      method: 'GET',
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MILLISECONDS),
    })
  } catch {
    throw new LinkedInOAuthError('identity_verification_failed', providerDiagnostic({ stage }))
  }
  return readProviderJSON(response, 'identity_verification_failed', stage)
}

const requireLinkedInExternalId = (accountKind: LinkedInAccountKind, value: string): string => {
  const normalized = value.trim()
  validateExternalAccountId(accountKind, normalized)
  return normalized
}

export const resolveLinkedInAuthorizedAccount = async ({
  accountKind,
  config,
  externalAccountId,
  fetcher = fetch,
  grantedScopes,
  requiredScopes,
  userAccessToken,
}: {
  accountKind: LinkedInAccountKind
  config: LinkedInOAuthConfiguration
  externalAccountId: string
  fetcher?: typeof fetch
  grantedScopes: string[]
  requiredScopes: string[]
  userAccessToken: string
}): Promise<LinkedInAuthorizedAccount> => {
  const normalizedToken = userAccessToken.trim()
  const targetId = requireLinkedInExternalId(accountKind, externalAccountId)
  if (!normalizedToken || normalizedToken.length > MAX_CREDENTIAL_LENGTH) {
    throw new LinkedInOAuthError(
      'identity_verification_failed',
      providerDiagnostic({ stage: 'userinfo_verification' }),
    )
  }

  const grantedScopeSet = new Set(grantedScopes)
  const missingScopes = requiredScopes.filter((scope) => !grantedScopeSet.has(scope))
  if (missingScopes.length > 0) {
    throw new LinkedInOAuthError('required_permission_missing', {
      grantedScopes: [...grantedScopeSet].sort(),
      missingScopes,
      stage:
        accountKind === 'linkedin-organization'
          ? 'organization_verification'
          : 'userinfo_verification',
    })
  }

  if (accountKind === 'linkedin-member') {
    const profile = await linkedInApiRequest({
      accessToken: normalizedToken,
      config,
      fetcher,
      path: '/v2/userinfo',
      stage: 'userinfo_verification',
    })
    const sub = typeof profile.sub === 'string' ? profile.sub.trim() : ''
    const name = typeof profile.name === 'string' ? profile.name.trim() : ''
    if (!sub) {
      throw new LinkedInOAuthError('identity_verification_failed', {
        stage: 'userinfo_verification',
      })
    }
    if (sub !== targetId) {
      throw new LinkedInOAuthError('identity_mismatch', {
        stage: 'userinfo_verification',
      })
    }
    return {
      accessToken: normalizedToken,
      displayName: name || sub,
      externalAccountId: sub,
      scopes: [...grantedScopeSet],
    }
  }

  const organizationAccess = await linkedInApiRequest({
    accessToken: normalizedToken,
    config,
    fetcher,
    path: '/rest/organizationAcls?q=roleAssignee',
    stage: 'organization_verification',
  })
  const targetOrganization = `urn:li:organization:${targetId}`
  const hasApprovedPublishingRole = Array.isArray(organizationAccess.elements)
    ? organizationAccess.elements.some((item) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return false
        const record = item as Record<string, unknown>
        return (
          record.organization === targetOrganization &&
          record.state === 'APPROVED' &&
          typeof record.role === 'string' &&
          LINKEDIN_ORGANIZATION_POST_ROLES.has(record.role)
        )
      })
    : false
  if (!hasApprovedPublishingRole) {
    throw new LinkedInOAuthError('identity_mismatch', {
      stage: 'organization_verification',
    })
  }
  return {
    accessToken: normalizedToken,
    displayName: targetOrganization,
    externalAccountId: targetId,
    scopes: [...grantedScopeSet],
  }
}
