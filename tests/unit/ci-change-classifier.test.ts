import { describe, expect, it } from 'vitest'

import { classifyChangedFiles } from '../../scripts/ci/classify-changes.mjs'

const lightClassification = {
  admin_e2e: false,
  chat_e2e: false,
  code: false,
  database: false,
  docs_only: true,
  full_fallback: false,
  operations: false,
  production_image: false,
  website_e2e: false,
}

const fullClassification = {
  ...lightClassification,
  admin_e2e: true,
  chat_e2e: true,
  code: true,
  database: true,
  docs_only: false,
  full_fallback: true,
  operations: true,
  production_image: true,
  website_e2e: true,
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

  it.each([
    'src/app/(frontend)/[locale]/products/page.tsx',
    'src/components/website/SiteHeader.tsx',
    'src/components/inquiry/InquiryForm.tsx',
    'tests/e2e/website.spec.ts',
  ])('selects only Website E2E for %s', (path) => {
    expect(classifyChangedFiles([path])).toMatchObject({
      admin_e2e: false,
      chat_e2e: false,
      code: true,
      docs_only: false,
      website_e2e: true,
    })
  })

  it.each([
    'src/admin/views/OperationsDashboard.tsx',
    'src/app/(payload)/custom.scss',
    'tests/e2e/admin-visual.spec.ts',
  ])('selects only Admin E2E for %s', (path) => {
    expect(classifyChangedFiles([path])).toMatchObject({
      admin_e2e: true,
      chat_e2e: false,
      code: true,
      docs_only: false,
      website_e2e: false,
    })
  })

  it.each([
    'src/components/chat/ChatWidget.tsx',
    'src/app/api/chat/sessions/route.ts',
    'tests/e2e/chat-handoff.spec.ts',
  ])('selects only Chat E2E for %s', (path) => {
    expect(classifyChangedFiles([path])).toMatchObject({
      admin_e2e: false,
      chat_e2e: true,
      code: true,
      docs_only: false,
      website_e2e: false,
    })
  })

  it.each([
    'src/app/(frontend)/[locale]/layout.tsx',
    'src/app/(frontend)/website.css',
  ])('selects Website and Chat E2E for shared frontend path %s', (path) => {
    expect(classifyChangedFiles([path])).toMatchObject({
      admin_e2e: false,
      chat_e2e: true,
      code: true,
      docs_only: false,
      website_e2e: true,
    })
  })

  it('combines Website and Admin E2E for a mixed change', () => {
    expect(
      classifyChangedFiles([
        'src/components/website/SiteHeader.tsx',
        'src/admin/views/OperationsDashboard.tsx',
      ]),
    ).toMatchObject({
      admin_e2e: true,
      chat_e2e: false,
      code: true,
      docs_only: false,
      website_e2e: true,
    })
  })

  it.each(['next.config.ts', 'tsconfig.json', 'playwright.config.ts'])(
    'selects every E2E suite for global UI configuration %s',
    (path) => {
      expect(classifyChangedFiles([path])).toMatchObject({
        admin_e2e: true,
        chat_e2e: true,
        code: true,
        docs_only: false,
        website_e2e: true,
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

  it('runs workflow changes through operations without publishing business images', () => {
    expect(classifyChangedFiles(['.github/workflows/ci.yml'])).toEqual({
      ...lightClassification,
      code: true,
      docs_only: false,
      operations: true,
    })
  })

  it('publishes images when the production-image classifier changes', () => {
    expect(classifyChangedFiles(['scripts/ci/classify-changes.mjs'])).toEqual({
      ...lightClassification,
      code: true,
      docs_only: false,
      operations: true,
      production_image: true,
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
    'tsconfig.json',
  ])('publishes production images for runtime input %s', (path) => {
    expect(classifyChangedFiles([path]).production_image).toBe(true)
  })

  it.each([
    ['unexpected-root.file'],
    ['src/components/unowned/NewWidget.tsx'],
    ['src/app/(unowned)/page.tsx'],
    ['tests/e2e/new-suite.spec.ts'],
  ])('fails closed for an unknown path %j', (paths) => {
    expect(classifyChangedFiles(paths)).toEqual(fullClassification)
  })

  it.each(invalidPathLists)('fails closed for invalid input %j', (paths) => {
    expect(classifyChangedFiles(paths)).toEqual(fullClassification)
  })
})
