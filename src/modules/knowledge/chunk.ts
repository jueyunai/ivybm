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

const STRUCTURED_QA_START = /^[A-Z][A-Z0-9-]{1,32}-\d{2}(?:\s|$)/
const STRUCTURED_TOPIC_START = /^\d{2}\.\s+\S/

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

const splitStructuredQASections = (text: string): string[] | null => {
  const sections: string[] = []
  let current: string[] = []
  let currentHasQA = false
  let qaCount = 0

  const pushCurrent = () => {
    const section = current.join('\n').trim()
    if (section) sections.push(section)
    current = []
    currentHasQA = false
  }

  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (STRUCTURED_QA_START.test(trimmed)) {
      if (currentHasQA || (qaCount === 0 && current.some((value) => value.trim()))) {
        pushCurrent()
      }
      current.push(trimmed)
      currentHasQA = true
      qaCount += 1
      continue
    }
    if (qaCount > 0 && currentHasQA && STRUCTURED_TOPIC_START.test(trimmed)) {
      pushCurrent()
    }
    current.push(line)
  }
  pushCurrent()

  return qaCount >= 2 ? sections : null
}

const splitStructuredQASection = (section: string, maxCharacters: number): string[] => {
  const pieces = splitAtWordBoundary(section, maxCharacters)
  const qaID = section
    .split('\n')
    .map((line) => line.trim())
    .find((line) => STRUCTURED_QA_START.test(line))
  if (!qaID || pieces.length < 2) return pieces

  const continuationBudget = maxCharacters - qaID.length - 1
  if (continuationBudget < 50) return pieces
  return [
    pieces[0],
    ...pieces.slice(1).flatMap((piece) =>
      splitAtWordBoundary(piece, continuationBudget).map((continuation) =>
        `${qaID}\n${continuation}`,
      ),
    ),
  ]
}

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

  const structuredSections = splitStructuredQASections(text)
  const contents = structuredSections
    ? structuredSections.flatMap((section) => splitStructuredQASection(section, maxCharacters))
    : packParagraphs(splitParagraphs(text, maxCharacters), maxCharacters)

  return contents.map(
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
