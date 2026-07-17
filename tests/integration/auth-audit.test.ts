import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getPayload, ValidationError, type Payload } from 'payload'

import type { AuditLog, User } from '@/payload-types'
import config from '@/payload.config'

let payload: Payload
let admin: User
let salesUser: User

const createdUserIds: Array<number | string> = []

const auditActorId = (auditLog: AuditLog): number | string | undefined =>
  typeof auditLog.actor === 'object' && auditLog.actor !== null
    ? auditLog.actor.id
    : (auditLog.actor ?? undefined)

describe.sequential('authentication and audit integration', () => {
  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL is required for authentication integration tests')
    }

    payload = await getPayload({
      config,
      disableOnInit: true,
      key: 'auth-audit-integration-tests',
    })

    admin = await payload.create({
      collection: 'users',
      context: { skipAudit: true },
      data: {
        email: `task3-admin-${randomUUID()}@example.invalid`,
        password: 'task3-admin-integration-password',
        role: 'admin',
      },
      overrideAccess: true,
    })
    createdUserIds.push(admin.id)
  })

  afterAll(async () => {
    if (!payload) {
      return
    }

    if (createdUserIds.length > 0) {
      await payload.delete({
        collection: 'audit-logs',
        overrideAccess: true,
        where: {
          or: [
            {
              actor: {
                equals: admin?.id,
              },
            },
            {
              documentId: {
                in: createdUserIds.map(String),
              },
            },
          ],
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

  it('records the administrator when a user is created', async () => {
    salesUser = await payload.create({
      collection: 'users',
      data: {
        email: `task3-sales-${randomUUID()}@example.invalid`,
        password: 'task3-sales-integration-password',
        role: 'sales',
      },
      overrideAccess: false,
      user: admin,
    })
    createdUserIds.push(salesUser.id)

    const auditLogs = await payload.find({
      collection: 'audit-logs',
      depth: 0,
      overrideAccess: true,
      where: {
        and: [
          { action: { equals: 'create' } },
          { resource: { equals: 'users' } },
          { documentId: { equals: String(salesUser.id) } },
        ],
      },
    })

    expect(auditLogs.totalDocs).toBe(1)
    expect(auditActorId(auditLogs.docs[0])).toBe(admin.id)
  })

  it('records user updates without storing changed credentials', async () => {
    await payload.update({
      collection: 'users',
      data: {
        email: `task3-sales-updated-${randomUUID()}@example.invalid`,
      },
      id: salesUser.id,
      overrideAccess: false,
      user: admin,
    })

    const auditLogs = await payload.find({
      collection: 'audit-logs',
      depth: 0,
      overrideAccess: true,
      where: {
        and: [
          { action: { equals: 'update' } },
          { resource: { equals: 'users' } },
          { documentId: { equals: String(salesUser.id) } },
        ],
      },
    })

    expect(auditLogs.totalDocs).toBe(1)
    expect(auditActorId(auditLogs.docs[0])).toBe(admin.id)
    expect(auditLogs.docs[0]).not.toHaveProperty('password')
    expect(auditLogs.docs[0]).not.toHaveProperty('token')
  })

  it('rejects passwords shorter than twelve characters', async () => {
    await expect(
      payload.create({
        collection: 'users',
        data: {
          email: `task3-short-password-${randomUUID()}@example.invalid`,
          password: 'too-short',
          role: 'sales',
        },
        overrideAccess: true,
      }),
    ).rejects.toBeInstanceOf(ValidationError)
  })

  it('prevents sales users from managing other users or changing roles', async () => {
    await expect(
      payload.create({
        collection: 'users',
        data: {
          email: `task3-forbidden-${randomUUID()}@example.invalid`,
          password: 'task3-forbidden-password',
          role: 'sales',
        },
        overrideAccess: false,
        user: salesUser,
      }),
    ).rejects.toMatchObject({ status: 403 })

    await expect(
      payload.update({
        collection: 'users',
        data: {
          email: `task3-admin-tampered-${randomUUID()}@example.invalid`,
        },
        id: admin.id,
        overrideAccess: false,
        user: salesUser,
      }),
    ).rejects.toBeDefined()

    const selfUpdated = await payload.update({
      collection: 'users',
      data: {
        email: `task3-sales-self-${randomUUID()}@example.invalid`,
        role: 'operator',
      },
      id: salesUser.id,
      overrideAccess: false,
      user: salesUser,
    })

    expect(selfUpdated.role).toBe('sales')
  })

  it('keeps audit logs immutable through ordinary access checks', async () => {
    const auditLogs = await payload.find({
      collection: 'audit-logs',
      limit: 1,
      overrideAccess: false,
      user: admin,
      where: {
        documentId: {
          equals: String(salesUser.id),
        },
      },
    })
    const auditLog = auditLogs.docs[0]

    expect(auditLog).toBeDefined()
    await expect(
      payload.update({
        collection: 'audit-logs',
        data: {
          resource: 'tampered',
        },
        id: auditLog.id,
        overrideAccess: false,
        user: admin,
      }),
    ).rejects.toMatchObject({ status: 403 })
  })
})
