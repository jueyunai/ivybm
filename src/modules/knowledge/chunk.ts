import { createHash } from 'node:crypto'

export type KnowledgeLocale = 'en' | 'ar'

export type KnowledgeDocumentInput = {
  documentId: number | string
  locale: KnowledgeLocale
  sourceTitle: string
  sourceURL?: string
  sourceVersion: string
  text: string
}

export type KnowledgeChunk = {
  citation: {
    documentId: number | string
    title: string
    url?: string
    version: string
  }
  content: string
  index: number
  locale: KnowledgeLocale
  stableId: string
}

type ChunkOptions = {
  maxCharacters?: number
}

const normalizeText = (text: string): string =>
  text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[\t ]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

const splitAtWordBoundary = (text: string, maxCharacters: number): string[] => {
  const pieces: string[] = []
  let remaining = text.trim()

  while (remaining.length > maxCharacters) {
    const candidate = remaining.slice(0, maxCharacters + 1)
    const boundary = Math.max(candidate.lastIndexOf(' '), candidate.lastIndexOf('\n'))
    const splitAt = boundary > Math.floor(maxCharacters * 0.5) ? boundary : maxCharacters
    pieces.push(remaining.slice(0, splitAt).trim())
    remaining = remaining.slice(splitAt).trim()
  }

  if (remaining) pieces.push(remaining)
  return pieces
}

const splitParagraphs = (text: string, maxCharacters: number): string[] =>
  text
    .split(/\n{2,}/)
    .flatMap((paragraph) => splitAtWordBoundary(paragraph, maxCharacters))
    .filter(Boolean)

const packParagraphs = (paragraphs: string[], maxCharacters: number): string[] => {
  const chunks: string[] = []
  let current = ''

  for (const paragraph of paragraphs) {
    const candidate = current ? `${current}\n\n${paragraph}` : paragraph
    if (candidate.length <= maxCharacters) {
      current = candidate
      continue
    }

    if (current) chunks.push(current)
    current = paragraph
  }

  if (current) chunks.push(current)
  return chunks
}

export const chunkKnowledgeDocument = (
  document: KnowledgeDocumentInput,
  options: ChunkOptions = {},
): KnowledgeChunk[] => {
  const maxCharacters = options.maxCharacters ?? 1_200
  if (!Number.isInteger(maxCharacters) || maxCharacters < 50) {
    throw new Error('maxCharacters must be an integer greater than or equal to 50')
  }

  const text = normalizeText(document.text)
  if (!text) throw new Error('Knowledge document text is required')

  const citation = {
    documentId: document.documentId,
    title: document.sourceTitle,
    ...(document.sourceURL ? { url: document.sourceURL } : {}),
    version: document.sourceVersion,
  }

  return packParagraphs(splitParagraphs(text, maxCharacters), maxCharacters).map(
    (content, index) => ({
      citation,
      content,
      index,
      locale: document.locale,
      stableId: createHash('sha256')
        .update(
          JSON.stringify({
            content,
            documentId: document.documentId,
            index,
            locale: document.locale,
            version: document.sourceVersion,
          }),
        )
        .digest('hex'),
    }),
  )
}
