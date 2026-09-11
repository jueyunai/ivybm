import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createLocalReq, getPayload, type Payload } from 'payload'

import type { User } from '@/payload-types'
import config from '@/payload.config'
import { executePortalCommand } from '@/admin-portal/core/commands/portalCommandReceipts'
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
  MANUAL_LOCK_UNTIL,
  UserSettingsCommandError,
} from '@/admin-portal/modules/settings/userSettingsContracts'
import { PORTAL_PERMISSION_PRESETS } from '@/access/roles'

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
    adminA = await payload.create({ collection: 'users',
      context: { skipAudit: true },
      draft: true, data: { username: `task16-adminA-${suffix}`,
        password: 'AdminPassword123!',
        role: 'admin',
      },
      overrideAccess: true,
    })
    adminB = await payload.create({ collection: 'users',
      context: { skipAudit: true },
      draft: true, data: { username: `task16-adminB-${suffix}`,
        password: 'AdminPassword123!',
        role: 'admin',
      },
      overrideAccess: true,
    })
    operatorUser = await payload.create({ collection: 'users',
      context: { skipAudit: true },
      draft: true, data: { username: `task16-operator-${suffix}`,
        password: 'OperatorPassword123!',
        role: 'operator',
      },
      overrideAccess: true,
    })
    salesUser = await payload.create({ collection: 'users',
      context: { skipAudit: true },
      draft: true, data: { username: `task16-sales-${suffix}`,
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
    const memberUsernames = members.map((m) => m.username)
    expect(memberUsernames).toContain(adminA.username)
    expect(memberUsernames).toContain(operatorUser.username)
    expect(memberUsernames).toContain(salesUser.username)

    for (const member of members) {
      expect(member).toHaveProperty('id')
      expect(member).toHaveProperty('username')
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
    const newUsername = `task16-new-${randomUUID()}.example.invalid`

    // 1. Create member
    const created = await createTeamMember({
      actor: adminA,
      input: {
        permissions: PORTAL_PERMISSION_PRESETS.sales,
        username: newUsername,
        password: 'InitialSecretPassword123!',
        role: 'sales',
      },
      payload,
      req,
    })
    createdUserIds.push(created.id)
    expect(created.username).toBe(newUsername)
    expect(created.role).toBe('sales')
    expect(created.status).toBe('normal')

    // 2. Update member username and role
    const updatedUsername = `task16-updated-${randomUUID().slice(0, 8)}`
    const updated = await updateTeamMember({
      actor: adminA,
      id: created.id,
      input: {
        username: updatedUsername,
        role: 'operator',
        updatedAt: created.updatedAt,
      },
      payload,
      req,
    })
    expect(updated.username).toBe(updatedUsername)
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
        confirmUsername: updatedUsername,
        updatedAt: unlocked.updatedAt,
      },
      payload,
      req,
    })
    expect(deleted).toEqual({ deletedId: created.id, success: true })

    // Verify deletion
    const verifyResult = await payload.find({
      collection: 'users',
      depth: 0,
      limit: 1,
      overrideAccess: true,
      req,
      where: { id: { equals: created.id } },
    })
    expect(verifyResult.totalDocs).toBe(0)
  })

  it('allows only one concurrent create for the same normalized username', async () => {
    const username = `task16-concurrent-${randomUUID().slice(0, 8)}`
    const [requestA, requestB] = await Promise.all([
      createLocalReq({ user: adminA }, payload),
      createLocalReq({ user: adminA }, payload),
    ])
    const create = (req: typeof requestA) =>
      createTeamMember({
        actor: adminA,
        input: {
          permissions: PORTAL_PERMISSION_PRESETS.sales,
          username,
          password: 'ConcurrentPassword123!',
          role: 'sales',
        },
        payload,
        req,
      })

    const results = await Promise.allSettled([create(requestA), create(requestB)])
    const fulfilled = results.filter(
      (result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof create>>> =>
        result.status === 'fulfilled',
    )
    const rejected = results.filter(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    )

    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    createdUserIds.push(fulfilled[0].value.id)
    expect(rejected[0].reason).toEqual(
      expect.objectContaining<Partial<UserSettingsCommandError>>({
        code: 'username-already-exists',
        status: 409,
      }),
    )
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
    const loginResult = await payload.login({ collection: 'users',
      data: {
        username: salesUser.username,
        password: 'NewSalesPassword123!',
      },
      req,
    })
    expect(loginResult.user?.id).toBe(salesUser.id)
  })

  it('enforces self-protection: cannot self-role-change, self-reset, self-lock, or self-delete', async () => {
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
      resetMemberPassword({
        actor: adminA,
        id: adminA.id,
        input: {
          confirmPassword: 'ReplacementAdminPassword123!',
          password: 'ReplacementAdminPassword123!',
          updatedAt: currentAdmin.updatedAt,
        },
        payload,
        req,
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<UserSettingsCommandError>>({
        code: 'self-reset-password-forbidden',
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
        input: { confirmUsername: adminA.username, updatedAt: currentAdmin.updatedAt },
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

  it('rejects an update that carries a stale user version', async () => {
    const req = await createLocalReq({ user: adminA }, payload)

    await expect(
      updateTeamMember({
        actor: adminA,
        id: operatorUser.id,
        input: {
          role: 'sales',
          updatedAt: '2000-01-01T00:00:00.000Z',
        },
        payload,
        req,
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<UserSettingsCommandError>>({
        code: 'stale-user-version',
        status: 409,
      }),
    )
  })

  it('serializes concurrent last-admin lock, demotion, and deletion commands', async () => {
    for (const operationName of ['lock', 'demote', 'delete'] as const) {
      const racePayload = await getPayload({
        config,
        disableOnInit: true,
        key: `portal-user-settings-race-${operationName}`,
      })
      const raceUserIds: Array<number | string> = []
      const baselineAdminLocks = new Map<number | string, string | null>()
      try {
        // Isolate this invariant test from seed/admin fixtures that may exist
        // in the shared integration database. The commands must prove that a
        // race over exactly two available administrators leaves one survivor.
        const existingAdmins = await racePayload.find({
          collection: 'users',
          depth: 0,
          limit: 100,
          overrideAccess: true,
          showHiddenFields: true,
          where: { role: { equals: 'admin' } },
        })
        for (const existingAdmin of existingAdmins.docs) {
          baselineAdminLocks.set(existingAdmin.id, existingAdmin.lockUntil ?? null)
          await racePayload.update({
            collection: 'users',
            context: { skipAudit: true },
            data: { lockUntil: MANUAL_LOCK_UNTIL } as never,
            id: existingAdmin.id,
            overrideAccess: true,
            showHiddenFields: true,
          })
        }

        const suffix = randomUUID()
        const raceAdminA = await racePayload.create({
          collection: 'users',
          context: { skipAudit: true },
          draft: true,
          data: {
            permissions: PORTAL_PERMISSION_PRESETS.admin,
            username: `task16-race-a-${operationName}-${suffix.slice(0, 8)}`,
            password: 'AdminPassword123!',
            role: 'admin',
          },
          overrideAccess: true,
        })
        const raceAdminB = await racePayload.create({
          collection: 'users',
          context: { skipAudit: true },
          draft: true,
          data: {
            permissions: PORTAL_PERMISSION_PRESETS.admin,
            username: `task16-race-b-${operationName}-${suffix.slice(0, 8)}`,
            password: 'AdminPassword123!',
            role: 'admin',
          },
          overrideAccess: true,
        })
        raceUserIds.push(raceAdminA.id, raceAdminB.id)

        const requestA = await createLocalReq({ user: raceAdminA }, racePayload)
        const requestB = await createLocalReq({ user: raceAdminB }, racePayload)
        const inputFor = (user: User) => ({
          username:
            operationName === 'demote'
              ? `task16-demoted-${String(user.id)}-${suffix.slice(0, 8)}`
              : undefined,
          role: operationName === 'demote' ? ('operator' as const) : undefined,
          updatedAt: user.updatedAt,
        })
        const commandFor = (target: User, actor: User, req: typeof requestA) =>
          executePortalCommand({
            fingerprintInput: { action: `task16-concurrent-${operationName}`, target: target.id },
            idempotencyKey: `task16-${operationName}-${randomUUID()}`,
            operation: async (transactionReq) => {
              if (operationName === 'lock') {
                return lockTeamMember({
                  actor: { id: actor.id, role: 'admin' },
                  id: target.id,
                  input: { updatedAt: target.updatedAt },
                  payload: racePayload,
                  req: transactionReq,
                })
              }
              if (operationName === 'demote') {
                return updateTeamMember({
                  actor: { id: actor.id, role: 'admin' },
                  id: target.id,
                  input: inputFor(target),
                  payload: racePayload,
                  req: transactionReq,
                })
              }
              return deleteTeamMember({
                actor: { id: actor.id, role: 'admin' },
                id: target.id,
                input: { confirmUsername: target.username, updatedAt: target.updatedAt },
                payload: racePayload,
                req: transactionReq,
              })
            },
            payload: racePayload,
            req,
            scope: `task16:concurrent-last-admin-${operationName}`,
            target: { collection: 'users', id: Number(target.id) },
          })

        const [resultA, resultB] = await Promise.allSettled([
          commandFor(raceAdminA, raceAdminB, requestB),
          commandFor(raceAdminB, raceAdminA, requestA),
        ])
        expect([resultA, resultB].filter((result) => result.status === 'fulfilled')).toHaveLength(1)
        expect([resultA, resultB].filter((result) => result.status === 'rejected')).toHaveLength(1)

        const currentUsers = await Promise.all(
          raceUserIds.map((id) =>
            racePayload
              .findByID({
                collection: 'users',
                depth: 0,
                id,
                overrideAccess: true,
                showHiddenFields: true,
              })
              .catch(() => null),
          ),
        )
        const availableAdmins = currentUsers.filter(
          (user) =>
            user?.role === 'admin' &&
            (!user.lockUntil || new Date(user.lockUntil).getTime() <= Date.now()),
        )
        expect(availableAdmins).toHaveLength(1)

        if (operationName === 'lock') {
          const lockedUser = currentUsers.find((user) => user?.lockUntil)
          if (!lockedUser) throw new Error('Expected one locked admin')
          const actor = currentUsers.find((user) => String(user?.id) !== String(lockedUser.id))
          if (!actor) throw new Error('Expected an available admin')
          await unlockTeamMember({
            actor: { id: actor.id, role: 'admin' },
            id: lockedUser.id,
            input: { updatedAt: lockedUser.updatedAt },
            payload: racePayload,
            req: await createLocalReq({ user: actor }, racePayload),
          })
        }
      } finally {
        await racePayload.destroy()
        if (raceUserIds.length || baselineAdminLocks.size) {
          const cleanupPayload = await getPayload({
            config,
            disableOnInit: true,
            key: `portal-user-settings-race-cleanup-${operationName}`,
          })
          if (raceUserIds.length) {
            await cleanupPayload.delete({
              collection: 'portal-command-receipts',
              context: { skipAudit: true },
              overrideAccess: true,
              where: { actor: { in: raceUserIds } },
            })
            await cleanupPayload.delete({
              collection: 'users',
              context: { skipAudit: true },
              overrideAccess: true,
              where: { id: { in: raceUserIds } },
            })
          }
          for (const [adminId, lockUntil] of baselineAdminLocks) {
            await cleanupPayload.update({
              collection: 'users',
              context: { skipAudit: true },
              data: { lockUntil } as never,
              id: adminId,
              overrideAccess: true,
              showHiddenFields: true,
            })
          }
          await cleanupPayload.destroy()
        }
      }
    }
  })

  it('prevents deleting a member with assigned leads or conversations', async () => {
    const req = await createLocalReq({ user: adminA }, payload)
    const suffix = randomUUID()

    const assignedSales = await payload.create({ collection: 'users',
      context: { skipAudit: true },
      draft: true, data: { username: `task16-assigned-${suffix}`,
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
          confirmUsername: assignedSales.username,
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
