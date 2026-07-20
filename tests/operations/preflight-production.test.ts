import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const imageTag = '0123456789abcdef0123456789abcdef01234567'
const runtimeDigest = 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const workerDigest = 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'

const productionEnvironment = `IMAGE_TAG=${imageTag}
RUNTIME_IMAGE=ghcr.io/example/ivybm-runtime
RUNTIME_IMAGE_DIGEST=${runtimeDigest}
WORKER_IMAGE=ghcr.io/example/ivybm-worker
WORKER_IMAGE_DIGEST=${workerDigest}
APP_VERSION=${imageTag}
POSTGRES_DB=ivybm
POSTGRES_USER=ivybm
POSTGRES_PASSWORD=operation-test-postgres-password
DATABASE_URL=postgresql://ivybm:operation-password@db:5432/ivybm
PAYLOAD_SECRET=operation-test-payload-secret-at-least-32-characters
NEXT_PUBLIC_SERVER_URL=https://ivybm.com
TRUST_PROXY_HEADERS=true
AI_PROVIDER_BASE_URL=https://api.example.invalid/v1
AI_PROVIDER_API_KEY=operation-placeholder-api-key
AI_TEXT_MODEL=operation-text-model
AI_EMBEDDING_MODEL=operation-embedding-model
`

const runPreflight = (environment: string) => {
  const directory = mkdtempSync(resolve(tmpdir(), 'ivybm-production-preflight-'))
  const environmentFile = resolve(directory, '.env')
  writeFileSync(environmentFile, environment)

  try {
    return spawnSync('bash', ['scripts/preflight-production.sh', environmentFile], {
      cwd: projectRoot,
      encoding: 'utf8',
    })
  } finally {
    rmSync(directory, { force: true, recursive: true })
  }
}

describe('production environment preflight', () => {
  it('accepts an explicit tag-and-digest release configuration without printing values', () => {
    const result = runPreflight(productionEnvironment)

    expect(result.status).toBe(0)
    expect(result.stdout).toContain('Production environment preflight passed')
    expect(result.stdout).not.toContain('operation-placeholder-api-key')
    expect(result.stdout).not.toContain('operation-test-postgres-password')
  })

  it('rejects a mutable or malformed image digest', () => {
    const result = runPreflight(
      productionEnvironment.replace(runtimeDigest, 'sha256:mutable-runtime-digest'),
    )

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('RUNTIME_IMAGE_DIGEST')
  })

  it('rejects a production file with demo seed credentials', () => {
    const result = runPreflight(`${productionEnvironment}SEED_ADMIN_EMAIL=admin@example.invalid\n`)

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('must not contain demo seed credentials')
  })

  it('rejects an unsafe database host and a mutable release tag', () => {
    const databaseResult = runPreflight(
      productionEnvironment.replace('@db:5432/', '@127.0.0.1:5432/'),
    )
    const tagResult = runPreflight(productionEnvironment.replace(imageTag, 'latest'))

    expect(databaseResult.status).not.toBe(0)
    expect(databaseResult.stderr).toContain('Compose db:5432 host')
    expect(tagResult.status).not.toBe(0)
    expect(tagResult.stderr).toContain('IMAGE_TAG')
  })
})
