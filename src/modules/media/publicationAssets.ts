import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

import type { Payload } from 'payload'

import { mediaBytesMatchMimeType, resolveManagedMediaPath } from './files'

const META_PUBLICATION_MIME_TYPES = new Set(['image/jpeg', 'image/png'])

export type PublicationAssetResponse = {
  bytes: Uint8Array
  mimeType: 'image/jpeg' | 'image/png'
}

export const publicationAssetPath = (id: number | string, sha256: string): string =>
  `/api/publication-assets/${encodeURIComponent(String(id))}/${sha256}`

export const readPublicationAsset = async ({
  id,
  mediaRoot,
  payload,
  sha256,
}: {
  id: number
  mediaRoot?: string
  payload: Payload
  sha256: string
}): Promise<PublicationAssetResponse | null> => {
  if (!Number.isSafeInteger(id) || id < 1 || !/^[a-f0-9]{64}$/u.test(sha256)) return null
  try {
    const media = await payload.findByID({
      collection: 'media',
      depth: 0,
      id,
      overrideAccess: false,
    })
    const filename = typeof media.filename === 'string' ? media.filename : ''
    const mimeType = typeof media.mimeType === 'string' ? media.mimeType : ''
    if (media.isPublic !== true || !META_PUBLICATION_MIME_TYPES.has(mimeType)) return null
    const bytes = await readFile(await resolveManagedMediaPath(filename, mediaRoot))
    if (
      (typeof media.filesize === 'number' && media.filesize !== bytes.byteLength) ||
      !mediaBytesMatchMimeType(bytes, mimeType) ||
      createHash('sha256').update(bytes).digest('hex') !== sha256
    ) {
      return null
    }
    return { bytes, mimeType: mimeType as PublicationAssetResponse['mimeType'] }
  } catch {
    return null
  }
}
