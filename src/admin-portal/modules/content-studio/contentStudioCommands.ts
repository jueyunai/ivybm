import { createHash, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

import type { Payload, PayloadRequest } from 'payload'
import sharp from 'sharp'

import { contentStudioInternalWriteContext } from '@/access/contentStudio'
import {
  AI_IMAGE_SIZES,
  AI_GENERATED_IMAGE_MAX_BYTES,
  isValidAiImage,
  type AiImageMimeType,
  type AiImageSize,
} from '@/modules/ai/gateway'
import { AI_USAGE_KEYS, resolveAiGateway } from '@/modules/ai/registry'
import {
  createPortalMedia,
  mediaBytesMatchMimeType,
  resolveManagedMediaPath,
} from '@/modules/media'

import {
  GENERATED_CONTENT_PLATFORMS,
  GENERATED_CONTENT_STATUSES,
  GENERATED_CONTENT_TYPES,
} from '@/collections/GeneratedContents'
import { PUBLISH_JOB_MODES, PUBLISH_JOB_STATUSES } from '@/collections/PublishJobs'

type LooseRecord = Record<string, unknown>
export interface ContentStudioPayload {
  create(args: LooseRecord): Promise<LooseRecord>
  delete(args: LooseRecord): Promise<LooseRecord | { docs?: LooseRecord[] }>
  find(args: LooseRecord): Promise<{ docs: LooseRecord[] }>
  findByID(args: LooseRecord): Promise<LooseRecord>
  update(args: LooseRecord): Promise<LooseRecord>
}

export type ContentStudioStatus = (typeof GENERATED_CONTENT_STATUSES)[number]
export type ContentStudioPlatform = (typeof GENERATED_CONTENT_PLATFORMS)[number]
export type ContentStudioType = (typeof GENERATED_CONTENT_TYPES)[number]
export type PublishJobMode = (typeof PUBLISH_JOB_MODES)[number]
export type PublishJobStatus = (typeof PUBLISH_JOB_STATUSES)[number]

export class ContentStudioCommandError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'ContentStudioCommandError'
  }
}

const asRecord = (value: unknown): LooseRecord =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as LooseRecord) : {}

const stringValue = (
  input: LooseRecord,
  key: string,
  { max, required = false }: { max: number; required?: boolean },
): string => {
  const raw = input[key]
  if (raw === undefined || raw === null) {
    if (required)
      throw new ContentStudioCommandError('content-studio-invalid-input', `${key} is required`, 400)
    return ''
  }
  if (typeof raw !== 'string') {
    throw new ContentStudioCommandError(
      'content-studio-invalid-input',
      `${key} must be a string`,
      400,
    )
  }
  const value = raw.trim()
  if (required && !value) {
    throw new ContentStudioCommandError('content-studio-invalid-input', `${key} is required`, 400)
  }
  if (value.length > max) {
    throw new ContentStudioCommandError('content-studio-invalid-input', `${key} is too long`, 400)
  }
  return value
}

const positiveID = (value: unknown, key: string): number => {
  const id =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && /^[1-9]\d*$/.test(value)
        ? Number(value)
        : Number.NaN
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new ContentStudioCommandError(
      'content-studio-invalid-input',
      `${key} must be a positive id`,
      400,
    )
  }
  return id
}

const optionalPositiveID = (value: unknown, key: string): null | number =>
  value === undefined || value === null || value === '' ? null : positiveID(value, key)

const idList = (value: unknown, key: string, maximum: number): number[] => {
  const input = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value]
  if (input.length > maximum) {
    throw new ContentStudioCommandError(
      'content-studio-invalid-input',
      `${key} contains too many entries`,
      400,
    )
  }
  return [...new Set(input.map((item) => positiveID(item, key)))]
}

const sourceReferences = (value: unknown): Array<{ claim: string; source: string }> => {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value) || value.length > 20) {
    throw new ContentStudioCommandError(
      'content-studio-invalid-input',
      'sourceReferences is invalid',
      400,
    )
  }
  return value.map((item) => {
    const record = asRecord(item)
    return {
      claim: stringValue(record, 'claim', { max: 500, required: true }),
      source: stringValue(record, 'source', { max: 2_000, required: true }),
    }
  })
}

const selected = <Value extends readonly string[]>(
  value: unknown,
  allowed: Value,
  key: string,
): Value[number] => {
  if (typeof value !== 'string' || !allowed.includes(value as Value[number])) {
    throw new ContentStudioCommandError('content-studio-invalid-input', `${key} is invalid`, 400)
  }
  return value as Value[number]
}

const idempotencyKey = (value: unknown): string => {
  const key = typeof value === 'string' ? value : ''
  if (!key || key !== key.trim() || key.length > 200) {
    throw new ContentStudioCommandError(
      'content-studio-invalid-idempotency-key',
      'A valid idempotency key is required',
      400,
    )
  }
  return key
}

const revision = (value: unknown): string => {
  const updatedAt = typeof value === 'string' ? value.trim() : ''
  if (!updatedAt) {
    throw new ContentStudioCommandError(
      'content-studio-stale',
      'Reload before changing this content',
      409,
    )
  }
  return updatedAt
}

const asRelationID = (value: unknown): null | number => {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value
  if (value && typeof value === 'object') {
    const id = (value as { id?: unknown }).id
    if (typeof id === 'number' && Number.isSafeInteger(id)) return id
  }
  return null
}

const asContentResult = (document: LooseRecord) => ({
  id: document.id as number,
  status: (typeof document.status === 'string' ? document.status : 'draft') as ContentStudioStatus,
  title: typeof document.title === 'string' ? document.title : '',
  updatedAt: typeof document.updatedAt === 'string' ? document.updatedAt : '',
})

const internalContext = { ...contentStudioInternalWriteContext }

const findContent = async ({
  id,
  payload,
  req,
}: {
  id: number
  payload: ContentStudioPayload
  req: PayloadRequest
}) => {
  const content = await payload.findByID({
    collection: 'generated-contents',
    depth: 0,
    id,
    overrideAccess: false,
    req,
  })
  if (!content)
    throw new ContentStudioCommandError('content-studio-not-found', 'Content was not found', 404)
  return content as unknown as LooseRecord
}

const assertRevision = (content: LooseRecord, updatedAt: string) => {
  if (content.updatedAt !== updatedAt) {
    throw new ContentStudioCommandError(
      'content-studio-stale',
      'Content changed. Reload before saving.',
      409,
    )
  }
}

export const parseContentStudioDraft = (input: unknown) => {
  const record = asRecord(input)
  return {
    assets: idList(record.assets, 'assets', 100),
    body: stringValue(record, 'body', { max: 30_000, required: true }),
    contentLocale: selected(record.contentLocale, ['en', 'ar'] as const, 'contentLocale'),
    contentType: selected(record.contentType, GENERATED_CONTENT_TYPES, 'contentType'),
    knowledgeSources: idList(record.knowledgeSources, 'knowledgeSources', 100),
    platform: selected(record.platform, GENERATED_CONTENT_PLATFORMS, 'platform'),
    sourceReferences: sourceReferences(record.sourceReferences),
    title: stringValue(record, 'title', { max: 180, required: true }),
  }
}

type ContentStudioDraft = ReturnType<typeof parseContentStudioDraft>

const draftFingerprint = (draft: ContentStudioDraft): string =>
  createHash('sha256')
    .update(
      JSON.stringify({
        assets: draft.assets,
        body: draft.body,
        contentLocale: draft.contentLocale,
        contentType: draft.contentType,
        knowledgeSources: draft.knowledgeSources,
        platform: draft.platform,
        sourceReferences: draft.sourceReferences,
        title: draft.title,
      }),
    )
    .digest('hex')

const findExistingCreate = async ({
  actorID,
  fingerprint,
  key,
  payload,
  req,
}: {
  actorID: number
  fingerprint: string
  key: string
  payload: ContentStudioPayload
  req: PayloadRequest
}) => {
  const existing = await payload.find({
    collection: 'generated-contents',
    depth: 0,
    limit: 1,
    overrideAccess: false,
    req,
    select: {
      createdBy: true,
      creationFingerprint: true,
      id: true,
      idempotencyKey: true,
      status: true,
      title: true,
      updatedAt: true,
    },
    where: { idempotencyKey: { equals: key } },
  })
  const document = existing.docs[0] as LooseRecord | undefined
  if (!document) return null

  if (
    asRelationID(document.createdBy) !== actorID ||
    document.creationFingerprint !== fingerprint
  ) {
    throw new ContentStudioCommandError(
      'content-studio-idempotency-conflict',
      'This create key belongs to a different draft request',
      409,
    )
  }
  return asContentResult(document)
}

type ResolveContentStudioGateway = typeof resolveAiGateway

const CONTENT_STUDIO_REFERENCE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
] as const satisfies readonly AiImageMimeType[]

type ContentStudioImageInput = {
  prompt: string
  referenceMediaId: null | number
  size: AiImageSize
}

const parseImageGenerationInput = (input: unknown): ContentStudioImageInput => {
  const record = asRecord(input)
  return {
    prompt: stringValue(record, 'prompt', { max: 2_000, required: true }),
    referenceMediaId: optionalPositiveID(record.referenceMediaId, 'referenceMediaId'),
    size: selected(record.size ?? '1024x1024', AI_IMAGE_SIZES, 'size'),
  }
}

const mediaReference = async ({
  id,
  payload,
  req,
}: {
  id: number
  payload: ContentStudioPayload
  req: PayloadRequest
}): Promise<{ data: Uint8Array; mimeType: AiImageMimeType }> => {
  let media: LooseRecord
  try {
    media = await payload.findByID({
      collection: 'media',
      depth: 0,
      id,
      overrideAccess: false,
      req,
    })
  } catch {
    throw new ContentStudioCommandError(
      'content-studio-reference-unavailable',
      'The reference image is unavailable',
      409,
    )
  }
  const filename = typeof media.filename === 'string' ? media.filename : ''
  const mimeType = typeof media.mimeType === 'string' ? media.mimeType : ''
  if (!filename || !CONTENT_STUDIO_REFERENCE_MIME_TYPES.includes(mimeType as AiImageMimeType)) {
    throw new ContentStudioCommandError(
      'content-studio-reference-unavailable',
      'The reference image is unavailable',
      409,
    )
  }
  let data: Uint8Array
  try {
    data = new Uint8Array(await readFile(await resolveManagedMediaPath(filename)))
  } catch {
    throw new ContentStudioCommandError(
      'content-studio-reference-unavailable',
      'The reference image is unavailable',
      409,
    )
  }
  if (!isValidAiImage(data, mimeType)) {
    throw new ContentStudioCommandError(
      'content-studio-reference-unavailable',
      'The reference image is unavailable',
      409,
    )
  }
  return { data, mimeType: mimeType as AiImageMimeType }
}

const imageExtension = (mimeType: AiImageMimeType): string => {
  if (mimeType === 'image/jpeg') return 'jpg'
  if (mimeType === 'image/webp') return 'webp'
  return 'png'
}

const normalizeGeneratedImage = async ({
  data,
  mimeType,
}: {
  data: Uint8Array
  mimeType: AiImageMimeType
}): Promise<{ data: Buffer; mimeType: 'image/jpeg' | 'image/png' }> => {
  if (mimeType !== 'image/webp') {
    return { data: Buffer.from(data), mimeType }
  }
  return { data: await sharp(data).png().toBuffer(), mimeType: 'image/png' }
}

export async function generateContentStudioImage({
  input: rawInput,
  onProviderDispatch,
  payload,
  readStoredMediaBytes = async (filename) => readFile(await resolveManagedMediaPath(filename)),
  req,
  resolveGateway = resolveAiGateway,
}: {
  input: unknown
  onProviderDispatch?: () => void
  payload: ContentStudioPayload
  readStoredMediaBytes?: (filename: string) => Promise<Uint8Array>
  req: PayloadRequest
  resolveGateway?: ResolveContentStudioGateway
}) {
  const input = parseImageGenerationInput(rawInput)
  const referenceImage = input.referenceMediaId
    ? await mediaReference({ id: input.referenceMediaId, payload, req })
    : undefined
  try {
    const gateway = await resolveGateway({
      allowEnvironmentFallback: false,
      payload: payload as unknown as Payload,
      routes: [{ operation: 'image', usageKey: AI_USAGE_KEYS.contentImageGeneration }],
    })
    const result = await gateway.generateImage({
      onDispatch: onProviderDispatch,
      prompt: input.prompt,
      referenceImage,
      size: input.size,
    })
    const image = await normalizeGeneratedImage(result.image)
    const media = await createPortalMedia({
      file: {
        data: image.data,
        mimetype: image.mimeType,
        name: `ai-generated-${randomUUID()}.${imageExtension(image.mimeType)}`,
        size: image.data.length,
      },
      input: {
        alt: input.prompt.slice(0, 500),
        isPublic: false,
        source: `AI generated via ${result.provider} / ${result.model}`,
      },
      payload: payload as Payload,
      req,
    })
    const storedBytes = await readStoredMediaBytes(media.filename)
    if (
      storedBytes.byteLength > AI_GENERATED_IMAGE_MAX_BYTES ||
      !mediaBytesMatchMimeType(storedBytes, media.mimeType)
    ) {
      throw new ContentStudioCommandError(
        'content-studio-image-unavailable',
        'The generated image could not be verified after storage.',
        503,
      )
    }
    return {
      media,
      model: result.model,
      provider: result.provider,
      requestId: result.requestId,
      revisedPrompt: result.revisedPrompt,
      sha256: createHash('sha256').update(storedBytes).digest('hex'),
    }
  } catch (error) {
    if (error instanceof ContentStudioCommandError) throw error
    throw new ContentStudioCommandError(
      'content-studio-image-unavailable',
      'Image generation is unavailable. Check the configured image model and retry.',
      503,
    )
  }
}

export async function adoptContentStudioImage({
  id,
  input: rawInput,
  payload,
  req,
}: {
  id: number
  input: unknown
  payload: ContentStudioPayload
  req: PayloadRequest
}) {
  const input = asRecord(rawInput)
  const mediaId = positiveID(input.mediaId, 'mediaId')
  const updatedAt = revision(input.updatedAt)
  const content = await findContent({ id, payload, req })
  assertRevision(content, updatedAt)
  if (content.status !== 'draft') {
    throw new ContentStudioCommandError(
      'content-studio-invalid-transition',
      'Only drafts can adopt generated images',
      409,
    )
  }

  let media: LooseRecord
  try {
    media = await payload.findByID({
      collection: 'media',
      depth: 0,
      id: mediaId,
      overrideAccess: false,
      req,
    })
  } catch {
    throw new ContentStudioCommandError(
      'content-studio-image-unavailable',
      'The generated image is unavailable',
      409,
    )
  }
  const filename = typeof media.filename === 'string' ? media.filename : ''
  const mimeType = typeof media.mimeType === 'string' ? media.mimeType : ''
  if (
    !filename ||
    path.basename(filename) !== filename ||
    !CONTENT_STUDIO_REFERENCE_MIME_TYPES.includes(mimeType as AiImageMimeType)
  ) {
    throw new ContentStudioCommandError(
      'content-studio-image-unavailable',
      'The generated image is unavailable',
      409,
    )
  }

  const assets = [
    ...new Set(
      (Array.isArray(content.assets) ? content.assets : [])
        .map(asRelationID)
        .filter((assetId): assetId is number => assetId !== null),
    ),
  ]
  if (assets.includes(mediaId)) return asContentResult(content)
  const updated = await payload.update({
    collection: 'generated-contents',
    context: internalContext,
    data: { assets: [...assets, mediaId] },
    id,
    overrideAccess: false,
    req,
  })
  return asContentResult(updated)
}

type ContentStudioGenerationInput = {
  assets: number[]
  brief: string
  contentLocale: 'ar' | 'en'
  contentType: ContentStudioType
  idempotencyKey: string
  knowledgeSources: number[]
  platform: ContentStudioPlatform
}

const parseGenerationInput = (input: unknown): ContentStudioGenerationInput => {
  const record = asRecord(input)
  const knowledgeSources = idList(record.knowledgeSources, 'knowledgeSources', 20)
  if (!knowledgeSources.length) {
    throw new ContentStudioCommandError(
      'content-studio-generation-sources-required',
      'Select at least one reviewed knowledge source before generating a draft',
      400,
    )
  }
  return {
    assets: idList(record.assets, 'assets', 100),
    brief: stringValue(record, 'brief', { max: 2_000, required: true }),
    contentLocale: selected(record.contentLocale, ['en', 'ar'] as const, 'contentLocale'),
    contentType: selected(record.contentType, GENERATED_CONTENT_TYPES, 'contentType'),
    idempotencyKey: idempotencyKey(record.idempotencyKey),
    knowledgeSources,
    platform: selected(record.platform, GENERATED_CONTENT_PLATFORMS, 'platform'),
  }
}

type GenerationKnowledgeSource = {
  content: string
  id: number
  label: string
}

const generationSources = async ({
  ids,
  payload,
  req,
}: {
  ids: number[]
  payload: ContentStudioPayload
  req: PayloadRequest
}): Promise<GenerationKnowledgeSource[]> => {
  const result = await payload.find({
    collection: 'knowledge-documents',
    depth: 0,
    limit: ids.length,
    overrideAccess: false,
    pagination: false,
    req,
    select: {
      content: true,
      id: true,
      indexStatus: true,
      reviewStatus: true,
      sourceTitle: true,
      sourceURL: true,
      sourceVersion: true,
    },
    where: {
      and: [
        { id: { in: ids } },
        { reviewStatus: { equals: 'reviewed' } },
        { indexStatus: { equals: 'ready' } },
      ],
    },
  })
  const byID = new Map(
    result.docs.flatMap((document) => {
      const id = typeof document.id === 'number' ? document.id : Number.NaN
      const content = typeof document.content === 'string' ? document.content.trim() : ''
      const title = typeof document.sourceTitle === 'string' ? document.sourceTitle.trim() : ''
      const version =
        typeof document.sourceVersion === 'string' ? document.sourceVersion.trim() : ''
      const sourceURL = typeof document.sourceURL === 'string' ? document.sourceURL.trim() : ''
      if (!Number.isSafeInteger(id) || !content || !title || !version) return []
      return [
        [
          id,
          {
            content,
            id,
            label: sourceURL || `${title} v${version}`,
          } satisfies GenerationKnowledgeSource,
        ] as const,
      ]
    }),
  )
  const ordered = ids.flatMap((id) => {
    const source = byID.get(id)
    return source ? [source] : []
  })
  if (ordered.length !== ids.length) {
    throw new ContentStudioCommandError(
      'content-studio-generation-sources-unavailable',
      'Every selected knowledge source must be reviewed, indexed, and readable',
      409,
    )
  }
  return ordered
}

const normalizeGeneratedDraft = ({
  generated,
  input,
  sources,
}: {
  generated: unknown
  input: ContentStudioGenerationInput
  sources: GenerationKnowledgeSource[]
}): ContentStudioDraft => {
  const record = asRecord(generated)
  const allowedSourceLabels = new Set(sources.map(({ label }) => label))
  const references = sourceReferences(record.sourceReferences)
  if (!references.length || references.some(({ source }) => !allowedSourceLabels.has(source))) {
    throw new ContentStudioCommandError(
      'content-studio-ai-invalid-response',
      'The AI response did not return traceable source references',
      422,
    )
  }
  return parseContentStudioDraft({
    assets: input.assets,
    body: record.body,
    contentLocale: input.contentLocale,
    contentType: input.contentType,
    knowledgeSources: input.knowledgeSources,
    platform: input.platform,
    sourceReferences: references,
    title: record.title,
  })
}

const parseGeneratedJSON = (value: string): unknown => {
  const trimmed = value
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
  try {
    return JSON.parse(trimmed) as unknown
  } catch {
    throw new ContentStudioCommandError(
      'content-studio-ai-invalid-response',
      'The AI response was not a valid structured draft',
      422,
    )
  }
}

const generationFingerprint = (input: ContentStudioGenerationInput): string =>
  createHash('sha256')
    .update(
      JSON.stringify({
        assets: input.assets,
        brief: input.brief,
        contentLocale: input.contentLocale,
        contentType: input.contentType,
        knowledgeSources: input.knowledgeSources,
        platform: input.platform,
      }),
    )
    .digest('hex')

const findExistingGeneratedDraft = async ({
  actorID,
  fingerprint,
  key,
  payload,
  req,
}: {
  actorID: number
  fingerprint: string
  key: string
  payload: ContentStudioPayload
  req: PayloadRequest
}) => {
  const existing = await payload.find({
    collection: 'generated-contents',
    depth: 0,
    limit: 1,
    overrideAccess: false,
    pagination: false,
    req,
    select: {
      createdBy: true,
      creationFingerprint: true,
      id: true,
      status: true,
      title: true,
      updatedAt: true,
    },
    where: { idempotencyKey: { equals: key } },
  })
  const document = existing.docs[0] as LooseRecord | undefined
  if (!document) return null
  if (
    asRelationID(document.createdBy) !== actorID ||
    document.creationFingerprint !== fingerprint
  ) {
    throw new ContentStudioCommandError(
      'content-studio-idempotency-conflict',
      'This generation key belongs to a different draft request',
      409,
    )
  }
  return asContentResult(document)
}

export async function generateContentStudioDraft({
  input: rawInput,
  onProviderDispatch,
  payload,
  req,
  resolveGateway = resolveAiGateway,
}: {
  input: unknown
  onProviderDispatch?: () => void
  payload: ContentStudioPayload
  req: PayloadRequest
  resolveGateway?: ResolveContentStudioGateway
}) {
  const input = parseGenerationInput(rawInput)
  const actorID = asRelationID(req.user)
  if (!actorID) {
    throw new ContentStudioCommandError(
      'content-studio-unauthenticated',
      'Authentication required',
      401,
    )
  }
  const fingerprint = generationFingerprint(input)
  const duplicate = await findExistingGeneratedDraft({
    actorID,
    fingerprint,
    key: input.idempotencyKey,
    payload,
    req,
  })
  if (duplicate) return { content: duplicate, duplicate: true }

  const sources = await generationSources({ ids: input.knowledgeSources, payload, req })
  const sourceContext = sources
    .map(({ content, label }, index) => `SOURCE ${index + 1}: ${label}\n${content.slice(0, 6_000)}`)
    .join('\n\n')
    .slice(0, 18_000)
  let generatedText: string
  try {
    const gateway = await resolveGateway({
      payload: payload as unknown as Payload,
      routes: [{ operation: 'text', usageKey: AI_USAGE_KEYS.chatReply }],
    })
    const result = await gateway.generateText({
      input: `Content brief:\n${input.brief}\n\nApproved sources:\n${sourceContext}`,
      instructions: [
        `Create a ${input.contentType} draft for ${input.platform} in ${input.contentLocale}.`,
        'Use only the approved sources supplied in the request. Do not invent facts or make price, delivery, MOQ, certification, payment, warranty, or legal commitments.',
        'Return JSON only with this exact shape: {"title":"...","body":"...","sourceReferences":[{"claim":"...","source":"..."}]}.',
        `Each source value must be exactly one of: ${sources.map(({ label }) => JSON.stringify(label)).join(', ')}.`,
      ].join('\n'),
      maxOutputTokens: 1_800,
      onDispatch: onProviderDispatch,
      temperature: 0.2,
    })
    generatedText = result.text
  } catch (error) {
    if (error instanceof ContentStudioCommandError) throw error
    throw new ContentStudioCommandError(
      'content-studio-ai-unavailable',
      'AI generation is unavailable. Check the configured text model and retry.',
      503,
    )
  }
  const draft = normalizeGeneratedDraft({
    generated: parseGeneratedJSON(generatedText),
    input,
    sources,
  })
  try {
    const document = await payload.create({
      collection: 'generated-contents',
      context: internalContext,
      data: {
        ...draft,
        createdBy: actorID,
        creationFingerprint: fingerprint,
        idempotencyKey: input.idempotencyKey,
        status: 'draft',
      },
      overrideAccess: false,
      req,
    })
    return { content: asContentResult(document as LooseRecord), duplicate: false }
  } catch (error) {
    const concurrentDuplicate = await findExistingGeneratedDraft({
      actorID,
      fingerprint,
      key: input.idempotencyKey,
      payload,
      req,
    })
    if (concurrentDuplicate) return { content: concurrentDuplicate, duplicate: true }
    throw error
  }
}

export async function createContentStudioDraft({
  input,
  payload,
  req,
}: {
  input: unknown
  payload: ContentStudioPayload
  req: PayloadRequest
}) {
  const record = asRecord(input)
  const draft = parseContentStudioDraft(record)
  const key = idempotencyKey(record.idempotencyKey)
  const actorID = asRelationID(req.user)
  if (!actorID) {
    throw new ContentStudioCommandError(
      'content-studio-unauthenticated',
      'Authentication required',
      401,
    )
  }
  const fingerprint = draftFingerprint(draft)
  const duplicate = await findExistingCreate({ actorID, fingerprint, key, payload, req })
  if (duplicate) return { content: duplicate, duplicate: true }

  try {
    const document = await payload.create({
      collection: 'generated-contents',
      context: internalContext,
      data: {
        ...draft,
        createdBy: actorID,
        creationFingerprint: fingerprint,
        idempotencyKey: key,
        status: 'draft',
      },
      overrideAccess: false,
      req,
    })
    return { content: asContentResult(document as unknown as LooseRecord), duplicate: false }
  } catch (error) {
    const concurrentDuplicate = await findExistingCreate({
      actorID,
      fingerprint,
      key,
      payload,
      req,
    })
    if (concurrentDuplicate) return { content: concurrentDuplicate, duplicate: true }
    throw error
  }
}

export async function updateContentStudioDraft({
  id,
  input,
  payload,
  req,
}: {
  id: number
  input: unknown
  payload: ContentStudioPayload
  req: PayloadRequest
}) {
  const record = asRecord(input)
  const content = await findContent({ id, payload, req })
  assertRevision(content, revision(record.updatedAt))
  if (content.status !== 'draft') {
    throw new ContentStudioCommandError(
      'content-studio-invalid-transition',
      'Only drafts can be edited. Start a new revision after review.',
      409,
    )
  }
  const draft = parseContentStudioDraft(record)
  const document = await payload.update({
    collection: 'generated-contents',
    context: internalContext,
    data: { ...draft, reviewedAt: null, reviewedBy: null, status: 'draft' },
    id,
    overrideAccess: false,
    req,
  })
  return asContentResult(document as unknown as LooseRecord)
}

export async function submitContentStudioReview({
  id,
  input,
  payload,
  req,
}: {
  id: number
  input: unknown
  payload: ContentStudioPayload
  req: PayloadRequest
}) {
  const record = asRecord(input)
  const content = await findContent({ id, payload, req })
  assertRevision(content, revision(record.updatedAt))
  if (content.status !== 'draft') {
    throw new ContentStudioCommandError(
      'content-studio-invalid-transition',
      'Only drafts can enter review',
      409,
    )
  }
  const references = sourceReferences(content.sourceReferences)
  const knowledgeSourceIDs = (
    Array.isArray(content.knowledgeSources)
      ? content.knowledgeSources
      : content.knowledgeSources === undefined || content.knowledgeSources === null
        ? []
        : [content.knowledgeSources]
  ).flatMap((source) => {
    const id = asRelationID(source)
    return id === null ? [] : [id]
  })
  if (knowledgeSourceIDs.length === 0 || references.length === 0) {
    throw new ContentStudioCommandError(
      'content-studio-sources-required',
      'At least one fact source is required before review',
      409,
    )
  }
  const reviewedSources = await generationSources({ ids: knowledgeSourceIDs, payload, req })
  const allowedLabels = new Set(reviewedSources.map(({ label }) => label))
  if (references.some(({ source }) => !allowedLabels.has(source))) {
    throw new ContentStudioCommandError(
      'content-studio-sources-unavailable',
      'Every fact source must reference a selected, reviewed, and indexed knowledge document',
      409,
    )
  }
  const document = await payload.update({
    collection: 'generated-contents',
    context: internalContext,
    data: { status: 'review' },
    id,
    overrideAccess: false,
    req,
  })
  return asContentResult(document as unknown as LooseRecord)
}

const parseReview = (input: unknown) => {
  const record = asRecord(input)
  const checklist = asRecord(record.checklist)
  const required = [
    'factsTraceable',
    'technicalClaimsChecked',
    'noCommercialCommitment',
    'platformFormatChecked',
    'arabicProofread',
  ] as const
  const normalizedChecklist = Object.fromEntries(
    required.map((key) => [key, checklist[key] === true || checklist[key] === 'true']),
  ) as Record<(typeof required)[number], boolean>
  return {
    checklist: normalizedChecklist,
    comments: stringValue(record, 'comments', { max: 5_000 }),
    decision: selected(record.decision, ['approved', 'revision-requested'] as const, 'decision'),
    updatedAt: revision(record.updatedAt),
  }
}

export async function reviewContentStudioDraft({
  id,
  input,
  payload,
  req,
}: {
  id: number
  input: unknown
  payload: ContentStudioPayload
  req: PayloadRequest
}) {
  const review = parseReview(input)
  const content = await findContent({ id, payload, req })
  assertRevision(content, review.updatedAt)
  if (content.status !== 'review') {
    throw new ContentStudioCommandError(
      'content-studio-invalid-transition',
      'Only content in review can be decided',
      409,
    )
  }
  if (review.decision === 'approved' && !Object.values(review.checklist).every(Boolean)) {
    throw new ContentStudioCommandError(
      'content-studio-incomplete-checklist',
      'Every review check is required before approval',
      409,
    )
  }
  await payload.create({
    collection: 'content-reviews',
    context: internalContext,
    data: { ...review, content: id, reviewedBy: req.user?.id },
    overrideAccess: false,
    req,
  })
  const document = await payload.update({
    collection: 'generated-contents',
    context: internalContext,
    data:
      review.decision === 'approved'
        ? { reviewedAt: new Date().toISOString(), reviewedBy: req.user?.id, status: 'approved' }
        : { reviewedAt: null, reviewedBy: null, status: 'draft' },
    id,
    overrideAccess: false,
    req,
  })
  return asContentResult(document as unknown as LooseRecord)
}

const scheduledDate = (value: unknown, now: () => Date): string => {
  if (typeof value !== 'string' || !value.trim()) {
    throw new ContentStudioCommandError(
      'content-studio-invalid-schedule',
      'A schedule time is required',
      400,
    )
  }
  const instant = new Date(value)
  if (Number.isNaN(instant.getTime())) {
    throw new ContentStudioCommandError(
      'content-studio-invalid-schedule',
      'The schedule time is invalid',
      400,
    )
  }
  if (instant.getTime() <= now().getTime()) {
    throw new ContentStudioCommandError(
      'content-studio-invalid-schedule',
      'The schedule time must be in the future',
      400,
    )
  }
  return instant.toISOString()
}

export async function scheduleContentStudioPublication({
  id,
  input,
  now = () => new Date(),
  payload,
  req,
}: {
  id: number
  input: unknown
  now?: () => Date
  payload: ContentStudioPayload
  req: PayloadRequest
}) {
  const record = asRecord(input)
  const content = await findContent({ id, payload, req })
  assertRevision(content, revision(record.updatedAt))
  if (content.status !== 'approved') {
    throw new ContentStudioCommandError(
      'content-studio-not-approved',
      'Only approved content can be scheduled',
      409,
    )
  }
  const platform = selected(
    record.platform ?? content.platform,
    GENERATED_CONTENT_PLATFORMS,
    'platform',
  )
  if (platform !== content.platform) {
    throw new ContentStudioCommandError(
      'content-studio-platform-mismatch',
      'Publication platform must match the approved content',
      400,
    )
  }
  const mode = selected(record.mode, PUBLISH_JOB_MODES, 'mode')
  if (mode === 'automatic') {
    if (process.env.ADMIN_PORTAL_PUBLISHING_ENABLED !== 'true') {
      throw new ContentStudioCommandError(
        'content-studio-publishing-disabled',
        'Automatic publishing is disabled in this environment. Create an internal assisted schedule instead.',
        503,
      )
    }
    throw new ContentStudioCommandError(
      'content-studio-publishing-unavailable',
      'Automatic publishing is not available until a platform adapter is connected.',
      409,
    )
  }
  const key = idempotencyKey(record.idempotencyKey)
  const existing = await payload.find({
    collection: 'publish-jobs',
    depth: 0,
    limit: 1,
    overrideAccess: false,
    req,
    where: { idempotencyKey: { equals: key } },
  })
  if (existing.docs[0]) {
    const found = existing.docs[0] as unknown as LooseRecord
    if (asRelationID(found.content) !== id) {
      throw new ContentStudioCommandError(
        'content-studio-idempotency-conflict',
        'This command key belongs to another publication',
        409,
      )
    }
    return { duplicate: true, job: safeJob(found) }
  }
  const job = await payload.create({
    collection: 'publish-jobs',
    context: internalContext,
    data: {
      content: id,
      createdBy: req.user?.id,
      executionRevision: 0,
      fencingGeneration: 0,
      idempotencyKey: key,
      mode,
      platform,
      platformAccount: optionalPositiveID(record.platformAccountId, 'platformAccountId'),
      scheduledFor: scheduledDate(record.scheduledFor, now),
      status: 'scheduled',
    },
    overrideAccess: false,
    req,
  })
  const safe = safeJob(job as unknown as LooseRecord)
  await payload.create({
    collection: 'publish-logs',
    context: internalContext,
    data: {
      actor: req.user?.id,
      event: 'scheduled',
      publishJob: safe.id,
      summary: 'Internal publication task scheduled. No platform request has been sent.',
    },
    overrideAccess: false,
    req,
  })
  return { duplicate: false, job: safe }
}

const safeJob = (job: LooseRecord) => ({
  id: job.id as number,
  mode: (typeof job.mode === 'string' ? job.mode : 'assisted') as PublishJobMode,
  platform: (typeof job.platform === 'string' ? job.platform : 'linkedin') as ContentStudioPlatform,
  scheduledFor: typeof job.scheduledFor === 'string' ? job.scheduledFor : '',
  status: (typeof job.status === 'string' ? job.status : 'scheduled') as PublishJobStatus,
  updatedAt: typeof job.updatedAt === 'string' ? job.updatedAt : '',
})

export async function deleteContentStudioDraft({
  id,
  input,
  payload,
  req,
}: {
  id: number
  input: unknown
  payload: ContentStudioPayload
  req: PayloadRequest
}) {
  const record = asRecord(input)
  const content = await findContent({ id, payload, req })
  assertRevision(content, revision(record.updatedAt))
  if (content.status !== 'draft') {
    throw new ContentStudioCommandError(
      'content-studio-delete-restricted',
      'Only an unreviewed draft can be deleted. Keep reviewed and scheduled records for audit history.',
      409,
    )
  }
  const jobs = await payload.find({
    collection: 'publish-jobs',
    depth: 0,
    limit: 100,
    overrideAccess: false,
    pagination: false,
    req,
    where: { content: { equals: id } },
  })
  if (jobs.docs.length > 0) {
    throw new ContentStudioCommandError(
      'content-studio-delete-restricted',
      'A scheduled publication exists for this draft. Preserve the publication history instead of deleting it.',
      409,
    )
  }
  const reviews = await payload.find({
    collection: 'content-reviews',
    depth: 0,
    limit: 1,
    overrideAccess: false,
    pagination: false,
    req,
    where: { content: { equals: id } },
  })
  if (reviews.docs.length > 0) {
    throw new ContentStudioCommandError(
      'content-studio-delete-restricted',
      'This draft has review history. Preserve that audit record instead of deleting it.',
      409,
    )
  }
  await payload.delete({
    collection: 'generated-contents',
    context: internalContext,
    id,
    overrideAccess: false,
    req,
  })
  return { id, deleted: true }
}

export const createContentStudioIdempotencyKey = (): string =>
  `portal-content-studio:${randomUUID()}`
