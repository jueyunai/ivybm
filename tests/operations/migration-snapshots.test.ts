import { readdirSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const migrationsDir = resolve(projectRoot, 'src/migrations')

const migrationBasenames = (extension: '.json' | '.ts') =>
  readdirSync(migrationsDir)
    .filter((file) => file.endsWith(extension))
    .map((file) => file.slice(0, -extension.length))
    .filter((basename) => basename !== 'index')
    .sort()

describe('Payload migration snapshots', () => {
  it('keeps every migration paired with its generated schema snapshot', () => {
    expect(migrationBasenames('.ts')).toEqual(migrationBasenames('.json'))
  })

  it('records the AI usage log collection in its paired schema snapshot', () => {
    const snapshot = JSON.parse(
      readFileSync(
        resolve(migrationsDir, '20260721_150000_task8_ai_usage_logs.json'),
        'utf8',
      ),
    ) as { tables?: Record<string, unknown> }

    expect(snapshot.tables).toHaveProperty('public.ai_usage_logs')
  })
})
