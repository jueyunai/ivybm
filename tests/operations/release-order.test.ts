import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const compose = './scripts/production-compose.sh .env'

describe('production release order', () => {
  it('stops app and worker before backup and migration, then starts services afterwards', () => {
    const handbook = readFileSync(resolve(projectRoot, 'docs/operations/部署手册.md'), 'utf8')
    const pullCommand = `${compose} pull`
    const stopServicesCommand = `${compose} stop app worker`
    const backupCommand = 'backup_dir="$(./scripts/backup-production.sh .env)"'
    const migrateCommand = `${compose} up --exit-code-from migrate migrate`
    const startServicesCommand = `${compose} up -d --wait --wait-timeout 120 app worker`

    expect(handbook.indexOf(pullCommand)).toBeGreaterThanOrEqual(0)
    expect(handbook.indexOf(stopServicesCommand)).toBeGreaterThan(handbook.indexOf(pullCommand))
    expect(handbook.indexOf(stopServicesCommand)).toBeLessThan(handbook.indexOf(backupCommand))
    expect(handbook.indexOf(backupCommand)).toBeLessThan(handbook.indexOf(migrateCommand))
    expect(handbook.indexOf(startServicesCommand)).toBeGreaterThan(handbook.indexOf(migrateCommand))
  })

  it('keeps the backup and Compose wrappers fail closed', () => {
    const composeWrapper = readFileSync(resolve(projectRoot, 'scripts/production-compose.sh'), 'utf8')
    const backupScript = readFileSync(resolve(projectRoot, 'scripts/backup-production.sh'), 'utf8')
    const verificationScript = readFileSync(
      resolve(projectRoot, 'scripts/verify-production-backup.sh'),
      'utf8',
    )
    const restoreScript = readFileSync(
      resolve(projectRoot, 'scripts/restore-production-backup-check.sh'),
      'utf8',
    )

    expect(composeWrapper).toContain('env -i')
    expect(composeWrapper).toContain('compose.prod.yaml')
    expect(backupScript).toContain('Stop app and worker')
    expect(backupScript).toContain('pg_restore --list')
    expect(backupScript).toContain('sha256sum -c SHA256SUMS')
    expect(backupScript).toContain('ivybm-prod-media:/media:ro')
    expect(verificationScript).toContain('different filesystem/device')
    expect(verificationScript).toContain('sha256sum -c SHA256SUMS')
    expect(restoreScript).toContain('--exit-on-error')
    expect(restoreScript).toContain('--tmpfs /var/lib/postgresql')
    expect(restoreScript).toContain('media.tar.gz')
  })
})
