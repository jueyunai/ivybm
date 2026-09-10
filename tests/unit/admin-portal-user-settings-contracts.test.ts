import { describe, expect, it } from 'vitest'

import {
  portalCommandFingerprint,
  portalPasswordCommandFingerprint,
} from '@/admin-portal/core/commands/portalCommandReceipts'
import {
  MANUAL_LOCK_UNTIL,
  selectPortalTeamMemberDTO,
  UserSettingsCommandError,
  validatePassword,
  validateRole,
  validateUsername,
  validateUpdatedAt,
} from '@/admin-portal/modules/settings/userSettingsContracts'
import { PORTAL_PERMISSION_PRESETS } from '@/access/roles'

describe('User settings contracts and DTO sanitization', () => {
  it('sanitizes user documents into safe team member DTOs without sensitive fields', () => {
    const rawUser = {
      collection: 'users' as const,
      createdAt: '2026-08-01T00:00:00.000Z',
      username: 'member.example',
      hash: 'argon2$secret-hash-value',
      id: 42,
      loginAttempts: 0,
      permissions: PORTAL_PERMISSION_PRESETS.operator,
      resetPasswordExpiration: '2026-08-02T00:00:00.000Z',
      resetPasswordToken: 'sensitive-token-12345',
      role: 'operator' as const,
      salt: 'sensitive-salt-value',
      sessions: [{ createdAt: '2026-08-01', expiresAt: '2026-08-02', id: 'session-1' }],
      updatedAt: '2026-08-10T12:00:00.000Z',
    }

    const dto = selectPortalTeamMemberDTO(rawUser)

    expect(dto).toEqual({
      createdAt: '2026-08-01T00:00:00.000Z',
      permissions: PORTAL_PERMISSION_PRESETS.operator,
      username: 'member.example',
      id: 42,
      lockedUntil: null,
      role: 'operator',
      status: 'normal',
      updatedAt: '2026-08-10T12:00:00.000Z',
    })

    const json = JSON.stringify(dto)
    expect(json).not.toContain('argon2')
    expect(json).not.toContain('sensitive-hash')
    expect(json).not.toContain('sensitive-salt')
    expect(json).not.toContain('sensitive-token')
    expect(json).not.toContain('session-1')
  })

  it('maps manual lock and security lock to correct statuses', () => {
    const futureDate = new Date(Date.now() + 5 * 60 * 1000).toISOString()
    const securityLockedUser = {
      createdAt: '2026-08-01T00:00:00.000Z',
      username: 'locked.example',
      id: 10,
      lockUntil: futureDate,
      loginAttempts: 5,
      permissions: PORTAL_PERMISSION_PRESETS.sales,
      role: 'sales' as const,
      updatedAt: '2026-08-10T12:00:00.000Z',
    }

    const securityDto = selectPortalTeamMemberDTO(securityLockedUser)
    expect(securityDto.status).toBe('security_locked')
    expect(securityDto.lockedUntil).toBe(futureDate)

    const manuallyLockedUser = {
      createdAt: '2026-08-01T00:00:00.000Z',
      username: 'manually-locked.example',
      id: 11,
      lockUntil: MANUAL_LOCK_UNTIL,
      permissions: PORTAL_PERMISSION_PRESETS.sales,
      role: 'sales' as const,
      updatedAt: '2026-08-10T12:00:00.000Z',
    }

    const manualDto = selectPortalTeamMemberDTO(manuallyLockedUser)
    expect(manualDto.status).toBe('manually_locked')
    expect(manualDto.lockedUntil).toBeNull()

    const expiredLockUser = {
      createdAt: '2026-08-01T00:00:00.000Z',
      username: 'expired.example',
      id: 12,
      lockUntil: '2020-01-01T00:00:00.000Z',
      permissions: PORTAL_PERMISSION_PRESETS.sales,
      role: 'sales' as const,
      updatedAt: '2026-08-10T12:00:00.000Z',
    }
    const expiredDto = selectPortalTeamMemberDTO(expiredLockUser)
    expect(expiredDto.status).toBe('normal')
    expect(expiredDto.lockedUntil).toBeNull()
  })

  it('validates usernames with trimming and lowercase normalization', () => {
    expect(validateUsername('  Valid.Username  ')).toBe('valid.username')
    expect(() => validateUsername('invalid username')).toThrowError(
      expect.objectContaining({ code: 'invalid-input', status: 400 }) as UserSettingsCommandError,
    )
    expect(() => validateUsername('')).toThrow()
    expect(() => validateUsername(null)).toThrow()
  })

  it('validates password length between 12 and 128 characters without trimming', () => {
    const validPassword = '  valid-password-1234  '
    expect(validatePassword(validPassword)).toBe(validPassword)
    expect(validatePassword('123456789012')).toBe('123456789012')

    expect(() => validatePassword('short-pass')).toThrowError(
      expect.objectContaining({ code: 'invalid-input', status: 400 }) as UserSettingsCommandError,
    )
    expect(() => validatePassword('a'.repeat(129))).toThrow()
    expect(() => validatePassword(12345)).toThrow()
  })

  it('validates role values against allowed role set', () => {
    expect(validateRole('admin')).toBe('admin')
    expect(validateRole('operator')).toBe('operator')
    expect(validateRole('sales')).toBe('sales')

    expect(() => validateRole('superadmin')).toThrowError(
      expect.objectContaining({ code: 'invalid-input', status: 400 }) as UserSettingsCommandError,
    )
    expect(() => validateRole('')).toThrow()
  })

  it('validates updatedAt string requirement', () => {
    expect(validateUpdatedAt('2026-08-25T00:00:00.000Z')).toBe('2026-08-25T00:00:00.000Z')
    expect(() => validateUpdatedAt('')).toThrowError(
      expect.objectContaining({ code: 'invalid-input', status: 400 }) as UserSettingsCommandError,
    )
  })

  it('generates HMAC-backed password command fingerprints preventing plaintext or plain sha256 leakage', () => {
    const nonSensitive = { action: 'create_team_member', username: 'test.example', role: 'operator' }
    const passA = 'SecretPassword123!'
    const passB = 'DifferentPassword456!'

    const fpA1 = portalPasswordCommandFingerprint({
      nonSensitivePayload: nonSensitive,
      secret: 'test-secret-key-1',
      sensitiveInputs: [passA, passA],
    })
    const fpA2 = portalPasswordCommandFingerprint({
      nonSensitivePayload: nonSensitive,
      secret: 'test-secret-key-1',
      sensitiveInputs: [passA, passA],
    })
    const fpB = portalPasswordCommandFingerprint({
      nonSensitivePayload: nonSensitive,
      secret: 'test-secret-key-1',
      sensitiveInputs: [passB, passB],
    })
    const fpDifferentSecret = portalPasswordCommandFingerprint({
      nonSensitivePayload: nonSensitive,
      secret: 'test-secret-key-2',
      sensitiveInputs: [passA, passA],
    })

    expect(fpA1).toBe(fpA2)
    expect(fpA1).not.toBe(fpB)
    expect(fpA1).not.toBe(fpDifferentSecret)
    expect(fpA1).not.toBe(portalCommandFingerprint(passA))
  })

  it('fails closed when the password command HMAC secret is unavailable', () => {
    expect(() =>
      portalPasswordCommandFingerprint({
        nonSensitivePayload: { action: 'change_password' },
        secret: '',
        sensitiveInputs: ['SecretPassword123!'],
      }),
    ).toThrowError(
      expect.objectContaining({
        code: 'portal-command-secret-unavailable',
        status: 503,
      }),
    )
  })
})
