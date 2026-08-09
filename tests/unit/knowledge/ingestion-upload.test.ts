// @vitest-environment node

import { describe, expect, it } from 'vitest'

import { readKnowledgeSourceUpload, safeKnowledgeSourceSummary } from '@/admin-portal/modules/knowledge/knowledgeSourceRoute'
import { KnowledgeSourceCommandError, knowledgeSourceStoragePath } from '@/modules/knowledge/ingestion/source'

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

describe('knowledge source upload request boundary', () => {
  it('parses a bounded multipart source upload', async () => {
    const boundary = 'knowledge-source-upload'
    const body = Buffer.from([
      `--${boundary}\r\nContent-Disposition: form-data; name="sourceTitle"\r\n\r\nPanel guide\r\n`,
      `--${boundary}\r\nContent-Disposition: form-data; name="sourceType"\r\n\r\ntechnical-specification\r\n`,
      `--${boundary}\r\nContent-Disposition: form-data; name="sourceVersion"\r\n\r\n1.0\r\n`,
      `--${boundary}\r\nContent-Disposition: form-data; name="originalLanguage"\r\n\r\nzh\r\n`,
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="guide.docx"\r\nContent-Type: ${DOCX_MIME}\r\n\r\nPK-test\r\n`,
      `--${boundary}--\r\n`,
    ].join(''))
    const result = await readKnowledgeSourceUpload(new Request('http://localhost/api/portal/knowledge/sources', {
      body,
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      method: 'POST',
    }))

    expect(result.input).toEqual({
      originalLanguage: 'zh',
      sourceTitle: 'Panel guide',
      sourceType: 'technical-specification',
      sourceVersion: '1.0',
    })
    expect(result.file).toMatchObject({ mimetype: DOCX_MIME, name: 'guide.docx', size: 7 })
  })

  it('rejects a forged oversized request before buffering it', async () => {
    const request = new Request('http://localhost/api/portal/knowledge/sources', {
      body: Buffer.from('small'),
      headers: {
        'content-length': String(32 * 1024 * 1024),
        'content-type': 'multipart/form-data; boundary=oversized',
      },
      method: 'POST',
    })
    await expect(readKnowledgeSourceUpload(request)).rejects.toMatchObject({
      code: 'request-too-large',
      status: 413,
    } satisfies Partial<KnowledgeSourceCommandError>)
  })

  it('rejects dot-path storage names before touching the private directory', () => {
    expect(() => knowledgeSourceStoragePath('..')).toThrow('safe file name')
    expect(() => knowledgeSourceStoragePath('.')).toThrow('safe file name')
    expect(() => knowledgeSourceStoragePath('nested/source.docx')).toThrow('safe file name')
  })

  it('normalizes Payload ZIP sniffing to the private DOCX MIME in summaries', () => {
    expect(
      safeKnowledgeSourceSummary({ filename: 'guide.docx', mimeType: 'application/zip' }),
    ).toMatchObject({
      filename: 'guide.docx',
      mimeType: DOCX_MIME,
    })
  })
})
