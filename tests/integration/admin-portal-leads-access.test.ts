import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createLocalReq, getPayload, type Payload } from 'payload'

import { createPortalLead, deletePortalLead, updatePortalLead } from '@/admin-portal/modules/leads/leadCommands'
import type { User } from '@/payload-types'
import config from '@/payload.config'

let payload: Payload
let admin: User
let operator: User
let sales: User
let sourceID = 0
let createdLeadID = 0

const localReq = (user: User) => createLocalReq({ user }, payload)

const relationID = (value: unknown): number | undefined =>
  typeof value === 'number'
    ? value
    : value && typeof value === 'object' && typeof (value as { id?: unknown }).id === 'number'
      ? (value as { id: number }).id
      : undefined

describe.sequential('Portal lead command access', () => {
  beforeAll(async () => {
    payload = await getPayload({ config, disableOnInit: true, key: 'admin-portal-leads-access' })
    const suffix = randomUUID()
    admin = await payload.create({ collection: 'users', context: { skipAudit: true }, data: { email: `lead-admin-${suffix}@example.invalid`, password: 'lead-command-integration-password', role: 'admin' }, overrideAccess: true })
    operator = await payload.create({ collection: 'users', context: { skipAudit: true }, data: { email: `lead-operator-${suffix}@example.invalid`, password: 'lead-command-integration-password', role: 'operator' }, overrideAccess: true })
    sales = await payload.create({ collection: 'users', context: { skipAudit: true }, data: { email: `lead-sales-${suffix}@example.invalid`, password: 'lead-command-integration-password', role: 'sales' }, overrideAccess: true })
    const source = await payload.create({ collection: 'lead-sources', context: { skipAudit: true }, data: { channel: 'manual', isActive: true, key: `lead-portal-${suffix}`, name: 'Lead Portal test source' }, overrideAccess: true })
    sourceID = source.id
  })

  afterAll(async () => {
    if (!payload) return
    if (createdLeadID) await payload.delete({ collection: 'leads', context: { skipAudit: true }, id: createdLeadID, overrideAccess: true }).catch(() => undefined)
    if (sourceID) await payload.delete({ collection: 'lead-sources', context: { skipAudit: true }, id: sourceID, overrideAccess: true }).catch(() => undefined)
    await payload.delete({ collection: 'audit-logs', overrideAccess: true, where: { actor: { in: [admin?.id, operator?.id, sales?.id].filter(Boolean) } } }).catch(() => undefined)
    await payload.delete({ collection: 'users', context: { skipAudit: true }, overrideAccess: true, where: { id: { in: [admin?.id, operator?.id, sales?.id].filter(Boolean) } } }).catch(() => undefined)
    await payload.destroy()
  })

  it('creates, updates, and deletes through ACL-aware Portal commands with audit history', async () => {
    const adminReq = await localReq(admin)
    const created = await createPortalLead({
      input: {
        assignedToId: String(sales.id), country: 'United Arab Emirates', email: `portal-lead-${randomUUID()}@example.invalid`, idempotencyKey: `portal-lead-${randomUUID()}`,
        locale: 'en', message: 'Need specification for a local integration test.', name: 'Portal Lead Test', sourceId: String(sourceID),
      },
      payload, req: adminReq, role: 'admin',
    })
    createdLeadID = Number(created.id)
    expect(createdLeadID).toBeGreaterThan(0)

    const operatorReq = await localReq(operator)
    const updated = await updatePortalLead({
      id: createdLeadID,
      input: { status: 'contacted', updatedAt: created.updatedAt },
      payload, req: operatorReq, role: 'operator',
    })
    const lead = await payload.findByID({ collection: 'leads', id: createdLeadID, overrideAccess: true })
    expect(relationID(lead.assignedTo)).toBe(sales.id)
    expect(lead.status).toBe('contacted')
    expect(updated.updatedAt).not.toBe(created.updatedAt)

    const salesUpdated = await updatePortalLead({
      id: createdLeadID,
      input: {
        status: 'qualified',
        updatedAt: updated.updatedAt,
      },
      payload,
      req: await localReq(sales),
      role: 'sales',
    })
    expect((await payload.findByID({ collection: 'leads', id: createdLeadID, overrideAccess: true })).status).toBe('qualified')

    const audit = await payload.find({ collection: 'audit-logs', limit: 20, overrideAccess: true, where: { documentId: { equals: String(createdLeadID) } } })
    expect(audit.docs.map((entry) => entry.action)).toEqual(expect.arrayContaining(['create', 'update']))

    const deleted = await deletePortalLead({
      id: createdLeadID,
      input: { updatedAt: salesUpdated.updatedAt },
      payload, req: await localReq(admin), role: 'admin',
    })
    expect(deleted).toEqual({ id: createdLeadID })
    createdLeadID = 0
  })

  it('rejects sales lead creation before any write occurs', async () => {
    await expect(createPortalLead({
      input: { country: 'UAE', email: 'sales-create@example.invalid', idempotencyKey: `sales-${randomUUID()}`, locale: 'en', message: 'blocked', name: 'Blocked', sourceId: String(sourceID) },
      payload, req: await localReq(sales), role: 'sales',
    })).rejects.toMatchObject({ code: 'leads-admin-required', status: 403 })
  })
})
