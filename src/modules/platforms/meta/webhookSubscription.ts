import { INSTAGRAM_GRAPH_API_VERSION } from '../instagram/oauth'
import { META_GRAPH_API_VERSION } from './oauth'

const DEFAULT_TIMEOUT_MS = 15_000
const MAX_RESPONSE_BYTES = 64 * 1_024
const MAX_TOKEN_LENGTH = 8_192

export type MetaWebhookSubscriptionPlatform = 'facebook-messenger' | 'instagram'

export type MetaWebhookSubscriptionFetch = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Pick<Response, 'headers' | 'ok' | 'status' | 'text'>>

export class MetaWebhookSubscriptionError extends Error {
  constructor() {
    super('Meta messaging webhook subscription failed')
    this.name = 'MetaWebhookSubscriptionError'
  }
}

export const isMetaWebhookAccountConfigured = ({
  accountExternalId,
  environment = process.env,
  platform = 'facebook-messenger',
}: {
  accountExternalId: string
  environment?: Readonly<Record<string, string | undefined>>
  platform?: MetaWebhookSubscriptionPlatform
}): boolean => {
  const accountId = exactDecimalId(accountExternalId)
  const verifyToken = environment.META_WEBHOOK_VERIFY_TOKEN?.trim()
  const allowedAccountIds = new Set(
    (environment.META_WEBHOOK_ALLOWED_ACCOUNT_IDS ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  )
  return Boolean(
    accountId &&
    verifyToken &&
    (platform === 'instagram' || allowedAccountIds.has(accountId)),
  )
}

const exactDecimalId = (value: unknown): string | undefined =>
  typeof value === 'string' && /^[1-9]\d{0,31}$/u.test(value) ? value : undefined

const exactToken = (value: unknown): string | undefined =>
  typeof value === 'string' &&
  value === value.trim() &&
  value.length > 0 &&
  value.length <= MAX_TOKEN_LENGTH &&
  !/\s/u.test(value)
    ? value
    : undefined

const providerOriginAndVersion = (
  platform: MetaWebhookSubscriptionPlatform,
): { origin: string; version: string } =>
  platform === 'instagram'
    ? { origin: 'https://graph.instagram.com', version: INSTAGRAM_GRAPH_API_VERSION }
    : { origin: 'https://graph.facebook.com', version: META_GRAPH_API_VERSION }

/**
 * Subscribe one already-authorized Page or Instagram professional account to
 * the app-level `messages` webhook. App Dashboard callback/field setup remains
 * a deployment prerequisite; this call only binds the selected asset.
 */
export const subscribeMetaMessagingWebhook = async ({
  accessToken,
  accountExternalId,
  fetch: fetchImpl = globalThis.fetch as MetaWebhookSubscriptionFetch,
  platform,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}: {
  accessToken: string
  accountExternalId: string
  fetch?: MetaWebhookSubscriptionFetch
  platform: MetaWebhookSubscriptionPlatform
  timeoutMs?: number
}): Promise<void> => {
  const accountId = exactDecimalId(accountExternalId)
  const token = exactToken(accessToken)
  if (
    !accountId ||
    !token ||
    (platform !== 'facebook-messenger' && platform !== 'instagram') ||
    typeof fetchImpl !== 'function'
  ) {
    throw new MetaWebhookSubscriptionError()
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 120_000) {
    throw new MetaWebhookSubscriptionError()
  }

  const { origin, version } = providerOriginAndVersion(platform)
  const url = new URL(`/${version}/${accountId}/subscribed_apps`, origin)
  url.searchParams.set('subscribed_fields', 'messages')
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetchImpl(url, {
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${token}`,
      },
      method: 'POST',
      signal: controller.signal,
    })
    if (!response.ok) throw new MetaWebhookSubscriptionError()

    const contentLength = response.headers.get('content-length')
    if (contentLength && /^\d+$/u.test(contentLength)) {
      const declaredBytes = Number(contentLength)
      if (!Number.isSafeInteger(declaredBytes) || declaredBytes > MAX_RESPONSE_BYTES) {
        throw new MetaWebhookSubscriptionError()
      }
    }
    const raw = await response.text()
    if (new TextEncoder().encode(raw).byteLength > MAX_RESPONSE_BYTES) {
      throw new MetaWebhookSubscriptionError()
    }
    const parsed = JSON.parse(raw) as unknown
    const success =
      parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as { success?: unknown }).success
        : undefined
    if (success !== true && success !== 'true') {
      throw new MetaWebhookSubscriptionError()
    }
  } catch (error) {
    if (error instanceof MetaWebhookSubscriptionError) throw error
    throw new MetaWebhookSubscriptionError()
  } finally {
    clearTimeout(timeout)
  }
}
