import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

import {
  ProviderPublicationConfirmedError,
  ProviderPublicationResultUnknownError,
  ProviderPublicationTransportError,
} from '../publishingResult'
import {
  buildLinkedInImageBinaryUploadPayload,
  buildLinkedInImageInitializeUploadRequest,
  buildLinkedInImagePostRequest,
  buildLinkedInPostStatusRequest,
  buildLinkedInTextPostRequest,
  parseLinkedInImageInitializeUploadResponse,
  parseLinkedInPostCreationResponse,
  parseLinkedInPostStatusResponse,
  type LinkedInAuthorUrnInput,
  type LinkedInPostCreationResponse,
  type LinkedInPostStatusResponse,
  type LinkedInPublishingHttpRequest,
} from './publishingRequests'

const LINKEDIN_API_ORIGIN = 'https://api.linkedin.com'
const DEFAULT_TIMEOUT_MS = 15_000
const MAX_TOKEN_LENGTH = 8_192

export type LinkedInPublishingAccountKind = 'linkedin-member' | 'linkedin-organization'

export type LinkedInPublishingAccessTokenProvider = (input: {
  accountExternalId: string
  accountKind: LinkedInPublishingAccountKind
}) => Promise<string | undefined>

export type LinkedInPublishingFetch = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Pick<Response, 'headers' | 'json' | 'ok' | 'status'>>

export type LinkedInTextPublishInput = {
  author: LinkedInAuthorUrnInput
  commentary: string
}

export type LinkedInImageInitializeInput = {
  author: LinkedInAuthorUrnInput
}

export type LinkedInImageUploadInput = {
  author: LinkedInAuthorUrnInput
  bytes: Uint8Array
  contentType: string
  ticket: LinkedInImageUploadTicket
}

/** Opaque encrypted capability; the stage authority must enforce single consumption. */
export type LinkedInImageUploadTicket = Readonly<{
  imageUrn: string
  sealedUpload: string
  uploadUrlExpiresAt: number
}>

export type LinkedInImagePublishInput = {
  altText?: string
  author: LinkedInAuthorUrnInput
  commentary: string
  imageUrn: string
}

export type LinkedInPostStatusInput = {
  author: LinkedInAuthorUrnInput
  postUrn: string
}

export interface LinkedInPublishingTransport {
  getPostStatus(input: LinkedInPostStatusInput): Promise<LinkedInPostStatusResponse>
  initializeImageUpload(input: LinkedInImageInitializeInput): Promise<LinkedInImageUploadTicket>
  publishImagePost(input: LinkedInImagePublishInput): Promise<LinkedInPostCreationResponse>
  publishTextPost(input: LinkedInTextPublishInput): Promise<LinkedInPostCreationResponse>
  uploadImage(input: LinkedInImageUploadInput): Promise<void>
}

const normalizedToken = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined
  const token = value.trim()
  return token && token === value && token.length <= MAX_TOKEN_LENGTH && !/\s/u.test(token)
    ? token
    : undefined
}

const invalidRequest = (): ProviderPublicationConfirmedError =>
  new ProviderPublicationConfirmedError('invalid_request', false)

const authorAccount = (
  author: LinkedInAuthorUrnInput,
): { accountExternalId: string; accountKind: LinkedInPublishingAccountKind } =>
  author.kind === 'person'
    ? { accountExternalId: author.personId, accountKind: 'linkedin-member' }
    : {
        accountExternalId: author.organizationId,
        accountKind: 'linkedin-organization',
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

const trustedOrigins = (values: readonly string[], label: string): Set<string> => {
  if (!values.length) throw new Error(`LinkedIn ${label} origin allowlist is required`)
  const origins = new Set<string>()
  for (const value of values) {
    let parsed: URL
    try {
      parsed = new URL(value)
    } catch {
      throw new Error(`LinkedIn ${label} origin is invalid`)
    }
    if (
      parsed.protocol !== 'https:' ||
      parsed.username ||
      parsed.password ||
      parsed.pathname !== '/' ||
      parsed.search ||
      parsed.hash ||
      parsed.origin !== value
    ) {
      throw new Error(`LinkedIn ${label} origin is invalid`)
    }
    origins.add(parsed.origin)
  }
  return origins
}

const requestUrl = (request: LinkedInPublishingHttpRequest): URL => {
  const url = new URL(request.path, LINKEDIN_API_ORIGIN)
  for (const [key, value] of Object.entries(request.query ?? {})) {
    url.searchParams.set(key, value)
  }
  return url
}

/**
 * Low-level LinkedIn Posts/Images API transport. It does not retry mutations;
 * callers must persist a lease-fenced stage before every network operation.
 */
export const createLinkedInPublishingTransport = ({
  allowedUploadOrigins,
  fetch: fetchImpl = globalThis.fetch as LinkedInPublishingFetch,
  linkedInVersion,
  now = Date.now,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  tokenProvider,
  uploadTicketKey,
}: {
  allowedUploadOrigins: readonly string[]
  fetch?: LinkedInPublishingFetch
  linkedInVersion: string
  now?: () => number
  timeoutMs?: number
  tokenProvider: LinkedInPublishingAccessTokenProvider
  /** Stable server-only AES-256 key used to persist provider upload capabilities safely. */
  uploadTicketKey: Buffer
}): LinkedInPublishingTransport => {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 120_000) {
    throw new Error('LinkedIn publishing timeout must be between 1 and 120000 milliseconds')
  }
  if (typeof tokenProvider !== 'function') {
    throw new Error('LinkedIn publishing token provider is required')
  }
  if (!(uploadTicketKey instanceof Buffer) || uploadTicketKey.byteLength !== 32) {
    throw new Error('LinkedIn upload ticket key must contain exactly 32 bytes')
  }
  const ticketKey = Buffer.from(uploadTicketKey)
  const uploadOrigins = trustedOrigins(allowedUploadOrigins, 'upload')
  // Trigger the pure builder's strict YYYYMM validation during construction.
  buildLinkedInTextPostRequest({
    author: { kind: 'person', personId: 'validation' },
    commentary: 'validation',
    linkedInVersion,
  })

  type UploadTicketPayload = {
    accountExternalId: string
    accountKind: LinkedInPublishingAccountKind
    imageUrn: string
    uploadUrl: string
    uploadUrlExpiresAt: number
  }

  const sealUploadTicket = (payload: UploadTicketPayload): string => {
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', ticketKey, iv)
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(payload), 'utf8'),
      cipher.final(),
    ])
    return [
      'v1',
      iv.toString('base64url'),
      cipher.getAuthTag().toString('base64url'),
      ciphertext.toString('base64url'),
    ].join('.')
  }

  const openUploadTicket = (ticket: LinkedInImageUploadTicket): UploadTicketPayload => {
    if (
      !ticket ||
      typeof ticket !== 'object' ||
      typeof ticket.imageUrn !== 'string' ||
      typeof ticket.sealedUpload !== 'string' ||
      typeof ticket.uploadUrlExpiresAt !== 'number'
    ) {
      throw invalidRequest()
    }
    const [version, encodedIV, encodedTag, encodedCiphertext, ...remaining] =
      ticket.sealedUpload.split('.')
    if (version !== 'v1' || !encodedIV || !encodedTag || !encodedCiphertext || remaining.length) {
      throw invalidRequest()
    }
    let plaintext: string
    try {
      const iv = Buffer.from(encodedIV, 'base64url')
      const tag = Buffer.from(encodedTag, 'base64url')
      const ciphertext = Buffer.from(encodedCiphertext, 'base64url')
      if (iv.byteLength !== 12 || tag.byteLength !== 16 || !ciphertext.byteLength) {
        throw invalidRequest()
      }
      const decipher = createDecipheriv('aes-256-gcm', ticketKey, iv)
      decipher.setAuthTag(tag)
      plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
    } catch {
      throw invalidRequest()
    }
    let payload: unknown
    try {
      payload = JSON.parse(plaintext)
    } catch {
      throw invalidRequest()
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw invalidRequest()
    const value = payload as Partial<UploadTicketPayload>
    if (
      typeof value.accountExternalId !== 'string' ||
      (value.accountKind !== 'linkedin-member' && value.accountKind !== 'linkedin-organization') ||
      typeof value.imageUrn !== 'string' ||
      typeof value.uploadUrl !== 'string' ||
      typeof value.uploadUrlExpiresAt !== 'number' ||
      ticket.imageUrn !== value.imageUrn ||
      ticket.uploadUrlExpiresAt !== value.uploadUrlExpiresAt
    ) {
      throw invalidRequest()
    }
    return value as UploadTicketPayload
  }

  const tokenFor = async (author: LinkedInAuthorUrnInput): Promise<string> => {
    const account = authorAccount(author)
    let token: string | undefined
    try {
      token = normalizedToken(await tokenProvider(account))
    } catch {
      throw new ProviderPublicationTransportError()
    }
    if (!token) {
      throw new ProviderPublicationConfirmedError('authorization_required', false)
    }
    return token
  }

  const dispatchJson = async <Result>({
    author,
    mutation,
    parse,
    request,
  }: {
    author: LinkedInAuthorUrnInput
    mutation: boolean
    parse: (response: Pick<Response, 'headers' | 'json'>) => Promise<Result>
    request: LinkedInPublishingHttpRequest
  }): Promise<Result> => {
    const token = await tokenFor(author)
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    let response: Awaited<ReturnType<LinkedInPublishingFetch>>
    try {
      response = await fetchImpl(requestUrl(request), {
        ...(request.body ? { body: JSON.stringify(request.body) } : {}),
        headers: {
          ...request.headers,
          authorization: `Bearer ${token}`,
        },
        method: request.method,
        signal: controller.signal,
      })
    } catch {
      if (mutation) {
        throw new ProviderPublicationResultUnknownError('LinkedIn publication result is unknown')
      }
      throw new ProviderPublicationTransportError()
    } finally {
      clearTimeout(timeout)
    }

    const confirmedFailure = confirmedHttpFailure(response)
    if (confirmedFailure) throw confirmedFailure
    if (!response.ok) {
      if (mutation) {
        throw new ProviderPublicationResultUnknownError('LinkedIn publication result is unknown')
      }
      throw new ProviderPublicationTransportError()
    }
    try {
      return await parse(response)
    } catch (error) {
      if (error instanceof ProviderPublicationResultUnknownError) throw error
      if (mutation) {
        throw new ProviderPublicationResultUnknownError('LinkedIn publication result is unknown')
      }
      throw new ProviderPublicationTransportError()
    }
  }

  const publishTextPost = async (
    input: LinkedInTextPublishInput,
  ): Promise<LinkedInPostCreationResponse> => {
    const request = buildLinkedInTextPostRequest({
      author: input.author,
      commentary: input.commentary,
      linkedInVersion,
    })
    return dispatchJson({
      author: input.author,
      mutation: true,
      parse: async (response) =>
        parseLinkedInPostCreationResponse({ xRestliId: response.headers.get('x-restli-id') }),
      request,
    })
  }

  const initializeImageUpload = async (
    input: LinkedInImageInitializeInput,
  ): Promise<LinkedInImageUploadTicket> => {
    const request = buildLinkedInImageInitializeUploadRequest({
      author: input.author,
      linkedInVersion,
    })
    const initialized = await dispatchJson({
      author: input.author,
      mutation: true,
      parse: async (response) => parseLinkedInImageInitializeUploadResponse(await response.json()),
      request,
    })
    const uploadUrl = new URL(initialized.uploadUrl)
    if (!uploadOrigins.has(uploadUrl.origin)) throw invalidRequest()
    const account = authorAccount(input.author)
    const sealedUpload = sealUploadTicket({
      ...account,
      imageUrn: initialized.imageUrn,
      uploadUrl: initialized.uploadUrl,
      uploadUrlExpiresAt: initialized.uploadUrlExpiresAt,
    })
    const ticket = Object.freeze({
      imageUrn: initialized.imageUrn,
      sealedUpload,
      uploadUrlExpiresAt: initialized.uploadUrlExpiresAt,
    })
    return ticket
  }

  const uploadImage = async (input: LinkedInImageUploadInput): Promise<void> => {
    const storedTicket = openUploadTicket(input.ticket)
    const account = authorAccount(input.author)
    if (
      !storedTicket ||
      storedTicket.accountExternalId !== account.accountExternalId ||
      storedTicket.accountKind !== account.accountKind
    ) {
      throw invalidRequest()
    }
    let payload: ReturnType<typeof buildLinkedInImageBinaryUploadPayload>
    try {
      payload = buildLinkedInImageBinaryUploadPayload({
        bytes: input.bytes,
        contentType: input.contentType,
        nowMilliseconds: now(),
        uploadUrl: storedTicket.uploadUrl,
        uploadUrlExpiresAt: input.ticket.uploadUrlExpiresAt,
      })
    } catch {
      throw invalidRequest()
    }
    const uploadUrl = new URL(payload.uploadUrl)
    if (!uploadOrigins.has(uploadUrl.origin)) throw invalidRequest()
    const token = await tokenFor(input.author)
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    let response: Awaited<ReturnType<LinkedInPublishingFetch>>
    try {
      response = await fetchImpl(uploadUrl, {
        body: Buffer.from(payload.bytes),
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': payload.contentType,
        },
        method: 'PUT',
        signal: controller.signal,
      })
    } catch {
      throw new ProviderPublicationResultUnknownError('LinkedIn image upload result is unknown')
    } finally {
      clearTimeout(timeout)
    }
    const confirmedFailure = confirmedHttpFailure(response)
    if (confirmedFailure) throw confirmedFailure
    if (!response.ok) {
      throw new ProviderPublicationResultUnknownError('LinkedIn image upload result is unknown')
    }
  }

  const publishImagePost = async (
    input: LinkedInImagePublishInput,
  ): Promise<LinkedInPostCreationResponse> => {
    const request = buildLinkedInImagePostRequest({
      author: input.author,
      commentary: input.commentary,
      image: { altText: input.altText, imageUrn: input.imageUrn },
      linkedInVersion,
    })
    return dispatchJson({
      author: input.author,
      mutation: true,
      parse: async (response) =>
        parseLinkedInPostCreationResponse({ xRestliId: response.headers.get('x-restli-id') }),
      request,
    })
  }

  const getPostStatus = async (
    input: LinkedInPostStatusInput,
  ): Promise<LinkedInPostStatusResponse> => {
    const request = buildLinkedInPostStatusRequest({
      linkedInVersion,
      postUrn: input.postUrn,
    })
    return dispatchJson({
      author: input.author,
      mutation: false,
      parse: async (response) => parseLinkedInPostStatusResponse(await response.json()),
      request,
    })
  }

  return {
    getPostStatus,
    initializeImageUpload,
    publishImagePost,
    publishTextPost,
    uploadImage,
  }
}
