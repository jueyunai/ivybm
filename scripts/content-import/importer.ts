import {
  mkdir,
  readFile,
  readFile as readCheckpointFile,
  rename,
  writeFile,
} from 'node:fs/promises'
import path from 'node:path'

import { createSafeLogger, redactLogValue, safeErrorMessage } from './logging'
import { manifestSha256, readManifest, resolveManifestFile, verifyManifestMedia } from './manifest'
import { PayloadRestClient, PayloadRestError, type PayloadCollection } from './payload-client'
import type {
  BatchManifest,
  ContentManifestItem,
  ImportOperation,
  ImportOptions,
  ImportSummary,
  Locale,
  MediaManifest,
  PayloadDocument,
} from './types'

type Checkpoint = {
  version: 1
  manifestSha256: string
  completed: Record<string, { id?: number | string; status: ImportOperation['status'] }>
}

type MediaResolution = {
  id: number | string
  uploaded: boolean
  reused: boolean
  wasPublic: boolean
}

const COLLECTION_BY_KIND: Record<'product' | 'project', 'products' | 'projects'> = {
  product: 'products',
  project: 'projects',
}

const isPayloadDocument = (value: unknown): value is PayloadDocument =>
  value !== null && typeof value === 'object' && !Array.isArray(value) && 'id' in value

const relationId = (value: unknown): number | string | null => {
  if (typeof value === 'string' || typeof value === 'number') return value
  if (isPayloadDocument(value)) return value.id
  return null
}

const relationIds = (value: unknown): Array<number | string> => {
  if (!Array.isArray(value)) return []
  return value.map(relationId).filter((id): id is number | string => id !== null)
}

const idEquals = (left: number | string, right: number | string): boolean =>
  String(left) === String(right)

const toRichText = (value: unknown, locale: Locale): Record<string, unknown> | undefined => {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  const text = String(value)
  const children = text.split(/\r?\n/).map((line) => ({
    children: [
      { detail: 0, format: 0, mode: 'normal', style: '', text: line, type: 'text', version: 1 },
    ],
    direction: locale === 'ar' ? 'rtl' : 'ltr',
    format: '',
    indent: 0,
    type: 'paragraph',
    version: 1,
  }))
  return {
    root: {
      children,
      direction: locale === 'ar' ? 'rtl' : 'ltr',
      format: '',
      indent: 0,
      type: 'root',
      version: 1,
    },
  }
}

const localeTitle = (document: PayloadDocument, locale: Locale): string | undefined => {
  const title = document.title
  if (typeof title === 'string') return title
  if (title && typeof title === 'object' && !Array.isArray(title)) {
    const localized = (title as Record<string, unknown>)[locale]
    return typeof localized === 'string' ? localized : undefined
  }
  return undefined
}

const uniqueIds = (ids: Array<number | string>): Array<number | string> =>
  ids.filter((id, index) => ids.findIndex((candidate) => idEquals(candidate, id)) === index)

const checkpointKey = (item: ContentManifestItem): string =>
  `${item.kind}:${item.slug}:${item.action}:${item.targetSlug ?? ''}`

const operationCollection = (item: ContentManifestItem): 'products' | 'projects' => {
  if (item.action === 'merge-into-product') return 'products'
  if (item.action === 'merge-into-project') return 'projects'
  return COLLECTION_BY_KIND[item.kind]
}

const operationSlug = (item: ContentManifestItem): string => item.targetSlug ?? item.slug

const safeCheckpoint = (value: unknown): Checkpoint | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (record.version !== 1 || typeof record.manifestSha256 !== 'string') return null
  const completed = record.completed
  if (!completed || typeof completed !== 'object' || Array.isArray(completed)) return null
  return {
    version: 1,
    manifestSha256: record.manifestSha256,
    completed: completed as Checkpoint['completed'],
  }
}

const readCheckpoint = async (
  checkpointPath: string,
  manifestHash: string,
): Promise<Checkpoint> => {
  try {
    const value = JSON.parse((await readCheckpointFile(checkpointPath)).toString('utf8')) as unknown
    const checkpoint = safeCheckpoint(value)
    if (!checkpoint || checkpoint.manifestSha256 !== manifestHash) {
      throw new Error('checkpoint does not match manifest')
    }
    return checkpoint
  } catch (error) {
    if (error instanceof SyntaxError || (error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error('checkpoint is missing or invalid')
    }
    throw error
  }
}

const writeCheckpoint = async (checkpointPath: string, checkpoint: Checkpoint): Promise<void> => {
  const directory = path.dirname(checkpointPath)
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const tempPath = path.join(directory, `.${path.basename(checkpointPath)}.${process.pid}.tmp`)
  await writeFile(tempPath, `${JSON.stringify(checkpoint, null, 2)}\n`, { mode: 0o600 })
  await rename(tempPath, checkpointPath)
}

const matchesMediaHash = async (
  client: PayloadRestClient,
  document: PayloadDocument,
  media: MediaManifest,
): Promise<boolean> => {
  if (typeof document.sha256 === 'string') return document.sha256 === media.sha256
  if (document.filename && document.filename !== media.filename) return false
  try {
    const bytes = await client.readMediaBytes(document.filename ?? media.filename)
    return manifestSha256(bytes) === media.sha256
  } catch {
    return false
  }
}

export class ContentImporter {
  private readonly logger: (event: Record<string, unknown>) => void
  private readonly options: ImportOptions
  private readonly manifestPath: string
  private readonly manifest: BatchManifest
  private readonly manifestHash: string
  private checkpoint: Checkpoint | null = null
  private writes = 0

  private constructor(
    private readonly client: PayloadRestClient,
    manifestPath: string,
    manifest: BatchManifest,
    manifestHash: string,
    options: ImportOptions,
  ) {
    this.options = options
    this.manifestPath = manifestPath
    this.manifest = manifest
    this.manifestHash = manifestHash
    this.logger = options.logger
      ? (event) => options.logger?.(redactLogValue(event) as Record<string, unknown>)
      : createSafeLogger()
  }

  static async fromFile(
    client: PayloadRestClient,
    manifestPath: string,
    options: ImportOptions,
  ): Promise<ContentImporter> {
    const { manifest, sha256 } = await readManifest(manifestPath)
    if (options.mode === 'execute' && options.confirmSha !== sha256) {
      throw new Error('execute requires --confirm with the exact manifest SHA-256')
    }
    const importer = new ContentImporter(client, manifestPath, manifest, sha256, options)
    const checkpointPath = options.resumePath ?? options.checkpointPath
    if (checkpointPath && options.resumePath) {
      importer.checkpoint = await readCheckpoint(checkpointPath, sha256)
    } else if (checkpointPath) {
      importer.checkpoint = { version: 1, manifestSha256: sha256, completed: {} }
    }
    return importer
  }

  async run(): Promise<ImportSummary> {
    const selected = this.manifest.items.filter((item) => {
      if (!this.options.batch || this.options.batch === 'all') return true
      return this.options.batch === 'products' ? item.kind === 'product' : item.kind === 'project'
    })
    const operations: ImportOperation[] = []
    for (const item of selected) {
      const key = checkpointKey(item)
      const completed = this.checkpoint?.completed[key]
      if (completed) {
        operations.push({
          key,
          collection: operationCollection(item) as 'products' | 'projects',
          action: item.action,
          slug: operationSlug(item),
          status: 'skipped',
          id: completed.id,
          mediaUploaded: 0,
          mediaReused: 0,
        })
        this.logger({ event: 'item-skipped-checkpoint', key, status: completed.status })
        continue
      }
      try {
        const operation = await this.processItem(item)
        operations.push(operation)
        if (this.checkpoint && operation.status !== 'failed') {
          this.checkpoint.completed[key] = { id: operation.id, status: operation.status }
          if (this.options.checkpointPath || this.options.resumePath) {
            await writeCheckpoint(
              this.options.resumePath ?? this.options.checkpointPath!,
              this.checkpoint,
            )
          }
        }
      } catch (error) {
        this.logger({ event: 'item-failed', key, error: safeErrorMessage(error) })
        operations.push({
          key,
          collection: operationCollection(item) as 'products' | 'projects',
          action: item.action,
          slug: operationSlug(item),
          status: 'failed',
          mediaUploaded: 0,
          mediaReused: 0,
        })
        throw error
      }
    }
    return {
      manifestSha256: this.manifestHash,
      mode: this.options.mode,
      operations,
      writes: this.writes,
      dryRun: this.options.mode === 'dry-run',
      checkpointPath:
        this.options.checkpointPath || this.options.resumePath
          ? path.basename(this.options.checkpointPath ?? this.options.resumePath!)
          : undefined,
    }
  }

  private async processItem(item: ContentManifestItem): Promise<ImportOperation> {
    const key = checkpointKey(item)
    const collection = operationCollection(item)
    const slug = operationSlug(item)
    this.logger({ event: 'item-start', key, action: item.action, collection, slug })
    const media = [item.coverImage, ...(item.gallery ?? [])]
    const mediaResolutions: MediaResolution[] = []
    const byHash = new Map<string, MediaResolution>()
    for (const entry of media) {
      const existingResolution = byHash.get(entry.sha256)
      const resolution = existingResolution ?? (await this.ensureMedia(entry))
      byHash.set(entry.sha256, resolution)
      mediaResolutions.push(resolution)
    }
    const mediaIds = mediaResolutions.map((resolution) => resolution.id)
    const mediaUploaded = mediaResolutions.filter((resolution) => resolution.uploaded).length
    const mediaReused = mediaResolutions.filter((resolution) => resolution.reused).length
    const existing = (
      await this.client.find(collection, { slug, locale: 'all', draft: true, limit: 1 })
    ).docs[0]

    if (item.action.startsWith('merge-')) {
      if (!existing) throw new Error(`merge target was not found for ${slug}`)
      const existingGallery = relationIds(existing.gallery)
      const nextGallery = uniqueIds([...existingGallery, ...mediaIds])
      if (this.options.mode === 'execute' && nextGallery.length !== existingGallery.length) {
        await this.mutate(
          () =>
            this.client.update(
              collection,
              existing.id,
              { gallery: nextGallery },
              { locale: 'all', draft: true },
            ),
          async () =>
            await this.client.findById(collection, existing.id, { locale: 'all', draft: true }),
          (document) =>
            relationIds(document.gallery).some((id) =>
              mediaIds.some((mediaId) => idEquals(id, mediaId)),
            ),
        )
        this.writes += 1
      }
      if (this.options.mode === 'execute') {
        if (this.options.publish === true && item.publish === true) {
          await this.publishMedia(mediaResolutions)
          await this.publishDocument(collection, existing.id)
        }
      }
      this.logger({ event: 'item-complete', key, collection, slug, status: 'updated' })
      return {
        key,
        collection,
        action: item.action,
        slug,
        status: this.options.mode === 'dry-run' ? 'planned' : 'updated',
        id: existing.id,
        mediaUploaded,
        mediaReused,
      }
    }

    let document = existing
    let status: ImportOperation['status'] = existing ? 'updated' : 'created'
    const categoryId =
      item.kind === 'product' && item.categorySlug
        ? await this.resolveCategory(item.categorySlug)
        : relationId(existing?.category)
    const enData = this.documentData(item, 'en', mediaIds, categoryId, existing, true)
    const arData = this.documentData(item, 'ar', mediaIds, categoryId, existing, false)

    if (!document) {
      if (this.options.mode === 'dry-run') {
        status = 'planned'
        document = { id: `planned:${slug}`, slug }
      } else {
        document = await this.mutate(
          () => this.client.create(collection, enData, { locale: 'en', draft: true }),
          async () =>
            (await this.client.find(collection, { slug, locale: 'all', draft: true, limit: 1 }))
              .docs[0],
          (candidate) =>
            Boolean(candidate && localeTitle(candidate, 'en') === item.locales.en.title),
        )
        this.writes += 1
      }
    } else if (this.options.mode === 'execute') {
      document = await this.mutate(
        () => this.client.update(collection, document!.id, enData, { locale: 'en', draft: true }),
        async () => this.client.findById(collection, document!.id, { locale: 'all', draft: true }),
        (candidate) => Boolean(localeTitle(candidate, 'en') === item.locales.en.title),
      )
      this.writes += 1
    }

    if (this.options.mode === 'execute' && document) {
      document = await this.mutate(
        () => this.client.update(collection, document!.id, arData, { locale: 'ar', draft: true }),
        async () => this.client.findById(collection, document!.id, { locale: 'all', draft: true }),
        (candidate) =>
          Boolean(
            localeTitle(candidate, 'ar') === item.locales.ar.title ||
            localeTitle(candidate, 'en') === item.locales.en.title,
          ),
      )
      this.writes += 1
      await this.assertReadBack(collection, document.id, item)
      if (this.options.publish === true && item.publish === true) {
        await this.publishMedia(mediaResolutions)
        document = await this.publishDocument(collection, document.id)
        status = 'published'
      }
    }
    this.logger({ event: 'item-complete', key, collection, slug, status })
    return {
      key,
      collection,
      action: item.action,
      slug,
      status,
      id: document?.id,
      mediaUploaded,
      mediaReused,
    }
  }

  private async resolveCategory(slug: string): Promise<number | string | null> {
    const category = (
      await this.client.find('product-categories', { slug, locale: 'all', draft: true, limit: 1 })
    ).docs[0]
    if (!category) throw new Error(`product category was not found for ${slug}`)
    return category.id
  }

  private documentData(
    item: ContentManifestItem,
    locale: Locale,
    mediaIds: Array<number | string>,
    categoryId: number | string | null,
    existing: PayloadDocument | undefined,
    includeShared: boolean,
  ): Record<string, unknown> {
    const copy = item.locales[locale]
    const data: Record<string, unknown> = {
      title: copy.title,
      seo: {
        title: copy.seo.title,
        description: copy.seo.description,
        keywords: copy.seo.keywords,
        ...(copy.seo.canonical ? { canonical: copy.seo.canonical } : {}),
      },
    }
    const summary = copy.shortDescription ?? copy.summary
    if (item.kind === 'product') {
      if (summary !== undefined) data.shortDescription = summary
    } else {
      if (summary !== undefined) data.summary = summary
      if (copy.location !== undefined) data.location = copy.location
      if (copy.application !== undefined) data.application = copy.application
    }
    const description = toRichText(copy.description, locale)
    if (description) data.description = description
    if (item.specifications && item.kind === 'product') {
      data.specifications = item.specifications.map((specification) => ({
        label: specification.label[locale],
        value: specification.value[locale],
      }))
    }
    if (includeShared) {
      data.slug = item.slug
      if (item.kind === 'product' && categoryId !== null) data.category = categoryId
      data.coverImage = mediaIds[0]
      const galleryIds = mediaIds.slice(1)
      if (existing && item.action === 'enrich-existing') {
        data.gallery = uniqueIds([...relationIds(existing.gallery), ...galleryIds])
      } else {
        data.gallery = galleryIds
      }
      data._status = 'draft'
    }
    return data
  }

  private async assertReadBack(
    collection: PayloadCollection,
    id: number | string,
    item: ContentManifestItem,
  ): Promise<void> {
    const [en, ar] = await Promise.all([
      this.client.findById(collection, id, { locale: 'en', draft: true }),
      this.client.findById(collection, id, { locale: 'ar', draft: true }),
    ])
    if (
      localeTitle(en, 'en') !== item.locales.en.title ||
      localeTitle(ar, 'ar') !== item.locales.ar.title
    ) {
      throw new Error(`localized read-back incomplete for ${item.slug}`)
    }
    const enSeo = en.seo
    const arSeo = ar.seo
    if (!enSeo || !arSeo || typeof enSeo !== 'object' || typeof arSeo !== 'object') {
      throw new Error(`SEO read-back incomplete for ${item.slug}`)
    }
  }

  private async publishMedia(mediaResolutions: MediaResolution[]): Promise<void> {
    const uniqueResolutions = mediaResolutions.filter(
      (resolution, index) =>
        mediaResolutions.findIndex((candidate) => idEquals(candidate.id, resolution.id)) === index,
    )
    for (const resolution of uniqueResolutions) {
      if (resolution.wasPublic) continue
      await this.mutate(
        () =>
          this.client.update(
            'media',
            resolution.id,
            { isPublic: true },
            { locale: 'all', draft: true },
          ),
        async () => this.client.findById('media', resolution.id, { locale: 'all', draft: true }),
        (document) => document.isPublic === true,
      )
      this.writes += 1
    }
  }

  private async publishDocument(
    collection: 'products' | 'projects',
    id: number | string,
  ): Promise<PayloadDocument> {
    const document = await this.mutate(
      () =>
        this.client.update(
          collection,
          id,
          { _status: 'published' },
          { locale: 'all', draft: true },
        ),
      async () => this.client.findById(collection, id, { locale: 'all', draft: true }),
      (candidate) => candidate._status === 'published',
    )
    this.writes += 1
    return document
  }

  private async ensureMedia(media: MediaManifest): Promise<MediaResolution> {
    await verifyManifestMedia(this.manifestPath, media)
    const candidatesById = new Map<string, PayloadDocument>()
    for (const options of [{ filename: media.filename, limit: 20 }, { limit: 1000 }]) {
      const response = await this.client.find('media', {
        ...options,
        locale: 'all',
        draft: true,
      })
      for (const candidate of response.docs) candidatesById.set(String(candidate.id), candidate)
    }
    const candidates = [...candidatesById.values()]
    for (const candidate of candidates) {
      if (!(await matchesMediaHash(this.client, candidate, media))) continue
      if (this.options.mode === 'execute') {
        await this.mutate(
          () =>
            this.client.update(
              'media',
              candidate.id,
              {
                alt: media.alt,
                source: media.source,
              },
              { locale: 'all', draft: true },
            ),
          async () => this.client.findById('media', candidate.id, { locale: 'all', draft: true }),
          (document) => document.id === candidate.id,
        )
        this.writes += 1
      }
      this.logger({ event: 'media-reused', filename: media.filename, id: candidate.id })
      return {
        id: candidate.id,
        uploaded: false,
        reused: true,
        wasPublic: candidate.isPublic === true,
      }
    }

    const bytes = await verifyManifestMedia(this.manifestPath, media)
    if (this.options.mode === 'dry-run') {
      this.logger({ event: 'media-planned', filename: media.filename, sha256: media.sha256 })
      return {
        id: `planned-media:${media.sha256.slice(0, 12)}`,
        uploaded: false,
        reused: false,
        wasPublic: false,
      }
    }
    const document = await this.mutate(
      () =>
        this.client.uploadMedia(
          { bytes, filename: media.filename, mimeType: media.mimeType },
          {
            alt: media.alt,
            source: media.source,
            isPublic: false,
          },
        ),
      async () => {
        const found = (
          await this.client.find('media', {
            filename: media.filename,
            locale: 'all',
            draft: true,
            limit: 20,
          })
        ).docs
        for (const candidate of found) {
          if (await matchesMediaHash(this.client, candidate, media)) return candidate
        }
        return undefined
      },
      (candidate) => Boolean(candidate && candidate.filename === media.filename),
    )
    this.writes += 1
    this.logger({ event: 'media-uploaded', filename: media.filename, id: document.id })
    return { id: document.id, uploaded: true, reused: false, wasPublic: false }
  }

  private async mutate<T extends PayloadDocument>(
    operation: () => Promise<T>,
    probe: () => Promise<PayloadDocument | undefined>,
    matches: (document: PayloadDocument) => boolean,
  ): Promise<T> {
    try {
      return await operation()
    } catch (error) {
      if (!(error instanceof PayloadRestError) || !error.unknown) throw error
      this.logger({ event: 'write-outcome-unknown', error: safeErrorMessage(error) })
      const candidate = await probe()
      if (candidate && matches(candidate)) return candidate as T
      throw new Error('write outcome is unknown; query the remote record before retrying')
    }
  }
}

export const importContentManifest = async (
  client: PayloadRestClient,
  manifestPath: string,
  options: ImportOptions,
): Promise<ImportSummary> => {
  const importer = await ContentImporter.fromFile(client, manifestPath, options)
  return importer.run()
}

export const manifestShaFromPath = async (manifestPath: string): Promise<string> =>
  manifestSha256(await readFile(manifestPath))

export { resolveManifestFile }
