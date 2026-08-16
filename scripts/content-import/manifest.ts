import { createHash } from 'node:crypto'
import { realpath, readFile } from 'node:fs/promises'
import path from 'node:path'

import type {
  BatchManifest,
  ContentManifestItem,
  LocalizedPair,
  LocalizedStringPair,
  LocalizedText,
  MediaManifest,
  SpecificationManifest,
} from './types'

const MAX_STRING = 12_000
const MAX_ITEMS = 2_000
const MAX_MEDIA_PER_ITEM = 64
const MAX_MEDIA_BYTES = 8 * 1024 * 1024
const ALLOWED_MEDIA_TYPES = new Set(['image/avif', 'image/jpeg', 'image/png', 'image/webp'])
const SHA256 = /^[a-f0-9]{64}$/
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export class ManifestValidationError extends Error {
  readonly code = 'manifest-invalid'

  constructor(message: string) {
    super(message)
    this.name = 'ManifestValidationError'
  }
}

const fail = (message: string): never => {
  throw new ManifestValidationError(message)
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const stringValue = (value: unknown, name: string, options?: { max?: number }): string => {
  if (typeof value !== 'string' || value.trim() === '')
    throw new ManifestValidationError(`${name} is required`)
  const normalized = value.trim()
  if (normalized.length > (options?.max ?? MAX_STRING)) fail(`${name} is too long`)
  return normalized
}

const optionalString = (
  value: unknown,
  name: string,
  options?: { max?: number },
): string | undefined => {
  if (value === undefined || value === null || value === '') return undefined
  return stringValue(value, name, options)
}

const slugValue = (value: unknown, name: string): string => {
  const slug = stringValue(value, name, { max: 160 })
  if (!SLUG.test(slug)) fail(`${name} must be a lowercase slug`)
  return slug
}

const localizedText = (value: unknown, name: string): LocalizedText => {
  const record = isRecord(value) ? value : fail(`${name} must be an object`)
  const seo = record.seo
  const seoRecord = isRecord(seo) ? seo : fail(`${name}.seo is required`)
  const description = record.description
  if (description !== undefined && typeof description !== 'string' && !isRecord(description)) {
    fail(`${name}.description must be text or rich text`)
  }
  return {
    title: stringValue(record.title, `${name}.title`),
    shortDescription: optionalString(record.shortDescription, `${name}.shortDescription`),
    summary: optionalString(record.summary, `${name}.summary`),
    description: description as string | Record<string, unknown> | undefined,
    location: optionalString(record.location, `${name}.location`),
    application: optionalString(record.application, `${name}.application`),
    seo: {
      title: stringValue(seoRecord.title, `${name}.seo.title`, { max: 70 }),
      description: stringValue(seoRecord.description, `${name}.seo.description`, { max: 180 }),
      keywords: stringValue(seoRecord.keywords, `${name}.seo.keywords`),
      canonical: optionalString(seoRecord.canonical, `${name}.seo.canonical`, { max: 500 }),
    },
  }
}

const localizedPair = (value: unknown, name: string): LocalizedPair => {
  const record = isRecord(value) ? value : fail(`${name} must be an object`)
  return {
    en: localizedText(record.en, `${name}.en`),
    ar: localizedText(record.ar, `${name}.ar`),
  }
}

const localizedSimplePair = (value: unknown, name: string): LocalizedStringPair => {
  const record = isRecord(value) ? value : fail(`${name} must be an object`)
  return {
    en: stringValue(record.en, `${name}.en`, { max: 2_000 }),
    ar: stringValue(record.ar, `${name}.ar`, { max: 2_000 }),
  }
}

const mediaValue = (value: unknown, name: string): MediaManifest => {
  const record = isRecord(value) ? value : fail(`${name} must be an object`)
  const mimeType = stringValue(record.mimeType, `${name}.mimeType`, { max: 100 })
  if (!ALLOWED_MEDIA_TYPES.has(mimeType)) fail(`${name}.mimeType is unsupported`)
  const mediaPath = stringValue(record.path, `${name}.path`, { max: 500 })
  if (path.isAbsolute(mediaPath) || mediaPath.includes('\0')) fail(`${name}.path is unsafe`)
  const normalizedPath = path.posix.normalize(mediaPath.replaceAll('\\', '/'))
  if (normalizedPath === '.' || normalizedPath === '..' || normalizedPath.startsWith('../')) {
    fail(`${name}.path is unsafe`)
  }
  const filename = stringValue(record.filename, `${name}.filename`, { max: 255 })
  if (filename !== path.basename(filename) || filename.includes('\0'))
    fail(`${name}.filename is unsafe`)
  const width = record.width
  const height = record.height
  const bytes = record.bytes
  if (typeof width !== 'number' || !Number.isSafeInteger(width) || width <= 0 || width > 20_000)
    fail(`${name}.width is invalid`)
  if (typeof height !== 'number' || !Number.isSafeInteger(height) || height <= 0 || height > 20_000)
    fail(`${name}.height is invalid`)
  if (
    typeof bytes !== 'number' ||
    !Number.isSafeInteger(bytes) ||
    bytes <= 0 ||
    bytes > MAX_MEDIA_BYTES
  )
    fail(`${name}.bytes is invalid`)
  const sha256 = stringValue(record.sha256, `${name}.sha256`, { max: 64 })
  if (!SHA256.test(sha256)) fail(`${name}.sha256 is invalid`)
  return {
    filename,
    path: normalizedPath,
    mimeType,
    width: width as number,
    height: height as number,
    bytes: bytes as number,
    sha256,
    alt: stringValue(record.alt, `${name}.alt`, { max: 500 }),
    source: stringValue(record.source, `${name}.source`, { max: 1_000 }),
    isPublic:
      record.isPublic === undefined
        ? undefined
        : typeof record.isPublic === 'boolean'
          ? record.isPublic
          : fail(`${name}.isPublic must be a boolean`),
  }
}

const specificationValue = (value: unknown, name: string): SpecificationManifest => {
  const record = isRecord(value) ? value : fail(`${name} must be an object`)
  const label = localizedSimplePair(record.label, `${name}.label`)
  const specification = localizedSimplePair(record.value, `${name}.value`)
  return { label, value: specification }
}

const itemValue = (value: unknown, index: number): ContentManifestItem => {
  const name = `items[${index}]`
  const record = isRecord(value) ? value : fail(`${name} must be an object`)
  const kind = record.kind
  if (kind !== 'product' && kind !== 'project') fail(`${name}.kind is invalid`)
  const normalizedKind = kind as ContentManifestItem['kind']
  const action = record.action
  if (
    action !== 'create' &&
    action !== 'enrich-existing' &&
    action !== 'merge-into-product' &&
    action !== 'merge-into-project'
  ) {
    fail(`${name}.action is invalid`)
  }
  const normalizedAction = action as ContentManifestItem['action']
  const sourceNumbersValue = Array.isArray(record.sourceNumbers) ? record.sourceNumbers : null
  if (!sourceNumbersValue || sourceNumbersValue.length === 0) {
    fail(`${name}.sourceNumbers is required`)
  }
  const sourceNumbers = sourceNumbersValue!.map((sourceNumber: unknown, sourceIndex: number) =>
    stringValue(sourceNumber, `${name}.sourceNumbers[${sourceIndex}]`, { max: 80 }),
  )
  if (new Set(sourceNumbers).size !== sourceNumbers.length)
    fail(`${name}.sourceNumbers must be unique`)
  const slug = slugValue(record.slug, `${name}.slug`)
  const targetSlug = optionalString(record.targetSlug, `${name}.targetSlug`, { max: 160 })
  if (targetSlug && !SLUG.test(targetSlug)) fail(`${name}.targetSlug must be a lowercase slug`)
  if (normalizedAction.startsWith('merge-') && !targetSlug)
    fail(`${name}.targetSlug is required for merge actions`)
  if (!normalizedAction.startsWith('merge-') && targetSlug)
    fail(`${name}.targetSlug is only valid for merge actions`)
  const coverImage = mediaValue(record.coverImage, `${name}.coverImage`)
  const galleryValue = record.gallery
  if (galleryValue !== undefined && !Array.isArray(galleryValue))
    fail(`${name}.gallery must be an array`)
  const gallery = (Array.isArray(galleryValue) ? galleryValue : []).map(
    (media: unknown, mediaIndex: number) => mediaValue(media, `${name}.gallery[${mediaIndex}]`),
  )
  if (gallery.length > MAX_MEDIA_PER_ITEM) fail(`${name}.gallery has too many assets`)
  if (normalizedKind === 'product' && normalizedAction === 'create' && !record.categorySlug) {
    fail(`${name}.categorySlug is required for new products`)
  }
  const categorySlug = optionalString(record.categorySlug, `${name}.categorySlug`, { max: 160 })
  if (categorySlug && !SLUG.test(categorySlug))
    fail(`${name}.categorySlug must be a lowercase slug`)
  const specificationValueList = record.specifications
  if (specificationValueList !== undefined && !Array.isArray(specificationValueList)) {
    fail(`${name}.specifications must be an array`)
  }
  const specifications = (Array.isArray(specificationValueList) ? specificationValueList : []).map(
    (specification: unknown, specificationIndex: number) =>
      specificationValue(specification, `${name}.specifications[${specificationIndex}]`),
  )
  return {
    kind: normalizedKind,
    sourceNumbers,
    slug,
    action: normalizedAction,
    targetSlug,
    categorySlug,
    locales: localizedPair(
      record.locales ??
        (record.en !== undefined && record.ar !== undefined
          ? { en: record.en, ar: record.ar }
          : undefined),
      `${name}.locales`,
    ),
    specifications,
    coverImage,
    gallery,
    publish:
      record.publish === undefined
        ? false
        : typeof record.publish === 'boolean'
          ? record.publish
          : fail(`${name}.publish must be a boolean`),
  }
}

export const parseManifest = (input: unknown): BatchManifest => {
  const record = isRecord(input) ? input : fail('manifest must be an object')
  if (record.version !== 1) fail('manifest.version must be 1')
  const batch = stringValue(record.batch, 'manifest.batch', { max: 120 })
  const manifestItems = Array.isArray(record.items) ? record.items : null
  if (!manifestItems || manifestItems.length === 0) fail('manifest.items is required')
  if ((manifestItems?.length ?? 0) > MAX_ITEMS) fail('manifest.items has too many entries')
  const items = manifestItems!.map((item: unknown, index: number) => itemValue(item, index))
  const keys = items.map(
    (item) => `${item.kind}:${item.slug}:${item.action}:${item.targetSlug ?? ''}`,
  )
  if (new Set(keys).size !== keys.length) fail('manifest contains duplicate item keys')
  return { version: 1, batch, items }
}

export const canonicalize = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

export const manifestSha256 = (bytes: Uint8Array): string =>
  createHash('sha256').update(bytes).digest('hex')

export const readManifest = async (
  manifestPath: string,
): Promise<{ manifest: BatchManifest; sha256: string }> => {
  const bytes = await readFile(manifestPath)
  let parsed: unknown
  try {
    parsed = JSON.parse(bytes.toString('utf8'))
  } catch {
    fail('manifest is not valid JSON')
  }
  return { manifest: parseManifest(parsed), sha256: manifestSha256(bytes) }
}

export const resolveManifestFile = (manifestPath: string, mediaPath: string): string => {
  const root = path.dirname(path.resolve(manifestPath))
  const resolved = path.resolve(root, mediaPath)
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`))
    fail('media path escapes manifest directory')
  return resolved
}

export const verifyManifestMedia = async (
  manifestPath: string,
  media: MediaManifest,
): Promise<Uint8Array> => {
  const root = await realpath(path.dirname(path.resolve(manifestPath)))
  let resolvedPath: string
  try {
    resolvedPath = await realpath(resolveManifestFile(manifestPath, media.path))
  } catch {
    throw new ManifestValidationError(`media file is unavailable for ${media.filename}`)
  }
  if (resolvedPath !== root && !resolvedPath.startsWith(`${root}${path.sep}`)) {
    fail('media path escapes manifest directory')
  }
  const bytes = await readFile(resolvedPath)
  if (bytes.byteLength !== media.bytes) fail(`media byte count mismatch for ${media.filename}`)
  const digest = manifestSha256(bytes)
  if (digest !== media.sha256) fail(`media hash mismatch for ${media.filename}`)
  return bytes
}
