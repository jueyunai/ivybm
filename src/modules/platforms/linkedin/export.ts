import type { AssistedPublicationExport, PublicationAsset } from '../types'

type CreateLinkedInAssistedExportInput = {
  assets: PublicationAsset[]
  text: string
}

const normalizedText = (text: string): string => text.replace(/\r\n?/g, '\n').trim()

const assertAssets = (assets: PublicationAsset[]): void => {
  const ids = new Set<string>()
  for (const asset of assets) {
    if (!asset.id.trim() || !asset.fileName.trim() || !asset.mimeType.trim()) {
      throw new Error('LinkedIn assisted export assets require ID, file name, and MIME type')
    }
    if (ids.has(asset.id)) {
      throw new Error('LinkedIn assisted export asset IDs must be unique')
    }
    ids.add(asset.id)
  }
}

export const createLinkedInAssistedExport = ({
  assets,
  text,
}: CreateLinkedInAssistedExportInput): AssistedPublicationExport => {
  const copyText = normalizedText(text)
  if (!copyText) throw new Error('LinkedIn assisted export text is required')
  assertAssets(assets)

  return {
    assets: structuredClone(assets).sort((left, right) => left.id.localeCompare(right.id)),
    checklist: [
      'Copy the reviewed text into LinkedIn.',
      'Download and attach the listed assets in manifest order.',
      'Verify the final preview before publishing manually.',
    ],
    copyText,
    mode: 'assisted',
    platform: 'linkedin',
  }
}
