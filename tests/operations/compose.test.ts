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
  APP_PORT: '3000',
  APP_VERSION: 'operation-test',
  DATABASE_URL: 'postgres://operation:operation@db:5432/ivybm',
  IMAGE_TAG: imageTag,
  META_WEBHOOK_ALLOWED_ACCOUNT_IDS: '1234567890,9876543210',
  META_WEBHOOK_APP_SECRET: 'operation-test-meta-app-secret',
  META_WEBHOOK_VERIFY_TOKEN: 'operation-test-meta-verify-token',
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
      AI_CONFIG_ENCRYPTION_KEY: 'c'.repeat(64),
      AI_REASONING_EFFORT: 'medium',
      AI_REASONING_ENABLED: 'false',
      META_WEBHOOK_ALLOWED_ACCOUNT_IDS: '1234567890,9876543210',
      META_WEBHOOK_APP_SECRET: 'operation-test-meta-app-secret',
      META_WEBHOOK_VERIFY_TOKEN: 'operation-test-meta-verify-token',
    })
    expect(config.services.worker.environment).toMatchObject({
      AI_CONFIG_ENCRYPTION_KEY: 'c'.repeat(64),
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

  it('passes optional Meta webhook configuration only to the app in production and staging', () => {
    for (const config of [getProductionComposeConfig(), getStagingComposeConfig()]) {
      expect(config.services.app.environment).toMatchObject({
        META_WEBHOOK_ALLOWED_ACCOUNT_IDS: '1234567890,9876543210',
        META_WEBHOOK_APP_SECRET: 'operation-test-meta-app-secret',
        META_WEBHOOK_VERIFY_TOKEN: 'operation-test-meta-verify-token',
      })
      expect(config.services.migrate.environment).not.toHaveProperty('META_WEBHOOK_APP_SECRET')
      expect(config.services.worker.environment).not.toHaveProperty('META_WEBHOOK_APP_SECRET')
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
      PLATFORM_CREDENTIAL_ENCRYPTION_KEY: 'f'.repeat(64),
    })
  })
})
