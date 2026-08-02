import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

import { FeishuConfigurationError } from './contracts'

type Environment = Record<string, string | undefined>

const VERSION = 'v1'

export const readFeishuCredentialEncryptionKey = (
  environment: Environment = process.env,
): Buffer => {
  const value = environment.FEISHU_CREDENTIAL_ENCRYPTION_KEY?.trim()
  if (!value || !/^[0-9a-f]{64}$/i.test(value)) {
    throw new FeishuConfigurationError(
      'FEISHU_CREDENTIAL_ENCRYPTION_KEY must be a 64-character hexadecimal key',
    )
  }
  return Buffer.from(value, 'hex')
}

export const encryptFeishuCredential = (plaintext: string, key: Buffer): string => {
  if (!plaintext.trim()) throw new FeishuConfigurationError('Feishu credential is empty')
  if (key.length !== 32) throw new FeishuConfigurationError('Feishu credential key is invalid')

  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [VERSION, iv, tag, ciphertext].map((value) => value.toString('base64url')).join(':')
}

export const decryptFeishuCredential = (encrypted: string, key: Buffer): string => {
  try {
    const [version, encodedIV, encodedTag, encodedCiphertext, extra] = encrypted.split(':')
    if (version !== VERSION || !encodedIV || !encodedTag || !encodedCiphertext || extra) {
      throw new Error('invalid ciphertext')
    }
    const iv = Buffer.from(encodedIV, 'base64url')
    const tag = Buffer.from(encodedTag, 'base64url')
    const ciphertext = Buffer.from(encodedCiphertext, 'base64url')
    if (iv.length !== 12 || tag.length !== 16 || ciphertext.length === 0) {
      throw new Error('invalid ciphertext')
    }
    const decipher = createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAuthTag(tag)
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString(
      'utf8',
    )
    if (!plaintext) throw new Error('empty plaintext')
    return plaintext
  } catch (error) {
    if (error instanceof FeishuConfigurationError) throw error
    throw new FeishuConfigurationError('Feishu credential could not be decrypted')
  }
}

export const canDecryptFeishuCredential = (
  encrypted: unknown,
  environment: Environment = process.env,
): boolean => {
  if (typeof encrypted !== 'string') return false
  try {
    decryptFeishuCredential(encrypted, readFeishuCredentialEncryptionKey(environment))
    return true
  } catch {
    return false
  }
}
