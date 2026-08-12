import {
  ProviderPublicationConfirmedError,
  ProviderPublicationResultUnknownError,
  ProviderPublicationTransportError,
} from '../publishingResult'
import {
  buildFacebookPagePhotoRequest,
  buildInstagramContainerStatusRequest,
  buildInstagramMediaPublishRequest,
  buildInstagramMediaRequest,
  parseFacebookPagePhotoResponse,
  parseInstagramContainerStatusResponse,
  parseInstagramMediaPublishResponse,
  parseInstagramMediaResponse,
  type FacebookPagePhotoResponse,
  type InstagramMediaPublishResponse,
  type InstagramMediaResponse,
  type MetaPublishingHttpRequest,
} from './publishingRequests'
import { META_GRAPH_API_VERSION } from './oauth'

const META_GRAPH_ORIGIN = 'https://graph.facebook.com'
const MAX_TOKEN_LENGTH = 8_192
const DEFAULT_TIMEOUT_MS = 15_000

export type MetaPublishingPlatform = 'facebook' | 'instagram'

export type MetaPublishingAccessTokenProvider = (input: {
  accountExternalId: string
  platform: MetaPublishingPlatform
}) => Promise<string | undefined>

export type MetaPublishingFetch = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Pick<Response, 'headers' | 'json' | 'ok' | 'status'>>

export type FacebookPagePhotoPublishInput = {
  accountExternalId: string
  caption?: string
  url: string
}

export type InstagramMediaCreateInput = {
  accountExternalId: string
  caption?: string
  imageUrl: string
}

export type InstagramContainerStatusInput = {
  accountExternalId: string
  containerId: string
}

export type InstagramContainerPublicationState =
  | { state: 'failed' }
  | { state: 'pending' }
  | { state: 'published' }
  | { state: 'ready' }

export type InstagramMediaPublishInput = {
  accountExternalId: string
  creationId: string
}

export interface MetaPublishingTransport {
  createInstagramMedia(input: InstagramMediaCreateInput): Promise<InstagramMediaResponse>
  getInstagramContainerStatus(
    input: InstagramContainerStatusInput,
  ): Promise<InstagramContainerPublicationState>
  publishFacebookPagePhoto(
    input: FacebookPagePhotoPublishInput,
  ): Promise<FacebookPagePhotoResponse>
  publishInstagramMedia(
    input: InstagramMediaPublishInput,
  ): Promise<InstagramMediaPublishResponse>
}

const normalizedToken = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined
  const token = value.trim()
  if (!token || token !== value || token.length > MAX_TOKEN_LENGTH || /\s/.test(token)) {
    return undefined
  }
  return token
}

const retryAfterSeconds = (headers: Headers): number | undefined => {
  const value = headers.get('retry-after')
  if (!value || !/^\d+$/.test(value)) return undefined
  const seconds = Number(value)
  return Number.isSafeInteger(seconds) && seconds > 0 ? seconds : undefined
}

const confirmedHttpFailure = (
  response: Pick<Response, 'headers' | 'status'>,
): ProviderPublicationConfirmedError | undefined => {
  if (response.status === 400 || response.status === 404 || response.status === 422) {
    return new ProviderPublicationConfirmedError('invalid_request', false)
  }
  if (response.status === 401) {
    return new ProviderPublicationConfirmedError('authorization_required', false)
  }
  if (response.status === 403) {
    return new ProviderPublicationConfirmedError('permission_required', false)
  }
  if (response.status === 429) {
    return new ProviderPublicationConfirmedError(
      'rate_limited',
      true,
      retryAfterSeconds(response.headers),
    )
  }
  if (response.status >= 400 && response.status < 500) {
    return new ProviderPublicationConfirmedError('platform_blocked', false)
  }
  return undefined
}

const invalidRequest = (): ProviderPublicationConfirmedError =>
  new ProviderPublicationConfirmedError('invalid_request', false)

const trustedMediaOrigins = (value: readonly string[]): Set<string> => {
  if (!value.length) throw new Error('Meta publishing requires a trusted media origin')
  const origins = new Set<string>()
  for (const candidate of value) {
    let parsed: URL
    try {
      parsed = new URL(candidate)
    } catch {
      throw new Error('Meta trusted media origin is invalid')
    }
    if (
      parsed.protocol !== 'https:' ||
      parsed.username ||
      parsed.password ||
      parsed.pathname !== '/' ||
      parsed.search ||
      parsed.hash ||
      parsed.origin !== candidate
    ) {
      throw new Error('Meta trusted media origin is invalid')
    }
    origins.add(parsed.origin)
  }
  return origins
}

export const createMetaPublishingTransport = ({
  allowedMediaOrigins,
  fetch: fetchImpl = globalThis.fetch as MetaPublishingFetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  tokenProvider,
}: {
  allowedMediaOrigins: readonly string[]
  fetch?: MetaPublishingFetch
  timeoutMs?: number
  tokenProvider: MetaPublishingAccessTokenProvider
}): MetaPublishingTransport => {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 120_000) {
    throw new Error('Meta publishing timeout must be between 1 and 120000 milliseconds')
  }
  if (typeof tokenProvider !== 'function') {
    throw new Error('Meta publishing token provider is required')
  }
  const mediaOrigins = trustedMediaOrigins(allowedMediaOrigins)

  const requireTrustedMediaUrl = (value: string): void => {
    let parsed: URL
    try {
      parsed = new URL(value)
    } catch {
      throw invalidRequest()
    }
    if (!mediaOrigins.has(parsed.origin)) throw invalidRequest()
  }

  const dispatch = async <Result>({
    accountExternalId,
    parse,
    platform,
    providerRequest,
  }: {
    accountExternalId: string
    parse: (value: unknown) => Result
    platform: MetaPublishingPlatform
    providerRequest: MetaPublishingHttpRequest
  }): Promise<Result> => {
    let token: string | undefined
    try {
      token = normalizedToken(await tokenProvider({ accountExternalId, platform }))
    } catch {
      throw new ProviderPublicationTransportError()
    }
    if (!token) {
      throw new ProviderPublicationConfirmedError('authorization_required', false)
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    let response: Awaited<ReturnType<MetaPublishingFetch>>
    try {
      const url = new URL(`/${META_GRAPH_API_VERSION}${providerRequest.path}`, META_GRAPH_ORIGIN)
      for (const [key, value] of Object.entries(providerRequest.query ?? {})) {
        url.searchParams.set(key, value)
      }
      response = await fetchImpl(url, {
        ...(providerRequest.body ? { body: JSON.stringify(providerRequest.body) } : {}),
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${token}`,
          ...(providerRequest.body ? { 'content-type': 'application/json' } : {}),
        },
        method: providerRequest.method,
        signal: controller.signal,
      })
    } catch {
      throw new ProviderPublicationResultUnknownError('Meta publication result is unknown')
    } finally {
      clearTimeout(timeout)
    }

    const confirmedFailure = confirmedHttpFailure(response)
    if (confirmedFailure) throw confirmedFailure
    if (!response.ok) {
      throw new ProviderPublicationResultUnknownError('Meta publication result is unknown')
    }
    try {
      return parse(await response.json())
    } catch {
      throw new ProviderPublicationResultUnknownError('Meta publication result is unknown')
    }
  }

  const publishFacebookPagePhoto = async (
    input: FacebookPagePhotoPublishInput,
  ): Promise<FacebookPagePhotoResponse> => {
    let providerRequest: MetaPublishingHttpRequest
    try {
      requireTrustedMediaUrl(input.url)
      providerRequest = buildFacebookPagePhotoRequest({
        caption: input.caption,
        pageId: input.accountExternalId,
        url: input.url,
      })
    } catch {
      throw invalidRequest()
    }
    return dispatch({
      accountExternalId: input.accountExternalId,
      parse: parseFacebookPagePhotoResponse,
      platform: 'facebook',
      providerRequest,
    })
  }

  const createInstagramMedia = async (
    input: InstagramMediaCreateInput,
  ): Promise<InstagramMediaResponse> => {
    let providerRequest: MetaPublishingHttpRequest
    try {
      requireTrustedMediaUrl(input.imageUrl)
      providerRequest = buildInstagramMediaRequest({
        caption: input.caption,
        igId: input.accountExternalId,
        imageUrl: input.imageUrl,
      })
    } catch {
      throw invalidRequest()
    }
    return dispatch({
      accountExternalId: input.accountExternalId,
      parse: parseInstagramMediaResponse,
      platform: 'instagram',
      providerRequest,
    })
  }

  const getInstagramContainerStatus = async (
    input: InstagramContainerStatusInput,
  ): Promise<InstagramContainerPublicationState> => {
    let providerRequest: MetaPublishingHttpRequest
    try {
      buildInstagramMediaPublishRequest({
        creationId: input.containerId,
        igId: input.accountExternalId,
      })
      providerRequest = buildInstagramContainerStatusRequest({ containerId: input.containerId })
    } catch {
      throw invalidRequest()
    }
    const result = await dispatch({
      accountExternalId: input.accountExternalId,
      parse: parseInstagramContainerStatusResponse,
      platform: 'instagram',
      providerRequest,
    })
    if (result.statusCode === 'FINISHED') return { state: 'ready' }
    if (result.statusCode === 'IN_PROGRESS') return { state: 'pending' }
    if (result.statusCode === 'PUBLISHED') return { state: 'published' }
    return { state: 'failed' }
  }

  const publishInstagramMedia = async (
    input: InstagramMediaPublishInput,
  ): Promise<InstagramMediaPublishResponse> => {
    let providerRequest: MetaPublishingHttpRequest
    try {
      providerRequest = buildInstagramMediaPublishRequest({
        creationId: input.creationId,
        igId: input.accountExternalId,
      })
    } catch {
      throw invalidRequest()
    }
    return dispatch({
      accountExternalId: input.accountExternalId,
      parse: parseInstagramMediaPublishResponse,
      platform: 'instagram',
      providerRequest,
    })
  }

  return {
    createInstagramMedia,
    getInstagramContainerStatus,
    publishFacebookPagePhoto,
    publishInstagramMedia,
  }
}
