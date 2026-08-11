import { createHash } from 'node:crypto'
import { inflateRawSync } from 'node:zlib'

export const KNOWLEDGE_SOURCE_MAX_BYTES = 30 * 1024 * 1024
export const KNOWLEDGE_SOURCE_MAX_IMAGES = 100
export const KNOWLEDGE_SOURCE_MAX_IMAGE_BYTES = 8 * 1024 * 1024
export const KNOWLEDGE_SOURCE_MAX_IMAGE_TOTAL_BYTES = 40 * 1024 * 1024
export const KNOWLEDGE_SOURCE_MAX_TEXT_CHARACTERS = 1_000_000
export const KNOWLEDGE_SOURCE_MAX_PDF_PAGES = 500
export const KNOWLEDGE_INGESTION_PARSER_VERSION = 'task8-ingestion-v1'

export const KNOWLEDGE_SOURCE_MIME_TYPES = [
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/pdf',
] as const
export const KNOWLEDGE_SOURCE_IMAGE_MIME_TYPES = [
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
] as const

export type KnowledgeSourceMimeType = (typeof KNOWLEDGE_SOURCE_MIME_TYPES)[number]

export type KnowledgeSourceFile = {
  data: Buffer
  mimetype: string
  name: string
  size: number
}

export type KnowledgeSourceImage = {
  data: Buffer
  mimeType: string
  name: string
  sequence: number
  sha256: string
}

export type ParsedKnowledgeSource = {
  detectedLanguage: 'ar' | 'en' | 'unknown' | 'zh'
  images: KnowledgeSourceImage[]
  pageCount: number
  paragraphCount: number
  text: string
}

export class KnowledgeIngestionError extends Error {
  readonly code: string
  readonly status: number

  constructor(code: string, message: string, status = 422) {
    super(message)
    this.name = 'KnowledgeIngestionError'
    this.code = code
    this.status = status
  }
}

const extensionFor = (name: string): string => name.slice(name.lastIndexOf('.')).toLowerCase()

const isSafeFileName = (name: string): boolean =>
  Boolean(name) &&
  name.length <= 255 &&
  name === name.trim() &&
  !name.includes('\0') &&
  !name.includes('/') &&
  !name.includes('\\') &&
  name !== '.' &&
  name !== '..'

const hasPrefix = (data: Buffer, prefix: string): boolean =>
  data.length >= prefix.length && data.subarray(0, prefix.length).toString('latin1') === prefix

/** Validate the upload before Payload or a parser can inspect untrusted bytes. */
export const validateKnowledgeSourceFile = (file: KnowledgeSourceFile): KnowledgeSourceFile => {
  if (!isSafeFileName(file.name)) {
    throw new KnowledgeIngestionError('invalid-file-name', 'A safe file name is required', 400)
  }
  if (!KNOWLEDGE_SOURCE_MIME_TYPES.includes(file.mimetype as KnowledgeSourceMimeType)) {
    throw new KnowledgeIngestionError('unsupported-file-type', 'Only DOCX and PDF files are allowed', 415)
  }
  if (!Number.isSafeInteger(file.size) || file.size <= 0 || file.size !== file.data.length) {
    throw new KnowledgeIngestionError('invalid-file', 'The uploaded file is invalid', 400)
  }
  if (file.size > KNOWLEDGE_SOURCE_MAX_BYTES) {
    throw new KnowledgeIngestionError('file-too-large', 'The uploaded file exceeds its size limit', 413)
  }

  const extension = extensionFor(file.name)
  if (file.mimetype === 'application/pdf') {
    if (extension !== '.pdf' || !hasPrefix(file.data, '%PDF-')) {
      throw new KnowledgeIngestionError('file-signature-mismatch', 'The PDF file signature is invalid', 415)
    }
  } else if (
    extension !== '.docx' ||
    !hasPrefix(file.data, 'PK\x03\x04') ||
    file.data.includes(Buffer.from('vbaProject.bin')) ||
    !readZipEntries(file.data).some((entry) => entry.name === 'word/document.xml')
  ) {
    throw new KnowledgeIngestionError('file-signature-mismatch', 'The DOCX file signature is invalid', 415)
  }
  return file
}

/** Payload's MIME sniffer sees the ZIP container inside a valid DOCX. */
export const validateStoredKnowledgeSourceFile = (file: KnowledgeSourceFile): KnowledgeSourceFile =>
  validateKnowledgeSourceFile(
    file.mimetype === 'application/zip' && extensionFor(file.name) === '.docx'
      ? { ...file, mimetype: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }
      : file,
  )

export const validateKnowledgeSourceImage = (file: KnowledgeSourceFile): KnowledgeSourceFile => {
  if (!isSafeFileName(file.name)) throw new KnowledgeIngestionError('invalid-image-name', 'A safe image name is required', 400)
  if (!KNOWLEDGE_SOURCE_IMAGE_MIME_TYPES.includes(file.mimetype as never)) throw new KnowledgeIngestionError('unsupported-image', 'Only safe image types are allowed', 415)
  if (!Number.isSafeInteger(file.size) || file.size <= 0 || file.size !== file.data.length) throw new KnowledgeIngestionError('invalid-image', 'The image is invalid', 400)
  if (file.size > KNOWLEDGE_SOURCE_MAX_IMAGE_BYTES) throw new KnowledgeIngestionError('image-too-large', 'The image exceeds its size limit', 413)
  const validSignature =
    (file.mimetype === 'image/png' && file.data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) ||
    (file.mimetype === 'image/jpeg' && file.data.length >= 3 && file.data[0] === 0xff && file.data[1] === 0xd8 && file.data[2] === 0xff) ||
    (file.mimetype === 'image/gif' && (hasPrefix(file.data, 'GIF87a') || hasPrefix(file.data, 'GIF89a'))) ||
    (file.mimetype === 'image/webp' && hasPrefix(file.data, 'RIFF') && file.data.subarray(8, 12).toString('latin1') === 'WEBP')
  if (!validSignature) throw new KnowledgeIngestionError('image-signature-mismatch', 'The image signature is invalid', 415)
  return file
}

export const sha256 = (data: Uint8Array): string => createHash('sha256').update(data).digest('hex')

const decodeXml = (value: string): string =>
  value
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#([0-9]+);/g, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')

const normalizeText = (text: string): string =>
  text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[\t ]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

const detectLanguage = (text: string): ParsedKnowledgeSource['detectedLanguage'] => {
  const sample = text.slice(0, 20_000)
  const counts = {
    ar: (sample.match(/[\u0600-\u06ff\u0750-\u077f]/g) ?? []).length,
    en: (sample.match(/[A-Za-z]/g) ?? []).length,
    zh: (sample.match(/[\u3400-\u4dbf\u4e00-\u9fff]/g) ?? []).length,
  }
  const total = Math.max(1, counts.ar + counts.en + counts.zh)
  if (counts.ar / total >= 0.2) return 'ar'
  if (counts.zh / total >= 0.2) return 'zh'
  if (counts.en / total >= 0.2) return 'en'
  return 'unknown'
}

type ZipEntry = {
  compressedSize: number
  compression: number
  data: Buffer
  name: string
  uncompressedSize: number
}

const zipNameIsSafe = (name: string): boolean => {
  if (!name || name.includes('\0') || name.startsWith('/') || name.includes('\\')) return false
  const normalized = name.endsWith('/') ? name.slice(0, -1) : name
  if (!normalized) return false
  const parts = normalized.split('/')
  return parts.every((part) => part.length > 0 && part !== '.' && part !== '..')
}

/** A small, bounded ZIP reader for OOXML. It intentionally supports only store/deflate. */
const readZipEntries = (archive: Buffer): ZipEntry[] => {
  const minimumEndOffset = Math.max(0, archive.length - 65_557)
  let endOffset = -1
  for (let offset = archive.length - 22; offset >= minimumEndOffset; offset -= 1) {
    if (archive.readUInt32LE(offset) === 0x06054b50) {
      endOffset = offset
      break
    }
  }
  if (endOffset < 0) throw new KnowledgeIngestionError('invalid-docx-archive', 'The DOCX archive is invalid')
  const entryCount = archive.readUInt16LE(endOffset + 10)
  const centralDirectorySize = archive.readUInt32LE(endOffset + 12)
  const centralDirectoryOffset = archive.readUInt32LE(endOffset + 16)
  if (entryCount < 1 || entryCount > 10_000 || centralDirectoryOffset + centralDirectorySize > archive.length) {
    throw new KnowledgeIngestionError('invalid-docx-archive', 'The DOCX archive is invalid')
  }

  const entries: ZipEntry[] = []
  let offset = centralDirectoryOffset
  let totalUncompressed = 0
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > archive.length || archive.readUInt32LE(offset) !== 0x02014b50) {
      throw new KnowledgeIngestionError('invalid-docx-archive', 'The DOCX archive is invalid')
    }
    const compression = archive.readUInt16LE(offset + 10)
    const flags = archive.readUInt16LE(offset + 8)
    const compressedSize = archive.readUInt32LE(offset + 20)
    const uncompressedSize = archive.readUInt32LE(offset + 24)
    const nameLength = archive.readUInt16LE(offset + 28)
    const extraLength = archive.readUInt16LE(offset + 30)
    const commentLength = archive.readUInt16LE(offset + 32)
    const localOffset = archive.readUInt32LE(offset + 42)
    const name = archive.subarray(offset + 46, offset + 46 + nameLength).toString('utf8')
    if (
      flags & 0x1 ||
      !zipNameIsSafe(name) ||
      compressedSize === 0xffffffff ||
      uncompressedSize === 0xffffffff ||
      compressedSize > KNOWLEDGE_SOURCE_MAX_BYTES ||
      uncompressedSize > KNOWLEDGE_SOURCE_MAX_TEXT_CHARACTERS * 8
    ) {
      throw new KnowledgeIngestionError('invalid-docx-archive', 'The DOCX archive exceeds safe limits')
    }
    totalUncompressed += uncompressedSize
    if (totalUncompressed > KNOWLEDGE_SOURCE_MAX_TEXT_CHARACTERS * 8 + KNOWLEDGE_SOURCE_MAX_IMAGE_TOTAL_BYTES) {
      throw new KnowledgeIngestionError('invalid-docx-archive', 'The DOCX archive exceeds safe limits')
    }
    if (localOffset + 30 > archive.length || archive.readUInt32LE(localOffset) !== 0x04034b50) {
      throw new KnowledgeIngestionError('invalid-docx-archive', 'The DOCX archive is invalid')
    }
    const localNameLength = archive.readUInt16LE(localOffset + 26)
    const localExtraLength = archive.readUInt16LE(localOffset + 28)
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength
    const localName = archive.subarray(localOffset + 30, localOffset + 30 + localNameLength).toString('utf8')
    if (localName !== name) {
      throw new KnowledgeIngestionError('invalid-docx-archive', 'The DOCX archive is invalid')
    }
    if (dataOffset + compressedSize > archive.length) {
      throw new KnowledgeIngestionError('invalid-docx-archive', 'The DOCX archive is invalid')
    }
    const compressed = archive.subarray(dataOffset, dataOffset + compressedSize)
    let data: Buffer
    try {
      if (compression === 0) data = Buffer.from(compressed)
      else if (compression === 8) {
        data = inflateRawSync(compressed, { maxOutputLength: Math.max(1, uncompressedSize) })
      }
      else throw new Error('unsupported compression')
    } catch {
      throw new KnowledgeIngestionError('invalid-docx-archive', 'The DOCX archive could not be decompressed')
    }
    if (data.length !== uncompressedSize) {
      throw new KnowledgeIngestionError('invalid-docx-archive', 'The DOCX archive is corrupted')
    }
    entries.push({ compressedSize, compression, data, name, uncompressedSize })
    offset += 46 + nameLength + extraLength + commentLength
  }
  return entries
}

const mimeForImage = (name: string): string | null => {
  const extension = name.slice(name.lastIndexOf('.')).toLowerCase()
  const mime = {
    '.gif': 'image/gif',
    '.jpeg': 'image/jpeg',
    '.jpg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
  }[extension]
  return mime ?? null
}

const extractXmlText = (fragment: string): string => {
  const text = [...fragment.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/gi)]
    .map((match) => decodeXml(match[1]))
    .join('')
  return text
    .replace(/<w:tab\s*\/?\s*>/gi, '\t')
    .replace(/<w:br\s*\/?\s*>/gi, '\n')
}

const extractDocxText = (
  xml: string,
  imageRelations: Map<string, string>,
): { imageTargets: string[]; paragraphCount: number; text: string } => {
  const body = xml.match(/<w:body\b[^>]*>([\s\S]*?)<\/w:body>/i)?.[1] ?? xml
  const blocks = body.match(/<w:p\b[^>]*>[\s\S]*?<\/w:p>|<w:tbl\b[^>]*>[\s\S]*?<\/w:tbl>/gi) ?? []
  const imageTargets: string[] = []
  const lines: string[] = []
  let paragraphCount = 0
  const appendImages = (fragment: string, value: string): string => {
    let result = value
    for (const embed of fragment.matchAll(/(?:r:embed|r:id)=["']([^"']+)["']/gi)) {
      const target = imageRelations.get(embed[1])
      if (!target) continue
      imageTargets.push(target)
      result = `${result}${result ? ' ' : ''}[[source-image-${imageTargets.length}]]`
    }
    return result
  }
  for (const block of blocks) {
    if (/^<w:tbl\b/i.test(block)) {
      const rows = [...block.matchAll(/<w:tr\b[^>]*>([\s\S]*?)<\/w:tr>/gi)].map((row) => {
        const cells = [...row[1].matchAll(/<w:tc\b[^>]*>([\s\S]*?)<\/w:tc>/gi)].map((cell) =>
          appendImages(cell[1], extractXmlText(cell[1])),
        )
        return cells.filter(Boolean).join(' | ')
      }).filter(Boolean)
      if (rows.length) lines.push(...rows)
      paragraphCount += rows.length
    } else {
      let line = appendImages(block, extractXmlText(block))
      line = line.trim()
      if (line) {
        lines.push(line)
        paragraphCount += 1
      }
    }
  }
  return { imageTargets, paragraphCount, text: normalizeText(lines.join('\n')) }
}

const parseRelations = (xml: string): Map<string, string> => {
  const relations = new Map<string, string>()
  for (const relation of xml.matchAll(/<Relationship\b[^>]*\/?\s*>/gi)) {
    const id = relation[0].match(/\bId=["']([^"']+)["']/i)?.[1]
    const rawTarget = relation[0].match(/\bTarget=["']([^"']+)["']/i)?.[1]
    if (!id || !rawTarget) continue
    const target = rawTarget.replace(/^\/?(?:\.\.\/)+/, '').replace(/^\//, '')
    if (
      relation[0].match(/TargetMode\s*=\s*["']External["']/i) ||
      /^[a-z][a-z0-9+.-]*:/i.test(target)
    ) {
      throw new KnowledgeIngestionError('external-docx-relation', 'External DOCX relationships are not allowed')
    }
    relations.set(id, target.startsWith('word/') ? target : `word/${target.replace(/^word\//, '')}`)
  }
  return relations
}

export const parseDocx = (data: Buffer): ParsedKnowledgeSource => {
  const entries = readZipEntries(data)
  const byName = new Map(entries.map((entry) => [entry.name, entry]))
  const documentXml = byName.get('word/document.xml')?.data.toString('utf8')
  if (!documentXml) throw new KnowledgeIngestionError('invalid-docx', 'The DOCX document body is missing')
  for (const entry of entries) {
    if (entry.name.endsWith('.rels') && /TargetMode\s*=\s*["']External["']/i.test(entry.data.toString('utf8'))) {
      throw new KnowledgeIngestionError('external-docx-relation', 'External DOCX relationships are not allowed')
    }
  }
  const imageRelations = parseRelations(byName.get('word/_rels/document.xml.rels')?.data.toString('utf8') ?? '')
  const extracted = extractDocxText(documentXml, imageRelations)
  if (!extracted.text) throw new KnowledgeIngestionError('empty-document', 'The DOCX document contains no readable text')
  if (extracted.text.length > KNOWLEDGE_SOURCE_MAX_TEXT_CHARACTERS) {
    throw new KnowledgeIngestionError('text-too-large', 'The extracted document text exceeds its limit', 413)
  }

  const images: KnowledgeSourceImage[] = []
  let totalImageBytes = 0
  if (extracted.imageTargets.length > KNOWLEDGE_SOURCE_MAX_IMAGES) {
    throw new KnowledgeIngestionError('too-many-images', 'The document contains too many images', 413)
  }
  for (const [index, target] of extracted.imageTargets.entries()) {
    const entry = byName.get(target)
    if (!entry || !entry.name.startsWith('word/media/')) {
      throw new KnowledgeIngestionError('invalid-docx-image', 'A referenced DOCX image is missing')
    }
    const mimeType = mimeForImage(entry.name)
    if (!mimeType) throw new KnowledgeIngestionError('unsupported-image', 'The document contains an unsupported image', 415)
    if (entry.data.length > KNOWLEDGE_SOURCE_MAX_IMAGE_BYTES) {
      throw new KnowledgeIngestionError('image-too-large', 'The document contains an oversized image', 413)
    }
    totalImageBytes += entry.data.length
    if (totalImageBytes > KNOWLEDGE_SOURCE_MAX_IMAGE_TOTAL_BYTES) {
      throw new KnowledgeIngestionError('image-total-too-large', 'The document images exceed their total limit', 413)
    }
    validateKnowledgeSourceImage({
      data: entry.data,
      mimetype: mimeType,
      name: entry.name.slice(entry.name.lastIndexOf('/') + 1),
      size: entry.data.length,
    })
    images.push({
      data: entry.data,
      mimeType,
      name: entry.name.slice(entry.name.lastIndexOf('/') + 1),
      sequence: index + 1,
      sha256: sha256(entry.data),
    })
  }
  const applicationProperties = byName.get('docProps/app.xml')?.data.toString('utf8') ?? ''
  const declaredPages = Number.parseInt(applicationProperties.match(/<Pages>([0-9]+)<\/Pages>/i)?.[1] ?? '', 10)
  const renderedPageBreaks = (documentXml.match(/<w:lastRenderedPageBreak\b/gi) ?? []).length
  const pageCount = Number.isSafeInteger(declaredPages) && declaredPages > 0
    ? Math.min(declaredPages, KNOWLEDGE_SOURCE_MAX_PDF_PAGES)
    : Math.max(1, renderedPageBreaks + 1)
  return {
    detectedLanguage: detectLanguage(extracted.text),
    images,
    pageCount,
    paragraphCount: extracted.paragraphCount,
    text: extracted.text,
  }
}

export const parsePdf = async (data: Buffer): Promise<ParsedKnowledgeSource> => {
  if (!hasPrefix(data, '%PDF-')) throw new KnowledgeIngestionError('file-signature-mismatch', 'The PDF file signature is invalid', 415)
  try {
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const task = getDocument({
      data: new Uint8Array(data),
      stopAtErrors: true,
      useSystemFonts: true,
    })
    try {
      const document = await task.promise
      if (document.numPages < 1 || document.numPages > KNOWLEDGE_SOURCE_MAX_PDF_PAGES) {
        throw new KnowledgeIngestionError('pdf-page-limit', 'The PDF page count exceeds its limit', 413)
      }
      const lines: string[] = []
      let extractedCharacters = 0
      for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
        const page = await document.getPage(pageNumber)
        const textContent = await page.getTextContent()
        let line = ''
        for (const item of textContent.items) {
          if (!('str' in item)) continue
          const value = item.str.trim()
          if (value) line = `${line}${line ? ' ' : ''}${value}`
          if (item.hasEOL && line) {
            lines.push(line)
            extractedCharacters += line.length
            line = ''
          }
          if (extractedCharacters + line.length > KNOWLEDGE_SOURCE_MAX_TEXT_CHARACTERS) {
            throw new KnowledgeIngestionError('text-too-large', 'The extracted document text exceeds its limit', 413)
          }
        }
        if (line) {
          lines.push(line)
          extractedCharacters += line.length
        }
        page.cleanup()
      }
      const text = normalizeText(lines.join('\n'))
      if (!text) throw new KnowledgeIngestionError('ocr-required', 'This PDF has no extractable text; OCR is required')
      if (text.length > KNOWLEDGE_SOURCE_MAX_TEXT_CHARACTERS) {
        throw new KnowledgeIngestionError('text-too-large', 'The extracted document text exceeds its limit', 413)
      }
      await document.cleanup()
      return {
        detectedLanguage: detectLanguage(text),
        images: [],
        pageCount: document.numPages,
        paragraphCount: text.split(/\n+/).filter(Boolean).length,
        text,
      }
    } finally {
      await task.destroy()
    }
  } catch (error) {
    if (error instanceof KnowledgeIngestionError) throw error
    const name = error instanceof Error ? error.name : ''
    if (name === 'PasswordException') {
      throw new KnowledgeIngestionError('pdf-password-required', 'The PDF is password protected')
    }
    throw new KnowledgeIngestionError('invalid-pdf', 'The PDF could not be parsed')
  }
}

export const parseKnowledgeSource = async (file: KnowledgeSourceFile): Promise<ParsedKnowledgeSource> => {
  // Payload may persist an OOXML upload as `application/zip` after its own
  // content sniffing. Normalize that representation before dispatching so a
  // valid DOCX cannot be rejected only because it crossed the storage
  // boundary. Ordinary ZIP files still fail signature/OOXML validation.
  const validFile = validateStoredKnowledgeSourceFile(file)
  return validFile.mimetype === 'application/pdf' ? parsePdf(validFile.data) : parseDocx(validFile.data)
}

/** Port used by the ingestion worker; keeping it injectable makes fixture and lease tests cheap. */
export class KnowledgeDocumentParser {
  parse(file: KnowledgeSourceFile): Promise<ParsedKnowledgeSource> {
    return parseKnowledgeSource(file)
  }
}

export const createKnowledgeDocumentParser = (): KnowledgeDocumentParser => new KnowledgeDocumentParser()
