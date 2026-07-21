import { describe, expect, it } from 'vitest'

import { chunkKnowledgeDocument } from '@/modules/knowledge/chunk'

const englishDocument = {
  documentId: 'product-manual-1',
  locale: 'en' as const,
  sourceTitle: 'Aluminum Panel Product Manual',
  sourceURL: 'https://example.invalid/manuals/aluminum-panel',
  sourceVersion: '2026.07',
  text: [
    'Aluminum panels are available in multiple alloys and finishes. They are commonly used for exterior facades and interior ceilings.',
    'Custom dimensions require an engineering review. Final pricing and delivery dates must be confirmed by a salesperson.',
    'Installation details depend on the supporting structure and local building requirements.',
  ].join('\n\n'),
}

describe('knowledge document chunking', () => {
  it('produces stable chunks with locale and source citations', () => {
    const first = chunkKnowledgeDocument(englishDocument, { maxCharacters: 150 })
    const second = chunkKnowledgeDocument(englishDocument, { maxCharacters: 150 })

    expect(first).toEqual(second)
    expect(first.length).toBeGreaterThan(1)
    expect(first.map(({ index }) => index)).toEqual(first.map((_, index) => index))

    for (const chunk of first) {
      expect(chunk.content.length).toBeLessThanOrEqual(150)
      expect(chunk.locale).toBe('en')
      expect(chunk.stableId).toMatch(/^[a-f0-9]{64}$/)
      expect(chunk.citation).toEqual({
        documentId: englishDocument.documentId,
        title: englishDocument.sourceTitle,
        url: englishDocument.sourceURL,
        version: englishDocument.sourceVersion,
      })
    }
  })

  it('changes stable identifiers when the source version changes', () => {
    const original = chunkKnowledgeDocument(englishDocument, { maxCharacters: 150 })
    const revised = chunkKnowledgeDocument(
      { ...englishDocument, sourceVersion: '2026.08' },
      { maxCharacters: 150 },
    )

    expect(revised.map(({ stableId }) => stableId)).not.toEqual(
      original.map(({ stableId }) => stableId),
    )
  })

  it('preserves Arabic text and rejects empty documents', () => {
    const chunks = chunkKnowledgeDocument(
      {
        documentId: 'arabic-faq-1',
        locale: 'ar',
        sourceTitle: 'الأسئلة الشائعة',
        sourceVersion: '1',
        text: 'تُستخدم ألواح الألومنيوم في الواجهات الخارجية.\n\nيجب تأكيد السعر وموعد التسليم مع فريق المبيعات.',
      },
      { maxCharacters: 80 },
    )

    expect(chunks).toHaveLength(2)
    expect(chunks.every(({ locale }) => locale === 'ar')).toBe(true)
    expect(chunks.map(({ content }) => content).join(' ')).toContain('الألومنيوم')

    expect(() => chunkKnowledgeDocument({ ...englishDocument, text: '  \n\n  ' })).toThrow(
      'Knowledge document text is required',
    )
  })
})
