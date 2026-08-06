import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

type Environment = Readonly<Record<string, string | undefined>>

const ENCRYPTION_KEY_ENV = 'AI_CONFIG_ENCRYPTION_KEY'
const HEX_32_BYTE_KEY = /^[a-f0-9]{64}$/i
const CREDENTIAL_VERSION = 'v1'

export class AiCredentialError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AiCredentialError'
  }
}

const decodeSegment = (value: string): Buffer => {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new AiCredentialError('AI credential ciphertext is invalid')
  }

  const decoded = Buffer.from(value, 'base64url')
  if (decoded.length === 0) {
    throw new AiCredentialError('AI credential ciphertext is invalid')
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
    throw new AiCredentialError('AI credential ciphertext is invalid')
  }

  const iv = decodeSegment(encodedIv)
  const tag = decodeSegment(encodedTag)
  const encrypted = decodeSegment(encodedCiphertext)
  if (iv.length !== 12 || tag.length !== 16) {
    throw new AiCredentialError('AI credential ciphertext is invalid')
  }

  return { ciphertext: encrypted, iv, tag }
}

export const readAiConfigurationEncryptionKey = (
  environment: Environment = process.env,
): Buffer => {
  const value = environment[ENCRYPTION_KEY_ENV]?.trim()
  if (!value || !HEX_32_BYTE_KEY.test(value)) {
    throw new AiCredentialError(`${ENCRYPTION_KEY_ENV} must be a 64-character hexadecimal key`)
  }

  return Buffer.from(value, 'hex')
}

export const encryptAiCredential = (plaintext: string, key: Buffer): string => {
  if (!plaintext.trim() || key.length !== 32) {
    throw new AiCredentialError('AI credential cannot be encrypted')
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

export const decryptAiCredential = (encrypted: string, key: Buffer): string => {
  if (key.length !== 32) {
    throw new AiCredentialError('AI credential cannot be decrypted')
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
    if (error instanceof AiCredentialError) throw error
    throw new AiCredentialError('AI credential ciphertext could not be decrypted')
  }
}

export const isEncryptedAiCredential = (value: unknown): value is string => {
  if (typeof value !== 'string') return false
  try {
    parseCiphertext(value)
    return true
  } catch {
    return false
  }
}

// Readiness only needs a boolean. Never return the plaintext, ciphertext,
// encryption key, or cryptographic error details to the caller.
export const canDecryptAiCredential = (
  encrypted: unknown,
  environment: Environment = process.env,
): boolean => {
  if (!isEncryptedAiCredential(encrypted)) return false

  try {
    decryptAiCredential(encrypted, readAiConfigurationEncryptionKey(environment))
    return true
  } catch {
    return false
  }
}
