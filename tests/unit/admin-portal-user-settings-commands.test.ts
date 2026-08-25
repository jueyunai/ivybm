import { describe, expect, it, vi } from 'vitest'

import type { Payload, PayloadRequest } from 'payload'

import {
  assertNoActiveBusinessAssignments,
  assertRemainingAvailableAdmin,
  changePersonalPassword,
  createTeamMember,
  deleteTeamMember,
  getPortalTeamMembers,
  lockTeamMember,
  resetMemberPassword,
  unlockTeamMember,
  updateTeamMember,
} from '@/admin-portal/modules/settings/userSettingsCommands'
import {
  MANUAL_LOCK_UNTIL,
  UserSettingsCommandError,
} from '@/admin-portal/modules/settings/userSettingsContracts'

const mockReq = {
  transactionID: Promise.resolve('test-tx-1'),
  user: { collection: 'users', id: 1, role: 'admin' },
} as unknown as PayloadRequest

describe('Portal team account and user settings commands', () => {
  it('lists team members mapped to safe DTOs', async () => {
    const payload = {
      find: vi.fn().mockResolvedValue({
        docs: [
          {
            createdAt: '2026-08-01T00:00:00.000Z',
            email: 'admin@example.com',
            id: 1,
            role: 'admin',
            updatedAt: '2026-08-01T00:00:00.000Z',
          },
          {
            createdAt: '2026-08-02T00:00:00.000Z',
            email: 'sales@example.com',
            id: 2,
            role: 'sales',
            updatedAt: '2026-08-02T00:00:00.000Z',
          },
        ],
      }),
    } as unknown as Payload

    const members = await getPortalTeamMembers({ payload, req: mockReq })
    expect(members).toHaveLength(2)
    expect(members[0].email).toBe('admin@example.com')
    expect(members[1].role).toBe('sales')
  })

  it('creates a new team member successfully', async () => {
    const payload = {
      create: vi.fn().mockResolvedValue({
        createdAt: '2026-08-25T00:00:00.000Z',
        email: 'newuser@example.com',
        id: 3,
        role: 'operator',
        updatedAt: '2026-08-25T00:00:00.000Z',
      }),
      find: vi.fn().mockResolvedValue({ totalDocs: 0 }),
    } as unknown as Payload

    const member = await createTeamMember({
      actor: { id: 1, role: 'admin' },
      input: {
        confirmPassword: 'InitialPassword123!',
        email: '  NewUser@example.com  ',
        password: 'InitialPassword123!',
        role: 'operator',
      },
      payload,
      req: mockReq,
    })

    expect(payload.create).toHaveBeenCalledWith({
      collection: 'users',
      data: {
        email: 'newuser@example.com',
        password: 'InitialPassword123!',
        role: 'operator',
      },
      overrideAccess: false,
      req: mockReq,
    })
    expect(member.email).toBe('newuser@example.com')
    expect(member.role).toBe('operator')
  })

  it('rejects creating a team member when email already exists', async () => {
    const payload = {
      find: vi.fn().mockResolvedValue({ totalDocs: 1 }),
    } as unknown as Payload

    await expect(
      createTeamMember({
        actor: { id: 1, role: 'admin' },
        input: {
          confirmPassword: 'InitialPassword123!',
          email: 'existing@example.com',
          password: 'InitialPassword123!',
          role: 'sales',
        },
        payload,
        req: mockReq,
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<UserSettingsCommandError>>({
        code: 'email-already-exists',
        status: 409,
      }),
    )
  })

  it('prevents administrator from changing their own role', async () => {
    const payload = {
      findByID: vi.fn().mockResolvedValue({
        id: 1,
        role: 'admin',
        updatedAt: '2026-08-25T00:00:00.000Z',
      }),
    } as unknown as Payload

    await expect(
      updateTeamMember({
        actor: { id: 1, role: 'admin' },
        id: 1,
        input: {
          role: 'sales',
          updatedAt: '2026-08-25T00:00:00.000Z',
        },
        payload,
        req: mockReq,
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<UserSettingsCommandError>>({
        code: 'self-role-change-forbidden',
        status: 403,
      }),
    )
  })

  it('protects the last remaining available administrator from demotion, locking, or deletion', async () => {
    const payload = {
      db: {
        sessions: {
          'test-tx-1': {
            db: { execute: vi.fn() },
          },
        },
      },
      find: vi.fn().mockResolvedValue({ docs: [] }), // No other admins found
      findByID: vi.fn().mockResolvedValue({
        email: 'lastadmin@example.com',
        id: 1,
        role: 'admin',
        updatedAt: '2026-08-25T00:00:00.000Z',
      }),
    } as unknown as Payload

    await expect(
      assertRemainingAvailableAdmin({ excludingUserId: 1, payload, req: mockReq }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<UserSettingsCommandError>>({
        code: 'last-admin-protected',
        status: 409,
      }),
    )

    // When another active admin exists, it succeeds
    payload.find = vi.fn().mockResolvedValue({
      docs: [{ id: 2, lockUntil: null, role: 'admin' }],
    })
    await expect(
      assertRemainingAvailableAdmin({ excludingUserId: 1, payload, req: mockReq }),
    ).resolves.toBeUndefined()
  })

  it('prevents self-lock and self-deletion', async () => {
    const payload = {
      findByID: vi.fn().mockResolvedValue({
        email: 'admin@example.com',
        id: 1,
        role: 'admin',
        updatedAt: '2026-08-25T00:00:00.000Z',
      }),
    } as unknown as Payload

    await expect(
      lockTeamMember({
        actor: { id: 1, role: 'admin' },
        id: 1,
        input: { updatedAt: '2026-08-25T00:00:00.000Z' },
        payload,
        req: mockReq,
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<UserSettingsCommandError>>({
        code: 'self-lock-forbidden',
        status: 403,
      }),
    )

    await expect(
      deleteTeamMember({
        actor: { id: 1, role: 'admin' },
        id: 1,
        input: { confirmEmail: 'admin@example.com', updatedAt: '2026-08-25T00:00:00.000Z' },
        payload,
        req: mockReq,
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<UserSettingsCommandError>>({
        code: 'self-delete-forbidden',
        status: 403,
      }),
    )
  })

  it('rejects stale updatedAt concurrency conflict on update, reset password, lock, unlock, and delete', async () => {
    const payload = {
      findByID: vi.fn().mockResolvedValue({
        email: 'user@example.com',
        id: 2,
        role: 'operator',
        updatedAt: '2026-08-25T12:00:00.000Z',
      }),
    } as unknown as Payload

    const staleVersion = '2026-08-25T08:00:00.000Z'

    await expect(
      updateTeamMember({
        actor: { id: 1, role: 'admin' },
        id: 2,
        input: { role: 'sales', updatedAt: staleVersion },
        payload,
        req: mockReq,
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<UserSettingsCommandError>>({
        code: 'stale-user-version',
        status: 409,
      }),
    )

    await expect(
      resetMemberPassword({
        actor: { id: 1, role: 'admin' },
        id: 2,
        input: {
          confirmPassword: 'NewPassword123!',
          password: 'NewPassword123!',
          updatedAt: staleVersion,
        },
        payload,
        req: mockReq,
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<UserSettingsCommandError>>({
        code: 'stale-user-version',
        status: 409,
      }),
    )

    await expect(
      lockTeamMember({
        actor: { id: 1, role: 'admin' },
        id: 2,
        input: { updatedAt: staleVersion },
        payload,
        req: mockReq,
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<UserSettingsCommandError>>({
        code: 'stale-user-version',
        status: 409,
      }),
    )

    await expect(
      deleteTeamMember({
        actor: { id: 1, role: 'admin' },
        id: 2,
        input: { confirmEmail: 'user@example.com', updatedAt: staleVersion },
        payload,
        req: mockReq,
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<UserSettingsCommandError>>({
        code: 'stale-user-version',
        status: 409,
      }),
    )
  })

  it('rejects deletion when user has active leads, conversations, or handoffs', async () => {
    const payload = {
      count: vi.fn().mockImplementation(({ collection }) => {
        if (collection === 'leads') return Promise.resolve({ totalDocs: 2 })
        return Promise.resolve({ totalDocs: 0 })
      }),
      find: vi.fn().mockResolvedValue({ docs: [] }),
    } as unknown as Payload

    await expect(
      assertNoActiveBusinessAssignments({ payload, req: mockReq, userId: 5 }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<UserSettingsCommandError>>({
        code: 'user-has-assignments',
        details: expect.objectContaining({ leads: 2 }),
        status: 409,
      }),
    )
  })

  it('allows personal password change with valid current password and revokes existing sessions', async () => {
    const execute = vi.fn()
    const payload = {
      db: {
        sessions: {
          'test-tx-1': {
            db: { execute },
          },
        },
      },
      login: vi.fn().mockResolvedValue({ user: { id: 3 } }),
      update: vi.fn().mockResolvedValue({ id: 3 }),
    } as unknown as Payload

    const result = await changePersonalPassword({
      input: {
        confirmNewPassword: 'BrandNewPassword123!',
        currentPassword: 'OldPassword123!',
        newPassword: 'BrandNewPassword123!',
      },
      payload,
      req: mockReq,
      user: { email: 'self@example.com', id: 3, role: 'sales' },
    })

    expect(result).toEqual({ success: true })
    expect(payload.login).toHaveBeenCalledWith({
      collection: 'users',
      data: { email: 'self@example.com', password: 'OldPassword123!' },
      req: mockReq,
    })
    expect(payload.update).toHaveBeenCalledWith({
      collection: 'users',
      data: { password: 'BrandNewPassword123!' },
      id: 3,
      overrideAccess: false,
      req: mockReq,
    })
    expect(execute).toHaveBeenCalled()
  })

  it('rejects personal password change when current password is wrong or new password matches current', async () => {
    const payload = {
      login: vi.fn().mockRejectedValue(new Error('Invalid credentials')),
    } as unknown as Payload

    await expect(
      changePersonalPassword({
        input: {
          confirmNewPassword: 'BrandNewPassword123!',
          currentPassword: 'WrongPassword123!',
          newPassword: 'BrandNewPassword123!',
        },
        payload,
        req: mockReq,
        user: { email: 'self@example.com', id: 3, role: 'sales' },
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<UserSettingsCommandError>>({
        code: 'current-password-invalid',
        status: 400,
      }),
    )

    await expect(
      changePersonalPassword({
        input: {
          confirmNewPassword: 'SamePassword123!',
          currentPassword: 'SamePassword123!',
          newPassword: 'SamePassword123!',
        },
        payload,
        req: mockReq,
        user: { email: 'self@example.com', id: 3, role: 'sales' },
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<UserSettingsCommandError>>({
        code: 'invalid-input',
        status: 400,
      }),
    )
  })

  it('locks and unlocks member correctly', async () => {
    const execute = vi.fn()
    const payload = {
      db: {
        sessions: {
          'test-tx-1': {
            db: { execute },
          },
        },
      },
      findByID: vi.fn().mockResolvedValue({
        id: 2,
        role: 'operator',
        updatedAt: '2026-08-25T00:00:00.000Z',
      }),
      update: vi
        .fn()
        .mockResolvedValueOnce({
          createdAt: '2026-08-25T00:00:00.000Z',
          email: 'op@example.com',
          id: 2,
          lockUntil: MANUAL_LOCK_UNTIL,
          role: 'operator',
          updatedAt: '2026-08-25T00:01:00.000Z',
        })
        .mockResolvedValueOnce({
          createdAt: '2026-08-25T00:00:00.000Z',
          email: 'op@example.com',
          id: 2,
          lockUntil: null,
          role: 'operator',
          updatedAt: '2026-08-25T00:02:00.000Z',
        }),
    } as unknown as Payload

    const locked = await lockTeamMember({
      actor: { id: 1, role: 'admin' },
      id: 2,
      input: { updatedAt: '2026-08-25T00:00:00.000Z' },
      payload,
      req: mockReq,
    })
    expect(locked.status).toBe('manually_locked')
    expect(payload.update).toHaveBeenCalledWith({
      collection: 'users',
      data: { lockUntil: MANUAL_LOCK_UNTIL },
      id: 2,
      overrideAccess: false,
      req: mockReq,
    })

    const unlocked = await unlockTeamMember({
      actor: { id: 1, role: 'admin' },
      id: 2,
      input: { updatedAt: '2026-08-25T00:00:00.000Z' },
      payload,
      req: mockReq,
    })
    expect(unlocked.status).toBe('normal')
    expect(payload.update).toHaveBeenCalledWith({
      collection: 'users',
      data: { lockUntil: null, loginAttempts: 0 },
      id: 2,
      overrideAccess: false,
      req: mockReq,
    })
  })
})
