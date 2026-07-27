import { getPayload, type Payload } from 'payload'

import { createFixedWindowRateLimiter, type RateLimiter } from '@/lib/security/rateLimit'
import config from '@/payload.config'

import { PayloadPlatformEventRepository } from '../payloadEventRepository'
import {
  PayloadPlatformMessagingAccountAuthorizer,
  type PlatformMessagingAccountAuthorizer,
} from '../payloadMessagingAccountAuthorizer'
import type { PlatformConnector, PlatformEventRepository, WebhookRateLimiter } from '../ports'
import {
  createMetaWebhookVerifier,
  ingestSignedWebhook,
  verifyMetaWebhookChallenge,
  WebhookValidationError,
} from '../webhook'
import { createMetaConnector } from './connector'

const DEFAULT_MAX_BODY_BYTES = 1_000_000
// Meta Graph webhooks retry failed delivery over the following 36 hours.
// Keep a small clock/queue margin so a legitimate delayed retry reaches Jobs.
export const META_WEBHOOK_MAX_EVENT_AGE_MS = 48 * 60 * 60 * 1_000
const META_WEBHOOK_RATE_LIMIT_PER_MINUTE = 120
const META_WEBHOOK_RATE_LIMIT_RETRY_AFTER_SECONDS = 60
const NO_STORE_HEADERS = { 'cache-control': 'no-store' }

type PayloadProvider = () => Promise<Payload>

export type MetaWebhookHandlerDependencies = {
  accountAuthorizer?: PlatformMessagingAccountAuthorizer
  allowedAccountExternalIds?: readonly string[]
  appSecret?: string
  connector?: PlatformConnector
  maxBodyBytes?: number
  now?: () => number
  payloadProvider?: PayloadProvider
  rateLimiter?: WebhookRateLimiter
  repository?: PlatformEventRepository
  verifyToken?: string
}

export type MetaWebhookHandlers = {
  GET: (request: Request) => Promise<Response>
  POST: (request: Request) => Promise<Response>
}

const defaultPayloadProvider: PayloadProvider = () =>
  getPayload({ config, disableOnInit: true, key: 'meta-webhook' })

const createWebhookRateLimiter = (limiter: RateLimiter): WebhookRateLimiter => ({
  consume: async (key) => limiter.consume(key).allowed,
})

const defaultRateLimiter = createWebhookRateLimiter(
  createFixedWindowRateLimiter({
    limit: META_WEBHOOK_RATE_LIMIT_PER_MINUTE,
    windowMs: META_WEBHOOK_RATE_LIMIT_RETRY_AFTER_SECONDS * 1_000,
  }),
)

const safeErrorResponse = (code: string, status: number, headers: HeadersInit = {}): Response => {
  const responseHeaders = new Headers({ ...NO_STORE_HEADERS, ...headers })
  if (code === 'rate_limited') {
    responseHeaders.set('Retry-After', String(META_WEBHOOK_RATE_LIMIT_RETRY_AFTER_SECONDS))
  }
  return Response.json({ error: { code } }, { headers: responseHeaders, status })
}

const webhookErrorResponse = (error: unknown): Response => {
  if (!(error instanceof WebhookValidationError)) {
    return safeErrorResponse('service_unavailable', 503)
  }

  switch (error.code) {
    case 'invalid_challenge':
      return safeErrorResponse(error.code, 403)
    case 'unauthorized_account':
      return safeErrorResponse(error.code, 403)
    case 'invalid_signature':
      return safeErrorResponse(error.code, 401)
    case 'invalid_content_type':
    case 'invalid_payload':
    case 'future_event':
    case 'stale_event':
      return safeErrorResponse(error.code, 400)
    case 'payload_too_large':
      return safeErrorResponse(error.code, 413)
    case 'rate_limited':
      return safeErrorResponse(error.code, 429)
    case 'idempotency_conflict':
      return safeErrorResponse(error.code, 409)
  }
}

const readRawBody = async (request: Request, maxBodyBytes: number): Promise<Uint8Array> => {
  const contentLength = Number(request.headers.get('content-length') ?? 0)
  if (Number.isFinite(contentLength) && contentLength > maxBodyBytes) {
    throw new WebhookValidationError('payload_too_large', 'Webhook payload exceeds the size limit')
  }
  if (!request.body) return new Uint8Array()

  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let byteLength = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      byteLength += value.byteLength
      if (byteLength > maxBodyBytes) {
        await reader.cancel().catch(() => undefined)
        throw new WebhookValidationError(
          'payload_too_large',
          'Webhook payload exceeds the size limit',
        )
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }

  const body = new Uint8Array(byteLength)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return body
}

const requestHeaders = (request: Request): Record<string, string> =>
  Object.fromEntries(request.headers.entries())

const configuredValue = (value: string | undefined): string | undefined => {
  const normalized = value?.trim()
  return normalized || undefined
}

export const createMetaWebhookHandlers = ({
  accountAuthorizer,
  allowedAccountExternalIds = process.env.META_WEBHOOK_ALLOWED_ACCOUNT_IDS?.split(',') ?? [],
  appSecret = process.env.META_WEBHOOK_APP_SECRET,
  connector = createMetaConnector(),
  maxBodyBytes = DEFAULT_MAX_BODY_BYTES,
  now = Date.now,
  payloadProvider = defaultPayloadProvider,
  rateLimiter = defaultRateLimiter,
  repository,
  verifyToken = process.env.META_WEBHOOK_VERIFY_TOKEN,
}: MetaWebhookHandlerDependencies = {}): MetaWebhookHandlers => {
  const configuredAppSecret = configuredValue(appSecret)
  const configuredVerifyToken = configuredValue(verifyToken)
  const allowedAccounts = new Set(
    allowedAccountExternalIds
      .map(configuredValue)
      .filter((accountExternalId): accountExternalId is string => Boolean(accountExternalId)),
  )
  const isChallengeConfigured = Boolean(configuredAppSecret && configuredVerifyToken)
  const isIngressConfigured = Boolean(isChallengeConfigured && allowedAccounts.size > 0)

  const unavailable = (): Response => safeErrorResponse('service_unavailable', 503)
  const resolveRepository = async (): Promise<PlatformEventRepository> => {
    let resolvedPayload: Payload | undefined
    const getResolvedPayload = async (): Promise<Payload> => {
      resolvedPayload ??= await payloadProvider()
      return resolvedPayload
    }
    const resolvedRepository =
      repository ?? new PayloadPlatformEventRepository({ payload: await getResolvedPayload() })
    const resolvedAccountAuthorizer =
      accountAuthorizer ??
      new PayloadPlatformMessagingAccountAuthorizer({ payload: await getResolvedPayload() })

    return {
      async enqueueBatch(events) {
        const checks = new Map<string, Promise<void>>()
        try {
          for (const { event } of events) {
            const key = `${event.platform}\u0000${event.accountExternalId}`
            let check = checks.get(key)
            if (!check) {
              check = resolvedAccountAuthorizer.assertCanReceive(event)
              checks.set(key, check)
            }
            await check
          }
        } catch {
          throw new WebhookValidationError(
            'unauthorized_account',
            'Webhook account is not authorized',
          )
        }
        return resolvedRepository.enqueueBatch(events)
      },
    }
  }

  return {
    GET: async (request) => {
      if (!isChallengeConfigured || !configuredVerifyToken) return unavailable()
      try {
        const url = new URL(request.url)
        const challenge = verifyMetaWebhookChallenge({
          challenge: url.searchParams.get('hub.challenge') ?? undefined,
          expectedVerifyToken: configuredVerifyToken,
          mode: url.searchParams.get('hub.mode') ?? undefined,
          verifyToken: url.searchParams.get('hub.verify_token') ?? undefined,
        })
        return new Response(challenge, {
          headers: { ...NO_STORE_HEADERS, 'content-type': 'text/plain; charset=utf-8' },
          status: 200,
        })
      } catch (error) {
        return webhookErrorResponse(error)
      }
    },
    POST: async (request) => {
      if (!isIngressConfigured || !configuredAppSecret) return unavailable()
      try {
        const rawBody = await readRawBody(request, maxBodyBytes)
        const result = await ingestSignedWebhook({
          connector,
          eventAuthorizer: (event) => {
            if (!allowedAccounts.has(event.accountExternalId)) {
              throw new WebhookValidationError(
                'unauthorized_account',
                'Webhook account is not authorized',
              )
            }
          },
          headers: requestHeaders(request),
          maxBodyBytes,
          maxEventAgeMs: META_WEBHOOK_MAX_EVENT_AGE_MS,
          nowMs: now(),
          rateLimiter,
          rateLimitKeyForEvent: (event) =>
            `meta-webhook:${event.platform}:${event.accountExternalId}`,
          rawBody,
          repository: resolveRepository,
          verifier: createMetaWebhookVerifier(configuredAppSecret),
        })
        return Response.json(result, { headers: NO_STORE_HEADERS, status: 200 })
      } catch (error) {
        return webhookErrorResponse(error)
      }
    },
  }
}
