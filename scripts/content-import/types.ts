export type ContentKind = 'product' | 'project'
export type ContentAction =
  'create' | 'enrich-existing' | 'merge-into-product' | 'merge-into-project'

export type Locale = 'en' | 'ar'

export type LocalizedText = {
  title: string
  shortDescription?: string
  summary?: string
  description?: string | Record<string, unknown>
  location?: string
  application?: string
  seo: {
    title: string
    description: string
    keywords: string
    canonical?: string
  }
}

export type LocalizedPair = {
  en: LocalizedText
  ar: LocalizedText
}

export type LocalizedStringPair = {
  en: string
  ar: string
}

export type MediaManifest = {
  filename: string
  path: string
  mimeType: string
  width: number
  height: number
  bytes: number
  sha256: string
  alt: string
  source: string
  isPublic?: boolean
}

export type SpecificationManifest = {
  label: LocalizedStringPair
  value: LocalizedStringPair
}

export type ContentManifestItem = {
  kind: ContentKind
  sourceNumbers: string[]
  slug: string
  action: ContentAction
  targetSlug?: string
  categorySlug?: string
  locales: LocalizedPair
  specifications?: SpecificationManifest[]
  coverImage: MediaManifest
  gallery?: MediaManifest[]
  publish?: boolean
}

export type BatchManifest = {
  version: 1
  batch: string
  items: ContentManifestItem[]
}

export type PayloadDocument = Record<string, unknown> & {
  id: number | string
  slug?: string
  filename?: string
  sha256?: string
  _status?: 'draft' | 'published' | null
  updatedAt?: string
  isPublic?: boolean | null
  mimeType?: string | null
}

export type PayloadFindResponse = {
  docs: PayloadDocument[]
  totalDocs?: number
  hasNextPage?: boolean
  page?: number
  totalPages?: number
}

export type PayloadFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

export type ImportMode = 'dry-run' | 'execute'

export type ImportOptions = {
  mode: ImportMode
  publish?: boolean
  batch?: 'products' | 'projects' | 'all'
  confirmSha?: string
  checkpointPath?: string
  resumePath?: string
  logger?: (event: Record<string, unknown>) => void
}

export type ImportOperation = {
  key: string
  collection: 'products' | 'projects'
  action: ContentAction
  slug: string
  status: 'planned' | 'created' | 'updated' | 'reused' | 'published' | 'skipped' | 'failed'
  id?: number | string
  mediaUploaded: number
  mediaReused: number
}

export type ImportSummary = {
  manifestSha256: string
  mode: ImportMode
  operations: ImportOperation[]
  writes: number
  dryRun: boolean
  checkpointPath?: string
}

export type FileLike = {
  bytes: Uint8Array
  filename: string
  mimeType: string
}
