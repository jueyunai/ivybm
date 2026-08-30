import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

type Environment = Readonly<Record<string, string | undefined>>

export const WEBHOOK_REPLAY_ENCRYPTION_KEY_ENV = 'WEBHOOK_REPLAY_ENCRYPTION_KEY'

const HEX_32_BYTE_KEY = /^[a-f0-9]{64}$/iu
const REPLAY_CIPHERTEXT_VERSION = 'v1'

export class MetaWebhookReplayCryptoError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MetaWebhookReplayCryptoError'
  }
}

export const readMetaWebhookReplayEncryptionKey = (
  environment: Environment = process.env,
): Buffer => {
  const value = environment[WEBHOOK_REPLAY_ENCRYPTION_KEY_ENV]?.trim()
  if (!value || !HEX_32_BYTE_KEY.test(value)) {
    throw new MetaWebhookReplayCryptoError(
      `${WEBHOOK_REPLAY_ENCRYPTION_KEY_ENV} must be a 64-character hexadecimal key`,
    )
  }
  return Buffer.from(value, 'hex')
}

const decode = (value: string): Buffer => {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) throw new MetaWebhookReplayCryptoError(
    'Meta webhook replay payload cannot be decrypted',
  )
  const decoded = Buffer.from(value, 'base64url')
  if (!decoded.length) throw new MetaWebhookReplayCryptoError(
    'Meta webhook replay payload cannot be decrypted',
  )
  return decoded
}

export const encryptMetaWebhookReplayBody = ({
  body,
  context,
  key,
}: {
  body: Uint8Array
  context: string
  key: Buffer
}): string => {
  if (!body.byteLength || !context.trim() || key.length !== 32) {
    throw new MetaWebhookReplayCryptoError('Meta webhook replay payload cannot be encrypted')
  }
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(Buffer.from(context, 'utf8'))
  const ciphertext = Buffer.concat([cipher.update(body), cipher.final()])
  const tag = cipher.getAuthTag()
  return [
    REPLAY_CIPHERTEXT_VERSION,
    iv.toString('base64url'),
    tag.toString('base64url'),
    ciphertext.toString('base64url'),
  ].join(':')
}

export const decryptMetaWebhookReplayBody = ({
  ciphertext,
  context,
  key,
}: {
  ciphertext: string
  context: string
  key: Buffer
}): Buffer => {
  if (!context.trim() || key.length !== 32) {
    throw new MetaWebhookReplayCryptoError('Meta webhook replay payload cannot be decrypted')
  }
  try {
    const [version, encodedIv, encodedTag, encodedCiphertext, ...rest] = ciphertext.split(':')
    if (
      version !== REPLAY_CIPHERTEXT_VERSION ||
      !encodedIv ||
      !encodedTag ||
      !encodedCiphertext ||
      rest.length
    ) throw new Error('invalid ciphertext')
    const iv = decode(encodedIv)
    const tag = decode(encodedTag)
    const encrypted = decode(encodedCiphertext)
    if (iv.length !== 12 || tag.length !== 16) throw new Error('invalid ciphertext')
    const decipher = createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAAD(Buffer.from(context, 'utf8'))
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(encrypted), decipher.final()])
  } catch {
    throw new MetaWebhookReplayCryptoError('Meta webhook replay payload cannot be decrypted')
  }
}
