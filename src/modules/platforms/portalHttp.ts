export class PlatformPortalRequestError extends Error {
  constructor(
    public readonly code:
      'forbidden' | 'invalid_request' | 'request_too_large' | 'unsupported_media_type',
    public readonly status: 400 | 403 | 413 | 415,
  ) {
    super(code)
    this.name = 'PlatformPortalRequestError'
  }
}

type PlatformPortalEnvironment = Partial<
  Pick<
    NodeJS.ProcessEnv,
    'CI' | 'IVYBM_E2E_ALLOW_HTTP_LOOPBACK' | 'NEXT_PUBLIC_SERVER_URL' | 'NODE_ENV'
  >
>

const isCILoopbackOrigin = (url: URL, environment: PlatformPortalEnvironment): boolean =>
  environment.CI === 'true' &&
  environment.IVYBM_E2E_ALLOW_HTTP_LOOPBACK === 'true' &&
  url.protocol === 'http:' &&
  (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]')

const expectedPlatformPortalOrigin = (
  request: Request,
  environment: PlatformPortalEnvironment,
): string | undefined => {
  if (environment.NODE_ENV !== 'production') return new URL(request.url).origin

  const configured = environment.NEXT_PUBLIC_SERVER_URL?.trim()
  if (configured) {
    try {
      const url = new URL(configured)
      if (
        (url.protocol !== 'https:' && !isCILoopbackOrigin(url, environment)) ||
        url.username ||
        url.password ||
        url.pathname !== '/' ||
        url.search ||
        url.hash
      ) {
        return undefined
      }
      return url.origin
    } catch {
      return undefined
    }
  }
  return undefined
}

const readBoundedText = async (request: Request, maximumBytes: number): Promise<string> => {
  const contentLengthHeader = request.headers.get('content-length')
  if (contentLengthHeader && /^\d+$/u.test(contentLengthHeader)) {
    const contentLength = Number(contentLengthHeader)
    if (!Number.isSafeInteger(contentLength) || contentLength > maximumBytes) {
      throw new PlatformPortalRequestError('request_too_large', 413)
    }
  }
  if (!request.body) throw new PlatformPortalRequestError('invalid_request', 400)

  const reader = request.body.getReader()
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let byteLength = 0
  let text = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      byteLength += value.byteLength
      if (byteLength > maximumBytes) {
        await reader.cancel().catch(() => undefined)
        throw new PlatformPortalRequestError('request_too_large', 413)
      }
      text += decoder.decode(value, { stream: true })
    }
    text += decoder.decode()
    return text
  } catch (error) {
    if (error instanceof PlatformPortalRequestError) throw error
    throw new PlatformPortalRequestError('invalid_request', 400)
  } finally {
    reader.releaseLock()
  }
}

export const readPlatformPortalJSON = async (
  request: Request,
  maximumBytes = 4_096,
  environment: PlatformPortalEnvironment = process.env,
): Promise<unknown> => {
  const origin = request.headers.get('origin')
  const expectedOrigin = expectedPlatformPortalOrigin(request, environment)
  if (!origin || !expectedOrigin || origin !== expectedOrigin) {
    throw new PlatformPortalRequestError('forbidden', 403)
  }
  const mediaType = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase()
  if (mediaType !== 'application/json') {
    throw new PlatformPortalRequestError('unsupported_media_type', 415)
  }
  const raw = await readBoundedText(request, maximumBytes)
  try {
    return JSON.parse(raw) as unknown
  } catch {
    throw new PlatformPortalRequestError('invalid_request', 400)
  }
}
