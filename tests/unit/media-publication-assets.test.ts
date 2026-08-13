import { createHash } from 'node:crypto'
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import sharp from 'sharp'
import { afterEach, describe, expect, it } from 'vitest'

import { readPublicationAsset } from '@/modules/media/publicationAssets'
import { resolveManagedMediaPath } from '@/modules/media/files'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  )
})

describe('publication media byte boundary', () => {
  it('serves only the current public bytes under their content hash', async () => {
    const mediaRoot = await mkdtemp(path.join(os.tmpdir(), 'ivybm-publication-media-'))
    temporaryDirectories.push(mediaRoot)
    const bytes = await sharp({
      create: { background: '#1c2f46', channels: 3, height: 2, width: 2 },
    })
      .png()
      .toBuffer()
    const filename = 'approved.png'
    await writeFile(path.join(mediaRoot, filename), bytes)
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    let isPublic = true
    const payload = {
      findByID: async () => ({
        filename,
        filesize: bytes.byteLength,
        id: 81,
        isPublic,
        mimeType: 'image/png',
      }),
    } as any

    await expect(
      readPublicationAsset({ id: 81, mediaRoot, payload, sha256 }),
    ).resolves.toMatchObject({ bytes, mimeType: 'image/png' })
    await expect(
      readPublicationAsset({ id: 81, mediaRoot, payload, sha256: '0'.repeat(64) }),
    ).resolves.toBeNull()

    await writeFile(
      path.join(mediaRoot, filename),
      Buffer.from(bytes.map((byte, index) => (index === bytes.length - 1 ? byte ^ 1 : byte))),
    )
    await expect(readPublicationAsset({ id: 81, mediaRoot, payload, sha256 })).resolves.toBeNull()

    isPublic = false
    await writeFile(path.join(mediaRoot, filename), bytes)
    await expect(readPublicationAsset({ id: 81, mediaRoot, payload, sha256 })).resolves.toBeNull()
  })

  it('rejects a managed filename whose real path escapes through a symlink', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ivybm-media-root-'))
    const outside = await mkdtemp(path.join(os.tmpdir(), 'ivybm-media-outside-'))
    temporaryDirectories.push(root, outside)
    await writeFile(path.join(outside, 'secret.png'), Buffer.from('not public'))
    await symlink(path.join(outside, 'secret.png'), path.join(root, 'linked.png'))

    await expect(resolveManagedMediaPath('linked.png', root)).rejects.toThrow(
      'Managed media path is outside storage',
    )
  })
})
