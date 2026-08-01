import { describe, expect, it, vi } from 'vitest'

import {
  createPortalLead,
  updatePortalLead,
} from '@/admin-portal/modules/leads/leadCommands'
import { getLeadMutationPayload, type LeadForm } from '@/admin-portal/modules/leads/LeadsHub'
import { LEADS_MODULE } from '@/admin-portal/modules/leads/manifest'
import { parseLeadQuery } from '@/admin-portal/modules/leads/getLeadsPage'

const req = { user: { id: 1, role: 'admin' } } as never

const valid = {
  country: 'United Arab Emirates',
  email: 'lead@example.test',
  idempotencyKey: 'lead-unit-key',
  locale: 'en',
  message: 'We require a facade specification for a tender.',
  name: 'Lead Tester',
  sourceId: '4',
}

describe('Portal lead commands', () => {
  it('omits Sales-only system fields from an edit request', () => {
    const form: LeadForm = {
      assignedToId: '9', company: 'IVYBM', country: 'UAE', email: 'lead@example.test', id: 48,
      idempotencyKey: '', interest: '', intentLevel: 'a', locale: 'en', message: 'Need specifications.',
      name: 'Lead Tester', phone: '', sourceId: '4', status: 'contacted', updatedAt: '2026-07-30T09:00:00.000Z',
    }

    expect(getLeadMutationPayload(form, 'edit', 'sales')).not.toHaveProperty('assignedToId')
    expect(getLeadMutationPayload(form, 'edit', 'sales')).not.toHaveProperty('sourceId')
    expect(getLeadMutationPayload(form, 'edit', 'admin')).toMatchObject({ assignedToId: '9', sourceId: '4' })
  })

  it('registers a real module rather than a dependency-gated placeholder', () => {
    expect(LEADS_MODULE).toMatchObject({
      availability: 'available',
      commands: ['leads:create', 'leads:update', 'leads:delete'],
    })
  })

  it('normalizes lead query filters and ignores malformed values', () => {
    expect(parseLeadQuery({ intent: 'a', page: '3', q: '  facade  ', status: 'qualified' })).toEqual({
      intent: 'a', page: 3, q: 'facade', status: 'qualified',
    })
    expect(parseLeadQuery({ intent: 'unknown', page: '-1', status: 'broken' })).toMatchObject({
      intent: 'all', page: 1, status: 'all',
    })
  })

  it('creates a server-authorized lead with a stable idempotency key', async () => {
    const create = vi.fn().mockResolvedValue({ id: 44, updatedAt: '2026-07-30T08:00:00.000Z' })
    const payload = {
      create,
      find: vi.fn().mockResolvedValue({ docs: [] }),
      findByID: vi.fn().mockResolvedValue({ id: 4, isActive: true }),
    } as any

    await expect(createPortalLead({ input: valid, payload, req, role: 'admin' })).resolves.toEqual({
      id: 44,
      updatedAt: '2026-07-30T08:00:00.000Z',
    })
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      collection: 'leads',
      data: expect.objectContaining({ idempotencyKey: 'lead-unit-key', requestId: 'portal-lead:lead-unit-key' }),
      overrideAccess: false,
      req,
    }))
  })

  it('persists an administrator-selected assignee and lets Sales save unchanged system fields', async () => {
    const create = vi.fn().mockResolvedValue({ id: 47, updatedAt: '2026-07-30T08:00:00.000Z' })
    const payload = {
      create,
      find: vi.fn().mockResolvedValue({ docs: [] }),
      findByID: vi.fn().mockImplementation(({ id }: { id: number }) => {
        if (id === 4) return { id: 4, isActive: true }
        if (id === 9) return { id: 9 }
        return { assignedTo: 9, id: 48, source: 4, updatedAt: '2026-07-30T09:00:00.000Z' }
      }),
      update: vi.fn().mockResolvedValue({ id: 48, updatedAt: '2026-07-30T09:01:00.000Z' }),
    } as any

    await createPortalLead({
      input: { ...valid, assignedToId: '9' },
      payload,
      req,
      role: 'admin',
    })
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ assignedTo: 9 }),
    }))

    await expect(updatePortalLead({
      id: 48,
      input: {
        assignedToId: '9',
        sourceId: '4',
        status: 'contacted',
        updatedAt: '2026-07-30T09:00:00.000Z',
      },
      payload,
      req,
      role: 'sales',
    })).resolves.toEqual({ id: 48, updatedAt: '2026-07-30T09:01:00.000Z' })
    expect(payload.update).toHaveBeenCalledWith(expect.objectContaining({
      data: { status: 'contacted' },
      overrideAccess: false,
      req,
    }))
  })

  it('rejects Sales attempts to reassign a lead or change its source', async () => {
    const payload = {
      findByID: vi.fn().mockResolvedValue({ assignedTo: 9, id: 48, source: 4, updatedAt: '2026-07-30T09:00:00.000Z' }),
      update: vi.fn(),
    } as any

    await expect(updatePortalLead({
      id: 48,
      input: { assignedToId: '10', updatedAt: '2026-07-30T09:00:00.000Z' },
      payload,
      req,
      role: 'sales',
    })).rejects.toMatchObject({ code: 'leads-assignment-forbidden', status: 403 })
    await expect(updatePortalLead({
      id: 48,
      input: { sourceId: '5', updatedAt: '2026-07-30T09:00:00.000Z' },
      payload,
      req,
      role: 'sales',
    })).rejects.toMatchObject({ code: 'leads-source-forbidden', status: 403 })
    expect(payload.update).not.toHaveBeenCalled()
  })

  it('reuses an existing idempotent lead rather than creating a duplicate', async () => {
    const payload = {
      create: vi.fn(),
      find: vi.fn().mockResolvedValue({ docs: [{ id: 45, updatedAt: '2026-07-30T08:00:00.000Z' }] }),
      findByID: vi.fn().mockResolvedValue({ id: 4, isActive: true }),
    } as any

    await expect(createPortalLead({ input: valid, payload, req, role: 'admin' })).resolves.toEqual({
      id: 45,
      updatedAt: '2026-07-30T08:00:00.000Z',
    })
    expect(payload.create).not.toHaveBeenCalled()
  })

  it('rejects stale updates before writing mutable lead fields', async () => {
    const payload = {
      findByID: vi.fn().mockResolvedValue({ id: 46, updatedAt: '2026-07-30T09:00:00.000Z' }),
      update: vi.fn(),
    } as any
    await expect(updatePortalLead({
      id: 46,
      input: { status: 'contacted', updatedAt: '2026-07-30T08:00:00.000Z' },
      payload,
      req,
      role: 'operator',
    })).rejects.toMatchObject({ code: 'leads-stale-update', status: 409 })
    expect(payload.update).not.toHaveBeenCalled()
  })
})
