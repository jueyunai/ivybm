import { deflateRawSync } from 'node:zlib'

import { describe, expect, it } from 'vitest'

import {
  KnowledgeIngestionError,
  parseDocx,
  parsePdf,
  parseKnowledgeSource,
  validateKnowledgeSourceFile,
} from '@/modules/knowledge/ingestion/parser'

const makeDocx = (imageCount = 1): Buffer => {
  const embeds = Array.from(
    { length: imageCount },
    (_, index) => `<w:drawing r:embed="rId${index + 1}"/>`,
  ).join('')
  const relations = Array.from(
    { length: imageCount },
    (_, index) => `<Relationship Id="rId${index + 1}" Target="media/image${index + 1}.png"/>`,
  ).join('')
  const files = [
    {
      name: 'word/document.xml',
      value: `<?xml version="1.0"?><w:document xmlns:w="x" xmlns:r="r"><w:body><w:p><w:r><w:t>Facade &amp; panels</w:t></w:r><w:r><w:tab/></w:r>${embeds}</w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Size</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>1200 mm</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>`,
    },
    {
      name: 'word/_rels/document.xml.rels',
      value: `<Relationships>${relations}</Relationships>`,
    },
    {
      name: 'word/media/image1.png',
      value: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    },
  ]
  const local: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  for (const file of files) {
    const data = Buffer.isBuffer(file.value) ? file.value : Buffer.from(file.value)
    const compressed = deflateRawSync(data)
    const name = Buffer.from(file.name)
    const header = Buffer.alloc(30)
    header.writeUInt32LE(0x04034b50, 0)
    header.writeUInt16LE(20, 4)
    header.writeUInt16LE(8, 8)
    header.writeUInt32LE(compressed.length, 18)
    header.writeUInt32LE(data.length, 22)
    header.writeUInt16LE(name.length, 26)
    local.push(header, name, compressed)
    const entry = Buffer.alloc(46)
    entry.writeUInt32LE(0x02014b50, 0)
    entry.writeUInt16LE(20, 4)
    entry.writeUInt16LE(20, 6)
    entry.writeUInt16LE(8, 10)
    entry.writeUInt32LE(compressed.length, 20)
    entry.writeUInt32LE(data.length, 24)
    entry.writeUInt16LE(name.length, 28)
    entry.writeUInt32LE(offset, 42)
    central.push(entry, name)
    offset += header.length + name.length + compressed.length
  }
  const centralSize = central.reduce((sum, part) => sum + part.length, 0)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(files.length, 8)
  end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(centralSize, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...local, ...central, end])
}

const makePdf = (text = ''): Buffer => {
  const escaped = text.replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)')
  const stream = text ? `BT /F1 12 Tf 72 720 Td (${escaped}) Tj ET` : ''
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ]
  let body = '%PDF-1.4\n'
  const offsets = [0]
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(body, 'latin1'))
    body += `${index + 1} 0 obj\n${object}\nendobj\n`
  }
  const xrefOffset = Buffer.byteLength(body, 'latin1')
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  body += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
    .join('')
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`
  return Buffer.from(body, 'latin1')
}

describe('knowledge source parser', () => {
  it('fails closed on names, MIME, signature, and size', () => {
    expect(() => validateKnowledgeSourceFile({ data: Buffer.from('%PDF-'), mimetype: 'application/pdf', name: '../source.pdf', size: 5 })).toThrow('safe file name')
    expect(() => validateKnowledgeSourceFile({ data: Buffer.from('%PDF-'), mimetype: 'application/pdf', name: 'source.docx', size: 5 })).toThrow('signature')
  })

  it('extracts DOCX paragraphs, tables, and private image metadata', () => {
    const parsed = parseDocx(makeDocx())
    expect(parsed.text).toContain('Facade & panels')
    expect(parsed.text).toContain('Size | 1200 mm')
    expect(parsed.text).toContain('[[source-image-1]]')
    expect(parsed.images).toMatchObject([{ name: 'image1.png', sequence: 1, mimeType: 'image/png' }])
  })

  it('rejects a DOCX with more embedded images than the safe limit', () => {
    let thrown: unknown
    try {
      parseDocx(makeDocx(101))
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(KnowledgeIngestionError)
    expect((thrown as KnowledgeIngestionError).code).toBe('too-many-images')
  })

  it('extracts real PDF page text and returns an actionable OCR error for textless pages', async () => {
    await expect(parsePdf(makePdf('Delivery'))).resolves.toMatchObject({
      pageCount: 1,
      text: 'Delivery',
    })
    await expect(parsePdf(makePdf())).rejects.toMatchObject({
      code: 'ocr-required',
      name: 'KnowledgeIngestionError',
    } satisfies Partial<KnowledgeIngestionError>)
  })

  it('dispatches by the declared MIME type', async () => {
    const data = makePdf('English')
    const file = { data, mimetype: 'application/pdf', name: 'source.pdf', size: data.length }
    await expect(parseKnowledgeSource(file)).resolves.toMatchObject({ detectedLanguage: 'en' })
  })

  it('accepts a valid DOCX whose stored MIME was sniffed as ZIP', async () => {
    const data = makeDocx()
    await expect(
      parseKnowledgeSource({
        data,
        mimetype: 'application/zip',
        name: 'source.docx',
        size: data.length,
      }),
    ).resolves.toMatchObject({ detectedLanguage: 'en' })
  })
})
