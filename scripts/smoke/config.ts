export type SmokeLocale = 'en' | 'ar'
export type SmokeEvidenceMode = 'full' | 'compact'
export type SmokeScenario = 'all' | 'inquiry' | 'chat'

export type SmokeConfig = {
  evidenceMode: SmokeEvidenceMode
  feishuTableUrl: string
  headless: boolean
  locales: SmokeLocale[]
  outputDir: string
  portalEmail: string
  portalPassword: string
  scenario: SmokeScenario
  targetUrl: string
  timeoutMs: number
}

const DEFAULT_FEISHU_TABLE_URL =
  'https://my.feishu.cn/base/FWqIbgJXVaR4lus7xcScgTblnle?table=tblrmOcSYnilLCIq&view=vewdQVJ7UZ'
const DEFAULT_TIMEOUT_MS = 180_000
const DEFAULT_OUTPUT_DIR = 'artifacts/live-smoke'

export const parseSmokeConfig = (
  env: Record<string, string | undefined> = process.env,
  argv: string[] = process.argv.slice(2),
): SmokeConfig => {
  const targetUrl = env.SMOKE_TARGET_URL?.trim()
  if (!targetUrl) {
    throw new Error('Missing SMOKE_TARGET_URL. Must provide target base URL (e.g. https://ivybm.com or http://localhost:3000).')
  }

  let parsedUrl: URL
  try {
    parsedUrl = new URL(targetUrl)
  } catch {
    throw new Error(`Invalid SMOKE_TARGET_URL: "${targetUrl}". Must be a valid HTTP or HTTPS URL.`)
  }

  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    throw new Error(`Invalid SMOKE_TARGET_URL protocol: "${parsedUrl.protocol}". Must start with http:// or https://.`)
  }
  if (
    parsedUrl.username ||
    parsedUrl.password ||
    parsedUrl.search ||
    parsedUrl.hash ||
    (parsedUrl.pathname !== '' && parsedUrl.pathname !== '/')
  ) {
    throw new Error('SMOKE_TARGET_URL must be an origin only, without credentials, path, query, or fragment.')
  }

  const hostname = parsedUrl.hostname.toLowerCase()
  const isProduction = hostname === 'ivybm.com' || hostname === 'www.ivybm.com'
  if (isProduction) {
    const confirm = env.SMOKE_CONFIRM_PRODUCTION?.trim()
    if (confirm !== 'ivybm.com') {
      throw new Error(
        'Targeting production hostname (ivybm.com) requires SMOKE_CONFIRM_PRODUCTION="ivybm.com" to prevent accidental execution.',
      )
    }
  }

  const portalEmail = env.SMOKE_PORTAL_EMAIL?.trim()
  if (!portalEmail) {
    throw new Error('Missing SMOKE_PORTAL_EMAIL. Must provide dedicated smoke test account email.')
  }

  const portalPassword = env.SMOKE_PORTAL_PASSWORD?.trim()
  if (!portalPassword) {
    throw new Error('Missing SMOKE_PORTAL_PASSWORD. Must provide dedicated smoke test account password.')
  }

  const feishuTableUrl = env.SMOKE_FEISHU_TABLE_URL?.trim() || DEFAULT_FEISHU_TABLE_URL
  let parsedFeishuUrl: URL
  try {
    parsedFeishuUrl = new URL(feishuTableUrl)
  } catch {
    throw new Error('Invalid SMOKE_FEISHU_TABLE_URL. Must be a valid HTTP or HTTPS URL.')
  }
  if (
    (parsedFeishuUrl.protocol !== 'http:' && parsedFeishuUrl.protocol !== 'https:') ||
    parsedFeishuUrl.username ||
    parsedFeishuUrl.password
  ) {
    throw new Error('Invalid SMOKE_FEISHU_TABLE_URL. Credentials and non-HTTP(S) URLs are not allowed.')
  }
  const headless = env.SMOKE_HEADLESS !== 'false'
  const envTimeout = env.SMOKE_TIMEOUT_MS ? Number.parseInt(env.SMOKE_TIMEOUT_MS, 10) : undefined
  const timeoutMs = Number.isInteger(envTimeout) && envTimeout! > 0 ? envTimeout! : DEFAULT_TIMEOUT_MS

  let locales: SmokeLocale[] = ['en']
  let evidenceMode: SmokeEvidenceMode = 'full'
  let scenario: SmokeScenario = 'all'
  let outputDir = DEFAULT_OUTPUT_DIR

  for (const arg of argv) {
    if (arg === '--') {
      continue
    } else if (arg.startsWith('--locales=')) {
      const rawLocales = arg.slice('--locales='.length).split(',').map((l) => l.trim().toLowerCase())
      const invalidLocales = rawLocales.filter((locale) => locale !== 'en' && locale !== 'ar')
      if (invalidLocales.length > 0) {
        throw new Error(`Invalid --locales argument: "${arg}". Must contain only "en" and/or "ar".`)
      }
      const validLocales = rawLocales.filter((l): l is SmokeLocale => l === 'en' || l === 'ar')
      if (validLocales.length > 0) {
        locales = Array.from(new Set(validLocales))
      } else {
        throw new Error(`Invalid --locales argument: "${arg}". Must be comma-separated list of "en" and/or "ar".`)
      }
    } else if (arg.startsWith('--evidence=')) {
      const mode = arg.slice('--evidence='.length).trim().toLowerCase()
      if (mode === 'full' || mode === 'compact') {
        evidenceMode = mode
      } else {
        throw new Error(`Invalid --evidence argument: "${arg}". Must be "full" or "compact".`)
      }
    } else if (arg.startsWith('--scenario=')) {
      const sc = arg.slice('--scenario='.length).trim().toLowerCase()
      if (sc === 'all' || sc === 'inquiry' || sc === 'chat') {
        scenario = sc
      } else {
        throw new Error(`Invalid --scenario argument: "${arg}". Must be "all", "inquiry", or "chat".`)
      }
    } else if (arg.startsWith('--output-dir=')) {
      const dir = arg.slice('--output-dir='.length).trim()
      if (dir) {
        outputDir = dir
      }
    } else {
      throw new Error(`Unknown smoke argument: "${arg}".`)
    }
  }

  return {
    evidenceMode,
    feishuTableUrl,
    headless,
    locales,
    outputDir,
    portalEmail,
    portalPassword,
    scenario,
    targetUrl: parsedUrl.origin,
    timeoutMs,
  }
}
