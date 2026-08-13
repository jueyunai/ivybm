import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const migrationName = '20260813_055309_image_generation_provider_contract'

describe('AI image capability migration', () => {
  it('extends all three AI enums and has a paired generated snapshot', () => {
    const migration = readFileSync(
      resolve(projectRoot, 'src/migrations', `${migrationName}.ts`),
      'utf8',
    )
    const snapshot = JSON.parse(
      readFileSync(resolve(projectRoot, 'src/migrations', `${migrationName}.json`), 'utf8'),
    ) as { enums?: Record<string, { values?: string[] }> }

    expect(migration).toContain('enum_ai_model_profiles_capability')
    expect(migration).toContain('enum_ai_usage_routes_operation')
    expect(migration).toContain('enum_ai_usage_logs_operation')
    expect(migration).not.toContain('publish_jobs')
    expect(migration).not.toContain('publish_logs')
    expect(snapshot.enums?.['public.enum_ai_model_profiles_capability']?.values).toContain('image')
    expect(snapshot.enums?.['public.enum_ai_usage_routes_operation']?.values).toContain('image')
    expect(snapshot.enums?.['public.enum_ai_usage_logs_operation']?.values).toContain('generateImage')
  })
})
