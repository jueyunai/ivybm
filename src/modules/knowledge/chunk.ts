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

const STRUCTURED_QA_START = /^([A-Z][A-Z0-9-]{1,32}-\d{2})(?:\s|$)/
const STRUCTURED_TOPIC_START = /^\d{2}\.\s+\S/

const structuredQAPrefix = (qaID: string): string =>
  qaID.replace(/-\d{2}$/, '').replace(/[^A-Z0-9]/g, '')

const isStructuredTopicForQA = (topicLine: string, qaID: string): boolean => {
  const topic = topicLine
    .replace(/^\d{2}\.\s+/, '')
    .replace(/[^a-z0-9]/gi, '')
    .toUpperCase()
  const qaPrefix = structuredQAPrefix(qaID)
  const singularTopic = topic.endsWith('S') ? topic.slice(0, -1) : topic

  return topic === qaPrefix || singularTopic === qaPrefix
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

const splitStructuredQASections = (text: string): string[] | null => {
  const sections: string[] = []
  let current: string[] = []
  let currentHasQA = false
  let currentQAPrefix: string | undefined
  let pendingTopics: string[] = []
  let qaCount = 0

  const pushCurrent = () => {
    const section = current.join('\n').trim()
    if (section) sections.push(section)
    current = []
    currentHasQA = false
    currentQAPrefix = undefined
  }

  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    const qaMatch = STRUCTURED_QA_START.exec(trimmed)
    if (qaMatch) {
      const nextQAPrefix = structuredQAPrefix(qaMatch[1])
      if (
        pendingTopics.length === 1 &&
        currentQAPrefix !== undefined &&
        currentQAPrefix !== nextQAPrefix &&
        isStructuredTopicForQA(pendingTopics[0], qaMatch[1])
      ) {
        pushCurrent()
        current.push(pendingTopics[0])
      } else if (pendingTopics.length > 0) {
        current.push(...pendingTopics)
        pushCurrent()
      } else if (currentHasQA || (qaCount === 0 && current.some((value) => value.trim()))) {
        pushCurrent()
      }
      pendingTopics = []
      current.push(trimmed)
      currentHasQA = true
      currentQAPrefix = nextQAPrefix
      qaCount += 1
      continue
    }
    if (qaCount > 0 && currentHasQA && STRUCTURED_TOPIC_START.test(trimmed)) {
      pendingTopics.push(line)
      continue
    }
    if (pendingTopics.length > 0) {
      current.push(...pendingTopics)
      pendingTopics = []
    }
    current.push(line)
  }
  current.push(...pendingTopics)
  pushCurrent()

  return qaCount >= 2 ? sections : null
}

const splitStructuredQASection = (section: string, maxCharacters: number): string[] => {
  const pieces = splitAtWordBoundary(section, maxCharacters)
  let qaID: string | undefined
  for (const line of section.split('\n')) {
    const match = STRUCTURED_QA_START.exec(line.trim())
    if (match) {
      qaID = match[1]
      break
    }
  }
  if (!qaID || pieces.length < 2) return pieces

  const continuationBudget = maxCharacters - qaID.length - 1
  if (continuationBudget < 50) return pieces
  return [
    pieces[0],
    ...pieces
      .slice(1)
      .flatMap((piece) =>
        splitAtWordBoundary(piece, continuationBudget).map(
          (continuation) => `${qaID}\n${continuation}`,
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

  return contents.map((content, index) => ({
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
  }))
}
