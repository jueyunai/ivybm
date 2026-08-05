import { describe, expect, it } from 'vitest'

import { preservePublicationHistory, publicationHistoryField } from '@/fields/publicationHistory'

const applyHook = async ({
  data,
  originalDoc,
}: {
  data: Record<string, unknown>
  originalDoc?: Record<string, unknown>
}) =>
  preservePublicationHistory({ data, originalDoc } as Parameters<
    typeof preservePublicationHistory
  >[0])

describe('publication history field', () => {
  it('is hidden from CMS editing and defaults new content to never published', () => {
    expect(publicationHistoryField).toMatchObject({
      admin: { hidden: true, readOnly: true },
      defaultValue: false,
      name: 'hasBeenPublished',
      type: 'checkbox',
    })
  })

  it('becomes true on first publication and can never return to false', async () => {
    await expect(
      applyHook({ data: { _status: 'draft' }, originalDoc: { hasBeenPublished: false } }),
    ).resolves.toMatchObject({ hasBeenPublished: false })
    await expect(
      applyHook({ data: { _status: 'published' }, originalDoc: { hasBeenPublished: false } }),
    ).resolves.toMatchObject({ hasBeenPublished: true })
    await expect(
      applyHook({
        data: { _status: 'draft', hasBeenPublished: false },
        originalDoc: { hasBeenPublished: true },
      }),
    ).resolves.toMatchObject({ hasBeenPublished: true })
  })
})
