import { describe, expect, it } from 'vitest'

import { MAX_PUBLICATION_ASSETS } from '@/modules/publishing/contracts'
import { createLinkedInAssistedExport } from '@/modules/platforms/linkedin/export'

describe('LinkedIn assisted export', () => {
  it('returns normalized stable metadata without exposing any source URL', () => {
    const sourceUrl =
      'https://example.invalid/assets/facade-panel.jpg?temporary=secret-token#preview'
    const result = createLinkedInAssistedExport({
      assets: [
        {
          fileName: 'facade-panel.jpg',
          id: 'asset-2',
          mimeType: 'IMAGE/JPEG',
          sha256: 'A'.repeat(64),
          sourceUrl,
        },
        {
          fileName: 'project-detail.png',
          id: 'asset-1',
          mimeType: 'image/png',
        },
      ],
      text: '  Aluminum facade systems\r\nfor global projects.  ',
    })

    expect(result.assets).toEqual([
      { fileName: 'project-detail.png', id: 'asset-1', mimeType: 'image/png' },
      {
        fileName: 'facade-panel.jpg',
        id: 'asset-2',
        mimeType: 'image/jpeg',
        sha256: 'a'.repeat(64),
      },
    ])
    expect(result.copyText).toBe('Aluminum facade systems\nfor global projects.')
    expect(JSON.stringify(result)).not.toContain('sourceUrl')
    expect(JSON.stringify(result)).not.toContain(sourceUrl)
    expect(JSON.stringify(result)).not.toContain('secret-token')
  })

  it('normalizes asset identities before uniqueness checks', () => {
    expect(() =>
      createLinkedInAssistedExport({
        assets: [
          { fileName: 'one.jpg', id: 'asset-1', mimeType: 'image/jpeg' },
          { fileName: 'two.jpg', id: ' asset-1 ', mimeType: 'image/jpeg' },
        ],
        text: 'Fixture post',
      }),
    ).toThrow('Publication asset IDs must be unique')
    expect(() =>
      createLinkedInAssistedExport({
        assets: [
          { fileName: 'one.jpg', id: 'é', mimeType: 'image/jpeg' },
          { fileName: 'two.jpg', id: 'e\u0301', mimeType: 'image/jpeg' },
        ],
        text: 'Fixture post',
      }),
    ).toThrow('Publication asset IDs must be unique')
  })

  it('enforces text, URL, and asset-count admission boundaries', () => {
    expect(() => createLinkedInAssistedExport({ assets: [], text: '   ' })).toThrow(
      'Publication text is invalid or too long',
    )
    expect(() =>
      createLinkedInAssistedExport({
        assets: [
          {
            fileName: 'one.jpg',
            id: 'asset-1',
            mimeType: 'image/jpeg',
            sourceUrl: `https://example.invalid/${'a'.repeat(2_100)}`,
          },
        ],
        text: 'Fixture post',
      }),
    ).toThrow('Publication asset source URL is invalid or too long')
    expect(() =>
      createLinkedInAssistedExport({
        assets: Array.from({ length: MAX_PUBLICATION_ASSETS + 1 }, (_, index) => ({
          fileName: `${index}.jpg`,
          id: `asset-${index}`,
          mimeType: 'image/jpeg',
        })),
        text: 'Fixture post',
      }),
    ).toThrow(`Publication assets must contain at most ${MAX_PUBLICATION_ASSETS} items`)
  })
})
