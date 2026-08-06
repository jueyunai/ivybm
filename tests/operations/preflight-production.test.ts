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
AI_CONFIG_ENCRYPTION_KEY=cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc
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
    expect(result.stdout).not.toContain(
      'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
    )
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

  it('rejects malformed optional reasoning configuration', () => {
    const invalidSwitch = runPreflight(`${productionEnvironment}AI_REASONING_ENABLED=sometimes\n`)
    const invalidEffort = runPreflight(`${productionEnvironment}AI_REASONING_EFFORT=ultra\n`)

    expect(invalidSwitch.status).not.toBe(0)
    expect(invalidSwitch.stderr).toContain('AI_REASONING_ENABLED')
    expect(invalidEffort.status).not.toBe(0)
    expect(invalidEffort.stderr).toContain('AI_REASONING_EFFORT')
  })

  it('accepts a supported optional reasoning configuration', () => {
    const result = runPreflight(
      `${productionEnvironment}AI_REASONING_ENABLED=true\nAI_REASONING_EFFORT=high\n`,
    )

    expect(result.status).toBe(0)
  })

  it('accepts a per-operation environment fallback and rejects missing or invalid encryption keys', () => {
    const fallbackResult =
      runPreflight(`${productionEnvironment}AI_PROVIDER_BASE_URL=https://api.example.invalid/v1
AI_PROVIDER_API_KEY=operation-placeholder-api-key
AI_TEXT_MODEL=operation-text-model
`)
    const missingKeyResult = runPreflight(
      productionEnvironment.replace(
        'AI_CONFIG_ENCRYPTION_KEY=cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc\n',
        '',
      ),
    )
    const partialFallbackResult = runPreflight(
      `${productionEnvironment}AI_PROVIDER_API_KEY=operation-placeholder-api-key\n`,
    )
    const invalidKeyResult = runPreflight(
      productionEnvironment.replace(
        'AI_CONFIG_ENCRYPTION_KEY=cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
        'AI_CONFIG_ENCRYPTION_KEY=too-short',
      ),
    )

    expect(fallbackResult.status).toBe(0)
    expect(missingKeyResult.status).not.toBe(0)
    expect(missingKeyResult.stderr).toContain('AI_CONFIG_ENCRYPTION_KEY')
    expect(partialFallbackResult.status).not.toBe(0)
    expect(partialFallbackResult.stderr).toContain('AI bootstrap endpoint and API key')
    expect(invalidKeyResult.status).not.toBe(0)
    expect(invalidKeyResult.stderr).toContain('AI_CONFIG_ENCRYPTION_KEY')
  })

  it('requires fixed dimensions for the legacy embedding fallback', () => {
    const fallback = `${productionEnvironment}AI_PROVIDER_BASE_URL=https://api.example.invalid/v1
AI_PROVIDER_API_KEY=operation-placeholder-api-key
AI_EMBEDDING_MODEL=operation-embedding-model
`
    const missingDimensions = runPreflight(fallback)
    const invalidDimensions = runPreflight(`${fallback}AI_EMBEDDING_DIMENSIONS=dynamic\n`)
    const fixedDimensions = runPreflight(`${fallback}AI_EMBEDDING_DIMENSIONS=1536\n`)

    expect(missingDimensions.status).not.toBe(0)
    expect(missingDimensions.stderr).toContain('AI_EMBEDDING_DIMENSIONS')
    expect(invalidDimensions.status).not.toBe(0)
    expect(invalidDimensions.stderr).toContain('AI_EMBEDDING_DIMENSIONS')
    expect(fixedDimensions.status).toBe(0)
  })

  it('requires all Meta webhook settings together when ingress is enabled', () => {
    const partial = runPreflight(
      `${productionEnvironment}META_WEBHOOK_APP_SECRET=operation-meta-app-secret\n`,
    )
    const complete = runPreflight(`${productionEnvironment}META_WEBHOOK_APP_SECRET=operation-meta-app-secret
META_WEBHOOK_VERIFY_TOKEN=operation-meta-verify-token
META_WEBHOOK_ALLOWED_ACCOUNT_IDS=1234567890,9876543210
`)

    expect(partial.status).not.toBe(0)
    expect(partial.stderr).toContain('META_WEBHOOK_APP_SECRET')
    expect(complete.status).toBe(0)
    expect(complete.stdout).not.toContain('operation-meta-app-secret')
  })

  it('requires a complete Meta OAuth set, exact callback, and credential encryption', () => {
    const webhook = `META_WEBHOOK_APP_SECRET=operation-meta-app-secret
META_WEBHOOK_VERIFY_TOKEN=operation-meta-verify-token
META_WEBHOOK_ALLOWED_ACCOUNT_IDS=1234567890,9876543210
`
    const partial = runPreflight(`${productionEnvironment}${webhook}META_APP_ID=1111111111111111
`)
    const wrongCallback = runPreflight(`${productionEnvironment}${webhook}META_APP_ID=1111111111111111
META_LOGIN_CONFIG_ID=2222222222222222
META_OAUTH_REDIRECT_URI=https://evil.example/api/platforms/meta/oauth/callback
PLATFORM_CREDENTIAL_ENCRYPTION_KEY=dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd
`)
    const missingEncryption = runPreflight(`${productionEnvironment}${webhook}META_APP_ID=1111111111111111
META_LOGIN_CONFIG_ID=2222222222222222
META_OAUTH_REDIRECT_URI=https://ivybm.com/api/platforms/meta/oauth/callback
`)
    const complete = runPreflight(`${productionEnvironment}${webhook}META_APP_ID=1111111111111111
META_LOGIN_CONFIG_ID=2222222222222222
META_OAUTH_REDIRECT_URI=https://ivybm.com/api/platforms/meta/oauth/callback
PLATFORM_CREDENTIAL_ENCRYPTION_KEY=dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd
`)

    expect(partial.status).not.toBe(0)
    expect(partial.stderr).toContain('META_LOGIN_CONFIG_ID')
    expect(wrongCallback.status).not.toBe(0)
    expect(wrongCallback.stderr).toContain('META_OAUTH_REDIRECT_URI')
    expect(missingEncryption.status).not.toBe(0)
    expect(missingEncryption.stderr).toContain('PLATFORM_CREDENTIAL_ENCRYPTION_KEY')
    expect(complete.status).toBe(0)
    expect(complete.stdout).not.toContain('operation-meta-app-secret')
  })

  it('requires a complete Instagram OAuth set and exact callback', () => {
    const partial = runPreflight(`${productionEnvironment}INSTAGRAM_APP_ID=3333333333333333
`)
    const wrongCallback = runPreflight(`${productionEnvironment}INSTAGRAM_APP_ID=3333333333333333
INSTAGRAM_APP_SECRET=operation-instagram-secret
INSTAGRAM_OAUTH_REDIRECT_URI=https://evil.example/api/platforms/instagram/oauth/callback
PLATFORM_CREDENTIAL_ENCRYPTION_KEY=dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd
`)
    const missingEncryption = runPreflight(`${productionEnvironment}INSTAGRAM_APP_ID=3333333333333333
INSTAGRAM_APP_SECRET=operation-instagram-secret
INSTAGRAM_OAUTH_REDIRECT_URI=https://ivybm.com/api/platforms/instagram/oauth/callback
`)
    const complete = runPreflight(`${productionEnvironment}INSTAGRAM_APP_ID=3333333333333333
INSTAGRAM_APP_SECRET=operation-instagram-secret
INSTAGRAM_OAUTH_REDIRECT_URI=https://ivybm.com/api/platforms/instagram/oauth/callback
PLATFORM_CREDENTIAL_ENCRYPTION_KEY=dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd
`)

    expect(partial.status).not.toBe(0)
    expect(partial.stderr).toContain('INSTAGRAM_APP_SECRET')
    expect(wrongCallback.status).not.toBe(0)
    expect(wrongCallback.stderr).toContain('INSTAGRAM_OAUTH_REDIRECT_URI')
    expect(missingEncryption.status).not.toBe(0)
    expect(missingEncryption.stderr).toContain('PLATFORM_CREDENTIAL_ENCRYPTION_KEY')
    expect(complete.status).toBe(0)
    expect(complete.stdout).not.toContain('operation-instagram-secret')
  })

  it('accepts an omitted platform credential key but rejects an invalid configured value', () => {
    const omitted = runPreflight(productionEnvironment)
    const invalid = runPreflight(
      `${productionEnvironment}PLATFORM_CREDENTIAL_ENCRYPTION_KEY=not-a-64-character-hex-key\n`,
    )
    const valid = runPreflight(
      `${productionEnvironment}PLATFORM_CREDENTIAL_ENCRYPTION_KEY=dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd\n`,
    )

    expect(omitted.status).toBe(0)
    expect(invalid.status).not.toBe(0)
    expect(invalid.stderr).toContain('PLATFORM_CREDENTIAL_ENCRYPTION_KEY')
    expect(valid.status).toBe(0)
    expect(valid.stdout).not.toContain(
      'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
    )
  })
})
