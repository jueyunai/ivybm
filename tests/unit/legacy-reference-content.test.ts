import { describe, expect, it } from 'vitest'

import { getLegacyArticleReference } from '@/lib/legacy-article-reference'
import { getProductProcurementContent } from '@/lib/product-procurement'

describe('legacy source-grounded detail content', () => {
  it('keeps the archived product table qualified as historical reference data', () => {
    const content = getProductProcurementContent('en', 'double-curved-aluminum-panel')

    expect(content.legacyReferenceRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: 'Legacy size reference',
          value: expect.stringContaining('1500 × 6000 mm'),
        }),
        expect.objectContaining({
          label: 'Geometry listed',
          value: expect.stringContaining('double-curved'),
        }),
      ]),
    )
    expect(content.legacyReferenceNote).toContain('not a current offer')
    expect(content.storyCaptions).toHaveLength(4)
  })

  it('reproduces every row in the archived thickness comparison with a source warning', () => {
    const reference = getLegacyArticleReference('en', 'aluminum-panel-thickness-guide')

    expect(reference?.rows).toEqual([
      { nominal: '1.5 mm', actual: '1.35 mm' },
      { nominal: '2.0 mm', actual: '1.85 mm' },
      { nominal: '2.5 mm', actual: '2.35 mm' },
      { nominal: '3.0 mm', actual: '2.85 mm' },
      { nominal: '4.0 mm', actual: '3.9 mm' },
      { nominal: '5.0 mm', actual: '5.0 mm — custom sheet' },
    ])
    expect(reference?.note).toContain('does not cite a test method')
    expect(getLegacyArticleReference('en', 'what-is-double-curved-aluminum-panel')).toBeNull()
  })
})
