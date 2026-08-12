import {
  PlatformConversationOutboundOutcomeUnknownError,
  PlatformConversationOutboundTransportError,
} from '../conversationOutboundResult'
import type { PlatformConversationOutboundPort } from '../ports'
import type {
  PlatformConversationOutboundRecoveryResult,
  PlatformConversationOutboundRequest,
  PlatformConversationOutboundResult,
} from '../types'
import {
  buildMetaConversationReplyRequest,
  MetaConversationReplyError,
  parseMetaConversationReplyResponse,
  type MetaConversationReplyPlatform,
} from './conversationRequests'
import { META_GRAPH_API_VERSION } from './oauth'

const META_GRAPH_ORIGIN = 'https://graph.facebook.com'
const MAX_TOKEN_LENGTH = 8_192
const DEFAULT_TIMEOUT_MS = 15_000

export type MetaConversationAccessTokenProvider = (input: {
  accountExternalId: string
  platform: MetaConversationReplyPlatform
}) => Promise<string>

export type MetaConversationFetch = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Pick<Response, 'json' | 'ok' | 'status' | 'headers'>>

const blocked = (
  request: PlatformConversationOutboundRequest,
  result:
    | { errorCode: 'rate_limited'; retryAfterSeconds?: number; retryable: true }
    | {
        errorCode:
          'authorization_required' | 'invalid_request' | 'permission_required' | 'platform_blocked'
        retryable: false
      },
): PlatformConversationOutboundResult => ({
  deliveryKey: request.deliveryKey,
  platform: request.platform,
  status: 'blocked',
  ...result,
})

const retryAfterSeconds = (headers: Headers): number | undefined => {
  const value = headers.get('retry-after')
  if (!value || !/^\d+$/.test(value)) return undefined
  const seconds = Number(value)
  return Number.isSafeInteger(seconds) && seconds > 0 ? seconds : undefined
}

const confirmedHttpFailure = (
  request: PlatformConversationOutboundRequest,
  response: Pick<Response, 'status' | 'headers'>,
): PlatformConversationOutboundResult | undefined => {
  if (response.status === 400 || response.status === 404 || response.status === 422) {
    return blocked(request, { errorCode: 'invalid_request', retryable: false })
  }
  if (response.status === 401) {
    return blocked(request, { errorCode: 'authorization_required', retryable: false })
  }
  if (response.status === 403) {
    return blocked(request, { errorCode: 'permission_required', retryable: false })
  }
  if (response.status === 429) {
    const retryAfter = retryAfterSeconds(response.headers)
    return blocked(request, {
      errorCode: 'rate_limited',
      ...(retryAfter ? { retryAfterSeconds: retryAfter } : {}),
      retryable: true,
    })
  }
  if (response.status >= 400 && response.status < 500) {
    return blocked(request, { errorCode: 'platform_blocked', retryable: false })
  }
  return undefined
}

const normalizedToken = (value: string): string | undefined => {
  if (typeof value !== 'string') return undefined
  const token = value.trim()
  if (!token || token !== value || token.length > MAX_TOKEN_LENGTH || /\s/.test(token)) {
    return undefined
  }
  return token
}

/**
 * Minimal Meta Send API transport. The injected token provider is the only
 * component that sees decrypted credentials. After fetch is invoked, every
 * non-confirmed result fails closed as delivery_unknown because Meta provides
 * no deliveryKey idempotency mechanism or acceptance lookup.
 */
export const createMetaConversationOutboundPort = ({
  fetch: fetchImpl = globalThis.fetch as MetaConversationFetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  tokenProvider,
}: {
  fetch?: MetaConversationFetch
  timeoutMs?: number
  tokenProvider: MetaConversationAccessTokenProvider
}): PlatformConversationOutboundPort => {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 120_000) {
    throw new Error('Meta conversation timeout must be between 1 and 120000 milliseconds')
  }
  const send = async (
    request: PlatformConversationOutboundRequest,
  ): Promise<PlatformConversationOutboundResult> => {
    let providerRequest
    try {
      providerRequest = buildMetaConversationReplyRequest({
        platform: request.platform as MetaConversationReplyPlatform,
        recipientExternalId: request.recipientExternalId,
        text: request.text,
      })
    } catch (error) {
      if (error instanceof MetaConversationReplyError) {
        return blocked(request, { errorCode: 'invalid_request', retryable: false })
      }
      throw new PlatformConversationOutboundTransportError(request)
    }

    let token: string | undefined
    try {
      token = normalizedToken(
        await tokenProvider({
          accountExternalId: request.accountExternalId,
          platform: providerRequest.body.messaging_type
            ? (request.platform as MetaConversationReplyPlatform)
            : 'facebook-messenger',
        }),
      )
    } catch {
      throw new PlatformConversationOutboundTransportError(request)
    }
    if (!token) {
      return blocked(request, { errorCode: 'authorization_required', retryable: false })
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    let response: Awaited<ReturnType<MetaConversationFetch>>
    try {
      const url = new URL(`/${META_GRAPH_API_VERSION}${providerRequest.path}`, META_GRAPH_ORIGIN)
      response = await fetchImpl(url, {
        body: JSON.stringify(providerRequest.body),
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        method: providerRequest.method,
        signal: controller.signal,
      })
    } catch {
      throw new PlatformConversationOutboundOutcomeUnknownError(request)
    } finally {
      clearTimeout(timeout)
    }

    const confirmedFailure = confirmedHttpFailure(request, response)
    if (confirmedFailure) return confirmedFailure
    if (!response.ok) {
      throw new PlatformConversationOutboundOutcomeUnknownError(request)
    }

    try {
      const acceptance = parseMetaConversationReplyResponse(await response.json())
      if (acceptance.recipientExternalId !== providerRequest.body.recipient.id) {
        throw new MetaConversationReplyError('Meta response recipient does not match the request')
      }
    } catch {
      throw new PlatformConversationOutboundOutcomeUnknownError(request)
    }

    return {
      deliveryKey: request.deliveryKey,
      platform: request.platform,
      status: 'accepted',
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
