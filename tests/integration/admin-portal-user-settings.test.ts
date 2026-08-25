import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createLocalReq, getPayload, type Payload } from 'payload'

import type { User } from '@/payload-types'
import config from '@/payload.config'
import {
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
  UserSettingsCommandError,
} from '@/admin-portal/modules/settings/userSettingsContracts'

let payload: Payload
let adminA: User
let adminB: User
let operatorUser: User
let salesUser: User

const createdUserIds: Array<number | string> = []

describe.sequential('Portal team account and user settings database integration', () => {
  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL is required for user settings integration tests')
    }

    payload = await getPayload({
      config,
      disableOnInit: true,
      key: 'portal-user-settings-integration-tests',
    })

    const suffix = randomUUID()
    adminA = await payload.create({
      collection: 'users',
      context: { skipAudit: true },
      data: {
        email: `task16-adminA-${suffix}@example.invalid`,
        password: 'AdminPassword123!',
        role: 'admin',
      },
      overrideAccess: true,
    })
    adminB = await payload.create({
      collection: 'users',
      context: { skipAudit: true },
      data: {
        email: `task16-adminB-${suffix}@example.invalid`,
        password: 'AdminPassword123!',
        role: 'admin',
      },
      overrideAccess: true,
    })
    operatorUser = await payload.create({
      collection: 'users',
      context: { skipAudit: true },
      data: {
        email: `task16-operator-${suffix}@example.invalid`,
        password: 'OperatorPassword123!',
        role: 'operator',
      },
      overrideAccess: true,
    })
    salesUser = await payload.create({
      collection: 'users',
      context: { skipAudit: true },
      data: {
        email: `task16-sales-${suffix}@example.invalid`,
        password: 'SalesPassword123!',
        role: 'sales',
      },
      overrideAccess: true,
    })
    createdUserIds.push(adminA.id, adminB.id, operatorUser.id, salesUser.id)
  })

  afterAll(async () => {
    if (!payload) return

    if (createdUserIds.length > 0) {
      await payload.delete({
        collection: 'audit-logs',
        overrideAccess: true,
        where: {
          documentId: {
            in: createdUserIds.map(String),
          },
        },
      })

      await payload.delete({
        collection: 'users',
        context: { skipAudit: true },
        overrideAccess: true,
        where: {
          id: {
            in: createdUserIds,
          },
        },
      })
    }

    await payload.destroy()
  })

  it('allows admin to list all team members with sanitized DTO format', async () => {
    const req = await createLocalReq({ user: adminA }, payload)
    const members = await getPortalTeamMembers({ payload, req })

    expect(members.length).toBeGreaterThanOrEqual(4)
    const memberEmails = members.map((m) => m.email)
    expect(memberEmails).toContain(adminA.email)
    expect(memberEmails).toContain(operatorUser.email)
    expect(memberEmails).toContain(salesUser.email)

    for (const member of members) {
      expect(member).toHaveProperty('id')
      expect(member).toHaveProperty('email')
      expect(member).toHaveProperty('role')
      expect(member).toHaveProperty('status')
      expect(member).not.toHaveProperty('hash')
      expect(member).not.toHaveProperty('salt')
      expect(member).not.toHaveProperty('sessions')
      expect(member).not.toHaveProperty('password')
    }
  })

  it('creates, modifies, locks, unlocks, resets password, and deletes a member as admin', async () => {
    const req = await createLocalReq({ user: adminA }, payload)
    const newEmail = `task16-new-${randomUUID()}@example.invalid`

    // 1. Create member
    const created = await createTeamMember({
      actor: adminA,
      input: {
        confirmPassword: 'InitialSecretPassword123!',
        email: newEmail,
        password: 'InitialSecretPassword123!',
        role: 'sales',
      },
      payload,
      req,
    })
    createdUserIds.push(created.id)
    expect(created.email).toBe(newEmail)
    expect(created.role).toBe('sales')
    expect(created.status).toBe('normal')

    // 2. Update member email and role
    const updatedEmail = `task16-updated-${randomUUID()}@example.invalid`
    const updated = await updateTeamMember({
      actor: adminA,
      id: created.id,
      input: {
        email: updatedEmail,
        role: 'operator',
        updatedAt: created.updatedAt,
      },
      payload,
      req,
    })
    expect(updated.email).toBe(updatedEmail)
    expect(updated.role).toBe('operator')

    // 3. Reset password
    const reset = await resetMemberPassword({
      actor: adminA,
      id: created.id,
      input: {
        confirmPassword: 'ResetSecretPassword123!',
        password: 'ResetSecretPassword123!',
        updatedAt: updated.updatedAt,
      },
      payload,
      req,
    })
    expect(reset.status).toBe('normal')

    // 4. Lock member
    const locked = await lockTeamMember({
      actor: adminA,
      id: created.id,
      input: { updatedAt: reset.updatedAt },
      payload,
      req,
    })
    expect(locked.status).toBe('manually_locked')

    // 5. Unlock member
    const unlocked = await unlockTeamMember({
      actor: adminA,
      id: created.id,
      input: { updatedAt: locked.updatedAt },
      payload,
      req,
    })
    expect(unlocked.status).toBe('normal')

    // 6. Delete member
    const deleted = await deleteTeamMember({
      actor: adminA,
      id: created.id,
      input: {
        confirmEmail: updatedEmail,
        updatedAt: unlocked.updatedAt,
      },
      payload,
      req,
    })
    expect(deleted).toEqual({ deletedId: created.id, success: true })

    // Verify deletion
    const verifyDoc = await payload.findByID({
      collection: 'users',
      depth: 0,
      id: created.id,
      overrideAccess: true,
      req,
    })
    expect(verifyDoc).toBeNull()
  })

  it('allows personal password change and rejects incorrect current password', async () => {
    const req = await createLocalReq({ user: salesUser }, payload)

    // Incorrect current password
    await expect(
      changePersonalPassword({
        input: {
          confirmNewPassword: 'NewSalesPassword123!',
          currentPassword: 'WrongPassword123!',
          newPassword: 'NewSalesPassword123!',
        },
        payload,
        req,
        user: salesUser,
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<UserSettingsCommandError>>({
        code: 'current-password-invalid',
        status: 400,
      }),
    )

    // Correct current password
    const result = await changePersonalPassword({
      input: {
        confirmNewPassword: 'NewSalesPassword123!',
        currentPassword: 'SalesPassword123!',
        newPassword: 'NewSalesPassword123!',
      },
      payload,
      req,
      user: salesUser,
    })
    expect(result).toEqual({ success: true })

    // Verify login with new password succeeds
    const loginResult = await payload.login({
      collection: 'users',
      data: {
        email: salesUser.email,
        password: 'NewSalesPassword123!',
      },
      req,
    })
    expect(loginResult.user?.id).toBe(salesUser.id)
  })

  it('enforces self-protection: cannot self-role-change, self-lock, or self-delete', async () => {
    const req = await createLocalReq({ user: adminA }, payload)
    const currentAdmin = await payload.findByID({
      collection: 'users',
      depth: 0,
      id: adminA.id,
      overrideAccess: true,
      req,
    })
    if (!currentAdmin) throw new Error('adminA not found')

    await expect(
      updateTeamMember({
        actor: adminA,
        id: adminA.id,
        input: { role: 'operator', updatedAt: currentAdmin.updatedAt },
        payload,
        req,
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<UserSettingsCommandError>>({
        code: 'self-role-change-forbidden',
        status: 403,
      }),
    )

    await expect(
      lockTeamMember({
        actor: adminA,
        id: adminA.id,
        input: { updatedAt: currentAdmin.updatedAt },
        payload,
        req,
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<UserSettingsCommandError>>({
        code: 'self-lock-forbidden',
        status: 403,
      }),
    )

    await expect(
      deleteTeamMember({
        actor: adminA,
        id: adminA.id,
        input: { confirmEmail: adminA.email, updatedAt: currentAdmin.updatedAt },
        payload,
        req,
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<UserSettingsCommandError>>({
        code: 'self-delete-forbidden',
        status: 403,
      }),
    )
  })

  it('prevents deleting a member with assigned leads or conversations', async () => {
    const req = await createLocalReq({ user: adminA }, payload)
    const suffix = randomUUID()

    const assignedSales = await payload.create({
      collection: 'users',
      context: { skipAudit: true },
      data: {
        email: `task16-assigned-${suffix}@example.invalid`,
        password: 'SalesPassword123!',
        role: 'sales',
      },
      overrideAccess: true,
    })
    createdUserIds.push(assignedSales.id)

    const source = await payload.create({
      collection: 'lead-sources',
      context: { skipAudit: true },
      data: {
        channel: 'manual',
        isActive: true,
        key: `lead-src-${suffix}`,
        name: 'Lead Source Test',
      },
      overrideAccess: true,
    })

    const lead = await payload.create({
      collection: 'leads',
      context: { skipAudit: true },
      data: {
        assignedTo: assignedSales.id,
        country: 'Saudi Arabia',
        email: `lead-${suffix}@example.invalid`,
        idempotencyKey: `lead-idemp-${suffix}`,
        intentLevel: 'a',
        locale: 'en',
        message: 'Active lead message',
        name: 'Active Lead Customer',
        requestId: `req-${suffix}`,
        source: source.id,
        status: 'qualified',
      },
      overrideAccess: true,
    })

    await expect(
      deleteTeamMember({
        actor: adminA,
        id: assignedSales.id,
        input: {
          confirmEmail: assignedSales.email,
          updatedAt: assignedSales.updatedAt,
        },
        payload,
        req,
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<UserSettingsCommandError>>({
        code: 'user-has-assignments',
        status: 409,
      }),
    )

    // Clean up lead and source
    await payload.delete({ collection: 'leads', id: lead.id, overrideAccess: true })
    await payload.delete({ collection: 'lead-sources', id: source.id, overrideAccess: true })
  })
})
