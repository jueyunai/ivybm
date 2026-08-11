// @vitest-environment node

import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { KnowledgeSourceAssets } from '@/collections/KnowledgeSourceAssets'

const migrationBase = path.join(
  process.cwd(),
  'src/migrations/20260809_103656_task8_knowledge_ingestion',
)

describe('knowledge source asset lifecycle', () => {
  it('keeps the required Collection relation and migration cascade semantics aligned', () => {
    const sourceField = KnowledgeSourceAssets.fields.find(
      (field) => 'name' in field && field.name === 'source',
    )
    expect(sourceField).toMatchObject({
      relationTo: 'knowledge-source-documents',
      required: true,
      type: 'relationship',
    })

    const migration = readFileSync(`${migrationBase}.ts`, 'utf8')
    expect(migration).toContain(
      '"source_id") REFERENCES "public"."knowledge_source_documents"("id") ON DELETE cascade',
    )

    const snapshot = JSON.parse(readFileSync(`${migrationBase}.json`, 'utf8')) as {
      tables: Record<string, { foreignKeys: Record<string, { onDelete?: string }> }>
    }
    expect(
      snapshot.tables['public.knowledge_source_assets'].foreignKeys[
        'knowledge_source_assets_source_id_knowledge_source_documents_id_fk'
      ].onDelete,
    ).toBe('cascade')
  })
})
