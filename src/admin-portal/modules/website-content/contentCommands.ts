import type { Payload, PayloadRequest } from 'payload'

import {
  CONTENT_TYPE_IDS,
  type ContentItemStatus,
  type ContentLocale,
  type ContentTypeId,
} from './getContentSummary'

export const CONTENT_MUTATION_ACTIONS = [
  'save',
  'save-draft',
  'publish',
  'unpublish',
  'activate',
  'deactivate',
] as const

export type ContentMutationAction = (typeof CONTENT_MUTATION_ACTIONS)[number]

type LooseRecord = Record<string, unknown>

export interface ContentCommandPayload {
  count?: (args: LooseRecord) => Promise<{ totalDocs: number }>
  create?: (args: LooseRecord) => Promise<LooseRecord>
  delete?: (args: LooseRecord) => Promise<LooseRecord>
  find?: (args: LooseRecord) => Promise<{ docs: LooseRecord[] }>
  findByID?: (args: LooseRecord) => Promise<LooseRecord>
  findGlobal?: (args: LooseRecord) => Promise<LooseRecord>
  update?: (args: LooseRecord) => Promise<LooseRecord>
}

type ContentCommandPayloadLike = ContentCommandPayload | Payload

export interface ParsedContentMutation {
  action: ContentMutationAction
  data: LooseRecord
  locale: ContentLocale
  updatedAt: null | string
}

export interface ContentCommandResult {
  id: number | string
  slug: string
  status: ContentItemStatus
  title: string
  updatedAt: string
}

export interface ContentEditorOption {
  id: number | string
  label: string
  meta?: string
  previewUrl?: string
}

export interface ContentEditorRecord {
  data: LooseRecord
  id: number | string
  locale: ContentLocale
  status: ContentItemStatus
  type: ContentTypeId
  updatedAt: string
}

export class ContentCommandError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'ContentCommandError'
  }
}

const VERSIONED_TYPES = new Set<ContentTypeId>(['pages', 'posts', 'products', 'projects'])
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const POST_CATEGORIES = new Set(['industry', 'products', 'projects', 'company'])
const DOWNLOAD_TYPES = new Set(['catalog', 'technical-data', 'certificate', 'other'])

const asRecord = (input: unknown): LooseRecord =>
  input && typeof input === 'object' && !Array.isArray(input) ? (input as LooseRecord) : {}

const stringValue = (
  input: LooseRecord,
  key: string,
  { max = 5000, required = false }: { max?: number; required?: boolean } = {},
): string => {
  const raw = input[key]
  if (raw === undefined || raw === null) {
    if (required) throw new ContentCommandError('content-invalid-input', `${key} is required`, 400)
    return ''
  }
  if (typeof raw !== 'string') {
    throw new ContentCommandError('content-invalid-input', `${key} must be a string`, 400)
  }
  const value = raw.trim()
  if (required && !value) {
    throw new ContentCommandError('content-invalid-input', `${key} is required`, 400)
  }
  if (value.length > max) {
    throw new ContentCommandError('content-invalid-input', `${key} is too long`, 400)
  }
  return value
}

const optionalString = (input: LooseRecord, key: string, max = 5000): null | string => {
  const value = stringValue(input, key, { max })
  return value || null
}

const booleanValue = (input: LooseRecord, key: string, fallback = false): boolean => {
  const raw = input[key]
  if (raw === undefined || raw === null || raw === '') return fallback
  if (raw === true || raw === 'true' || raw === 1 || raw === '1') return true
  if (raw === false || raw === 'false' || raw === 0 || raw === '0') return false
  throw new ContentCommandError('content-invalid-input', `${key} must be a boolean`, 400)
}

const numericValue = (
  input: LooseRecord,
  key: string,
  { required = false }: { required?: boolean } = {},
): null | number => {
  const raw = input[key]
  if (raw === undefined || raw === null || raw === '') {
    if (required) throw new ContentCommandError('content-invalid-input', `${key} is required`, 400)
    return null
  }
  try {
    return positiveID(raw)
  } catch {
    throw new ContentCommandError('content-invalid-input', `${key} must be a positive id`, 400)
  }
}

const positiveID = (raw: unknown): number => {
  const value =
    typeof raw === 'number'
      ? raw
      : typeof raw === 'string' && /^[1-9]\d*$/.test(raw)
        ? Number(raw)
        : Number.NaN
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new ContentCommandError('content-invalid-input', 'A positive numeric id is required', 400)
  }
  return value
}

const numericList = (input: LooseRecord, key: string, max = 12): number[] => {
  const raw = input[key]
  const values = Array.isArray(raw)
    ? raw
    : typeof raw === 'string'
      ? raw.split(',').map((value) => value.trim())
      : raw === undefined || raw === null
        ? []
        : [raw]

  const result = values
    .filter((value) => value !== '')
    .map((value) => {
      try {
        return positiveID(value)
      } catch {
        throw new ContentCommandError('content-invalid-input', `${key} contains an invalid id`, 400)
      }
    })
  if (result.length > max) {
    throw new ContentCommandError('content-invalid-input', `${key} contains too many items`, 400)
  }
  return [...new Set(result)]
}

const localeValue = (input: LooseRecord): ContentLocale => {
  if (input.locale === 'en' || input.locale === 'ar') return input.locale
  throw new ContentCommandError('content-invalid-locale', 'locale must be en or ar', 400)
}

const actionValue = (type: ContentTypeId, input: LooseRecord): ContentMutationAction => {
  const fallback: ContentMutationAction = VERSIONED_TYPES.has(type) ? 'save-draft' : 'save'
  const action = input.action ?? fallback
  if (!CONTENT_MUTATION_ACTIONS.includes(action as ContentMutationAction)) {
    throw new ContentCommandError('content-invalid-action', 'Unsupported content action', 400)
  }
  const normalized = action as ContentMutationAction
  if (VERSIONED_TYPES.has(type) && !['save-draft', 'publish', 'unpublish'].includes(normalized)) {
    throw new ContentCommandError(
      'content-invalid-action',
      'Versioned content uses draft or publish actions',
      400,
    )
  }
  if (type === 'downloads' && !['save', 'activate', 'deactivate'].includes(normalized)) {
    throw new ContentCommandError(
      'content-invalid-action',
      'Downloads use save, activate, or deactivate',
      400,
    )
  }
  if (type === 'product-categories' && normalized !== 'save') {
    throw new ContentCommandError('content-invalid-action', 'Categories are always visible', 400)
  }
  return normalized
}

const relationID = (value: unknown): null | number => {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value
  if (value && typeof value === 'object') {
    const id = (value as { id?: unknown }).id
    if (typeof id === 'number' && Number.isSafeInteger(id)) return id
  }
  return null
}

export const buildPlainRichText = (text: string, locale: ContentLocale): LooseRecord => ({
  root: {
    children: text
      .split(/\n{2,}/)
      .map((paragraph) => paragraph.trim())
      .filter(Boolean)
      .map((paragraph) => ({
        children: [
          {
            detail: 0,
            format: 0,
            mode: 'normal',
            style: '',
            text: paragraph,
            type: 'text',
            version: 1,
          },
        ],
        direction: locale === 'ar' ? 'rtl' : 'ltr',
        format: '',
        indent: 0,
        textFormat: 0,
        textStyle: '',
        type: 'paragraph',
        version: 1,
      })),
    direction: locale === 'ar' ? 'rtl' : 'ltr',
    format: '',
    indent: 0,
    type: 'root',
    version: 1,
  },
})

export const richTextToPlainText = (value: unknown): string => {
  const texts: string[] = []
  const visit = (node: unknown) => {
    if (Array.isArray(node)) {
      node.forEach(visit)
      return
    }
    if (!node || typeof node !== 'object') return
    const record = node as LooseRecord
    if (typeof record.text === 'string' && record.text.trim()) texts.push(record.text.trim())
    if (Array.isArray(record.children)) {
      const before = texts.length
      record.children.forEach(visit)
      if (before !== texts.length && record.type === 'paragraph') texts.push('\n')
    }
    if (record.root) visit(record.root)
  }
  visit(value)
  return texts
    .join(' ')
    .replace(/\s+\n\s+/g, '\n\n')
    .replace(/\s+/g, ' ')
    .trim()
}

const commonData = (input: LooseRecord) => {
  const slug = stringValue(input, 'slug', { max: 120, required: true })
  if (!SLUG_PATTERN.test(slug)) {
    throw new ContentCommandError(
      'content-invalid-slug',
      'Slug must use lowercase Latin letters, numbers, and single hyphens',
      400,
    )
  }
  return {
    generateSlug: false,
    seo: {
      canonical: optionalString(input, 'seoCanonical', 500),
      description: optionalString(input, 'seoDescription', 180),
      keywords: optionalString(input, 'seoKeywords', 1000),
      noIndex: booleanValue(input, 'seoNoIndex', false),
      ogImage: numericValue(input, 'seoOgImageId'),
      title: optionalString(input, 'seoTitle', 70),
    },
    slug,
    title: stringValue(input, 'title', { max: 200, required: true }),
  }
}

export const parseContentType = (value: unknown): ContentTypeId => {
  if (typeof value === 'string' && CONTENT_TYPE_IDS.includes(value as ContentTypeId)) {
    return value as ContentTypeId
  }
  throw new ContentCommandError('content-invalid-type', 'Unsupported content type', 404)
}

export function parseContentMutation(
  type: ContentTypeId,
  rawInput: unknown,
): ParsedContentMutation {
  const input = asRecord(rawInput)
  const locale = localeValue(input)
  const action = actionValue(type, input)
  const common = commonData(input)
  let data: LooseRecord

  switch (type) {
    case 'pages': {
      const bodyText = stringValue(input, 'bodyText', { max: 80_000 })
      data = {
        ...common,
        body: bodyText ? buildPlainRichText(bodyText, locale) : null,
        heroImage: numericValue(input, 'heroImageId'),
        internalNotes: optionalString(input, 'internalNotes', 5000),
        summary: optionalString(input, 'summary', 1000),
      }
      break
    }
    case 'products': {
      const bodyText = stringValue(input, 'bodyText', { max: 80_000 })
      const specifications = Array.isArray(input.specifications)
        ? input.specifications.slice(0, 50).map((item) => {
            const record = asRecord(item)
            return {
              ...(typeof record.id === 'string' ? { id: record.id } : {}),
              label: stringValue(record, 'label', { max: 200, required: true }),
              value: stringValue(record, 'value', { max: 500, required: true }),
            }
          })
        : []
      data = {
        ...common,
        category: numericValue(input, 'categoryId', { required: true }),
        coverImage: numericValue(input, 'coverImageId', { required: true }),
        description: bodyText ? buildPlainRichText(bodyText, locale) : null,
        gallery: numericList(input, 'galleryIds'),
        internalNotes: optionalString(input, 'internalNotes', 5000),
        shortDescription: optionalString(input, 'shortDescription', 1000),
        specifications,
      }
      break
    }
    case 'product-categories':
      data = {
        ...common,
        description: optionalString(input, 'description', 5000),
        sortOrder: Math.max(0, Number.parseInt(String(input.sortOrder ?? 0), 10) || 0),
      }
      break
    case 'projects': {
      const bodyText = stringValue(input, 'bodyText', { max: 80_000 })
      data = {
        ...common,
        application: optionalString(input, 'application', 500),
        coverImage: numericValue(input, 'coverImageId', { required: true }),
        description: bodyText ? buildPlainRichText(bodyText, locale) : null,
        gallery: numericList(input, 'galleryIds'),
        internalNotes: optionalString(input, 'internalNotes', 5000),
        location: optionalString(input, 'location', 500),
        summary: optionalString(input, 'summary', 1000),
      }
      break
    }
    case 'posts': {
      const bodyText = stringValue(input, 'bodyText', { max: 80_000 })
      const category = stringValue(input, 'category', { max: 40, required: true })
      if (!POST_CATEGORIES.has(category)) {
        throw new ContentCommandError('content-invalid-input', 'Invalid post category', 400)
      }
      data = {
        ...common,
        category,
        content: bodyText ? buildPlainRichText(bodyText, locale) : null,
        excerpt: optionalString(input, 'excerpt', 1000),
        featuredImage: numericValue(input, 'featuredImageId'),
        internalNotes: optionalString(input, 'internalNotes', 5000),
        publishedAt: optionalString(input, 'publishedAt', 100),
      }
      break
    }
    case 'downloads': {
      const downloadType = stringValue(input, 'downloadType', { max: 40, required: true })
      if (!DOWNLOAD_TYPES.has(downloadType)) {
        throw new ContentCommandError('content-invalid-input', 'Invalid download type', 400)
      }
      data = {
        ...common,
        coverImage: numericValue(input, 'coverImageId'),
        description: optionalString(input, 'description', 5000),
        file: numericValue(input, 'fileId', { required: true }),
        isActive:
          action === 'activate'
            ? true
            : action === 'deactivate'
              ? false
              : booleanValue(input, 'isActive', true),
        type: downloadType,
      }
      break
    }
  }

  if (VERSIONED_TYPES.has(type)) {
    data._status = action === 'publish' ? 'published' : 'draft'
  }

  return {
    action,
    data,
    locale,
    updatedAt: optionalString(input, 'updatedAt', 100),
  }
}

const statusFromDocument = (type: ContentTypeId, document: LooseRecord): ContentItemStatus => {
  if (VERSIONED_TYPES.has(type)) {
    if (document._status === 'published') return 'published'
    return document.hasBeenPublished === true ? 'unpublished' : 'draft'
  }
  if (type === 'downloads') return document.isActive === false ? 'inactive' : 'active'
  return 'always-visible'
}

const toResult = (type: ContentTypeId, document: LooseRecord): ContentCommandResult => ({
  id: document.id as number | string,
  slug: typeof document.slug === 'string' ? document.slug : '',
  status: statusFromDocument(type, document),
  title: typeof document.title === 'string' ? document.title : '',
  updatedAt: typeof document.updatedAt === 'string' ? document.updatedAt : '',
})

const requireMethod = <T extends keyof ContentCommandPayload>(
  payload: ContentCommandPayloadLike,
  method: T,
): NonNullable<ContentCommandPayload[T]> => {
  const port = payload as ContentCommandPayload
  const value = port[method]
  if (!value)
    throw new ContentCommandError('content-command-unavailable', 'Content command unavailable', 500)
  return value.bind(payload) as NonNullable<ContentCommandPayload[T]>
}

const assertCurrentRevision = (document: LooseRecord, expected: null | string) => {
  if (!expected || typeof document.updatedAt !== 'string' || document.updatedAt !== expected) {
    throw new ContentCommandError(
      'content-stale',
      'This content changed after the editor was opened. Reload before saving.',
      409,
    )
  }
}

const assertPageIsNotInNavigation = async ({
  id,
  payload,
  req,
}: {
  id: number | string
  payload: ContentCommandPayloadLike
  req: PayloadRequest
}) => {
  const findGlobal = requireMethod(payload, 'findGlobal')
  const settings = await findGlobal({
    depth: 0,
    fallbackLocale: false,
    locale: 'en',
    overrideAccess: false,
    req,
    slug: 'site-settings',
  })
  const navigation = Array.isArray(settings.navigation) ? settings.navigation : []
  const referenced = navigation.some((item) => {
    const record = asRecord(item)
    return String(relationID(record.page)) === String(id)
  })
  if (referenced) {
    throw new ContentCommandError(
      'content-in-use',
      'This page is still referenced by site navigation',
      409,
    )
  }
}

const hasText = (value: unknown): boolean =>
  typeof value === 'string' ? Boolean(value.trim()) : Boolean(value)

const assertPublishable = (type: ContentTypeId, data: LooseRecord) => {
  const seo = asRecord(data.seo)
  const required: Array<[string, unknown]> = [
    ['title', data.title],
    ['slug', data.slug],
    ['seo.title', seo.title],
    ['seo.description', seo.description],
  ]
  if (type === 'pages')
    required.push(['summary', data.summary], ['body', data.body], ['heroImage', data.heroImage])
  if (type === 'products') {
    required.push(
      ['shortDescription', data.shortDescription],
      ['description', data.description],
      ['category', data.category],
      ['coverImage', data.coverImage],
    )
  }
  if (type === 'projects') {
    required.push(
      ['summary', data.summary],
      ['description', data.description],
      ['location', data.location],
      ['application', data.application],
      ['coverImage', data.coverImage],
    )
  }
  if (type === 'posts') required.push(['excerpt', data.excerpt], ['content', data.content])

  const missing = required.filter(([, value]) => !hasText(value)).map(([field]) => field)
  if (missing.length) {
    throw new ContentCommandError(
      'content-incomplete',
      `Complete required publish fields: ${missing.join(', ')}`,
      422,
    )
  }
}

type MediaReference = { field: string; id: number; requiresImage: boolean }

const contentMediaReferences = (type: ContentTypeId, data: LooseRecord): MediaReference[] => {
  const references: MediaReference[] = []
  const add = (field: string, value: unknown, requiresImage: boolean) => {
    if (typeof value === 'number' && Number.isSafeInteger(value)) {
      references.push({ field, id: value, requiresImage })
    }
  }
  const seo = asRecord(data.seo)

  add('seo.ogImage', seo.ogImage, true)
  if (type === 'pages') add('heroImage', data.heroImage, true)
  if (type === 'products' || type === 'projects') {
    add('coverImage', data.coverImage, true)
    if (Array.isArray(data.gallery)) {
      data.gallery.forEach((id, index) => add(`gallery.${index}`, id, true))
    }
  }
  if (type === 'posts') add('featuredImage', data.featuredImage, true)
  if (type === 'downloads') {
    add('coverImage', data.coverImage, true)
    add('file', data.file, false)
  }
  return references
}

const assertContentMediaReferences = async ({
  data,
  payload,
  req,
  type,
}: {
  data: LooseRecord
  payload: ContentCommandPayloadLike
  req: PayloadRequest
  type: ContentTypeId
}) => {
  const references = contentMediaReferences(type, data)
  if (!references.length) return

  const find = requireMethod(payload, 'find')
  const media = await find({
    collection: 'media',
    depth: 0,
    limit: references.length,
    overrideAccess: false,
    pagination: false,
    req,
    select: { id: true, mimeType: true },
    where: { id: { in: [...new Set(references.map(({ id }) => id))] } },
  })
  const mimeTypeByID = new Map(
    media.docs.map((document) => [
      relationID(document.id),
      typeof document.mimeType === 'string' ? document.mimeType : '',
    ]),
  )

  for (const reference of references) {
    const mimeType = mimeTypeByID.get(reference.id)
    if (mimeType === undefined) {
      throw new ContentCommandError(
        'content-media-not-found',
        `${reference.field} references unavailable media`,
        400,
      )
    }
    if (reference.requiresImage && !mimeType.startsWith('image/')) {
      throw new ContentCommandError(
        'content-media-image-required',
        `${reference.field} must reference an image`,
        400,
      )
    }
  }
}

const writeOptions = (
  type: ContentTypeId,
  mutation: ParsedContentMutation,
  req: PayloadRequest,
) => ({
  ...(VERSIONED_TYPES.has(type) ? { draft: mutation.action === 'save-draft' } : {}),
  context: { skipAudit: true },
  fallbackLocale: false,
  locale: mutation.locale,
  overrideAccess: false,
  overrideLock: false,
  req,
})

const writePortalContentAudit = async ({
  action,
  documentId,
  payload,
  req,
  type,
}: {
  action: 'create' | 'delete' | 'update'
  documentId: number | string
  payload: ContentCommandPayloadLike
  req: PayloadRequest
  type: ContentTypeId
}) => {
  const create = requireMethod(payload, 'create')
  await create({
    collection: 'audit-logs',
    context: { skipAudit: true },
    data: {
      action,
      actor: req.user?.id,
      documentId: String(documentId),
      resource: type,
    },
    overrideAccess: true,
    req,
  })
}

export async function createPortalContent({
  input,
  payload,
  req,
  type,
}: {
  input: unknown
  payload: ContentCommandPayloadLike
  req: PayloadRequest
  type: ContentTypeId
}): Promise<ContentCommandResult> {
  const mutation = parseContentMutation(type, input)
  if (mutation.action === 'unpublish') {
    throw new ContentCommandError(
      'content-invalid-action',
      'New content cannot start in the unpublished state',
      409,
    )
  }
  if (mutation.action === 'publish') assertPublishable(type, mutation.data)

  const find = requireMethod(payload, 'find')
  const existing = await find({
    collection: type,
    depth: 0,
    fallbackLocale: false,
    limit: 1,
    locale: mutation.locale,
    overrideAccess: false,
    pagination: false,
    req,
    select: { id: true, slug: true, title: true, updatedAt: true },
    where: { slug: { equals: mutation.data.slug } },
  })
  if (existing.docs.length) {
    throw new ContentCommandError(
      'content-slug-conflict',
      'A record with this slug already exists',
      409,
    )
  }

  await assertContentMediaReferences({ data: mutation.data, payload, req, type })

  const create = requireMethod(payload, 'create')
  const document = await create({
    collection: type,
    data: mutation.data,
    ...writeOptions(type, mutation, req),
  })
  await writePortalContentAudit({
    action: 'create',
    documentId: document.id as number | string,
    payload,
    req,
    type,
  })
  return toResult(type, document)
}

export async function updatePortalContent({
  id,
  input,
  now = () => new Date(),
  payload,
  req,
  type,
}: {
  id: number | string
  input: unknown
  now?: () => Date
  payload: ContentCommandPayloadLike
  req: PayloadRequest
  type: ContentTypeId
}): Promise<ContentCommandResult> {
  const mutation = parseContentMutation(type, input)
  const findByID = requireMethod(payload, 'findByID')
  const current = await findByID({
    collection: type,
    depth: 0,
    draft: VERSIONED_TYPES.has(type),
    fallbackLocale: false,
    id,
    locale: mutation.locale,
    overrideAccess: false,
    req,
  })
  assertCurrentRevision(current, mutation.updatedAt)
  const hasBeenPublished = current.hasBeenPublished === true || current._status === 'published'
  if (VERSIONED_TYPES.has(type) && hasBeenPublished && mutation.action === 'save-draft') {
    throw new ContentCommandError(
      'content-invalid-action',
      'Published content can only remain published or become unpublished',
      409,
    )
  }
  if (VERSIONED_TYPES.has(type) && !hasBeenPublished && mutation.action === 'unpublish') {
    throw new ContentCommandError(
      'content-invalid-action',
      'Draft content cannot be unpublished before its first publication',
      409,
    )
  }
  if (mutation.action === 'publish') assertPublishable(type, mutation.data)
  await assertContentMediaReferences({ data: mutation.data, payload, req, type })

  if (type === 'posts' && mutation.action === 'publish' && !mutation.data.publishedAt) {
    mutation.data.publishedAt = now().toISOString()
  }
  const update = requireMethod(payload, 'update')
  const document = await update({
    collection: type,
    data: mutation.data,
    id,
    ...writeOptions(type, mutation, req),
  })
  await writePortalContentAudit({
    action: 'update',
    documentId: document.id as number | string,
    payload,
    req,
    type,
  })
  return toResult(type, document)
}

export async function deletePortalContent({
  id,
  payload,
  req,
  type,
  updatedAt,
  locale,
}: {
  id: number | string
  payload: ContentCommandPayloadLike
  req: PayloadRequest
  type: ContentTypeId
  updatedAt: string
  locale: ContentLocale
}): Promise<ContentCommandResult> {
  const findByID = requireMethod(payload, 'findByID')
  const current = await findByID({
    collection: type,
    depth: 0,
    draft: VERSIONED_TYPES.has(type),
    fallbackLocale: false,
    id,
    locale,
    overrideAccess: false,
    req,
  })
  assertCurrentRevision(current, updatedAt)

  if (type === 'product-categories') {
    const count = requireMethod(payload, 'count')
    const references = await count({
      collection: 'products',
      overrideAccess: false,
      req,
      where: { category: { equals: id } },
    })
    if (references.totalDocs > 0) {
      throw new ContentCommandError(
        'content-in-use',
        'This category is still referenced by products',
        409,
      )
    }
  }

  if (type === 'pages') {
    await assertPageIsNotInNavigation({ id, payload, req })
  }

  const deleteDocument = requireMethod(payload, 'delete')
  const document = await deleteDocument({
    collection: type,
    context: { skipAudit: true },
    id,
    overrideAccess: false,
    overrideLock: false,
    req,
  })
  await writePortalContentAudit({
    action: 'delete',
    documentId: document.id as number | string,
    payload,
    req,
    type,
  })
  return toResult(type, document)
}

const editorDataFor = (type: ContentTypeId, document: LooseRecord): LooseRecord => {
  const seo = asRecord(document.seo)
  const common = {
    seoCanonical: seo.canonical ?? '',
    seoDescription: seo.description ?? '',
    seoKeywords: seo.keywords ?? '',
    seoNoIndex: seo.noIndex ?? false,
    seoOgImageId: relationID(seo.ogImage),
    seoTitle: seo.title ?? '',
    slug: document.slug ?? '',
    title: document.title ?? '',
  }
  switch (type) {
    case 'pages':
      return {
        ...common,
        bodyText: richTextToPlainText(document.body),
        heroImageId: relationID(document.heroImage),
        internalNotes: document.internalNotes ?? '',
        summary: document.summary ?? '',
      }
    case 'products':
      return {
        ...common,
        bodyText: richTextToPlainText(document.description),
        categoryId: relationID(document.category),
        coverImageId: relationID(document.coverImage),
        galleryIds: Array.isArray(document.gallery)
          ? document.gallery.map(relationID).filter(Boolean)
          : [],
        internalNotes: document.internalNotes ?? '',
        shortDescription: document.shortDescription ?? '',
        specifications: Array.isArray(document.specifications) ? document.specifications : [],
      }
    case 'product-categories':
      return {
        ...common,
        description: document.description ?? '',
        sortOrder: document.sortOrder ?? 0,
      }
    case 'projects':
      return {
        ...common,
        application: document.application ?? '',
        bodyText: richTextToPlainText(document.description),
        coverImageId: relationID(document.coverImage),
        galleryIds: Array.isArray(document.gallery)
          ? document.gallery.map(relationID).filter(Boolean)
          : [],
        internalNotes: document.internalNotes ?? '',
        location: document.location ?? '',
        summary: document.summary ?? '',
      }
    case 'posts':
      return {
        ...common,
        bodyText: richTextToPlainText(document.content),
        category: document.category ?? 'industry',
        excerpt: document.excerpt ?? '',
        featuredImageId: relationID(document.featuredImage),
        internalNotes: document.internalNotes ?? '',
        publishedAt: document.publishedAt ?? '',
      }
    case 'downloads':
      return {
        ...common,
        coverImageId: relationID(document.coverImage),
        description: document.description ?? '',
        downloadType: document.type ?? 'other',
        fileId: relationID(document.file),
        isActive: document.isActive !== false,
      }
  }
}

const LOCALIZED_EDITOR_FIELDS: Record<ContentTypeId, readonly string[]> = {
  downloads: ['description', 'title'],
  pages: ['body', 'summary', 'title'],
  posts: ['content', 'excerpt', 'title'],
  'product-categories': ['description', 'title'],
  products: ['description', 'shortDescription', 'title'],
  projects: ['application', 'description', 'location', 'summary', 'title'],
}

const valueForLocale = (value: unknown, locale: ContentLocale): unknown => {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const localized = value as LooseRecord
    if (Object.hasOwn(localized, 'ar') || Object.hasOwn(localized, 'en')) {
      return localized[locale]
    }
  }
  return value
}

const editorDocumentForLocale = (
  type: ContentTypeId,
  document: LooseRecord,
  locale: ContentLocale,
): LooseRecord => {
  const localized = { ...document }
  for (const field of LOCALIZED_EDITOR_FIELDS[type]) {
    localized[field] = valueForLocale(document[field], locale)
  }

  const seo = asRecord(document.seo)
  localized.seo = {
    ...seo,
    canonical: valueForLocale(seo.canonical, locale),
    description: valueForLocale(seo.description, locale),
    keywords: valueForLocale(seo.keywords, locale),
    title: valueForLocale(seo.title, locale),
  }

  if (type === 'products' && Array.isArray(document.specifications)) {
    localized.specifications = document.specifications.map((item) => {
      const specification = asRecord(item)
      return {
        ...specification,
        label: valueForLocale(specification.label, locale),
        value: valueForLocale(specification.value, locale),
      }
    })
  }

  return localized
}

export async function getPortalContentEditor({
  id,
  locale,
  payload,
  req,
  type,
}: {
  id: number | string
  locale: ContentLocale
  payload: ContentCommandPayloadLike
  req: PayloadRequest
  type: ContentTypeId
}): Promise<ContentEditorRecord> {
  const find = requireMethod(payload, 'find')
  // Payload Local API mutates req.locale, so this read must not share state with option queries.
  const editorReq = {
    ...req,
    context: { ...req.context },
    query: { ...req.query },
  } as PayloadRequest
  const result = await find({
    collection: type,
    depth: 1,
    draft: VERSIONED_TYPES.has(type),
    fallbackLocale: false,
    limit: 1,
    locale: 'all',
    overrideAccess: false,
    pagination: false,
    req: editorReq,
    where: { id: { equals: id } },
  })
  const document = result.docs[0]
  if (!document) {
    throw new ContentCommandError('content-invalid-id', 'The selected content is unavailable', 404)
  }
  const editorDocument = editorDocumentForLocale(type, document, locale)
  return {
    data: editorDataFor(type, editorDocument),
    id,
    locale,
    status: statusFromDocument(type, document),
    type,
    updatedAt: typeof document.updatedAt === 'string' ? document.updatedAt : '',
  }
}

export async function getPortalContentOptions({
  payload,
  req,
}: {
  payload: ContentCommandPayloadLike
  req: PayloadRequest
}): Promise<{ categories: ContentEditorOption[]; media: ContentEditorOption[] }> {
  const find = requireMethod(payload, 'find')
  const [categories, media] = await Promise.all([
    find({
      collection: 'product-categories',
      depth: 0,
      fallbackLocale: false,
      limit: 100,
      locale: 'en',
      overrideAccess: false,
      pagination: false,
      req,
      select: { id: true, slug: true, title: true },
      sort: 'sortOrder',
    }),
    find({
      collection: 'media',
      depth: 0,
      limit: 200,
      overrideAccess: false,
      pagination: false,
      req,
      select: {
        alt: true,
        filename: true,
        id: true,
        mimeType: true,
        sizes: { card: { url: true }, thumbnail: { url: true } },
        thumbnailURL: true,
        url: true,
      },
      sort: '-updatedAt',
    }),
  ])
  return {
    categories: categories.docs.map((document) => ({
      id: document.id as number | string,
      label:
        typeof document.title === 'string'
          ? document.title
          : typeof document.slug === 'string'
            ? document.slug
            : String(document.id),
    })),
    media: media.docs.map((document) => {
      const sizes = asRecord(document.sizes)
      const card = asRecord(sizes.card)
      const thumbnail = asRecord(sizes.thumbnail)
      const safeURL = (value: unknown): string | undefined => {
        if (typeof value !== 'string' || !value || value.includes('\\')) return undefined
        if (value.startsWith('/') && !value.startsWith('//')) return value
        try {
          const url = new URL(value)
          return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : undefined
        } catch {
          return undefined
        }
      }
      const mimeType = typeof document.mimeType === 'string' ? document.mimeType : undefined
      const previewUrl = mimeType?.startsWith('image/')
        ? (safeURL(card.url) ??
          safeURL(thumbnail.url) ??
          safeURL(document.thumbnailURL) ??
          safeURL(document.url))
        : undefined

      return {
        id: document.id as number | string,
        label:
          typeof document.filename === 'string'
            ? document.filename
            : typeof document.alt === 'string'
              ? document.alt
              : String(document.id),
        meta: mimeType,
        previewUrl,
      }
    }),
  }
}
