import {
  buildMetaConversationReplyRequest,
  parseMetaConversationReplyResponse,
  type MetaConversationReplyPlatform,
  type MetaConversationReplyRequest,
} from './conversationRequests'
import { INSTAGRAM_GRAPH_API_VERSION } from '../instagram/oauth'
import { META_GRAPH_API_VERSION } from './oauth'
import { PlatformConversationOutboundOutcomeUnknownError } from '../conversationOutboundResult'
import type {
  ConfirmedPlatformConversationOutboundErrorCode,
  MessagingPlatform,
  PlatformConversationOutboundRecoveryResult,
  PlatformConversationOutboundRequest,
  PlatformConversationOutboundResult,
} from '../types'
import type { PlatformConversationOutboundPort } from '../ports'

const DEFAULT_TIMEOUT_MS = 15_000
const MAX_ACCOUNT_EXTERNAL_ID_LENGTH = 32
const MAX_DELIVERY_KEY_LENGTH = 200
const MAX_PROVIDER_RESPONSE_BYTES = 64 * 1_024
const MAX_TOKEN_LENGTH = 8_192
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001F\u007F-\u009F]/u
const DECIMAL_ID_PATTERN = /^\d+$/u

export type MetaConversationOutboundFetch = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Pick<Response, 'headers' | 'ok' | 'status' | 'text'>>

export type MetaConversationAccessTokenProvider = (input: {
  accountExternalId: string
  platform: MessagingPlatform
}) => Promise<string | undefined>

const META_CONVERSATION_PLATFORMS: readonly MetaConversationReplyPlatform[] = [
  'facebook-messenger',
  'instagram',
]

const isMetaConversationPlatform = (
  platform: MessagingPlatform,
): platform is MetaConversationReplyPlatform =>
  (META_CONVERSATION_PLATFORMS as readonly string[]).includes(platform)

const providerOriginAndVersion = (
  platform: MetaConversationReplyPlatform,
): { origin: string; version: string } => {
  if (platform === 'instagram') {
    return { origin: 'https://graph.instagram.com', version: INSTAGRAM_GRAPH_API_VERSION }
  }
  return { origin: 'https://graph.facebook.com', version: META_GRAPH_API_VERSION }
}

const normalizedToken = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined
  const token = value.trim()
  if (!token || token !== value || token.length > MAX_TOKEN_LENGTH || /\s/.test(token)) {
    return undefined
  }
  return token
}

const exactBoundedString = (value: unknown, maximumLength: number): string | undefined => {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  return normalized &&
    normalized === value &&
    normalized.length <= maximumLength &&
    !CONTROL_CHARACTER_PATTERN.test(normalized)
    ? normalized
    : undefined
}

const exactDecimalId = (value: unknown, maximumLength: number): string | undefined => {
  const normalized = exactBoundedString(value, maximumLength)
  return normalized && DECIMAL_ID_PATTERN.test(normalized) ? normalized : undefined
}

const exactMessageText = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  return normalized && normalized === value && normalized.length <= 5_000 ? normalized : undefined
}

const retryAfterSeconds = (headers: Headers): number | undefined => {
  const value = headers.get('retry-after')
  if (!value || !/^\d+$/.test(value)) return undefined
  const seconds = Number(value)
  return Number.isSafeInteger(seconds) && seconds > 0 ? seconds : undefined
}

const blocked = (
  request: Pick<PlatformConversationOutboundRequest, 'deliveryKey' | 'platform'>,
  errorCode: ConfirmedPlatformConversationOutboundErrorCode,
  retryable: boolean,
  retryAfterSeconds?: number,
): PlatformConversationOutboundResult => {
  if (retryable) {
    return {
      deliveryKey: request.deliveryKey,
      errorCode,
      platform: request.platform,
      ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}),
      retryable: true,
      status: 'blocked',
    }
  }
  return {
    deliveryKey: request.deliveryKey,
    errorCode,
    platform: request.platform,
    retryable: false,
    status: 'blocked',
  }
}

const confirmedHttpFailure = (
  request: PlatformConversationOutboundRequest,
  response: Pick<Response, 'headers' | 'status'>,
): PlatformConversationOutboundResult | undefined => {
  if (response.status === 400 || response.status === 404 || response.status === 422) {
    return blocked(request, 'invalid_request', false)
  }
  if (response.status === 401) {
    return blocked(request, 'authorization_required', false)
  }
  if (response.status === 403) {
    return blocked(request, 'permission_required', false)
  }
  if (response.status === 429) {
    return blocked(request, 'rate_limited', true, retryAfterSeconds(response.headers))
  }
  if (response.status >= 400 && response.status < 500) {
    return blocked(request, 'platform_blocked', false)
  }
  return undefined
}

/**
 * Server-only Meta conversation outbound adapter for the phase-one automatic
 * reply contract. It supports facebook-messenger and instagram only; TikTok is
 * rejected before any token lookup or network call.
 *
 * The adapter uses the credential-free Send API request builder, attaches a
 * decrypted provider access token at transport time, and fails closed as
 * `delivery_unknown` whenever the provider may have accepted a request but a
 * trustworthy acceptance result cannot be recovered.
 */
export const createMetaConversationOutboundAdapter = ({
  fetch: fetchImpl = globalThis.fetch as MetaConversationOutboundFetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  tokenProvider,
}: {
  fetch?: MetaConversationOutboundFetch
  timeoutMs?: number
  tokenProvider: MetaConversationAccessTokenProvider
}): PlatformConversationOutboundPort => {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 120_000) {
    throw new Error('Meta conversation outbound timeout must be between 1 and 120000 milliseconds')
  }
  if (typeof tokenProvider !== 'function') {
    throw new Error('Meta conversation outbound token provider is required')
  }
  if (typeof fetchImpl !== 'function') {
    throw new Error('Meta conversation outbound fetch implementation is required')
  }

  const send = async (
    input: PlatformConversationOutboundRequest,
  ): Promise<PlatformConversationOutboundResult> => {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new Error('Meta conversation outbound request is invalid')
    }
    const platform = (input as Partial<PlatformConversationOutboundRequest>).platform
    const deliveryKey = exactBoundedString(
      (input as Partial<PlatformConversationOutboundRequest>).deliveryKey,
      MAX_DELIVERY_KEY_LENGTH,
    )
    if (
      !deliveryKey ||
      !platform ||
      !['facebook-messenger', 'instagram', 'tiktok'].includes(platform)
    ) {
      throw new Error('Meta conversation outbound request identity is invalid')
    }
    const resultIdentity = { deliveryKey, platform }
    if (!isMetaConversationPlatform(platform)) {
      return blocked(resultIdentity, 'invalid_request', false)
    }
    const accountExternalId = exactDecimalId(
      input.accountExternalId,
      MAX_ACCOUNT_EXTERNAL_ID_LENGTH,
    )
    const recipientExternalId = exactDecimalId(input.recipientExternalId, 64)
    const text = exactMessageText(input.text)
    if (!accountExternalId || !recipientExternalId || !text) {
      return blocked(resultIdentity, 'invalid_request', false)
    }
    const request = {
      accountExternalId,
      deliveryKey,
      platform,
      recipientExternalId,
      text,
    } satisfies PlatformConversationOutboundRequest
    let providerRequest: MetaConversationReplyRequest
    try {
      providerRequest = buildMetaConversationReplyRequest({
        accountExternalId: request.accountExternalId,
        platform: request.platform,
        recipientExternalId: request.recipientExternalId,
        text: request.text,
      })
    } catch {
      return blocked(request, 'invalid_request', false)
    }

    let token: string | undefined
    try {
      token = normalizedToken(
        await tokenProvider({
          accountExternalId: request.accountExternalId,
          platform: request.platform,
        }),
      )
    } catch {
      return blocked(request, 'provider_unavailable', true)
    }
    if (!token) {
      return blocked(request, 'authorization_required', false)
    }

    const { origin, version } = providerOriginAndVersion(request.platform)
    const controller = new AbortController()
    let rejectTimeout: ((error: Error) => void) | undefined
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      rejectTimeout = reject
    })
    const timeout = setTimeout(() => {
      controller.abort()
      rejectTimeout?.(new Error('Meta conversation outbound timed out'))
    }, timeoutMs)
    try {
      const response = await Promise.race([
        fetchImpl(new URL(`/${version}${providerRequest.path}`, origin), {
          body: JSON.stringify(providerRequest.body),
          headers: {
            accept: 'application/json',
            authorization: `Bearer ${token}`,
            'content-type': 'application/json',
          },
          method: providerRequest.method,
          signal: controller.signal,
        }),
        timeoutPromise,
      ])

      const confirmedFailure = confirmedHttpFailure(request, response)
      if (confirmedFailure) return confirmedFailure
      if (!response.ok) throw new Error('Meta conversation outbound response was not successful')

      const contentLength = response.headers.get('content-length')
      if (contentLength && /^\d+$/u.test(contentLength)) {
        const declaredBytes = Number(contentLength)
        if (!Number.isSafeInteger(declaredBytes) || declaredBytes > MAX_PROVIDER_RESPONSE_BYTES) {
          throw new Error('Meta conversation outbound response is too large')
        }
      }
      const rawResponse = await Promise.race([response.text(), timeoutPromise])
      if (new TextEncoder().encode(rawResponse).byteLength > MAX_PROVIDER_RESPONSE_BYTES) {
        throw new Error('Meta conversation outbound response is too large')
      }
      const acceptance = parseMetaConversationReplyResponse(JSON.parse(rawResponse))
      if (acceptance.recipientExternalId !== request.recipientExternalId) {
        throw new Error('Meta conversation outbound response identity does not match')
      }

      return {
        deliveryKey: request.deliveryKey,
        platform: request.platform,
        status: 'accepted',
      }
    } catch {
      throw new PlatformConversationOutboundOutcomeUnknownError({
        deliveryKey: request.deliveryKey,
        platform: request.platform,
      })
    } finally {
      clearTimeout(timeout)
    }
  }

  const recoverUnknownOutcome = async (
    request: PlatformConversationOutboundRequest,
  ): Promise<PlatformConversationOutboundRecoveryResult> => ({
    deliveryKey: request.deliveryKey,
    platform: request.platform,
    status: 'delivery_unknown',
  })

  return { recoverUnknownOutcome, send }
}
