import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const historicalMigration = '20260910_235252_task17_ai_model_profile_defaults'
const correctiveMigration = '20260911_024207_task17_ai_model_profile_defaults'

describe('AI model profile default migrations (history and correction)', () => {
  const readMigration = (name: string) =>
    readFileSync(resolve(projectRoot, 'src/migrations', `${name}.ts`), 'utf8')

  it('preserves the historical migration that initially set 90000 and 8192', () => {
    const historical = readMigration(historicalMigration)
    expect(historical).toContain('ALTER COLUMN "parameters_timeout_ms" SET DEFAULT 90000')
    expect(historical).toContain('ALTER COLUMN "parameters_max_output_tokens" SET DEFAULT 8192')
  })

  it('applies corrective migration resetting timeout to 30000 and dropping shared token default', () => {
    const corrective = readMigration(correctiveMigration)
    const upSection = corrective.slice(
      corrective.indexOf('export async function up'),
      corrective.indexOf('export async function down'),
    )
    // Corrective up resets timeout to 30000 (preserving the 120s command lease)
    expect(upSection).toContain('ALTER COLUMN "parameters_timeout_ms" SET DEFAULT 30000')
    expect(upSection).toContain('ALTER COLUMN "parameters_max_output_tokens" DROP DEFAULT')
    expect(upSection).not.toMatch(/parameters_max_output_tokens"\s+SET DEFAULT/)
  })

  it('rolls corrective migration back to the historical 90000 and 8192 state', () => {
    const corrective = readMigration(correctiveMigration)
    const downSection = corrective.slice(corrective.indexOf('export async function down'))
    expect(downSection).toContain('ALTER COLUMN "parameters_timeout_ms" SET DEFAULT 90000')
    expect(downSection).toContain('ALTER COLUMN "parameters_max_output_tokens" SET DEFAULT 8192')
  })
})
