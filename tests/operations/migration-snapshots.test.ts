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
      readFileSync(resolve(migrationsDir, '20260721_150000_task8_ai_usage_logs.json'), 'utf8'),
    ) as { tables?: Record<string, unknown> }

    expect(snapshot.tables).toHaveProperty('public.ai_usage_logs')
  })

  it('keeps Task 13, qualification, and image generation migrations in linear order', () => {
    const migrationIndex = readFileSync(resolve(migrationsDir, 'index.ts'), 'utf8')
    const orderedNames = [
      '20260812_163806_task13_platform_publishing_authority',
      '20260812_173701_qualification_answer_state',
      '20260813_055309_image_generation_provider_contract',
    ]
    const positions = orderedNames.map((name) => migrationIndex.lastIndexOf(`name: '${name}'`))

    expect(positions.every((position) => position >= 0)).toBe(true)
    expect(positions).toEqual([...positions].sort((left, right) => left - right))
  })

  it('uses restrictive deletes for required Portal V1 audit relationships', () => {
    const snapshot = JSON.parse(
      readFileSync(resolve(migrationsDir, '20260802_042231_portal_v1.json'), 'utf8'),
    ) as {
      tables?: Record<string, { foreignKeys?: Record<string, { onDelete?: string }> }>
    }
    const requiredForeignKeys = [
      ['public.generated_contents', 'generated_contents_created_by_id_users_id_fk'],
      ['public.content_reviews', 'content_reviews_content_id_generated_contents_id_fk'],
      ['public.content_reviews', 'content_reviews_reviewed_by_id_users_id_fk'],
      ['public.publish_jobs', 'publish_jobs_content_id_generated_contents_id_fk'],
      ['public.publish_jobs', 'publish_jobs_created_by_id_users_id_fk'],
      ['public.publish_logs', 'publish_logs_publish_job_id_publish_jobs_id_fk'],
      ['public.portal_command_receipts', 'portal_command_receipts_actor_id_users_id_fk'],
    ] as const

    for (const [table, constraint] of requiredForeignKeys) {
      expect(snapshot.tables?.[table]?.foreignKeys?.[constraint]?.onDelete).toBe('restrict')
    }
  })
})
