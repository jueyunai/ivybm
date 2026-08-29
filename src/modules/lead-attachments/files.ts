import { createHash } from 'node:crypto'
import path from 'node:path'

export const LEAD_ATTACHMENT_MAX_BYTES = 50 * 1024 * 1024
export const LEAD_ATTACHMENT_MAX_FILES = 5
export const LEAD_ATTACHMENT_MAX_TOTAL_BYTES = 200 * 1024 * 1024
export const LEAD_ATTACHMENT_STAGING_TTL_MS = 24 * 60 * 60 * 1_000
export const LEAD_ATTACHMENT_RETENTION_MS = 180 * 24 * 60 * 60 * 1_000

export const LEAD_ATTACHMENT_ALLOWED_EXTENSIONS = [
  '.pdf',
  '.dwg',
  '.dxf',
  '.step',
  '.stp',
  '.3dm',
  '.iges',
  '.igs',
  '.xlsx',
  '.xls',
  '.csv',
  '.zip',
  '.rar',
  '.7z',
  '.jpg',
  '.jpeg',
  '.png',
  '.gif',
  '.webp',
] as const

export const LEAD_ATTACHMENT_MIME_TYPES = [
  'application/acad',
  'application/dxf',
  'application/iges',
  'application/octet-stream',
  'application/pdf',
  'application/step',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.rar',
  'application/x-7z-compressed',
  'application/x-autocad',
  'application/x-rar-compressed',
  'application/x-zip-compressed',
  'application/zip',
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/vnd.dxf',
  'image/webp',
  'model/3dm',
  'model/iges',
  'model/step',
  'text/csv',
  'text/plain',
] as const

const bytesEqual = (data: Uint8Array, expected: readonly number[], offset = 0): boolean => {
  if (data.length < offset + expected.length) return false
  return expected.every((byte, index) => data[offset + index] === byte)
}

const asciiStartsWith = (data: Uint8Array, value: string): boolean => {
  const expected = Buffer.from(value, 'ascii')
  return bytesEqual(data, [...expected])
}

const isExecutableHeader = (data: Uint8Array): boolean => {
  if (bytesEqual(data, [0x4d, 0x5a])) return true // Windows PE/MZ
  if (bytesEqual(data, [0x7f, 0x45, 0x4c, 0x46])) return true // Linux ELF
  if (bytesEqual(data, [0xfe, 0xed, 0xfa, 0xce])) return true // Mach-O 32
  if (bytesEqual(data, [0xfe, 0xed, 0xfa, 0xcf])) return true // Mach-O 64
  if (bytesEqual(data, [0xce, 0xfa, 0xed, 0xfe])) return true // Mach-O reverse
  if (bytesEqual(data, [0xcf, 0xfa, 0xed, 0xfe])) return true // Mach-O reverse 64
  return false
}

export const attachmentBytesMatch = (data: Uint8Array, extension: string): boolean => {
  if (!data || data.length === 0) return false
  if (isExecutableHeader(data)) return false

  const ext = extension.toLowerCase()
  if (ext === '.pdf') return asciiStartsWith(data, '%PDF-')
  if (ext === '.jpg' || ext === '.jpeg') return bytesEqual(data, [0xff, 0xd8, 0xff])
  if (ext === '.png') return bytesEqual(data, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  if (ext === '.gif') return asciiStartsWith(data, 'GIF87a') || asciiStartsWith(data, 'GIF89a')
  if (ext === '.webp') return bytesEqual(data, [0x52, 0x49, 0x46, 0x46]) && bytesEqual(data, [0x57, 0x45, 0x42, 0x50], 8)
  if (ext === '.zip' || ext === '.xlsx') {
    return (
      bytesEqual(data, [0x50, 0x4b, 0x03, 0x04]) ||
      bytesEqual(data, [0x50, 0x4b, 0x05, 0x06]) ||
      bytesEqual(data, [0x50, 0x4b, 0x07, 0x08])
    )
  }
  if (ext === '.rar') return bytesEqual(data, [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07])
  if (ext === '.7z') return bytesEqual(data, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])
  if (ext === '.dwg') return asciiStartsWith(data, 'AC10') || asciiStartsWith(data, 'AC1')
  if (ext === '.step' || ext === '.stp') {
    return asciiStartsWith(data, 'ISO-10303-21') || asciiStartsWith(data, 'HEADER;') || asciiStartsWith(data, '/*')
  }
  if (ext === '.3dm') {
    return bytesEqual(data, [0xd0, 0xcf, 0x11, 0xe0]) || asciiStartsWith(data, '3D Geometry File')
  }
  if (ext === '.xls') return bytesEqual(data, [0xd0, 0xcf, 0x11, 0xe0])
  if (ext === '.csv' || ext === '.dxf' || ext === '.iges' || ext === '.igs') {
    // Text-based technical formats
    const slice = data.subarray(0, Math.min(data.length, 1024))
    for (let i = 0; i < slice.length; i++) {
      const byte = slice[i]
      if (byte === 0x00) return false // No null bytes in text formats
    }
    return true
  }
  return false
}

export const attachmentExtension = (filename: string): string => path.extname(filename).toLowerCase()

export const attachmentSha256 = (data: Uint8Array): string => createHash('sha256').update(data).digest('hex')

export const isAllowedAttachmentName = (filename: string): boolean => {
  if (!filename || typeof filename !== 'string' || filename.length > 255 || path.basename(filename) !== filename) {
    return false
  }
  const ext = attachmentExtension(filename)
  return LEAD_ATTACHMENT_ALLOWED_EXTENSIONS.includes(ext as (typeof LEAD_ATTACHMENT_ALLOWED_EXTENSIONS)[number])
}

export const attachmentMimeMatchesExtension = (mimeType: string, extension: string): boolean => {
  const normalized = mimeType.toLowerCase().trim()
  const ext = extension.toLowerCase()
  if (ext === '.pdf') return normalized === 'application/pdf'
  if (ext === '.jpg' || ext === '.jpeg') return normalized === 'image/jpeg' || normalized === 'image/pjpeg'
  if (ext === '.png') return normalized === 'image/png'
  if (ext === '.gif') return normalized === 'image/gif'
  if (ext === '.webp') return normalized === 'image/webp'
  if (ext === '.zip') {
    return (
      normalized === 'application/zip' ||
      normalized === 'application/x-zip-compressed' ||
      normalized === 'application/octet-stream'
    )
  }
  if (ext === '.xlsx') {
    return (
      normalized === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
      normalized === 'application/zip' ||
      normalized === 'application/x-zip-compressed' ||
      normalized === 'application/octet-stream'
    )
  }
  if (ext === '.xls') {
    return (
      normalized === 'application/vnd.ms-excel' ||
      normalized === 'application/msexcel' ||
      normalized === 'application/octet-stream'
    )
  }
  if (ext === '.csv') {
    return (
      normalized === 'text/csv' ||
      normalized === 'text/plain' ||
      normalized === 'application/csv' ||
      normalized === 'application/octet-stream'
    )
  }
  if (ext === '.step' || ext === '.stp') {
    return (
      normalized === 'application/step' ||
      normalized === 'model/step' ||
      normalized === 'application/octet-stream' ||
      normalized === 'text/plain'
    )
  }
  if (ext === '.dwg') {
    return (
      normalized === 'application/acad' ||
      normalized === 'application/x-autocad' ||
      normalized === 'image/vnd.dwg' ||
      normalized === 'application/octet-stream'
    )
  }
  if (ext === '.dxf') {
    return (
      normalized === 'application/dxf' ||
      normalized === 'image/vnd.dxf' ||
      normalized === 'text/plain' ||
      normalized === 'application/octet-stream'
    )
  }
  if (ext === '.3dm') {
    return (
      normalized === 'model/3dm' ||
      normalized === 'application/octet-stream'
    )
  }
  if (ext === '.iges' || ext === '.igs') {
    return (
      normalized === 'model/iges' ||
      normalized === 'application/iges' ||
      normalized === 'text/plain' ||
      normalized === 'application/octet-stream'
    )
  }
  if (ext === '.rar') {
    return (
      normalized === 'application/x-rar-compressed' ||
      normalized === 'application/vnd.rar' ||
      normalized === 'application/octet-stream'
    )
  }
  if (ext === '.7z') {
    return (
      normalized === 'application/x-7z-compressed' ||
      normalized === 'application/octet-stream'
    )
  }
  return false
}

export const resolveManagedLeadAttachmentPath = async (
  filename: string,
  attachmentRoot = path.resolve(process.cwd(), 'private/lead-attachments'),
): Promise<string> => {
  if (!filename || typeof filename !== 'string' || path.basename(filename) !== filename) {
    throw new Error('Managed attachment filename is invalid')
  }
  const root = path.resolve(attachmentRoot)
  const target = path.resolve(root, filename)
  const relative = path.relative(root, target)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Managed attachment path is outside storage')
  }
  return target
}
