import { describe, expect, it } from 'vitest'

import { createLinkedInAssistedPackage } from '../../../src/modules/platforms/linkedin/package'

const decoder = new TextDecoder()

const readStoredEntries = (archive: Uint8Array): Map<string, Uint8Array> => {
  const entries = new Map<string, Uint8Array>()
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength)
  let offset = 0

  while (offset + 4 <= archive.byteLength && view.getUint32(offset, true) === 0x04034b50) {
    const compression = view.getUint16(offset + 8, true)
    const compressedSize = view.getUint32(offset + 18, true)
    const fileNameLength = view.getUint16(offset + 26, true)
    const extraLength = view.getUint16(offset + 28, true)
    expect(compression).toBe(0)
    const fileNameStart = offset + 30
    const fileNameEnd = fileNameStart + fileNameLength
    const dataStart = fileNameEnd + extraLength
    const dataEnd = dataStart + compressedSize
    entries.set(decoder.decode(archive.slice(fileNameStart, fileNameEnd)), archive.slice(dataStart, dataEnd))
    offset = dataEnd
  }

  return entries
}

describe('LinkedIn assisted package', () => {
  it('creates a deterministic downloadable ZIP without fetching asset URLs', () => {
    const input = {
      assets: [
        {
          fileName: 'facade-panel.jpg',
          id: 'asset-2',
          mimeType: 'image/jpeg',
          bytes: new Uint8Array([2, 4, 6]),
        },
        {
          fileName: 'project-detail.png',
          id: 'asset-1',
          mimeType: 'image/png',
          bytes: new Uint8Array([1, 3, 5]),
        },
      ],
      text: '  Aluminum facade systems\r\nfor global projects.  ',
    }

    const first = createLinkedInAssistedPackage(input)
    const second = createLinkedInAssistedPackage({ ...input, assets: [...input.assets].reverse() })

    expect(first).toMatchObject({
      fileName: 'linkedin-assisted-post.zip',
      mimeType: 'application/zip',
      mode: 'assisted',
      platform: 'linkedin',
    })
    expect(first.bytes).toEqual(second.bytes)

    const entries = readStoredEntries(first.bytes)
    expect([...entries.keys()]).toEqual([
      'README.txt',
      'post.txt',
      'manifest.json',
      'assets/001-project-detail.png',
      'assets/002-facade-panel.jpg',
    ])
    expect(decoder.decode(entries.get('post.txt'))).toBe('Aluminum facade systems\nfor global projects.\n')
    expect(entries.get('assets/001-project-detail.png')).toEqual(new Uint8Array([1, 3, 5]))
    expect(entries.get('assets/002-facade-panel.jpg')).toEqual(new Uint8Array([2, 4, 6]))
    const manifest = JSON.parse(decoder.decode(entries.get('manifest.json'))) as {
      assets: Array<Record<string, string>>
    }
    expect(manifest.assets).toEqual([
      {
        archivePath: 'assets/001-project-detail.png',
        fileName: 'project-detail.png',
        id: 'asset-1',
        mimeType: 'image/png',
      },
      {
        archivePath: 'assets/002-facade-panel.jpg',
        fileName: 'facade-panel.jpg',
        id: 'asset-2',
        mimeType: 'image/jpeg',
      },
    ])
    expect(JSON.stringify(manifest)).not.toContain('sourceUrl')
  })

  it('orders non-ASCII asset identities by a locale-independent code-unit comparator', () => {
    const archive = createLinkedInAssistedPackage({
      assets: [
        { bytes: new Uint8Array([1]), fileName: 'umlaut.jpg', id: 'ä-asset', mimeType: 'image/jpeg' },
        { bytes: new Uint8Array([2]), fileName: 'zeta.jpg', id: 'z-asset', mimeType: 'image/jpeg' },
      ],
      text: 'Fixture post',
    })

    const entries = readStoredEntries(archive.bytes)
    expect([...entries.keys()]).toContain('assets/001-zeta.jpg')
    expect([...entries.keys()]).toContain('assets/002-umlaut.jpg')
  })

  it('rejects unsafe archive paths and duplicate archive entries', () => {
    expect(() =>
      createLinkedInAssistedPackage({
        assets: [
          { bytes: new Uint8Array([1]), fileName: '../outside.jpg', id: 'asset-1', mimeType: 'image/jpeg' },
        ],
        text: 'Fixture post',
      }),
    ).toThrow('LinkedIn assisted package file names must be safe base names')
    expect(() =>
      createLinkedInAssistedPackage({
        assets: [
          { bytes: new Uint8Array([1]), fileName: 'same.jpg', id: 'asset-1', mimeType: 'image/jpeg' },
          { bytes: new Uint8Array([2]), fileName: 'same.jpg', id: 'asset-2', mimeType: 'image/jpeg' },
        ],
        text: 'Fixture post',
      }),
    ).toThrow('LinkedIn assisted package file names must be unique')
    expect(() =>
      createLinkedInAssistedPackage({
        assets: [
          { bytes: new Uint8Array([1]), fileName: 'Panel.jpg', id: 'asset-1', mimeType: 'image/jpeg' },
          { bytes: new Uint8Array([2]), fileName: 'panel.jpg', id: 'asset-2', mimeType: 'image/jpeg' },
        ],
        text: 'Fixture post',
      }),
    ).toThrow('LinkedIn assisted package file names must be unique')
  })

  it('rejects file names that are unsafe or ambiguous on common customer desktops', () => {
    for (const fileName of [
      'panel:final.jpg',
      'trailing-dot.',
      'CON.jpg',
      'invoice\u202Egpj.jpg',
      `${'a'.repeat(256)}.jpg`,
    ]) {
      expect(() =>
        createLinkedInAssistedPackage({
          assets: [{ bytes: new Uint8Array([1]), fileName, id: 'asset-1', mimeType: 'image/jpeg' }],
          text: 'Fixture post',
        }),
      ).toThrow('LinkedIn assisted package file names must be safe base names')
    }
  })
})
