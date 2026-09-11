import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const migrationName = '20260911_024207_task17_ai_model_profile_defaults'

// The first attempt at this migration set a column-level DEFAULT 8192 on
// parameters_max_output_tokens. That column is shared by text, embedding and
// image profiles, so Postgres filled it for every capability and both the
// AiModelProfiles validation and the AI route registry rejected non-text
// profiles. The default must be applied per capability in the collection hook.
describe('AI model profile default migration', () => {
  const migration = readFileSync(
    resolve(projectRoot, 'src/migrations', `${migrationName}.ts`),
    'utf8',
  )

  it('raises the timeout default', () => {
    expect(migration).toContain(
      'ALTER COLUMN "parameters_timeout_ms" SET DEFAULT 90000',
    )
  })

  it('never gives maxOutputTokens a column default shared across capabilities', () => {
    expect(migration).not.toMatch(/parameters_max_output_tokens"\s+SET DEFAULT/)
    expect(migration).toContain(
      'ALTER COLUMN "parameters_max_output_tokens" DROP DEFAULT',
    )
  })

  it('rolls the timeout default back without reintroducing the token default', () => {
    const downSection = migration.slice(migration.indexOf('export async function down'))
    expect(downSection).toContain('ALTER COLUMN "parameters_timeout_ms" SET DEFAULT 30000')
    expect(downSection).not.toMatch(/parameters_max_output_tokens"\s+SET DEFAULT/)
  })
})
