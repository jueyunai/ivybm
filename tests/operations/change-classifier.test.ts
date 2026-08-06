import { describe, expect, it } from 'vitest'

import { classifyChangedFiles } from '../../scripts/ci/classify-changes.mjs'

describe('CI change classifier', () => {
  it('publishes immutable production images when production Compose changes', () => {
    expect(classifyChangedFiles(['compose.prod.yaml'])).toMatchObject({
      code: true,
      operations: true,
      production_image: true,
      full_fallback: false,
    })
  })

  it.each([
    'src/admin-portal/modules/media/MediaEditor.tsx',
    'src/app/(dashboard)/dashboard/(protected)/media/page.tsx',
    'src/app/api/portal/media/route.ts',
    'tests/e2e/admin-portal-media.spec.ts',
  ])('selects Portal browser coverage for %s', (path) => {
    const result = classifyChangedFiles([path])

    expect(result).toMatchObject({
      admin_e2e: true,
      code: true,
      docs_only: false,
      full_fallback: false,
    })
  })
})
