import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

const TOKEN_TTL_MS = 2 * 60 * 60 * 1_000
const TOKEN_VERSION = 'v1'

type UploadTicketPayload = {
  exp: number
  nonce: string
  v: typeof TOKEN_VERSION
}

const secret = (): string =>
  process.env.PAYLOAD_SECRET || 'local-development-only-secret-change-me'

const encode = (value: string): string => Buffer.from(value, 'utf8').toString('base64url')
const decode = (value: string): string => Buffer.from(value, 'base64url').toString('utf8')

const signature = (value: string): string =>
  createHmac('sha256', secret()).update(value).digest('base64url')

export const issueUploadTicket = (now = Date.now()): string => {
  const payload: UploadTicketPayload = {
    exp: now + TOKEN_TTL_MS,
    nonce: randomBytes(18).toString('base64url'),
    v: TOKEN_VERSION,
  }
  const encoded = encode(JSON.stringify(payload))
  return `${encoded}.${signature(encoded)}`
}

export const verifyUploadTicket = (
  token: unknown,
  now = Date.now(),
): UploadTicketPayload | null => {
  if (typeof token !== 'string') return null
  const [encoded, provided] = token.split('.')
  if (!encoded || !provided || token.length > 512) return null
  const expected = signature(encoded)
  const providedBytes = Buffer.from(provided)
  const expectedBytes = Buffer.from(expected)
  if (providedBytes.length !== expectedBytes.length || !timingSafeEqual(providedBytes, expectedBytes)) {
    return null
  }
  try {
    const payload = JSON.parse(decode(encoded)) as Partial<UploadTicketPayload>
    if (
      payload.v !== TOKEN_VERSION ||
      typeof payload.exp !== 'number' ||
      !Number.isSafeInteger(payload.exp) ||
      payload.exp <= now ||
      typeof payload.nonce !== 'string' ||
      payload.nonce.length < 8
    ) {
      return null
    }
    return payload as UploadTicketPayload
  } catch {
    return null
  }
}

export const hashUploadTicket = (token: string): string =>
  createHmac('sha256', secret()).update(`attachment:${token}`).digest('hex')

export const uploadTicketTTL = TOKEN_TTL_MS
