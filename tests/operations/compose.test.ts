import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

type ComposeService = {
  build?: unknown
  depends_on?: Record<string, { condition?: string }>
  environment?: Record<string, string>
  healthcheck?: { test?: string[] }
  image?: string
  logging?: { driver?: string; options?: Record<string, string> }
  mem_limit?: string
  ports?: Array<{ host_ip?: string; published?: string; target?: number }>
  restart?: string
  volumes?: Array<{ source?: string; target?: string; type?: string }>
}

type ComposeConfig = {
  services: Record<string, ComposeService>
  volumes: Record<string, { name?: string }>
}

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const imageTag = '0123456789abcdef0123456789abcdef01234567'
const runtimeDigest = 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const workerDigest = 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
const requiredEnvironment = {
  AI_CONFIG_ENCRYPTION_KEY: 'c'.repeat(64),
  ADMIN_PORTAL_ENABLED: 'true',
  ADMIN_PORTAL_SETTINGS_ENABLED: 'true',
  ADMIN_PORTAL_OVERVIEW_ENABLED: 'true',
  ADMIN_PORTAL_WEBSITE_CONTENT_ENABLED: 'true',
  ADMIN_PORTAL_MEDIA_ENABLED: 'true',
  ADMIN_PORTAL_KNOWLEDGE_ENABLED: 'true',
  ADMIN_PORTAL_CONVERSATIONS_ENABLED: 'true',
  ADMIN_PORTAL_LEADS_ENABLED: 'true',
  ADMIN_PORTAL_CONTENT_STUDIO_ENABLED: 'true',
  ADMIN_PORTAL_PLATFORMS_ENABLED: 'true',
  ADMIN_PORTAL_OPERATIONS_ENABLED: 'true',
  ADMIN_PORTAL_PUBLISHING_ENABLED: 'false',
  APP_PORT: '3000',
  APP_VERSION: 'operation-test',
  DATABASE_URL: 'postgres://operation:operation@db:5432/ivybm',
  FEISHU_APP_ID: 'cli-operation-test',
  FEISHU_APP_SECRET: 'operation-test-feishu-secret',
  FEISHU_CREDENTIAL_ENCRYPTION_KEY: 'd'.repeat(64),
  FEISHU_OAUTH_REDIRECT_URI: 'https://ivybm.com/api/integrations/feishu/callback',
  FEISHU_QR_REGISTRATION_ENABLED: 'true',
  FEISHU_RELAY_INTERVAL_MS: '45000',
  IMAGE_TAG: imageTag,
  META_APP_ID: '1111111111111111',
  META_LOGIN_CONFIG_ID: '2222222222222222',
  META_OAUTH_REDIRECT_URI: 'https://ivybm.com/api/platforms/meta/oauth/callback',
  META_WEBHOOK_ALLOWED_ACCOUNT_IDS: '1234567890,9876543210',
  META_WEBHOOK_APP_SECRET: 'operation-test-meta-app-secret',
  META_WEBHOOK_VERIFY_TOKEN: 'operation-test-meta-verify-token',
  INSTAGRAM_APP_ID: '3333333333333333',
  INSTAGRAM_APP_SECRET: 'operation-test-instagram-app-secret',
  INSTAGRAM_OAUTH_REDIRECT_URI: 'https://ivybm.com/api/platforms/instagram/oauth/callback',
  LINKEDIN_APP_ID: 'linkedin-operation-app',
  LINKEDIN_APP_SECRET: 'operation-test-linkedin-app-secret',
  LINKEDIN_OAUTH_REDIRECT_URI: 'https://ivybm.com/api/platforms/linkedin/oauth/callback',
  LINKEDIN_API_VERSION: '202608',
  LINKEDIN_UPLOAD_ALLOWED_ORIGINS: 'https://www.linkedin.com,https://media.licdn.com',
  LINKEDIN_UPLOAD_TICKET_KEY: 'f'.repeat(64),
  PLATFORM_CREDENTIAL_ENCRYPTION_KEY: 'e'.repeat(64),
  PAYLOAD_SECRET: 'operation-test-secret-at-least-32-characters',
  POSTGRES_DB: 'ivybm',
  POSTGRES_PASSWORD: 'operation-password',
  POSTGRES_USER: 'operation',
  RUNTIME_IMAGE: 'registry.example.invalid/ivybm-runtime',
  RUNTIME_IMAGE_DIGEST: runtimeDigest,
  SEED_ADMIN_EMAIL: 'operation-seed@example.invalid',
  SEED_ADMIN_PASSWORD: 'operation-seed-password',
  NEXT_PUBLIC_SERVER_URL: 'https://ivybm.com',
  TRUST_PROXY_HEADERS: 'true',
  WORKER_IMAGE: 'registry.example.invalid/ivybm-worker',
  WORKER_IMAGE_DIGEST: workerDigest,
}

const getProductionComposeConfig = (): ComposeConfig => {
  const result = spawnSync(
    'docker',
    ['compose', '-f', 'compose.yaml', '-f', 'compose.prod.yaml', 'config', '--format', 'json'],
    {
      cwd: projectRoot,
      encoding: 'utf8',
      env: { ...process.env, ...requiredEnvironment },
    },
  )

  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || 'docker compose config failed')
  }

  return JSON.parse(result.stdout) as ComposeConfig
}

const getLocalComposeConfig = (): ComposeConfig => {
  const result = spawnSync(
    'docker',
    ['compose', '-f', 'compose.yaml', 'config', '--format', 'json'],
    {
      cwd: projectRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        AI_CONFIG_ENCRYPTION_KEY: 'd'.repeat(64),
        AI_EMBEDDING_DIMENSIONS: '3',
        AI_EMBEDDING_MODEL: 'local-embedding-model',
        AI_PROVIDER_API_KEY: 'local-provider-key',
        AI_PROVIDER_BASE_URL: 'https://local-provider.example.invalid/v1',
        AI_TEXT_MODEL: 'local-text-model',
        FEISHU_APP_ID: 'cli-local-test',
        FEISHU_APP_SECRET: 'local-feishu-secret',
        FEISHU_CREDENTIAL_ENCRYPTION_KEY: 'a'.repeat(64),
        FEISHU_OAUTH_REDIRECT_URI: 'http://localhost:3000/api/integrations/feishu/callback',
        FEISHU_RELAY_INTERVAL_MS: '60000',
        PLATFORM_CREDENTIAL_ENCRYPTION_KEY: 'f'.repeat(64),
      },
    },
  )

  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || 'local docker compose config failed')
  }

  return JSON.parse(result.stdout) as ComposeConfig
}

const getStagingComposeConfig = (): ComposeConfig => {
  const result = spawnSync(
    'docker',
    ['compose', '-f', 'compose.yaml', '-f', 'compose.staging.yaml', 'config', '--format', 'json'],
    {
      cwd: projectRoot,
      encoding: 'utf8',
      env: { ...process.env, ...requiredEnvironment },
    },
  )

  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || 'staging docker compose config failed')
  }

  return JSON.parse(result.stdout) as ComposeConfig
}

describe('production Compose configuration', () => {
  it('declares worker feature switches exactly once per app and worker service', () => {
    for (const file of ['compose.prod.yaml', 'compose.staging.yaml']) {
      const source = readFileSync(resolve(projectRoot, file), 'utf8')
      expect(source.match(/^\s+ADMIN_PORTAL_CONVERSATIONS_ENABLED:/gm)).toHaveLength(2)
      expect(source.match(/^\s+ADMIN_PORTAL_PUBLISHING_ENABLED:/gm)).toHaveLength(2)

      for (const variable of [
        'LINKEDIN_API_VERSION',
        'LINKEDIN_UPLOAD_ALLOWED_ORIGINS',
        'LINKEDIN_UPLOAD_TICKET_KEY',
      ]) {
        expect(source.match(new RegExp(`^\\s+${variable}:`, 'gm'))).toHaveLength(2)
      }
    }
  })

  it('waits through the PostgreSQL init-server restart before probing persistence', () => {
    const persistenceScript = readFileSync(
      resolve(projectRoot, 'scripts/db/verify-compose-persistence.sh'),
      'utf8',
    )

    expect(persistenceScript).toContain('local consecutive_ready=0')
    expect(persistenceScript).toContain(
      'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc \'SELECT 1\'',
    )
    expect(persistenceScript).toContain('if ((consecutive_ready >= 3)); then')
    expect(persistenceScript).toContain('consecutive_ready=0')
  })

  it('does not accept PAYLOAD_SECRET as a Docker build argument', () => {
    const dockerfile = readFileSync(resolve(projectRoot, 'Dockerfile'), 'utf8')

    expect(dockerfile).not.toMatch(/^ARG PAYLOAD_SECRET=/m)
  })

  it('uses immutable runtime and worker images without server-side builds', () => {
    const config = getProductionComposeConfig()

    expect(config.services.app.build).toBeUndefined()
    expect(config.services.worker.build).toBeUndefined()
    expect(config.services.migrate.build).toBeUndefined()
    expect(config.services.app.image).toBe(
      `registry.example.invalid/ivybm-runtime:${imageTag}@${runtimeDigest}`,
    )
    expect(config.services.worker.image).toBe(
      `registry.example.invalid/ivybm-worker:${imageTag}@${workerDigest}`,
    )
    expect(config.services.migrate.image).toBe(
      `registry.example.invalid/ivybm-worker:${imageTag}@${workerDigest}`,
    )
    expect(config.services.migrate.restart).toBe('no')
  })

  it('fails closed when a Portal module switch is omitted', () => {
    const environment: NodeJS.ProcessEnv = { ...process.env, ...requiredEnvironment }
    delete environment.ADMIN_PORTAL_MEDIA_ENABLED

    const result = spawnSync(
      'docker',
      ['compose', '-f', 'compose.yaml', '-f', 'compose.prod.yaml', 'config', '--format', 'json'],
      {
        cwd: projectRoot,
        encoding: 'utf8',
        env: environment,
      },
    )

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('ADMIN_PORTAL_MEDIA_ENABLED')
  })

  it('keeps database private, binds the app to loopback, and retains named volumes', () => {
    const config = getProductionComposeConfig()

    expect(config.services.db.ports).toBeUndefined()
    expect(config.services.worker.ports).toBeUndefined()
    expect(config.services.app.ports).toEqual([
      expect.objectContaining({
        host_ip: '127.0.0.1',
        published: '3000',
        target: 3000,
      }),
    ])
    expect(config.volumes.postgres_data.name).toBe('ivybm-prod-postgres')
    expect(config.volumes.media_data.name).toBe('ivybm-prod-media')
  })

  it('waits for a successful migration and keeps resource, health, and log guards', () => {
    const config = getProductionComposeConfig()

    expect(config.services.app.depends_on?.migrate?.condition).toBe(
      'service_completed_successfully',
    )
    expect(config.services.worker.depends_on?.migrate?.condition).toBe(
      'service_completed_successfully',
    )
    expect(config.services.app.mem_limit).toBe('805306368')
    expect(config.services.worker.mem_limit).toBe('402653184')
    expect(config.services.db.mem_limit).toBe('805306368')
    expect(config.services.app.environment).toMatchObject({
      ADMIN_PORTAL_ENABLED: 'true',
      ADMIN_PORTAL_PUBLISHING_ENABLED: 'false',
      ADMIN_PORTAL_CONTENT_STUDIO_ENABLED: 'true',
      ADMIN_PORTAL_CONVERSATIONS_ENABLED: 'true',
      ADMIN_PORTAL_KNOWLEDGE_ENABLED: 'true',
      ADMIN_PORTAL_LEADS_ENABLED: 'true',
      ADMIN_PORTAL_MEDIA_ENABLED: 'true',
      ADMIN_PORTAL_OPERATIONS_ENABLED: 'true',
      ADMIN_PORTAL_OVERVIEW_ENABLED: 'true',
      ADMIN_PORTAL_PLATFORMS_ENABLED: 'true',
      ADMIN_PORTAL_SETTINGS_ENABLED: 'true',
      ADMIN_PORTAL_WEBSITE_CONTENT_ENABLED: 'true',
      AI_CONFIG_ENCRYPTION_KEY: 'c'.repeat(64),
      AI_REASONING_EFFORT: 'medium',
      AI_REASONING_ENABLED: 'false',
      META_APP_ID: '1111111111111111',
      META_LOGIN_CONFIG_ID: '2222222222222222',
      META_OAUTH_REDIRECT_URI: 'https://ivybm.com/api/platforms/meta/oauth/callback',
      META_WEBHOOK_ALLOWED_ACCOUNT_IDS: '1234567890,9876543210',
      META_WEBHOOK_APP_SECRET: 'operation-test-meta-app-secret',
      META_WEBHOOK_VERIFY_TOKEN: 'operation-test-meta-verify-token',
      INSTAGRAM_APP_ID: '3333333333333333',
      INSTAGRAM_APP_SECRET: 'operation-test-instagram-app-secret',
      INSTAGRAM_OAUTH_REDIRECT_URI: 'https://ivybm.com/api/platforms/instagram/oauth/callback',
      LINKEDIN_APP_ID: 'linkedin-operation-app',
      LINKEDIN_APP_SECRET: 'operation-test-linkedin-app-secret',
      LINKEDIN_OAUTH_REDIRECT_URI: 'https://ivybm.com/api/platforms/linkedin/oauth/callback',
    })
    expect(config.services.worker.environment).toMatchObject({
      ADMIN_PORTAL_CONVERSATIONS_ENABLED: 'true',
      ADMIN_PORTAL_PUBLISHING_ENABLED: 'false',
      AI_CONFIG_ENCRYPTION_KEY: 'c'.repeat(64),
      LINKEDIN_API_VERSION: '202608',
      LINKEDIN_UPLOAD_ALLOWED_ORIGINS: 'https://www.linkedin.com,https://media.licdn.com',
      LINKEDIN_UPLOAD_TICKET_KEY: 'f'.repeat(64),
    })
    expect(config.services.migrate.environment).not.toHaveProperty('AI_CONFIG_ENCRYPTION_KEY')
    expect(config.services.app.healthcheck?.test?.join(' ')).toContain('/api/health/ready')

    for (const service of ['app', 'db', 'migrate', 'worker']) {
      expect(config.services[service]?.logging).toEqual({
        driver: 'local',
        options: {
          'max-file': '5',
          'max-size': '10m',
        },
      })
    }
  })

  it('passes optional platform OAuth configuration only to the app in production and staging', () => {
    for (const config of [getProductionComposeConfig(), getStagingComposeConfig()]) {
      expect(config.services.worker.environment?.ADMIN_PORTAL_CONVERSATIONS_ENABLED).toBe(
        config.services.app.environment?.ADMIN_PORTAL_CONVERSATIONS_ENABLED,
      )
      expect(config.services.app.environment).toMatchObject({
        META_APP_ID: '1111111111111111',
        META_LOGIN_CONFIG_ID: '2222222222222222',
        META_OAUTH_REDIRECT_URI: 'https://ivybm.com/api/platforms/meta/oauth/callback',
        META_WEBHOOK_ALLOWED_ACCOUNT_IDS: '1234567890,9876543210',
        META_WEBHOOK_APP_SECRET: 'operation-test-meta-app-secret',
        META_WEBHOOK_VERIFY_TOKEN: 'operation-test-meta-verify-token',
        INSTAGRAM_APP_ID: '3333333333333333',
        INSTAGRAM_APP_SECRET: 'operation-test-instagram-app-secret',
        INSTAGRAM_OAUTH_REDIRECT_URI: 'https://ivybm.com/api/platforms/instagram/oauth/callback',
        LINKEDIN_APP_ID: 'linkedin-operation-app',
        LINKEDIN_APP_SECRET: 'operation-test-linkedin-app-secret',
        LINKEDIN_OAUTH_REDIRECT_URI: 'https://ivybm.com/api/platforms/linkedin/oauth/callback',
      })
      expect(config.services.migrate.environment).not.toHaveProperty('META_WEBHOOK_APP_SECRET')
      expect(config.services.worker.environment).not.toHaveProperty('META_WEBHOOK_APP_SECRET')
      expect(config.services.migrate.environment).not.toHaveProperty('META_APP_ID')
      expect(config.services.worker.environment).not.toHaveProperty('META_APP_ID')
      expect(config.services.migrate.environment).not.toHaveProperty('INSTAGRAM_APP_ID')
      expect(config.services.worker.environment).not.toHaveProperty('INSTAGRAM_APP_SECRET')
      expect(config.services.migrate.environment).not.toHaveProperty('LINKEDIN_APP_ID')
      expect(config.services.worker.environment).not.toHaveProperty('LINKEDIN_APP_SECRET')
    }
  })

  it('passes the platform credential master key only to app and worker processes', () => {
    for (const config of [getProductionComposeConfig(), getStagingComposeConfig()]) {
      expect(config.services.app.environment).toMatchObject({
        PLATFORM_CREDENTIAL_ENCRYPTION_KEY: 'e'.repeat(64),
      })
      expect(config.services.worker.environment).toMatchObject({
        PLATFORM_CREDENTIAL_ENCRYPTION_KEY: 'e'.repeat(64),
      })
      expect(config.services.migrate.environment).not.toHaveProperty(
        'PLATFORM_CREDENTIAL_ENCRYPTION_KEY',
      )
    }
  })

  it('passes Feishu OAuth credentials to app and worker but not migration processes', () => {
    for (const config of [getProductionComposeConfig(), getStagingComposeConfig()]) {
      const expected = {
        FEISHU_APP_ID: 'cli-operation-test',
        FEISHU_APP_SECRET: 'operation-test-feishu-secret',
        FEISHU_CREDENTIAL_ENCRYPTION_KEY: 'd'.repeat(64),
        FEISHU_OAUTH_REDIRECT_URI: 'https://ivybm.com/api/integrations/feishu/callback',
      }
      expect(config.services.app.environment).toMatchObject(expected)
      expect(config.services.app.environment).toMatchObject({
        FEISHU_QR_REGISTRATION_ENABLED: 'true',
      })
      expect(config.services.worker.environment).toMatchObject({
        ...expected,
        FEISHU_RELAY_INTERVAL_MS: '45000',
      })
      expect(config.services.migrate.environment).not.toHaveProperty('FEISHU_APP_SECRET')
      expect(config.services.migrate.environment).not.toHaveProperty(
        'FEISHU_CREDENTIAL_ENCRYPTION_KEY',
      )
      expect(config.services.worker.environment).not.toHaveProperty(
        'FEISHU_QR_REGISTRATION_ENABLED',
      )
      expect(config.services.migrate.environment).not.toHaveProperty(
        'FEISHU_QR_REGISTRATION_ENABLED',
      )
    }
  })
})
describe('local Compose worker configuration', () => {
  it('passes CMS encryption and legacy AI fallback settings to the worker', () => {
    const config = getLocalComposeConfig()

    expect(config.services.worker.environment).toMatchObject({
      AI_CONFIG_ENCRYPTION_KEY: 'd'.repeat(64),
      AI_EMBEDDING_DIMENSIONS: '3',
      AI_EMBEDDING_MODEL: 'local-embedding-model',
      AI_PROVIDER_API_KEY: 'local-provider-key',
      AI_PROVIDER_BASE_URL: 'https://local-provider.example.invalid/v1',
      AI_TEXT_MODEL: 'local-text-model',
      FEISHU_APP_ID: 'cli-local-test',
      FEISHU_APP_SECRET: 'local-feishu-secret',
      FEISHU_CREDENTIAL_ENCRYPTION_KEY: 'a'.repeat(64),
      FEISHU_OAUTH_REDIRECT_URI: 'http://localhost:3000/api/integrations/feishu/callback',
      FEISHU_RELAY_INTERVAL_MS: '60000',
      PLATFORM_CREDENTIAL_ENCRYPTION_KEY: 'f'.repeat(64),
      ADMIN_PORTAL_PUBLISHING_ENABLED: 'false',
    })
  })
})
