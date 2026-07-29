import { describe, expect, it } from 'vitest'

import { classifyChangedFiles } from '../../scripts/ci/classify-changes.mjs'

const lightClassification = {
  code: false,
  database: false,
  docs_only: true,
  full_fallback: false,
  operations: false,
  production_image: false,
  ui_e2e: false,
}

const invalidPathLists: string[][] = [
  [],
  [''],
  ['/etc/passwd'],
  ['../outside'],
  ['docs/../../outside'],
  ['docs\\guide.md'],
]

describe('CI change classifier', () => {
  it('keeps documentation-only changes on the light path', () => {
    expect(
      classifyChangedFiles(['docs/guide.md', 'AGENTS.md', '.github/pull_request_template.md']),
    ).toEqual(lightClassification)
  })

  it('classifies runtime source as code that needs a build and production images', () => {
    expect(classifyChangedFiles(['src/modules/platforms/types.ts'])).toEqual({
      ...lightClassification,
      code: true,
      docs_only: false,
      production_image: true,
    })
  })

  it.each(['src/payload.config.ts', 'src/migrations/20260729_example.ts'])(
    'classifies %s as a database and integration change',
    (path) => {
      expect(classifyChangedFiles([path])).toMatchObject({
        code: true,
        database: true,
        docs_only: false,
        production_image: true,
      })
    },
  )

  it.each(['src/admin/views/Page.tsx', 'src/app/page.tsx', 'tests/e2e/smoke.spec.ts'])(
    'classifies %s as a UI E2E change',
    (path) => {
      expect(classifyChangedFiles([path])).toMatchObject({
        code: true,
        docs_only: false,
        ui_e2e: true,
      })
    },
  )

  it.each(['Dockerfile', 'compose.prod.yaml', 'tests/operations/compose.test.ts'])(
    'classifies %s as an operations change',
    (path) => {
      expect(classifyChangedFiles([path])).toMatchObject({
        code: true,
        docs_only: false,
        operations: true,
      })
    },
  )

  it('runs workflow and classifier changes through operations without publishing business images', () => {
    expect(
      classifyChangedFiles(['.github/workflows/ci.yml', 'scripts/ci/classify-changes.mjs']),
    ).toEqual({
      ...lightClassification,
      code: true,
      docs_only: false,
      operations: true,
    })
  })

  it.each(['tests/unit/example.test.ts', 'tests/contract/example.test.ts'])(
    'does not publish production images for test-only change %s',
    (path) => {
      expect(classifyChangedFiles([path])).toMatchObject({
        code: true,
        docs_only: false,
        production_image: false,
      })
    },
  )

  it.each([
    'src/worker.ts',
    'src/migrations/20260729_example.ts',
    'package.json',
    'pnpm-lock.yaml',
    'Dockerfile',
    'next.config.ts',
  ])('publishes production images for runtime input %s', (path) => {
    expect(classifyChangedFiles([path]).production_image).toBe(true)
  })

  it('combines flags across all changed paths', () => {
    expect(
      classifyChangedFiles(['docs/guide.md', 'src/admin/views/Page.tsx', 'src/payload.config.ts']),
    ).toMatchObject({
      code: true,
      database: true,
      docs_only: false,
      production_image: true,
      ui_e2e: true,
    })
  })

  it('fails closed for an unknown path', () => {
    expect(classifyChangedFiles(['unexpected-root.file'])).toEqual({
      ...lightClassification,
      code: true,
      database: true,
      docs_only: false,
      full_fallback: true,
      operations: true,
      production_image: true,
      ui_e2e: true,
    })
  })

  it.each(invalidPathLists)('fails closed for invalid input %j', (paths) => {
    expect(classifyChangedFiles(paths)).toEqual({
      ...lightClassification,
      code: true,
      database: true,
      docs_only: false,
      full_fallback: true,
      operations: true,
      production_image: true,
      ui_e2e: true,
    })
  })
})
