import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const migrationName = '20260812_163218_image_generation_provider_contract'

describe('AI provider text contract migration', () => {
  it('adds only the explicit text contract field and preserves unrelated foreign keys', () => {
    const migration = readFileSync(
      resolve(projectRoot, 'src/migrations', `${migrationName}.ts`),
      'utf8',
    )
    const snapshot = JSON.parse(
      readFileSync(resolve(projectRoot, 'src/migrations', `${migrationName}.json`), 'utf8'),
    ) as {
      enums?: Record<string, { values?: string[] }>
      tables?: Record<
        string,
        {
          columns?: Record<string, unknown>
          foreignKeys?: Record<string, { onDelete?: string }>
        }
      >
    }

    expect(migration).toContain('enum_ai_providers_text_generation_contract')
    expect(migration).toContain('ALTER TABLE "ai_providers" ADD COLUMN "text_generation_contract"')
    expect(migration).not.toContain('knowledge_source_assets')
    expect(
      snapshot.enums?.['public.enum_ai_providers_text_generation_contract']?.values,
    ).toEqual(['responses', 'chat-completions'])
    expect(snapshot.tables?.['public.ai_providers']?.columns).toHaveProperty(
      'text_generation_contract',
    )
    expect(
      snapshot.tables?.['public.knowledge_source_assets']?.foreignKeys
        ?.knowledge_source_assets_source_id_knowledge_source_documents_id_fk?.onDelete,
    ).toBe('cascade')
  })
})
