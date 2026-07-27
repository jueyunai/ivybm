import type {
  AssistedPublicationPackage,
  AssistedPublicationPackageAsset,
} from '../types'
import { normalizePublicationAsset } from '../../publishing/contracts'
import { createLinkedInAssistedExport } from './export'

const encoder = new TextEncoder()
const ZIP_UTF8_FLAG = 0x0800
const ZIP_STORED = 0
const ZIP_VERSION = 20
const ZIP_DOS_DATE = 0x0021 // 1980-01-01, fixed so repeated exports are byte-stable.
const MAX_PACKAGE_BYTES = 50 * 1024 * 1024
const MAX_PACKAGE_ASSETS = 100
const MAX_FILE_NAME_BYTES = 255
const WINDOWS_RESERVED_BASE_NAMES = new Set([
  'AUX',
  'CON',
  'NUL',
  'PRN',
  ...Array.from({ length: 9 }, (_, index) => `COM${index + 1}`),
  ...Array.from({ length: 9 }, (_, index) => `LPT${index + 1}`),
])
const UNSAFE_FILE_NAME_CHARACTERS = /[\\/:*?"<>|\u0000-\u001f\u007f\u200e\u200f\u202a-\u202e\u2066-\u2069]/

type ZipEntry = {
  bytes: Uint8Array
  name: string
}

const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
  return value >>> 0
})

const crc32 = (bytes: Uint8Array): number => {
  let value = 0xffffffff
  for (const byte of bytes) value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8)
  return (value ^ 0xffffffff) >>> 0
}

// TextEncoder.encode allocates a second copy of its input. Use a small exact
// counter for admission checks so a malformed, enormous copy-text value is
// rejected before we allocate archive buffers. Lone surrogates match TextEncoder
// replacement-character encoding (three bytes).
const utf8ByteLength = (value: string): number => {
  let length = 0
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code <= 0x7f) {
      length += 1
    } else if (code <= 0x7ff) {
      length += 2
    } else if (
      code >= 0xd800 &&
      code <= 0xdbff &&
      index + 1 < value.length &&
      value.charCodeAt(index + 1) >= 0xdc00 &&
      value.charCodeAt(index + 1) <= 0xdfff
    ) {
      length += 4
      index += 1
    } else {
      length += 3
    }
  }
  return length
}

const setUint16 = (target: Uint8Array, offset: number, value: number): void =>
  new DataView(target.buffer, target.byteOffset, target.byteLength).setUint16(offset, value, true)

const setUint32 = (target: Uint8Array, offset: number, value: number): void =>
  new DataView(target.buffer, target.byteOffset, target.byteLength).setUint32(offset, value, true)

const concat = (parts: Uint8Array[]): Uint8Array => {
  const length = parts.reduce((total, part) => total + part.byteLength, 0)
  const output = new Uint8Array(length)
  let offset = 0
  for (const part of parts) {
    output.set(part, offset)
    offset += part.byteLength
  }
  return output
}

const safeBaseName = (value: string): string => {
  const name = value.normalize('NFC')
  const windowsBaseName = name.split('.', 1)[0]?.trimEnd().toUpperCase()
  if (
    !name ||
    name !== name.trim() ||
    name === '.' ||
    name === '..' ||
    name.endsWith('.') ||
    utf8ByteLength(name) > MAX_FILE_NAME_BYTES ||
    UNSAFE_FILE_NAME_CHARACTERS.test(name) ||
    WINDOWS_RESERVED_BASE_NAMES.has(windowsBaseName ?? '')
  ) {
    throw new Error('LinkedIn assisted package file names must be safe base names')
  }
  return name
}

const packageAsset = (asset: AssistedPublicationPackageAsset): AssistedPublicationPackageAsset => {
  if (!(asset.bytes instanceof Uint8Array)) {
    throw new Error('LinkedIn assisted package assets require Uint8Array bytes')
  }
  const fileName = safeBaseName(asset.fileName)
  const normalized = normalizePublicationAsset({ ...asset, fileName })
  return {
    ...normalized,
    // The function is synchronous and always copies bytes into the returned ZIP,
    // so retaining this input view cannot leak mutable caller-owned data. Avoid an
    // unnecessary full-size clone before the package-size admission check.
    bytes: asset.bytes,
    fileName,
  }
}

const assertInputFitsPackageBudget = (
  assets: AssistedPublicationPackageAsset[],
  text: string,
): void => {
  let inputBytes = utf8ByteLength(text)
  if (inputBytes > MAX_PACKAGE_BYTES) {
    throw new Error(`LinkedIn assisted package exceeds ${MAX_PACKAGE_BYTES} bytes`)
  }
  for (const asset of assets) {
    if (!(asset.bytes instanceof Uint8Array)) continue
    if (asset.bytes.byteLength > MAX_PACKAGE_BYTES - inputBytes) {
      throw new Error(`LinkedIn assisted package exceeds ${MAX_PACKAGE_BYTES} bytes`)
    }
    inputBytes += asset.bytes.byteLength
  }
}

const createStoredZip = (entries: ZipEntry[]): Uint8Array => {
  const localParts: Uint8Array[] = []
  const centralParts: Uint8Array[] = []
  let offset = 0

  for (const entry of entries) {
    const name = encoder.encode(entry.name)
    const checksum = crc32(entry.bytes)
    const local = new Uint8Array(30 + name.byteLength + entry.bytes.byteLength)
    setUint32(local, 0, 0x04034b50)
    setUint16(local, 4, ZIP_VERSION)
    setUint16(local, 6, ZIP_UTF8_FLAG)
    setUint16(local, 8, ZIP_STORED)
    setUint16(local, 10, 0)
    setUint16(local, 12, ZIP_DOS_DATE)
    setUint32(local, 14, checksum)
    setUint32(local, 18, entry.bytes.byteLength)
    setUint32(local, 22, entry.bytes.byteLength)
    setUint16(local, 26, name.byteLength)
    setUint16(local, 28, 0)
    local.set(name, 30)
    local.set(entry.bytes, 30 + name.byteLength)
    localParts.push(local)

    const central = new Uint8Array(46 + name.byteLength)
    setUint32(central, 0, 0x02014b50)
    setUint16(central, 4, ZIP_VERSION)
    setUint16(central, 6, ZIP_VERSION)
    setUint16(central, 8, ZIP_UTF8_FLAG)
    setUint16(central, 10, ZIP_STORED)
    setUint16(central, 12, 0)
    setUint16(central, 14, ZIP_DOS_DATE)
    setUint32(central, 16, checksum)
    setUint32(central, 20, entry.bytes.byteLength)
    setUint32(central, 24, entry.bytes.byteLength)
    setUint16(central, 28, name.byteLength)
    setUint16(central, 30, 0)
    setUint16(central, 32, 0)
    setUint16(central, 34, 0)
    setUint16(central, 36, 0)
    setUint32(central, 38, 0)
    setUint32(central, 42, offset)
    central.set(name, 46)
    centralParts.push(central)
    offset += local.byteLength
  }

  const centralDirectory = concat(centralParts)
  const ending = new Uint8Array(22)
  setUint32(ending, 0, 0x06054b50)
  setUint16(ending, 4, 0)
  setUint16(ending, 6, 0)
  setUint16(ending, 8, entries.length)
  setUint16(ending, 10, entries.length)
  setUint32(ending, 12, centralDirectory.byteLength)
  setUint32(ending, 16, offset)
  setUint16(ending, 20, 0)
  return concat([...localParts, centralDirectory, ending])
}

/**
 * Builds a deterministic, browser-downloadable ZIP for the LinkedIn manual flow.
 * It is deliberately pure: no network request, filesystem write, or platform SDK.
 */
export const createLinkedInAssistedPackage = ({
  assets,
  text,
}: {
  assets: AssistedPublicationPackageAsset[]
  text: string
}): AssistedPublicationPackage => {
  if (assets.length > MAX_PACKAGE_ASSETS) {
    throw new Error(`LinkedIn assisted package supports at most ${MAX_PACKAGE_ASSETS} assets`)
  }

  assertInputFitsPackageBudget(assets, text)
  const normalizedAssets = assets.map(packageAsset)
  const exportData = createLinkedInAssistedExport({
    // The export manifest has no reason to carry raw bytes. Passing only metadata
    // also prevents structuredClone in the export helper from duplicating large
    // input assets before ZIP creation.
    assets: normalizedAssets.map(({ bytes: _bytes, ...asset }) => asset),
    text,
  })
  const bytesByID = new Map(normalizedAssets.map((asset) => [asset.id, asset.bytes]))
  const fileNames = new Set<string>()
  const assetEntries = exportData.assets.map((asset, index) => {
    const fileName = safeBaseName(asset.fileName)
    if (fileNames.has(fileName)) {
      throw new Error('LinkedIn assisted package file names must be unique')
    }
    fileNames.add(fileName)
    const bytes = bytesByID.get(asset.id)
    if (!bytes) throw new Error('LinkedIn assisted package asset bytes are missing')
    return {
      archivePath: `assets/${String(index + 1).padStart(3, '0')}-${fileName}`,
      asset,
      bytes,
    }
  })

  const manifest = {
    assets: assetEntries.map(({ archivePath, asset }) => ({
      archivePath,
      fileName: asset.fileName,
      id: asset.id,
      mimeType: asset.mimeType,
    })),
    copyFile: 'post.txt',
    mode: 'assisted',
    platform: 'linkedin',
    version: 1,
  }
  const readme = [
    'LinkedIn assisted publishing package',
    '',
    ...exportData.checklist.map((item, index) => `${index + 1}. ${item}`),
    '',
    'This package is generated locally. It does not publish to LinkedIn.',
    '',
  ].join('\n')
  const entries: ZipEntry[] = [
    { bytes: encoder.encode(readme), name: 'README.txt' },
    { bytes: encoder.encode(`${exportData.copyText}\n`), name: 'post.txt' },
    { bytes: encoder.encode(`${JSON.stringify(manifest, null, 2)}\n`), name: 'manifest.json' },
    ...assetEntries.map(({ archivePath, bytes }) => ({ bytes, name: archivePath })),
  ]
  const contentBytes = entries.reduce((total, entry) => total + entry.bytes.byteLength, 0)
  if (contentBytes > MAX_PACKAGE_BYTES) {
    throw new Error(`LinkedIn assisted package exceeds ${MAX_PACKAGE_BYTES} bytes`)
  }
  const bytes = createStoredZip(entries)
  if (bytes.byteLength > MAX_PACKAGE_BYTES) {
    throw new Error(`LinkedIn assisted package exceeds ${MAX_PACKAGE_BYTES} bytes`)
  }

  return {
    bytes,
    fileName: 'linkedin-assisted-post.zip',
    mimeType: 'application/zip',
    mode: 'assisted',
    platform: 'linkedin',
  }
}
