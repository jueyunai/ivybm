import { describe, expect, it } from 'vitest'

import {
  createKnowledgeDocumentRevision,
  parseKnowledgeIndexJobPayload,
} from '@/modules/knowledge/jobs'

describe('knowledge index job contracts', () => {
  it('accepts system-created rebuild jobs without a requesting user', () => {
    expect(
      parseKnowledgeIndexJobPayload({
        documentId: 1,
        documentRevision: 'revision',
        embeddingConfigurationKey: 'configuration',
        requestedBy: null,
      }),
    ).toMatchObject({ requestedBy: null })
  })

  it('keeps the revision stable across indexing-only status changes', () => {
    const document = {
      content: 'Reviewed product knowledge.',
      customerVisible: true,
      locale: 'en' as const,
      reviewStatus: 'reviewed' as const,
      reviewedAt: '2026-07-21T00:00:00.000Z',
      reviewedBy: 1,
      sourceFile: null,
      sourceTitle: 'Panel manual',
      sourceType: 'product-manual' as const,
      sourceURL: null,
      sourceVersion: '1.0',
    }

    const revision = createKnowledgeDocumentRevision(document)
    expect(createKnowledgeDocumentRevision({ ...document })).toBe(revision)
    expect(
      createKnowledgeDocumentRevision({ ...document, content: 'Changed knowledge.' }),
    ).not.toBe(revision)
  })
})
