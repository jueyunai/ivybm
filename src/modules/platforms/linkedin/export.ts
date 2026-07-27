import {
  normalizePublicationAssets,
  normalizePublicationText,
  type AssistedPublicationAsset,
  type AssistedPublicationExport,
  type PublicationAsset,
} from '../types'

type CreateLinkedInAssistedExportInput = {
  assets: PublicationAsset[]
  text: string
}

// Do not use localeCompare here: the package promises byte-stable output, while
// a process default locale can order the same Unicode IDs differently on another
// developer machine or deployment image. ECMAScript string comparison is a fixed
// UTF-16 code-unit ordering for a given input.
const compareAssetIDs = (left: AssistedPublicationAsset, right: AssistedPublicationAsset): number =>
  left.id < right.id ? -1 : left.id > right.id ? 1 : 0

export const createLinkedInAssistedExport = ({
  assets,
  text,
}: CreateLinkedInAssistedExportInput): AssistedPublicationExport => {
  const copyText = normalizePublicationText(text)
  const exportAssets = normalizePublicationAssets(assets)
    .map(({ sourceUrl: _sourceUrl, ...asset }) => asset)
    .sort(compareAssetIDs)

  return {
    assets: exportAssets,
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
