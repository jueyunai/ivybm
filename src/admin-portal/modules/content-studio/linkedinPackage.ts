import { readFile } from 'node:fs/promises'
import path from 'node:path'

import type { PayloadRequest } from 'payload'

import { createLinkedInAssistedPackage } from '@/modules/publishing/assisted'

import { ContentStudioCommandError, type ContentStudioPayload } from './contentStudioCommands'

type LooseRecord = Record<string, unknown>

const asID = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value
  if (value && typeof value === 'object' && typeof (value as { id?: unknown }).id === 'number') return (value as { id: number }).id
  return null
}

export async function createContentStudioLinkedInPackage({
  id,
  payload,
  req,
}: {
  id: number
  payload: ContentStudioPayload
  req: PayloadRequest
}) {
  const content = await payload.findByID({ collection: 'generated-contents', depth: 1, id, overrideAccess: false, req }) as LooseRecord
  if (!content) throw new ContentStudioCommandError('content-studio-not-found', 'Content was not found', 404)
  if (content.status !== 'approved') {
    throw new ContentStudioCommandError('content-studio-not-approved', 'Only approved content can create an assisted package', 409)
  }
  if (content.platform !== 'linkedin') {
    throw new ContentStudioCommandError('content-studio-package-unavailable', 'Assisted packages are available for LinkedIn only', 409)
  }
  const relationships = Array.isArray(content.assets) ? content.assets : []
  const assets = await Promise.all(relationships.map(async (relationship) => {
    const asset = relationship && typeof relationship === 'object'
      ? relationship as LooseRecord
      : await payload.findByID({ collection: 'media', depth: 0, id: asID(relationship) ?? 0, overrideAccess: false, req }) as LooseRecord
    const assetID = asID(asset)
    const filename = typeof asset.filename === 'string' ? asset.filename : ''
    const mimeType = typeof asset.mimeType === 'string' ? asset.mimeType : ''
    if (!assetID || !filename || !mimeType || path.basename(filename) !== filename) {
      throw new ContentStudioCommandError('content-studio-package-asset-invalid', 'An attached asset is unavailable for packaging', 409)
    }
    return {
      bytes: new Uint8Array(await readFile(path.resolve(process.cwd(), 'media', filename))),
      fileName: filename,
      id: String(assetID),
      mimeType,
    }
  }))
  // A GET download must remain a pure read. The user can create a durable
  // assisted schedule separately; downloading its local package must not
  // create or mutate publication history during browser retries or prefetches.
  return createLinkedInAssistedPackage({ assets, text: String(content.body ?? '') })
}
