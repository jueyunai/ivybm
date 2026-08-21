// @vitest-environment node

import { describe, expect, it } from 'vitest'

import {
  readKnowledgeDocumentJSON,
  readKnowledgeJSON,
} from '@/admin-portal/modules/knowledge/knowledgeRoute'
import { KNOWLEDGE_DOCUMENT_MAX_REQUEST_BYTES } from '@/modules/knowledge/limits'

const requestFor = (body: string, declaredLength?: number): Request =>
  new Request('http://localhost/api/portal/knowledge/documents', {
    body,
    headers:
      declaredLength === undefined
        ? { 'content-type': 'application/json' }
        : {
            'content-length': String(declaredLength),
            'content-type': 'application/json',
          },
    method: 'POST',
  })

describe('Portal knowledge document JSON boundary', () => {
  it('accepts a multibyte imported draft above the legacy request ceiling', async () => {
    const content = 'م'.repeat(200_001)
    const body = JSON.stringify({ action: 'save', content })

    expect(Buffer.byteLength(body)).toBeGreaterThan(256_000)
    await expect(readKnowledgeDocumentJSON(requestFor(body))).resolves.toMatchObject({ content })
    await expect(readKnowledgeJSON(requestFor(body))).rejects.toMatchObject({
      code: 'knowledge-request-too-large',
      status: 413,
    })
  })

  it('keeps the document request boundary fail closed', async () => {
    await expect(
      readKnowledgeDocumentJSON(requestFor('{}', KNOWLEDGE_DOCUMENT_MAX_REQUEST_BYTES + 1)),
    ).rejects.toMatchObject({ code: 'knowledge-request-too-large', status: 413 })
  })
})
