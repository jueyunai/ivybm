// @vitest-environment node

import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  ManifestValidationError,
  parseManifest,
  verifyManifestMedia,
} from '../../../scripts/content-import/manifest'

const digest = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')

const media = (bytes: Uint8Array, overrides: Record<string, unknown> = {}) => ({
  filename: 'panel-01.jpg',
  path: 'media/panel-01.jpg',
  mimeType: 'image/jpeg',
  width: 1200,
  height: 800,
  bytes: bytes.byteLength,
  sha256: digest(bytes),
  alt: 'Aluminum panel',
  source: 'Synthetic test fixture',
  ...overrides,
})

const text = (title: string) => ({
  title,
  shortDescription: `${title} summary`,
  description: `${title} description`,
  seo: {
    title: `${title} SEO`,
    description: `${title} SEO description`,
    keywords: 'aluminum,panel',
  },
})

const validManifest = (bytes: Uint8Array) => ({
  version: 1,
  batch: 'unit-test',
  items: [
    {
      kind: 'product',
      sourceNumbers: ['01'],
      slug: 'test-panel',
      action: 'create',
      categorySlug: 'aluminum-panels',
      locales: { en: text('Test Panel'), ar: text('لوح اختبار') },
      coverImage: media(bytes),
    },
  ],
})

describe('content import manifest validation', () => {
  it('rejects traversal paths, unsupported media, and malformed slugs', () => {
    const bytes = new Uint8Array([1, 2, 3])
    expect(() => parseManifest(validManifest(bytes))).not.toThrow()
    expect(() =>
      parseManifest({
        ...validManifest(bytes),
        items: [{ ...validManifest(bytes).items[0], slug: 'Bad Slug' }],
      }),
    ).toThrow(ManifestValidationError)
    expect(() =>
      parseManifest({
        ...validManifest(bytes),
        items: [
          {
            ...validManifest(bytes).items[0],
            coverImage: media(bytes, { path: '../outside.jpg' }),
          },
        ],
      }),
    ).toThrow(/path is unsafe/)
    expect(() =>
      parseManifest({
        ...validManifest(bytes),
        items: [
          {
            ...validManifest(bytes).items[0],
            coverImage: media(bytes, { mimeType: 'application/pdf' }),
          },
        ],
      }),
    ).toThrow(/mimeType is unsupported/)
  })

  it('verifies external media bytes against the manifest SHA-256', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ivybm-content-import-'))
    const manifestPath = path.join(root, 'batch-manifest.json')
    const bytes = new Uint8Array([10, 20, 30, 40])
    await mkdir(path.join(root, 'media'))
    await writeFile(manifestPath, '{}')
    const manifest = validManifest(bytes)
    const actualPath = path.join(root, 'media', 'panel-01.jpg')
    await writeFile(actualPath, bytes)
    await expect(verifyManifestMedia(manifestPath, manifest.items[0].coverImage)).resolves.toEqual(
      expect.objectContaining({ length: bytes.byteLength }),
    )
    await writeFile(actualPath, new Uint8Array([99]))
    await expect(verifyManifestMedia(manifestPath, manifest.items[0].coverImage)).rejects.toThrow(
      /byte count mismatch/,
    )
  })
})
