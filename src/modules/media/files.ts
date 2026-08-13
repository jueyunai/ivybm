import { realpath } from 'node:fs/promises'
import path from 'node:path'

const bytesEqual = (data: Uint8Array, expected: readonly number[], offset = 0): boolean =>
  expected.every((byte, index) => data[offset + index] === byte)

export const mediaBytesMatchMimeType = (data: unknown, mimeType: unknown): data is Uint8Array => {
  if (
    (!Buffer.isBuffer(data) &&
      !(ArrayBuffer.isView(data) && 'BYTES_PER_ELEMENT' in data && data.BYTES_PER_ELEMENT === 1)) ||
    data.byteLength === 0 ||
    typeof mimeType !== 'string'
  ) {
    return false
  }
  const bytes = data as Uint8Array
  if (mimeType === 'image/png') {
    return bytesEqual(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  }
  if (mimeType === 'image/jpeg') return bytesEqual(bytes, [0xff, 0xd8, 0xff])
  if (mimeType === 'image/webp') {
    return (
      bytesEqual(bytes, [0x52, 0x49, 0x46, 0x46]) && bytesEqual(bytes, [0x57, 0x45, 0x42, 0x50], 8)
    )
  }
  if (mimeType === 'image/avif') {
    if (!bytesEqual(bytes, [0x66, 0x74, 0x79, 0x70], 4)) return false
    const brand = String.fromCharCode(...bytes.subarray(8, Math.min(bytes.byteLength, 32)))
    return brand.includes('avif') || brand.includes('avis')
  }
  if (mimeType === 'application/pdf') return bytesEqual(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])
  return false
}

export const resolveManagedMediaPath = async (
  filename: string,
  mediaRoot = path.resolve(process.cwd(), 'media'),
): Promise<string> => {
  if (!filename || path.basename(filename) !== filename) {
    throw new Error('Managed media filename is invalid')
  }
  const root = await realpath(mediaRoot)
  const resolved = await realpath(path.resolve(root, filename))
  const relative = path.relative(root, resolved)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Managed media path is outside storage')
  }
  return resolved
}
