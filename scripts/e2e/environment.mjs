import { readFileSync } from 'node:fs'
import path from 'node:path'

const projectRoot = process.cwd()
const systemEnvironmentKeys = [
  'CI',
  'HOME',
  'LANG',
  'LC_ALL',
  'LOGNAME',
  'PATH',
  'PNPM_HOME',
  'PLAYWRIGHT_BROWSERS_PATH',
  'SHELL',
  'TERM',
  'TMPDIR',
  'USER',
]

const copyIfPresent = (target, source, key) => {
  if (source[key] !== undefined) target[key] = source[key]
}

const localEnvironmentKeys = () => {
  const keys = new Set()
  for (const file of [
    '.env',
    '.env.local',
    '.env.development',
    '.env.development.local',
    '.env.test',
    '.env.test.local',
  ]) {
    try {
      const contents = readFileSync(path.join(projectRoot, file), 'utf8')
      for (const line of contents.split('\n')) {
        const match = line.match(/^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=/u)
        if (match?.[1]) keys.add(match[1])
      }
    } catch {
      // Optional local environment files are not required for the launcher.
    }
  }
  return keys
}

const providerEnvironmentKeys = () => {
  const keys = new Set()
  try {
    const contents = readFileSync(path.join(projectRoot, '.env.example'), 'utf8')
    for (const line of contents.split('\n')) {
      const match = line.match(/^([A-Z][A-Z0-9_]*)=/u)
      if (match?.[1] && /^(?:AI_PROVIDER_|FEISHU_|META_|INSTAGRAM_|LINKEDIN_)/u.test(match[1])) {
        keys.add(match[1])
      }
    }
  } catch {
    // The repository example is part of the launcher contract.
  }
  return keys
}

export const createE2EEnvironment = ({
  aiProviderPort,
  baseURL,
  commitSHA,
  databaseURL,
  databaseName,
  launchToken,
  mode,
  planDigest,
  requestedSuites,
  runID,
  specPaths,
  port,
}) => {
  const environment = {}
  const publishingOptIn = requestedSuites.includes('facebook-publishing')
  for (const key of systemEnvironmentKeys) copyIfPresent(environment, process.env, key)

  for (const key of localEnvironmentKeys()) environment[key] = ''
  for (const key of providerEnvironmentKeys()) environment[key] = ''

  for (const key of [
    'E2E_ADMIN_EMAIL',
    'E2E_ADMIN_PASSWORD',
    'SEED_ADMIN_EMAIL',
    'SEED_ADMIN_PASSWORD',
    'SEED_KNOWLEDGE_DEMO',
  ])
    copyIfPresent(environment, process.env, key)

  for (const key of Object.keys(process.env)) {
    if (key.startsWith('ADMIN_PORTAL_')) environment[key] = process.env[key]
  }

  const fixedEnvironment = {
    ADMIN_PORTAL_CONTENT_STUDIO_ENABLED: mode === 'mutation' ? 'true' : 'false',
    ADMIN_PORTAL_CONVERSATIONS_ENABLED: mode === 'mutation' ? 'true' : 'false',
    ADMIN_PORTAL_ENABLED: mode === 'mutation' ? 'true' : 'false',
    ADMIN_PORTAL_KNOWLEDGE_ENABLED: mode === 'mutation' ? 'true' : 'false',
    ADMIN_PORTAL_LEADS_ENABLED: mode === 'mutation' ? 'true' : 'false',
    ADMIN_PORTAL_MEDIA_ENABLED: mode === 'mutation' ? 'true' : 'false',
    ADMIN_PORTAL_OPERATIONS_ENABLED: mode === 'mutation' ? 'true' : 'false',
    ADMIN_PORTAL_OVERVIEW_ENABLED: mode === 'mutation' ? 'true' : 'false',
    ADMIN_PORTAL_PLATFORMS_ENABLED: mode === 'mutation' ? 'true' : 'false',
    ADMIN_PORTAL_PUBLISHING_ENABLED:
      publishingOptIn &&
      process.env.CI !== 'true' &&
      process.env.ADMIN_PORTAL_PUBLISHING_ENABLED === 'true'
        ? 'true'
        : 'false',
    ADMIN_PORTAL_SETTINGS_ENABLED: mode === 'mutation' ? 'true' : 'false',
    ADMIN_PORTAL_WEBSITE_CONTENT_ENABLED: mode === 'mutation' ? 'true' : 'false',
    AI_CONFIG_ENCRYPTION_KEY: 'e'.repeat(64),
    AI_EMBEDDING_DIMENSIONS: mode === 'mutation' ? '3' : '',
    AI_EMBEDDING_MODEL: mode === 'mutation' ? 'e2e-embedding-model' : '',
    AI_PROVIDER_API_KEY: mode === 'mutation' ? launchToken : '',
    AI_PROVIDER_BASE_URL:
      mode === 'mutation' && aiProviderPort ? `http://127.0.0.1:${aiProviderPort}/v1` : '',
    AI_TEXT_MODEL: mode === 'mutation' ? 'e2e-text-model' : '',
    APP_VERSION: process.env.APP_VERSION || 'e2e',
    ...(mode === 'readonly-external' ? { BASE_URL: baseURL } : {}),
    DATABASE_URL: databaseURL || '',
    DOTENV_CONFIG_PATH: '/dev/null',
    E2E_PORT: port ? String(port) : '',
    HOSTNAME: '127.0.0.1',
    IVYBM_ALLOW_TEST_DATABASE_WORKER: '',
    IVYBM_E2E_AI_PROVIDER_PORT: aiProviderPort ? String(aiProviderPort) : '',
    IVYBM_E2E_ALLOW_HTTP_AI_LOOPBACK: mode === 'mutation' ? 'true' : '',
    IVYBM_E2E_ENVIRONMENT_ALLOWLIST: 'v1',
    IVYBM_E2E_COMMIT_SHA: commitSHA,
    IVYBM_E2E_DATABASE_NAME: databaseName,
    IVYBM_E2E_EXTERNAL_SIDE_EFFECTS: 'deny',
    IVYBM_E2E_LAUNCH_TOKEN: launchToken,
    IVYBM_E2E_MODE: mode,
    IVYBM_E2E_PLAN_DIGEST: planDigest,
    IVYBM_E2E_REQUESTED_SUITES: requestedSuites.join(','),
    IVYBM_E2E_RUN_ID: runID,
    IVYBM_E2E_SPEC_PATHS_JSON: JSON.stringify(specPaths),
    IVYBM_E2E_WORKER_MODE: mode === 'mutation' ? 'harness-only' : '',
    NEXT_PUBLIC_SERVER_URL: publishingOptIn ? 'https://e2e-publication.invalid' : baseURL || '',
    PAYLOAD_SECRET: 'e2e-build-only-secret-at-least-32-characters',
    PLATFORM_CREDENTIAL_ENCRYPTION_KEY: 'b'.repeat(64),
    PLAYWRIGHT_HTML_OPEN: 'never',
  }

  return { ...environment, ...fixedEnvironment }
}

export const assertE2EEnvironmentDoesNotExposeProviderCredentials = (environment) => {
  const documentedKeys = new Set(
    readFileSync(path.join(projectRoot, '.env.example'), 'utf8')
      .split('\n')
      .map((line) => line.match(/^([A-Z][A-Z0-9_]*)=/u)?.[1])
      .filter(Boolean),
  )
  for (const key of documentedKeys) {
    if (
      /^(?:AI_PROVIDER|FEISHU|INSTAGRAM|LINKEDIN|META)_/u.test(key) &&
      /(?:SECRET|TOKEN|PASSWORD|API_KEY|APP_ID|PRIVATE|TICKET_KEY)/u.test(key)
    ) {
      if (
        key === 'AI_PROVIDER_API_KEY' &&
        environment.IVYBM_E2E_MODE === 'mutation' &&
        environment.IVYBM_E2E_EXTERNAL_SIDE_EFFECTS === 'deny' &&
        environment.AI_PROVIDER_API_KEY === environment.IVYBM_E2E_LAUNCH_TOKEN
      ) {
        continue
      }
      if (environment[key]) throw new Error(`E2E environment must not expose ${key}`)
    }
  }
}
