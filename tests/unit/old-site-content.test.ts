import { describe, expect, it } from 'vitest'

import {
  ABOUT_SECTIONS,
  buildLocalizedContent,
  OLD_SITE_ASSETS,
  OLD_SITE_POSTS,
  OLD_SITE_PRODUCT_DESCRIPTIONS,
  OLD_SITE_PROJECTS,
  PRODUCT_ASSET_FILENAMES,
} from '@/seed/oldSiteContent'

describe('old-site content migration fixtures', () => {
  it('keeps the approved first release within three products, projects, and articles', () => {
    expect(Object.keys(PRODUCT_ASSET_FILENAMES)).toHaveLength(3)
    expect(Object.keys(PRODUCT_ASSET_FILENAMES)).toEqual(
      expect.arrayContaining([
        'single-curved-aluminum-panel',
        'double-curved-aluminum-panel',
        'solid-aluminum-panel',
      ]),
    )
    expect(
      Object.values(PRODUCT_ASSET_FILENAMES).every((filenames) => filenames.length === 5),
    ).toBe(true)
    expect(Object.keys(OLD_SITE_PRODUCT_DESCRIPTIONS)).toEqual(
      expect.arrayContaining(Object.keys(PRODUCT_ASSET_FILENAMES)),
    )
    expect(
      Object.values(OLD_SITE_PRODUCT_DESCRIPTIONS).every(
        (content) => content.en.sections.length >= 6 && content.ar.sections.length >= 6,
      ),
    ).toBe(true)
    expect(OLD_SITE_PROJECTS).toHaveLength(3)
    expect(OLD_SITE_POSTS).toHaveLength(3)
    expect(OLD_SITE_ASSETS).toHaveLength(39)
  })

  it('builds locale-directed Lexical content with deterministic media nodes', () => {
    const imageIDs = [101, 102, 103, 104]
    const english = buildLocalizedContent('en', ABOUT_SECTIONS.en, 'about-en', imageIDs)
    const arabic = buildLocalizedContent('ar', ABOUT_SECTIONS.ar, 'about-ar', imageIDs)

    expect(english.root).toMatchObject({ direction: 'ltr', type: 'root', version: 1 })
    expect(arabic.root).toMatchObject({ direction: 'rtl', type: 'root', version: 1 })

    for (const [content, direction, key] of [
      [english, 'ltr', 'about-en'],
      [arabic, 'rtl', 'about-ar'],
    ] as const) {
      const root = content.root as { children: Array<Record<string, unknown>> }
      const children = root.children
      expect(children.filter((node) => node.type === 'heading')).toHaveLength(4)
      expect(children.filter((node) => node.type === 'paragraph')).toHaveLength(4)
      expect(children.filter((node) => node.type === 'upload')).toEqual(
        imageIDs.map((value, index) =>
          expect.objectContaining({
            id: `${key}-${index + 1}`,
            relationTo: 'media',
            type: 'upload',
            value,
          }),
        ),
      )
      expect(
        children
          .filter((node) => node.type === 'heading' || node.type === 'paragraph')
          .every((node) => node.direction === direction),
      ).toBe(true)
    }
  })
})
