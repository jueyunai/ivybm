import { describe, expect, it } from 'vitest'

import {
  PlatformCredentialError,
  canDecryptPlatformCredential,
  decryptPlatformCredential,
  encryptPlatformCredential,
  readPlatformCredentialEncryptionKey,
} from '@/modules/platforms/credentials'

const encryptionEnvironment = {
  PLATFORM_CREDENTIAL_ENCRYPTION_KEY: 'b'.repeat(64),
}

describe('platform credential encryption', () => {
  it('encrypts a credential with a versioned AES-GCM payload without retaining plaintext', () => {
    const key = readPlatformCredentialEncryptionKey(encryptionEnvironment)
    const encrypted = encryptPlatformCredential('platform-access-token', key)

    expect(encrypted).toMatch(/^v1:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$/)
    expect(encrypted).not.toContain('platform-access-token')
    expect(decryptPlatformCredential(encrypted, key)).toBe('platform-access-token')
  })

  it('rejects invalid keys and tampered ciphertext without echoing a credential', () => {
    expect(() =>
      readPlatformCredentialEncryptionKey({ PLATFORM_CREDENTIAL_ENCRYPTION_KEY: 'too-short' }),
    ).toThrow(PlatformCredentialError)

    const key = readPlatformCredentialEncryptionKey(encryptionEnvironment)
    const encrypted = encryptPlatformCredential('platform-access-token', key)
    const [version, iv, tag, ciphertext] = encrypted.split(':')
    const tamperedTag = `${tag[0] === 'x' ? 'y' : 'x'}${tag.slice(1)}`
    const tampered = [version, iv, tamperedTag, ciphertext].join(':')

    expect(() => decryptPlatformCredential(tampered, key)).toThrow(PlatformCredentialError)
    try {
      decryptPlatformCredential(tampered, key)
    } catch (error) {
      expect((error as Error).message).not.toContain('platform-access-token')
    }
  })

  it('checks credential readability without exposing decryption failures to callers', () => {
    const key = readPlatformCredentialEncryptionKey(encryptionEnvironment)
    const encrypted = encryptPlatformCredential('platform-access-token', key)

    expect(canDecryptPlatformCredential(encrypted, encryptionEnvironment)).toBe(true)
    expect(canDecryptPlatformCredential(encrypted, {})).toBe(false)
    expect(canDecryptPlatformCredential(encrypted, {
      PLATFORM_CREDENTIAL_ENCRYPTION_KEY: 'c'.repeat(64),
    })).toBe(false)
    expect(canDecryptPlatformCredential('not-a-credential', encryptionEnvironment)).toBe(false)
  })
})
