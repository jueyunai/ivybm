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
  AI_EMBEDDING_MODEL: 'operation-embedding-model',
  AI_PROVIDER_API_KEY: 'operation-placeholder-api-key',
  AI_PROVIDER_BASE_URL: 'https://api.example.invalid/v1',
  AI_TEXT_MODEL: 'operation-text-model',
  APP_PORT: '3000',
  APP_VERSION: 'operation-test',
  DATABASE_URL: 'postgres://operation:operation@db:5432/ivybm',
  IMAGE_TAG: imageTag,
  PAYLOAD_SECRET: 'operation-test-secret-at-least-32-characters',
  POSTGRES_DB: 'ivybm',
  POSTGRES_PASSWORD: 'operation-password',
  POSTGRES_USER: 'operation',
  RUNTIME_IMAGE: 'registry.example.invalid/ivybm-runtime',
  RUNTIME_IMAGE_DIGEST: runtimeDigest,
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
      AI_REASONING_EFFORT: 'medium',
      AI_REASONING_ENABLED: 'false',
    })
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
})
