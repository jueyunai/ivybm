import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const compose = 'docker compose --env-file .env -f compose.yaml -f compose.prod.yaml'

describe('production release order', () => {
  it('stops the old worker before migration and starts services afterwards', () => {
    const handbook = readFileSync(resolve(projectRoot, 'docs/operations/部署手册.md'), 'utf8')
    const pullCommand = `${compose} pull`
    const stopWorkerCommand = `${compose} stop worker`
    const migrateCommand = `${compose} up --exit-code-from migrate migrate`
    const startServicesCommand = `${compose} up -d --wait --wait-timeout 120 app worker`

    expect(handbook.indexOf(pullCommand)).toBeGreaterThanOrEqual(0)
    expect(handbook.indexOf(stopWorkerCommand)).toBeGreaterThan(handbook.indexOf(pullCommand))
    expect(handbook.indexOf(stopWorkerCommand)).toBeLessThan(handbook.indexOf(migrateCommand))
    expect(handbook.indexOf(startServicesCommand)).toBeGreaterThan(handbook.indexOf(migrateCommand))
  })
})
