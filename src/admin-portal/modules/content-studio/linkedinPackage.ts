import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import path from 'node:path'

import type { PayloadRequest } from 'payload'

import { createLinkedInAssistedPackage } from '@/modules/publishing/assisted'

import { ContentStudioCommandError, type ContentStudioPayload } from './contentStudioCommands'

type LooseRecord = Record<string, unknown>

const MAX_PACKAGE_ASSETS = 100
const MAX_PACKAGE_INPUT_BYTES = 50 * 1024 * 1024

type PackageAssetDescriptor = {
  fileName: string
  filePath: string
  id: string
  mimeType: string
}

type PackageFileSystem = {
  createReadStream: typeof createReadStream
  stat: typeof stat
}

const defaultFileSystem: PackageFileSystem = { createReadStream, stat }

const packageBudgetError = () =>
  new ContentStudioCommandError(
    'content-studio-package-too-large',
    `LinkedIn assisted package exceeds ${MAX_PACKAGE_INPUT_BYTES} bytes`,
    413,
  )

const readAssetWithinBudget = async (
  filePath: string,
  maximumBytes: number,
  fileSystem: PackageFileSystem,
): Promise<Uint8Array> => {
  const chunks: Buffer[] = []
  let total = 0
  for await (const value of fileSystem.createReadStream(filePath, { highWaterMark: 64 * 1024 })) {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value)
    if (chunk.byteLength > maximumBytes - total) throw packageBudgetError()
    total += chunk.byteLength
    chunks.push(chunk)
  }
  return new Uint8Array(Buffer.concat(chunks, total))
}

const asID = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value
  if (value && typeof value === 'object' && typeof (value as { id?: unknown }).id === 'number')
    return (value as { id: number }).id
  return null
}

export async function createContentStudioLinkedInPackage({
  id,
  fileSystem = defaultFileSystem,
  payload,
  req,
}: {
  id: number
  fileSystem?: PackageFileSystem
  payload: ContentStudioPayload
  req: PayloadRequest
}) {
  const content = (await payload.findByID({
    collection: 'generated-contents',
    depth: 1,
    id,
    overrideAccess: false,
    req,
  })) as LooseRecord
  if (!content)
    throw new ContentStudioCommandError('content-studio-not-found', 'Content was not found', 404)
  if (content.status !== 'approved') {
    throw new ContentStudioCommandError(
      'content-studio-not-approved',
      'Only approved content can create an assisted package',
      409,
    )
  }
  if (content.platform !== 'linkedin') {
    throw new ContentStudioCommandError(
      'content-studio-package-unavailable',
      'Assisted packages are available for LinkedIn only',
      409,
    )
  }
  const relationships = Array.isArray(content.assets) ? content.assets : []
  if (relationships.length > MAX_PACKAGE_ASSETS) {
    throw new ContentStudioCommandError(
      'content-studio-package-too-many-assets',
      `LinkedIn assisted package supports at most ${MAX_PACKAGE_ASSETS} assets`,
      413,
    )
  }

  const mediaRoot = path.resolve(process.cwd(), 'media')
  const descriptors: PackageAssetDescriptor[] = []
  let inputBytes = Buffer.byteLength(String(content.body ?? ''), 'utf8')
  if (inputBytes > MAX_PACKAGE_INPUT_BYTES) throw packageBudgetError()

  for (const relationship of relationships) {
    const asset =
      relationship && typeof relationship === 'object'
        ? (relationship as LooseRecord)
        : ((await payload.findByID({
            collection: 'media',
            depth: 0,
            id: asID(relationship) ?? 0,
            overrideAccess: false,
            req,
          })) as LooseRecord)
    const assetID = asID(asset)
    const filename = typeof asset.filename === 'string' ? asset.filename : ''
    const mimeType = typeof asset.mimeType === 'string' ? asset.mimeType : ''
    if (!assetID || !filename || !mimeType || path.basename(filename) !== filename) {
      throw new ContentStudioCommandError(
        'content-studio-package-asset-invalid',
        'An attached asset is unavailable for packaging',
        409,
      )
    }
    const filePath = path.resolve(mediaRoot, filename)
    let size: number
    try {
      const metadata = await fileSystem.stat(filePath)
      if (!metadata.isFile() || !Number.isSafeInteger(metadata.size) || metadata.size <= 0) {
        throw new Error('invalid asset metadata')
      }
      size = metadata.size
    } catch {
      throw new ContentStudioCommandError(
        'content-studio-package-asset-invalid',
        'An attached asset is unavailable for packaging',
        409,
      )
    }
    if (size > MAX_PACKAGE_INPUT_BYTES - inputBytes) throw packageBudgetError()
    inputBytes += size
    descriptors.push({ fileName: filename, filePath, id: String(assetID), mimeType })
  }

  const assets = []
  let loadedBytes = Buffer.byteLength(String(content.body ?? ''), 'utf8')
  for (const descriptor of descriptors) {
    const bytes = await readAssetWithinBudget(
      descriptor.filePath,
      MAX_PACKAGE_INPUT_BYTES - loadedBytes,
      fileSystem,
    )
    loadedBytes += bytes.byteLength
    assets.push({
      bytes,
      fileName: descriptor.fileName,
      id: descriptor.id,
      mimeType: descriptor.mimeType,
    })
  }
  // A GET download must remain a pure read. The user can create a durable
  // assisted schedule separately; downloading its local package must not
  // create or mutate publication history during browser retries or prefetches.
  return createLinkedInAssistedPackage({ assets, text: String(content.body ?? '') })
}
