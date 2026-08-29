import { describe, expect, it } from 'vitest'

import { PORTAL_EN } from '@/admin-portal/core/i18n/en'
import { PORTAL_ZH } from '@/admin-portal/core/i18n/zh'
import { safeFailure } from '@/modules/knowledge/ingestion/jobs'
import { KnowledgeIngestionError } from '@/modules/knowledge/ingestion/parser'

// Every code the ingestion pipeline can persist on a source document must
// surface a specific message: a precise worker-side summary and a translated,
// actionable portal message. A missing entry degrades the customer-facing
// error to the opaque "could not be processed safely" fallback (HMT-0019).
const INGESTION_ERROR_CODES = [
  'empty-document',
  'empty-source-text',
  'external-docx-relation',
  'file-signature-mismatch',
  'file-too-large',
  'image-too-large',
  'image-signature-mismatch',
  'image-total-too-large',
  'ingestion-failed',
  'invalid-docx',
  'invalid-docx-archive',
  'invalid-docx-image',
  'invalid-file',
  'invalid-file-name',
  'invalid-image',
  'invalid-image-name',
  'invalid-pdf',
  'ocr-required',
  'pdf-page-limit',
  'pdf-password-required',
  'text-too-large',
  'too-many-images',
  'translation-model-unavailable',
  'translation-prompt-ambiguous',
  'translation-prompt-unavailable',
  'translation-fidelity',
  'translation-empty',
  'translation-too-large',
  'unsupported-file-type',
  'unsupported-image',
] as const

describe('knowledge ingestion failure messages', () => {
  it('maps every ingestion error code to a specific worker summary', () => {
    for (const code of INGESTION_ERROR_CODES) {
      const failure = safeFailure(new KnowledgeIngestionError(code, 'internal detail'))
      expect(failure.code).toBe(code)
      expect(failure.summary).not.toBe('The document could not be processed safely')
    }
  })

  it('never leaks internal error details into worker summaries', () => {
    const failure = safeFailure(new KnowledgeIngestionError('invalid-docx', 'zip bomb at 0xdead'))
    expect(failure.summary).toBe('The DOCX document is invalid')
    expect(failure.summary).not.toContain('0xdead')
  })

  it('maps every ingestion error code to portal zh and en summaries', () => {
    const zh = PORTAL_ZH.knowledgeWorkspace.ingestion.errorSummaries
    const en = PORTAL_EN.knowledgeWorkspace.ingestion.errorSummaries
    for (const code of INGESTION_ERROR_CODES) {
      expect(zh[code], `zh errorSummaries["${code}"]`).toBeTruthy()
      expect(en[code], `en errorSummaries["${code}"]`).toBeTruthy()
    }
    expect(zh.unknown).toBeTruthy()
    expect(en.unknown).toBeTruthy()
  })
})
