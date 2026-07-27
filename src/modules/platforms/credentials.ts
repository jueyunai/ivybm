import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

type Environment = Readonly<Record<string, string | undefined>>

export const PLATFORM_CREDENTIAL_ENCRYPTION_KEY_ENV = 'PLATFORM_CREDENTIAL_ENCRYPTION_KEY'

const HEX_32_BYTE_KEY = /^[a-f0-9]{64}$/i
const CREDENTIAL_VERSION = 'v1'

export class PlatformCredentialError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PlatformCredentialError'
  }
}

const decodeSegment = (value: string): Buffer => {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new PlatformCredentialError('Platform credential ciphertext is invalid')
  }

  const decoded = Buffer.from(value, 'base64url')
  if (decoded.length === 0) {
    throw new PlatformCredentialError('Platform credential ciphertext is invalid')
  }

  return decoded
}

const parseCiphertext = (ciphertext: string): { ciphertext: Buffer; iv: Buffer; tag: Buffer } => {
  const [version, encodedIv, encodedTag, encodedCiphertext, ...remaining] = ciphertext.split(':')
  if (
    version !== CREDENTIAL_VERSION ||
    !encodedIv ||
    !encodedTag ||
    !encodedCiphertext ||
    remaining.length > 0
  ) {
    throw new PlatformCredentialError('Platform credential ciphertext is invalid')
  }

  const iv = decodeSegment(encodedIv)
  const tag = decodeSegment(encodedTag)
  const encrypted = decodeSegment(encodedCiphertext)
  if (iv.length !== 12 || tag.length !== 16) {
    throw new PlatformCredentialError('Platform credential ciphertext is invalid')
  }

  return { ciphertext: encrypted, iv, tag }
}

export const readPlatformCredentialEncryptionKey = (
  environment: Environment = process.env,
): Buffer => {
  const value = environment[PLATFORM_CREDENTIAL_ENCRYPTION_KEY_ENV]?.trim()
  if (!value || !HEX_32_BYTE_KEY.test(value)) {
    throw new PlatformCredentialError(
      `${PLATFORM_CREDENTIAL_ENCRYPTION_KEY_ENV} must be a 64-character hexadecimal key`,
    )
  }

  return Buffer.from(value, 'hex')
}

export const encryptPlatformCredential = (plaintext: string, key: Buffer): string => {
  if (!plaintext.trim() || key.length !== 32) {
    throw new PlatformCredentialError('Platform credential cannot be encrypted')
  }

  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()

  return [
    CREDENTIAL_VERSION,
    iv.toString('base64url'),
    tag.toString('base64url'),
    ciphertext.toString('base64url'),
  ].join(':')
}

export const decryptPlatformCredential = (encrypted: string, key: Buffer): string => {
  if (key.length !== 32) {
    throw new PlatformCredentialError('Platform credential cannot be decrypted')
  }

  try {
    const { ciphertext, iv, tag } = parseCiphertext(encrypted)
    const decipher = createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAuthTag(tag)
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString(
      'utf8',
    )
    if (!plaintext) throw new Error('empty credential')
    return plaintext
  } catch (error) {
    if (error instanceof PlatformCredentialError) throw error
    throw new PlatformCredentialError('Platform credential ciphertext could not be decrypted')
  }
}

export const isEncryptedPlatformCredential = (value: unknown): value is string => {
  if (typeof value !== 'string') return false
  try {
    parseCiphertext(value)
    return true
  } catch {
    return false
  }
}

// This deliberately returns only a boolean. Callers such as the readiness
// endpoint need to distinguish a configured credential from one that the
// current deployment can actually use, without exposing the plaintext,
// ciphertext, encryption key, or a cryptographic error detail.
export const canDecryptPlatformCredential = (
  encrypted: unknown,
  environment: Environment = process.env,
): boolean => {
  if (!isEncryptedPlatformCredential(encrypted)) return false

  try {
    decryptPlatformCredential(encrypted, readPlatformCredentialEncryptionKey(environment))
    return true
  } catch {
    return false
  }
}
