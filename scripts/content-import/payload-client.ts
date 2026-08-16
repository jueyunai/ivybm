import type { PayloadDocument, PayloadFetch, PayloadFindResponse } from './types'

export type PayloadCollection = 'media' | 'products' | 'projects' | 'product-categories'

export class PayloadRestError extends Error {
  readonly status: number
  readonly code: string
  readonly unknown: boolean

  constructor(
    message: string,
    options: { status?: number; code?: string; unknown?: boolean } = {},
  ) {
    super(message)
    this.name = 'PayloadRestError'
    this.status = options.status ?? 0
    this.code = options.code ?? 'payload-rest-error'
    this.unknown = options.unknown ?? false
  }
}

const parseResponseBody = async (response: Response): Promise<Record<string, unknown>> => {
  if (response.status === 204) return {}
  const text = await response.text()
  if (!text) return {}
  try {
    const value = JSON.parse(text) as unknown
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

const responseDocument = (body: Record<string, unknown>): PayloadDocument => {
  const result = body.result
  const doc = body.doc
  const document =
    result && typeof result === 'object' && !Array.isArray(result)
      ? (result as PayloadDocument)
      : doc && typeof doc === 'object' && !Array.isArray(doc)
        ? (doc as PayloadDocument)
        : (body as PayloadDocument)
  if (!document || document.id === undefined || document.id === null) {
    throw new PayloadRestError('Payload write response was incomplete', {
      code: 'payload-response-invalid',
      unknown: true,
    })
  }
  return document
}

export const assertAllowedOrigin = (origin: string): string => {
  let parsed: URL
  try {
    parsed = new URL(origin)
  } catch {
    throw new PayloadRestError('origin must be an absolute HTTP(S) URL', { code: 'origin-invalid' })
  }
  if (
    parsed.username ||
    parsed.password ||
    parsed.pathname !== '/' ||
    parsed.search ||
    parsed.hash
  ) {
    throw new PayloadRestError('origin must not contain credentials, path, query, or hash', {
      code: 'origin-invalid',
    })
  }
  const normalized = parsed.origin
  const isProduction = normalized === 'https://ivybm.com'
  const isLocalhost =
    (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
    (parsed.hostname === 'localhost' ||
      parsed.hostname === '127.0.0.1' ||
      parsed.hostname === '::1')
  if (!isProduction && !isLocalhost) {
    throw new PayloadRestError('origin is not an approved production or localhost origin', {
      code: 'origin-not-allowed',
    })
  }
  return normalized
}

const collectionPath = (collection: PayloadCollection): string => `/api/${collection}`

const appendQuery = (
  path: string,
  query: Record<string, string | number | boolean | undefined>,
): string => {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) search.set(key, String(value))
  }
  const queryString = search.toString()
  return queryString ? `${path}?${queryString}` : path
}

const authHeader = (token: string | undefined): Record<string, string> =>
  token ? { Authorization: `JWT ${token}` } : {}

export class PayloadRestClient {
  readonly origin: string
  private token: string | undefined
  private readonly fetchImpl: PayloadFetch

  constructor(options: { origin: string; token?: string; fetchImpl?: PayloadFetch }) {
    this.origin = assertAllowedOrigin(options.origin)
    this.token = options.token
    this.fetchImpl = options.fetchImpl ?? (globalThis.fetch as PayloadFetch)
    if (!this.fetchImpl)
      throw new PayloadRestError('fetch is unavailable', { code: 'fetch-unavailable' })
  }

  get authenticated(): boolean {
    return Boolean(this.token)
  }

  async login(email: string, password: string): Promise<void> {
    const body = await this.request(
      '/api/users/login',
      {
        method: 'POST',
        body: JSON.stringify({ email, password }),
        headers: { 'Content-Type': 'application/json' },
      },
      { mutation: false },
    )
    const token = body.token
    if (typeof token !== 'string' || token.length < 16) {
      throw new PayloadRestError('Payload login did not return a token', { code: 'login-invalid' })
    }
    this.token = token
  }

  async find(
    collection: PayloadCollection,
    options: {
      slug?: string
      filename?: string
      locale?: 'en' | 'ar' | 'all'
      draft?: boolean
      limit?: number
    } = {},
  ): Promise<PayloadFindResponse> {
    const whereKey =
      options.slug !== undefined ? 'slug' : options.filename !== undefined ? 'filename' : undefined
    const whereValue = options.slug ?? options.filename
    const path = appendQuery(collectionPath(collection), {
      'where[slug][equals]': whereKey === 'slug' ? whereValue : undefined,
      'where[filename][equals]': whereKey === 'filename' ? whereValue : undefined,
      depth: 0,
      draft: options.draft ?? true,
      'fallback-locale': 'none',
      limit: options.limit ?? 10,
      locale: options.locale ?? 'all',
    })
    const body = await this.request(path, { method: 'GET' }, { mutation: false })
    const docs = Array.isArray(body.docs) ? body.docs.filter(isDocument) : []
    return {
      docs,
      totalDocs: typeof body.totalDocs === 'number' ? body.totalDocs : docs.length,
      hasNextPage: body.hasNextPage === true,
      page: typeof body.page === 'number' ? body.page : 1,
      totalPages: typeof body.totalPages === 'number' ? body.totalPages : 1,
    }
  }

  async findById(
    collection: PayloadCollection,
    id: number | string,
    options: { locale?: 'en' | 'ar' | 'all'; draft?: boolean } = {},
  ): Promise<PayloadDocument> {
    const path = appendQuery(`${collectionPath(collection)}/${encodeURIComponent(String(id))}`, {
      depth: 0,
      draft: options.draft ?? true,
      'fallback-locale': 'none',
      locale: options.locale ?? 'all',
    })
    return responseDocument(await this.request(path, { method: 'GET' }, { mutation: false }))
  }

  async create(
    collection: PayloadCollection,
    data: Record<string, unknown>,
    options: { locale?: 'en' | 'ar'; draft?: boolean } = {},
  ): Promise<PayloadDocument> {
    const path = appendQuery(collectionPath(collection), {
      draft: options.draft ?? true,
      'fallback-locale': 'none',
      locale: options.locale ?? 'en',
    })
    return responseDocument(
      await this.request(
        path,
        {
          method: 'POST',
          body: JSON.stringify(data),
          headers: { 'Content-Type': 'application/json' },
        },
        { mutation: true },
      ),
    )
  }

  async update(
    collection: PayloadCollection,
    id: number | string,
    data: Record<string, unknown>,
    options: { locale?: 'en' | 'ar' | 'all'; draft?: boolean } = {},
  ): Promise<PayloadDocument> {
    const path = appendQuery(`${collectionPath(collection)}/${encodeURIComponent(String(id))}`, {
      draft: options.draft ?? true,
      'fallback-locale': 'none',
      locale: options.locale ?? 'en',
    })
    return responseDocument(
      await this.request(
        path,
        {
          method: 'PATCH',
          body: JSON.stringify(data),
          headers: { 'Content-Type': 'application/json' },
        },
        { mutation: true },
      ),
    )
  }

  async uploadMedia(
    file: { bytes: Uint8Array; filename: string; mimeType: string },
    metadata: { alt: string; source: string; isPublic: boolean },
  ): Promise<PayloadDocument> {
    const form = new FormData()
    form.append('_payload', JSON.stringify(metadata))
    form.append('alt', metadata.alt)
    form.append('source', metadata.source)
    form.append('isPublic', String(metadata.isPublic))
    form.append('file', new Blob([file.bytes], { type: file.mimeType }), file.filename)
    return responseDocument(
      await this.request(
        collectionPath('media'),
        {
          method: 'POST',
          body: form,
        },
        { mutation: true },
      ),
    )
  }

  async readMediaBytes(filename: string): Promise<Uint8Array> {
    const path = `/api/media/file/${encodeURIComponent(filename)}`
    const response = await this.fetchImpl(new URL(path, this.origin), {
      headers: authHeader(this.token),
    })
    if (!response.ok)
      throw new PayloadRestError('media read failed', {
        status: response.status,
        code: 'media-read-failed',
      })
    return new Uint8Array(await response.arrayBuffer())
  }

  private async request(
    path: string,
    init: RequestInit,
    options: { mutation: boolean },
  ): Promise<Record<string, unknown>> {
    let response: Response
    try {
      response = await this.fetchImpl(new URL(path, this.origin), {
        ...init,
        headers: { ...authHeader(this.token), ...(init.headers ?? {}) },
      })
    } catch {
      throw new PayloadRestError(
        options.mutation ? 'write outcome is unknown' : 'Payload request failed',
        {
          code: options.mutation ? 'write-outcome-unknown' : 'payload-request-failed',
          unknown: options.mutation,
        },
      )
    }
    const body = await parseResponseBody(response)
    if (!response.ok) {
      throw new PayloadRestError(`Payload request was rejected (${response.status})`, {
        status: response.status,
        code: 'payload-http-error',
      })
    }
    return body
  }
}

const isDocument = (value: unknown): value is PayloadDocument =>
  value !== null && typeof value === 'object' && !Array.isArray(value) && 'id' in value

export const createPayloadClientFromEnv = (fetchImpl?: PayloadFetch): PayloadRestClient => {
  const origin = process.env.PAYLOAD_IMPORT_ORIGIN
  if (!origin)
    throw new PayloadRestError('PAYLOAD_IMPORT_ORIGIN is required', { code: 'origin-required' })
  const client = new PayloadRestClient({
    origin,
    token: process.env.PAYLOAD_IMPORT_TOKEN,
    fetchImpl,
  })
  if (!client.authenticated) {
    const email = process.env.PAYLOAD_IMPORT_EMAIL
    const password = process.env.PAYLOAD_IMPORT_PASSWORD
    if (!email || !password) {
      throw new PayloadRestError('Payload import credentials are required', {
        code: 'credentials-required',
      })
    }
  }
  return client
}
