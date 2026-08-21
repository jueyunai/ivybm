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

  it('keeps structured sales Q&A entries in separate chunks', () => {
    const chunks = chunkKnowledgeDocument(
      {
        documentId: 'sales-script-1',
        locale: 'en',
        sourceTitle: 'Sales knowledge',
        sourceVersion: '1',
        text: [
          'Sales agent rules',
          '01. Company',
          'COMPANY-01',
          'Customer question: Who are you?',
          'Recommended answer: We supply facade materials.',
          'Follow-up question: Where is the project?',
          '2. Product support remains available after delivery.',
          'COMPANY-02',
          'Customer question: Where are you based?',
          'Recommended answer: Confirm the relevant legal entity with sales.',
          '02. Products',
          'PRODUCT-01',
          'Customer question: What products do you supply?',
          'Recommended answer: Solid aluminum facade products.',
        ].join('\n'),
      },
      { maxCharacters: 1_200 },
    )

    expect(chunks.map((chunk) => chunk.content.match(/\b[A-Z][A-Z-]+-\d{2}\b/g) ?? [])).toEqual([
      [],
      ['COMPANY-01'],
      ['COMPANY-02'],
      ['PRODUCT-01'],
    ])
    expect(chunks[1].content).toContain('2. Product support remains available after delivery.')
    expect(chunks[3].content).toContain('02. Products')
  })

  it('keeps two-digit numbered answer steps with their Q&A entry', () => {
    const chunks = chunkKnowledgeDocument(
      {
        documentId: 'numbered-answer-steps',
        locale: 'en',
        sourceTitle: 'Numbered answer steps',
        sourceVersion: '1',
        text: [
          'FIRST-01',
          'Recommended procedure:',
          '01. Inspect the substrate.',
          '02. Apply the coating.',
          'SECOND-01',
          'Recommended answer: Next topic.',
        ].join('\n'),
      },
      { maxCharacters: 1_200 },
    )

    expect(chunks.map((chunk) => chunk.content.match(/\b[A-Z][A-Z-]+-\d{2}\b/g) ?? [])).toEqual([
      ['FIRST-01'],
      ['SECOND-01'],
    ])
    expect(chunks[0].content).toContain('01. Inspect the substrate.\n02. Apply the coating.')
    expect(chunks[1].content).toBe('SECOND-01\nRecommended answer: Next topic.')
  })

  it('repeats the Q&A identifier on continuation chunks', () => {
    const chunks = chunkKnowledgeDocument(
      {
        documentId: 'long-sales-script',
        locale: 'en',
        sourceTitle: 'Long sales knowledge',
        sourceVersion: '1',
        text: [
          'LONG-01',
          `Recommended answer: ${'verified facade detail '.repeat(20)}`,
          'LONG-02',
          'Recommended answer: Short answer.',
        ].join('\n'),
      },
      { maxCharacters: 120 },
    )

    expect(chunks.length).toBeGreaterThan(2)
    expect(chunks.every((chunk) => chunk.content.length <= 120)).toBe(true)
    expect(chunks.slice(0, -1).every((chunk) => chunk.content.startsWith('LONG-01'))).toBe(true)
    expect(chunks.at(-1)?.content).toBe('LONG-02\nRecommended answer: Short answer.')
  })

  it('repeats only the identifier when a long question shares the Q&A start line', () => {
    const chunks = chunkKnowledgeDocument(
      {
        documentId: 'long-inline-question',
        locale: 'en',
        sourceTitle: 'Long inline question',
        sourceVersion: '1',
        text: [
          `LONG-01 Customer question: ${'detailed specification '.repeat(10)}`,
          `Recommended answer: ${'verified facade detail '.repeat(20)}`,
          'LONG-02 Recommended answer: Short answer.',
        ].join('\n'),
      },
      { maxCharacters: 120 },
    )

    expect(chunks.length).toBeGreaterThan(2)
    expect(chunks.every((chunk) => chunk.content.length <= 120)).toBe(true)
    expect(chunks.slice(0, -1).every((chunk) => chunk.content.startsWith('LONG-01'))).toBe(true)
    expect(
      chunks.slice(1, -1).every((chunk) => chunk.content.split('\n', 1)[0] === 'LONG-01'),
    ).toBe(true)
    expect(chunks.at(-1)?.content).toBe('LONG-02 Recommended answer: Short answer.')
  })
})
