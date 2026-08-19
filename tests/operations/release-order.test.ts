import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'

import { describe, expect, it } from 'vitest'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const compose = './scripts/production-compose.sh .env'

describe('production release order', () => {
  it('stops app and worker before backup and migration, then starts services afterwards', () => {
    const handbook = readFileSync(resolve(projectRoot, 'docs/operations/部署手册.md'), 'utf8')
    const pullCommand = `${compose} pull`
    const stopServicesCommand = `${compose} stop app worker`
    const backupCommand = 'backup_dir="$(./scripts/backup-production.sh .env)"'
    const verifyCommand = './scripts/verify-production-backup.sh .env'
    const restoreCommand = './scripts/restore-production-backup-check.sh "$offsite_dir"'
    const knowledgeMigrationCommand =
      './scripts/migrate-production-knowledge-volumes.sh .env "$old_app_container"'
    const migrateCommand = `${compose} up --exit-code-from migrate migrate`
    const startServicesCommand = `${compose} up -d --wait --wait-timeout 120 app worker`

    expect(handbook.indexOf(pullCommand)).toBeGreaterThanOrEqual(0)
    expect(handbook.indexOf(stopServicesCommand)).toBeGreaterThan(handbook.indexOf(pullCommand))
    expect(handbook.indexOf(stopServicesCommand)).toBeLessThan(handbook.indexOf(backupCommand))
    expect(handbook.indexOf(backupCommand)).toBeLessThan(handbook.indexOf(migrateCommand))
    expect(handbook.indexOf(verifyCommand)).toBeGreaterThan(handbook.indexOf(backupCommand))
    expect(handbook.indexOf(verifyCommand)).toBeLessThan(handbook.indexOf(migrateCommand))
    expect(handbook.indexOf(restoreCommand)).toBeGreaterThan(handbook.indexOf(verifyCommand))
    expect(handbook.indexOf(restoreCommand)).toBeLessThan(handbook.indexOf(migrateCommand))
    expect(handbook.indexOf(knowledgeMigrationCommand)).toBeGreaterThan(
      handbook.indexOf(stopServicesCommand),
    )
    expect(handbook.indexOf(knowledgeMigrationCommand)).toBeLessThan(
      handbook.indexOf(startServicesCommand),
    )
    expect(handbook.indexOf(startServicesCommand)).toBeGreaterThan(handbook.indexOf(migrateCommand))
  })

  it('keeps the backup and Compose wrappers fail closed', () => {
    const composeWrapper = readFileSync(
      resolve(projectRoot, 'scripts/production-compose.sh'),
      'utf8',
    )
    const backupScript = readFileSync(resolve(projectRoot, 'scripts/backup-production.sh'), 'utf8')
    const verificationScript = readFileSync(
      resolve(projectRoot, 'scripts/verify-production-backup.sh'),
      'utf8',
    )
    const restoreScript = readFileSync(
      resolve(projectRoot, 'scripts/restore-production-backup-check.sh'),
      'utf8',
    )
    const knowledgeMigrationScript = readFileSync(
      resolve(projectRoot, 'scripts/migrate-production-knowledge-volumes.sh'),
      'utf8',
    )

    expect(composeWrapper).toContain('env -i')
    expect(composeWrapper).toContain('compose.prod.yaml')
    expect(backupScript).toContain('Stop app and worker')
    expect(backupScript).toContain('pg_restore --list')
    expect(backupScript).toContain('sha256sum -c SHA256SUMS')
    expect(backupScript).toContain('Refusing to overwrite an existing production backup')
    expect(backupScript).toContain('archive_volume ivybm-prod-media media.tar.gz')
    expect(backupScript).toContain(
      'archive_volume ivybm-prod-knowledge-sources knowledge-sources.tar.gz',
    )
    expect(backupScript).toContain(
      'archive_volume ivybm-prod-knowledge-source-assets knowledge-source-assets.tar.gz',
    )
    expect(verificationScript).toContain('knowledge-sources.tar.gz')
    expect(verificationScript).toContain('knowledge-source-assets.tar.gz')
    expect(verificationScript).toContain('different filesystem/device')
    expect(verificationScript).toContain('sha256sum -c SHA256SUMS')
    expect(verificationScript).toContain('does not match the verified production backup manifest')
    expect(restoreScript).toContain('--exit-on-error')
    expect(restoreScript).toContain('--tmpfs /var/lib/postgresql')
    expect(restoreScript).toContain('media.tar.gz')
    expect(restoreScript).toContain('knowledge-sources.tar.gz')
    expect(restoreScript).toContain('knowledge-source-assets.tar.gz')
    expect(knowledgeMigrationScript).toContain('Refusing to overwrite existing volume')
    expect(knowledgeMigrationScript).toContain('knowledge_source_documents')
    expect(knowledgeMigrationScript).toContain('knowledge_source_assets')
    expect(knowledgeMigrationScript).toContain('chown -R 1001:1001')
    expect(knowledgeMigrationScript).toContain('verify_volume')
  })

  it('strips caller release variables before invoking Compose', () => {
    const directory = mkdtempSync(resolve(tmpdir(), 'ivybm-production-compose-'))
    const fakeDocker = resolve(directory, 'docker')
    const environmentFile = resolve(directory, '.env')

    writeFileSync(
      fakeDocker,
      '#!/usr/bin/env bash\nprintf "%s\\n" "${ADMIN_PORTAL_PUBLISHING_ENABLED-<unset>}"\n',
    )
    chmodSync(fakeDocker, 0o755)
    writeFileSync(environmentFile, 'ADMIN_PORTAL_PUBLISHING_ENABLED=false\n')

    try {
      const result = spawnSync(
        'bash',
        ['./scripts/production-compose.sh', environmentFile, 'config'],
        {
          cwd: projectRoot,
          encoding: 'utf8',
          env: {
            ...process.env,
            PATH: `${directory}:${process.env.PATH ?? ''}`,
            ADMIN_PORTAL_PUBLISHING_ENABLED: 'true',
          },
        },
      )

      expect(result.status).toBe(0)
      expect(result.stdout.trim()).toBe('<unset>')
    } finally {
      rmSync(directory, { force: true, recursive: true })
    }
  })
})
