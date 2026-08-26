const CLOUDFLARE_API_ORIGIN = 'https://api.cloudflare.com'
const CLOUDFLARE_URL_BATCH_SIZE = 30
const DEFAULT_TIMEOUT_MS = 5_000
const ZONE_ID_PATTERN = /^[a-f0-9]{32}$/i

type CloudflareEnvironment = Readonly<Record<string, string | undefined>>
type CloudflareFetch = typeof globalThis.fetch

type CloudflareLogger = {
  debug?: (message: string) => void
  info?: (message: string) => void
  warn?: (message: string) => void
}

type CloudflarePurgeOptions = {
  environment?: CloudflareEnvironment
  fetch?: CloudflareFetch
  logger?: CloudflareLogger
  timeoutMs?: number
}

export type CloudflarePurgeResult = {
  batches: number
  status: 'failed' | 'skipped' | 'succeeded'
  urls: number
}

type CloudflareConfig = {
  apiToken: string
  fetch: CloudflareFetch
  logger?: CloudflareLogger
  origin: URL
  timeoutMs: number
  zoneId: string
}

const skippedResult = (): CloudflarePurgeResult => ({ batches: 0, status: 'skipped', urls: 0 })

const failedResult = (urls = 0, batches = 0): CloudflarePurgeResult => ({
  batches,
  status: 'failed',
  urls,
})

const readConfig = (options: CloudflarePurgeOptions): CloudflareConfig | undefined => {
  const environment = options.environment ?? process.env

  if (environment.CLOUDFLARE_CACHE_PURGE_ENABLED?.trim() !== 'true') {
    options.logger?.debug?.('Skipped Cloudflare cache purge because it is disabled')
    return undefined
  }

  const apiToken = environment.CLOUDFLARE_API_TOKEN?.trim()
  const zoneId = environment.CLOUDFLARE_ZONE_ID?.trim()
  const siteURL = environment.NEXT_PUBLIC_SERVER_URL?.trim()

  if (!apiToken || !zoneId || !siteURL || !ZONE_ID_PATTERN.test(zoneId)) {
    options.logger?.warn?.(
      'Skipped Cloudflare cache purge because its runtime configuration is incomplete',
    )
    return undefined
  }

  let origin: URL

  try {
    origin = new URL(siteURL)
  } catch {
    options.logger?.warn?.('Skipped Cloudflare cache purge because the public site URL is invalid')
    return undefined
  }

  if (origin.protocol !== 'https:') {
    options.logger?.warn?.(
      'Skipped Cloudflare cache purge because the public site URL is not HTTPS',
    )
    return undefined
  }

  return {
    apiToken,
    fetch: options.fetch ?? globalThis.fetch,
    logger: options.logger,
    origin,
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    zoneId,
  }
}

const purgeEndpoint = (zoneId: string): URL =>
  new URL(`/client/v4/zones/${encodeURIComponent(zoneId)}/purge_cache`, CLOUDFLARE_API_ORIGIN)

const requestPurge = async (
  config: CloudflareConfig,
  payload: { files: string[] } | { purge_everything: true },
): Promise<boolean> => {
  try {
    const response = await config.fetch(purgeEndpoint(config.zoneId), {
      body: JSON.stringify(payload),
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${config.apiToken}`,
        'Content-Type': 'application/json',
      },
      method: 'POST',
      signal: AbortSignal.timeout(config.timeoutMs),
    })

    let body: unknown
    try {
      body = await response.json()
    } catch {
      body = undefined
    }

    const succeeded =
      response.ok &&
      typeof body === 'object' &&
      body !== null &&
      'success' in body &&
      body.success === true

    if (!succeeded) {
      config.logger?.warn?.(`Cloudflare cache purge failed with HTTP ${response.status}`)
    }

    return succeeded
  } catch (error) {
    const reason = error instanceof Error ? error.name : 'UnknownError'
    config.logger?.warn?.(`Cloudflare cache purge request failed: ${reason}`)
    return false
  }
}

const normalizeURLs = (paths: string[], config: CloudflareConfig): string[] => {
  const urls = new Set<string>()

  for (const path of paths) {
    const value = path.trim()
    if (!value) continue

    try {
      const url = new URL(value, config.origin)
      if (url.origin === config.origin.origin) urls.add(url.toString())
    } catch {
      config.logger?.warn?.('Skipped an invalid Cloudflare cache purge URL')
    }
  }

  return [...urls]
}

export const purgeCloudflareUrls = async (
  paths: string[],
  options: CloudflarePurgeOptions = {},
): Promise<CloudflarePurgeResult> => {
  if (paths.length === 0) return skippedResult()

  const config = readConfig(options)
  if (!config) return skippedResult()

  const urls = normalizeURLs(paths, config)
  if (urls.length === 0) return skippedResult()

  let batches = 0

  for (let index = 0; index < urls.length; index += CLOUDFLARE_URL_BATCH_SIZE) {
    const files = urls.slice(index, index + CLOUDFLARE_URL_BATCH_SIZE)
    batches += 1
    if (!(await requestPurge(config, { files }))) return failedResult(urls.length, batches)
  }

  config.logger?.info?.(`Purged ${urls.length} Cloudflare cache URLs in ${batches} batch(es)`)
  return { batches, status: 'succeeded', urls: urls.length }
}

export const purgeCloudflareEverything = async (
  options: CloudflarePurgeOptions = {},
): Promise<CloudflarePurgeResult> => {
  const config = readConfig(options)
  if (!config) return skippedResult()

  if (!(await requestPurge(config, { purge_everything: true }))) return failedResult(0, 1)

  config.logger?.info?.('Purged the complete Cloudflare zone cache')
  return { batches: 1, status: 'succeeded', urls: 0 }
}
