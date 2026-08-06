import { createHash, randomBytes } from 'node:crypto'

import { FeishuApiError, FeishuConfigurationError } from './contracts'

type FetchLike = typeof fetch
type JsonRecord = Record<string, unknown>

export const FEISHU_OAUTH_SCOPES = ['auth:user.id:read', 'bitable:app', 'offline_access'] as const
export const FEISHU_OAUTH_STATE_TTL_MS = 10 * 60 * 1_000
export const FEISHU_OAUTH_REQUEST_TIMEOUT_MS = 30_000

const record = (value: unknown): JsonRecord | undefined =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonRecord) : undefined

const string = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined

const number = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined

const oauthAbortError = (): FeishuApiError =>
  new FeishuApiError({
    code: 'abort',
    message: 'Feishu OAuth request was aborted',
    retryable: true,
  })

const withFeishuOAuthRequestTimeout = async <T>({
  operation,
  signal: externalSignal,
  timeoutMs,
}: {
  operation: (signal: AbortSignal) => Promise<T>
  signal?: AbortSignal
  timeoutMs: number
}): Promise<T> => {
  const requestController = new AbortController()

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
      requestController.abort(externalSignal?.reason)
      finish(() => reject(oauthAbortError()))
    }

    const timer = setTimeout(() => {
      requestController.abort()
      finish(() =>
        reject(
          new FeishuApiError({
            code: 'timeout',
            message: 'Feishu OAuth request timed out',
            retryable: true,
          }),
        ),
      )
    }, timeoutMs)

    if (externalSignal?.aborted) {
      onExternalAbort()
      return
    }
    externalSignal?.addEventListener('abort', onExternalAbort, { once: true })

    operation(requestController.signal).then(
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

const readOAuthJSON = async (response: Response, signal: AbortSignal): Promise<JsonRecord> => {
  try {
    return record(await response.json()) ?? {}
  } catch (error) {
    if (signal.aborted) throw error
    return {}
  }
}

const base64url = (value: Buffer): string => value.toString('base64url')

export const hashOAuthState = (state: string): string =>
  createHash('sha256').update(state).digest('hex')

export const createOAuthAttempt = (clock: () => Date = () => new Date()) => {
  const state = base64url(randomBytes(32))
  const verifier = base64url(randomBytes(64))
  return {
    challenge: base64url(createHash('sha256').update(verifier).digest()),
    expiresAt: new Date(clock().getTime() + FEISHU_OAUTH_STATE_TTL_MS).toISOString(),
    state,
    stateHash: hashOAuthState(state),
    verifier,
  }
}

export const buildFeishuAuthorizeURL = ({
  appId,
  challenge,
  redirectURI,
  state,
}: {
  appId: string
  challenge?: string
  redirectURI: string
  state: string
}): string => {
  if (!appId.trim() || !redirectURI.trim()) {
    throw new FeishuConfigurationError('Feishu OAuth app ID and redirect URI are required')
  }
  const url = new URL('https://accounts.feishu.cn/open-apis/authen/v1/authorize')
  url.searchParams.set('client_id', appId.trim())
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('redirect_uri', redirectURI.trim())
  url.searchParams.set('scope', FEISHU_OAUTH_SCOPES.join(' '))
  url.searchParams.set('state', state)
  if (challenge) {
    url.searchParams.set('code_challenge', challenge)
    url.searchParams.set('code_challenge_method', 'S256')
  }
  return url.toString()
}

export type FeishuOAuthToken = {
  accessToken: string
  expiresAt: string
  refreshToken: string
  refreshTokenExpiresAt?: string
  scopes: string[]
}

const tokenFromResponse = (body: JsonRecord, clock: () => Date): FeishuOAuthToken => {
  const accessToken = string(body.access_token)
  const refreshToken = string(body.refresh_token)
  const expiresIn = number(body.expires_in)
  if (!accessToken || !refreshToken || !expiresIn) {
    throw new FeishuApiError({
      code: 'invalid_oauth_response',
      message: 'Feishu OAuth response did not include renewable credentials',
      retryable: false,
    })
  }
  const refreshExpiresIn = number(body.refresh_token_expires_in)
  return {
    accessToken,
    expiresAt: new Date(clock().getTime() + expiresIn * 1_000).toISOString(),
    refreshToken,
    ...(refreshExpiresIn
      ? {
          refreshTokenExpiresAt: new Date(
            clock().getTime() + refreshExpiresIn * 1_000,
          ).toISOString(),
        }
      : {}),
    scopes: (string(body.scope) ?? '').split(/\s+/).filter(Boolean),
  }
}

const requestOAuthToken = async ({
  body,
  clock = () => new Date(),
  fetch: fetchImpl = globalThis.fetch,
  signal,
  timeoutMs = FEISHU_OAUTH_REQUEST_TIMEOUT_MS,
}: {
  body: JsonRecord
  clock?: () => Date
  fetch?: FetchLike
  signal?: AbortSignal
  timeoutMs?: number
}): Promise<FeishuOAuthToken> => {
  const { payload, response } = await withFeishuOAuthRequestTimeout({
    operation: async (requestSignal) => {
      const response = await fetchImpl('https://accounts.feishu.cn/oauth/v3/token', {
        body: JSON.stringify(body),
        headers: { 'content-type': 'application/json; charset=utf-8' },
        method: 'POST',
        signal: requestSignal,
      })
      return { payload: await readOAuthJSON(response, requestSignal), response }
    },
    signal,
    timeoutMs,
  })
  if (!response.ok || (number(payload.code) ?? 0) !== 0 || string(payload.error)) {
    throw new FeishuApiError({
      code: number(payload.code) ?? string(payload.error) ?? response.status,
      message: string(payload.error_description) ?? 'Feishu OAuth token request failed',
      retryable:
        response.status >= 500 || number(payload.code) === 20050 || number(payload.code) === 20072,
      status: response.status,
    })
  }
  return tokenFromResponse(payload, clock)
}

export const exchangeFeishuOAuthCode = (input: {
  appId: string
  appSecret: string
  code: string
  codeVerifier?: string
  redirectURI: string
  clock?: () => Date
  fetch?: FetchLike
  signal?: AbortSignal
  timeoutMs?: number
}): Promise<FeishuOAuthToken> =>
  requestOAuthToken({
    body: {
      client_id: input.appId,
      client_secret: input.appSecret,
      code: input.code,
      ...(input.codeVerifier ? { code_verifier: input.codeVerifier } : {}),
      grant_type: 'authorization_code',
      redirect_uri: input.redirectURI,
    },
    clock: input.clock,
    fetch: input.fetch,
    signal: input.signal,
    timeoutMs: input.timeoutMs,
  })

export const refreshFeishuOAuthToken = (input: {
  appId: string
  appSecret: string
  refreshToken: string
  clock?: () => Date
  fetch?: FetchLike
  signal?: AbortSignal
  timeoutMs?: number
}): Promise<FeishuOAuthToken> =>
  requestOAuthToken({
    body: {
      client_id: input.appId,
      client_secret: input.appSecret,
      grant_type: 'refresh_token',
      refresh_token: input.refreshToken,
    },
    clock: input.clock,
    fetch: input.fetch,
    signal: input.signal,
    timeoutMs: input.timeoutMs,
  })

export type FeishuOAuthUser = {
  name?: string
  openId: string
  tenantKey: string
}

export const getFeishuOAuthUser = async ({
  accessToken,
  fetch: fetchImpl = globalThis.fetch,
  signal,
  timeoutMs = FEISHU_OAUTH_REQUEST_TIMEOUT_MS,
}: {
  accessToken: string
  fetch?: FetchLike
  signal?: AbortSignal
  timeoutMs?: number
}): Promise<FeishuOAuthUser> => {
  const { payload: body, response } = await withFeishuOAuthRequestTimeout({
    operation: async (requestSignal) => {
      const response = await fetchImpl('https://open.feishu.cn/open-apis/authen/v1/user_info', {
        headers: { authorization: `Bearer ${accessToken}` },
        signal: requestSignal,
      })
      return { payload: await readOAuthJSON(response, requestSignal), response }
    },
    signal,
    timeoutMs,
  })
  const data = record(body.data) ?? body
  const openId = string(data.open_id)
  const tenantKey = string(data.tenant_key)
  if (!response.ok || number(body.code) !== 0 || !openId || !tenantKey) {
    throw new FeishuApiError({
      code: number(body.code) ?? response.status,
      message: 'Feishu user identity request failed',
      retryable: response.status >= 500,
      status: response.status,
    })
  }
  return { name: string(data.name), openId, tenantKey }
}
