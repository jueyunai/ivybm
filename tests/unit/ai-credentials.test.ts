import { describe, expect, it } from 'vitest'

import {
  aiCredentialRead,
  portalAiReadinessCredentialReadContext,
} from '@/access/aiCredentials'
import {
  AiCredentialError,
  canDecryptAiCredential,
  decryptAiCredential,
  encryptAiCredential,
  readAiConfigurationEncryptionKey,
} from '@/modules/ai/credentials'

const encryptionEnvironment = {
  AI_CONFIG_ENCRYPTION_KEY: 'a'.repeat(64),
}

describe('AI provider credential encryption', () => {
  it('encrypts credentials with a versioned AES-GCM payload and decrypts only with the master key', () => {
    const key = readAiConfigurationEncryptionKey(encryptionEnvironment)
    const encrypted = encryptAiCredential('provider-secret-key', key)

    expect(encrypted).toMatch(/^v1:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$/)
    expect(encrypted).not.toContain('provider-secret-key')
    expect(decryptAiCredential(encrypted, key)).toBe('provider-secret-key')
  })

  it('rejects malformed master keys and tampered credentials without echoing secrets', () => {
    expect(() =>
      readAiConfigurationEncryptionKey({ AI_CONFIG_ENCRYPTION_KEY: 'too-short' }),
    ).toThrow(AiCredentialError)

    const key = readAiConfigurationEncryptionKey(encryptionEnvironment)
    const encrypted = encryptAiCredential('provider-secret-key', key)
    const [version, iv, tag, ciphertext] = encrypted.split(':')
    const tamperedTag = `${tag[0] === 'x' ? 'y' : 'x'}${tag.slice(1)}`
    const tampered = [version, iv, tamperedTag, ciphertext].join(':')

    expect(() => decryptAiCredential(tampered, key)).toThrow(AiCredentialError)
    try {
      decryptAiCredential(tampered, key)
    } catch (error) {
      expect((error as Error).message).not.toContain('provider-secret-key')
    }
  })

  it('checks credential readability without exposing decryption failures', () => {
    const key = readAiConfigurationEncryptionKey(encryptionEnvironment)
    const encrypted = encryptAiCredential('provider-secret-key', key)

    expect(canDecryptAiCredential(encrypted, encryptionEnvironment)).toBe(true)
    expect(canDecryptAiCredential(encrypted, {})).toBe(false)
    expect(
      canDecryptAiCredential(encrypted, { AI_CONFIG_ENCRYPTION_KEY: 'b'.repeat(64) }),
    ).toBe(false)
    expect(canDecryptAiCredential('not-a-credential', encryptionEnvironment)).toBe(false)
  })

  it('keeps ciphertext unreadable outside the server-only readiness context', () => {
    expect(
      aiCredentialRead({ req: { context: {} } } as never),
    ).toBe(false)
    expect(
      aiCredentialRead({
        req: { context: portalAiReadinessCredentialReadContext },
      } as never),
    ).toBe(true)
  })
})
