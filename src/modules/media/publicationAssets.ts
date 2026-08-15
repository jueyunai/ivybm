import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

import type { Payload } from 'payload'

import { mediaBytesMatchMimeType, resolveManagedMediaPath } from './files'

const META_PUBLICATION_MIME_TYPES = new Set(['image/jpeg', 'image/png'])
const LINKEDIN_PUBLICATION_MIME_TYPES = new Set(['image/gif', 'image/jpeg', 'image/png'])

export type PublicationAssetResponse = {
  bytes: Uint8Array
  mimeType: 'image/jpeg' | 'image/png'
}

export type CurrentPublicMediaAssetResponse = {
  bytes: Uint8Array
  mimeType: string
}

export const publicationAssetPath = (id: number | string, sha256: string): string =>
  `/api/publication-assets/${encodeURIComponent(String(id))}/${sha256}`

/**
 * Reads the exact bytes currently authorized for an external publication.
 * Callers provide the platform MIME allowlist and the staged byte identity;
 * all checks happen after resolving the managed path and before provider I/O.
 */
export const readCurrentPublicMediaAsset = async ({
  allowedMimeTypes,
  expectedByteLength,
  expectedMimeType,
  id,
  mediaRoot,
  payload,
  sha256,
}: {
  allowedMimeTypes: ReadonlySet<string>
  expectedByteLength?: number
  expectedMimeType?: string
  id: number
  mediaRoot?: string
  payload: Payload
  sha256: string
}): Promise<CurrentPublicMediaAssetResponse | null> => {
  if (!Number.isSafeInteger(id) || id < 1 || !/^[a-f0-9]{64}$/u.test(sha256)) return null
  if (
    expectedByteLength !== undefined &&
    (!Number.isSafeInteger(expectedByteLength) || expectedByteLength < 1)
  ) {
    return null
  }
  try {
    const media = await payload.findByID({
      collection: 'media',
      depth: 0,
      id,
      overrideAccess: false,
    })
    const filename = typeof media.filename === 'string' ? media.filename : ''
    const mimeType = typeof media.mimeType === 'string' ? media.mimeType : ''
    if (
      media.isPublic !== true ||
      !allowedMimeTypes.has(mimeType) ||
      (expectedMimeType !== undefined && mimeType !== expectedMimeType)
    ) {
      return null
    }
    const bytes = await readFile(await resolveManagedMediaPath(filename, mediaRoot))
    if (
      (typeof media.filesize === 'number' && media.filesize !== bytes.byteLength) ||
      (expectedByteLength !== undefined && expectedByteLength !== bytes.byteLength) ||
      !mediaBytesMatchMimeType(bytes, mimeType) ||
      createHash('sha256').update(bytes).digest('hex') !== sha256
    ) {
      return null
    }
    return { bytes, mimeType }
  } catch {
    return null
  }
}

export const readLinkedInPublicationAsset = async ({
  id,
  mediaRoot,
  payload,
  sha256,
  byteLength,
  contentType,
}: {
  byteLength: number
  contentType: 'image/gif' | 'image/jpeg' | 'image/png'
  id: number
  mediaRoot?: string
  payload: Payload
  sha256: string
}): Promise<Uint8Array | null> => {
  const asset = await readCurrentPublicMediaAsset({
    allowedMimeTypes: LINKEDIN_PUBLICATION_MIME_TYPES,
    expectedByteLength: byteLength,
    expectedMimeType: contentType,
    id,
    mediaRoot,
    payload,
    sha256,
  })
  return asset?.bytes ?? null
}

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
  const asset = await readCurrentPublicMediaAsset({
    allowedMimeTypes: META_PUBLICATION_MIME_TYPES,
    id,
    mediaRoot,
    payload,
    sha256,
  })
  if (!asset) return null
  return { bytes: asset.bytes, mimeType: asset.mimeType as PublicationAssetResponse['mimeType'] }
}
