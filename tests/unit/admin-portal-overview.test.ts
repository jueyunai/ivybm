import { describe, expect, it, vi } from 'vitest'

import type { Payload, PayloadRequest } from 'payload'

import {
  getPortalOverview,
  PORTAL_OVERVIEW_QUERY_BUDGET,
  PortalOverviewReadError,
} from '@/admin-portal/modules/overview/getPortalOverview'

const requestFor = (role: 'admin' | 'operator' | 'sales'): PayloadRequest =>
  ({
    user: { collection: 'users', email: `${role}@example.invalid`, id: role, role },
  }) as unknown as PayloadRequest

describe('Portal overview read model', () => {
  it('uses at most seven access-controlled bounded queries and returns a safe Portal DTO', async () => {
    const count = vi.fn().mockResolvedValue({ totalDocs: 2 })
    const find = vi
      .fn()
      .mockResolvedValueOnce({
        docs: [
          {
            handoffStatus: 'handoff_requested',
            id: 10,
            lastMessageAt: '2026-07-30T08:00:00.000Z',
            publicId: 'CNV-0010',
            updatedAt: '2026-07-30T08:00:00.000Z',
          },
          {
            handoffStatus: 'human_active',
            id: 11,
            lastMessageAt: '2026-07-30T07:00:00.000Z',
            publicId: 'CNV-0011',
            updatedAt: '2026-07-30T07:00:00.000Z',
          },
        ],
      })
      .mockResolvedValueOnce({
        docs: [
          {
            id: 20,
            intentLevel: 'a',
            status: 'qualified',
            updatedAt: '2026-07-30T09:00:00.000Z',
          },
        ],
      })
      .mockResolvedValueOnce({
        docs: [
          {
            id: 30,
            status: 'failed',
            type: 'handoff.notify',
            updatedAt: '2026-07-30T10:00:00.000Z',
          },
        ],
      })
    const payload = { count, find } as unknown as Payload
    const req = requestFor('admin')

    const summary = await getPortalOverview({ payload, req })

    expect(PORTAL_OVERVIEW_QUERY_BUDGET).toBe(7)
    expect(count).toHaveBeenCalledTimes(4)
    expect(find).toHaveBeenCalledTimes(3)
    expect(count).toHaveBeenCalledWith(expect.objectContaining({ overrideAccess: false, req }))
    expect(find).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: 'conversations',
        depth: 0,
        limit: 3,
        overrideAccess: false,
        pagination: false,
        req,
        select: {
          handoffStatus: true,
          lastMessageAt: true,
          publicId: true,
          updatedAt: true,
        },
        where: { handoffStatus: { in: ['handoff_requested', 'human_active'] } },
      }),
    )
    expect(summary.queues.failedJobs).toBe(2)
    expect(summary.priorityItems.map((item) => item.kind)).toEqual([
      'job',
      'lead',
      'handoff-request',
      'active-conversation',
    ])
    expect(summary.dependencies).toEqual([
      { id: 'content-review', status: 'dependency-gated' },
      { id: 'publishing-today', status: 'dependency-gated' },
      { id: 'feishu-failures', status: 'dependency-gated' },
    ])

    const serialized = JSON.stringify(summary)
    expect(serialized).not.toMatch(/\/admin/i)
    expect(serialized).not.toMatch(
      /\"(href|summary|message|email|phone|payload|secret|token|key)\":/i,
    )
  })

  it('never queries or exposes Jobs outside the admin role', async () => {
    const count = vi.fn().mockResolvedValue({ totalDocs: 0 })
    const find = vi.fn().mockResolvedValue({ docs: [] })
    const payload = { count, find } as unknown as Payload

    const summary = await getPortalOverview({ payload, req: requestFor('operator') })

    expect(count).toHaveBeenCalledTimes(3)
    expect(find).toHaveBeenCalledTimes(2)
    expect(count).not.toHaveBeenCalledWith(expect.objectContaining({ collection: 'jobs' }))
    expect(find).not.toHaveBeenCalledWith(expect.objectContaining({ collection: 'jobs' }))
    expect(summary.queues.failedJobs).toBeUndefined()
    expect(summary.priorityItems).toEqual([])
  })

  it('surfaces query failures instead of returning a misleading empty summary', async () => {
    const payload = {
      count: vi.fn().mockRejectedValue(new Error('database unavailable')),
      find: vi.fn(),
    } as unknown as Payload

    await expect(
      getPortalOverview({ payload, req: requestFor('admin') }),
    ).rejects.toBeInstanceOf(PortalOverviewReadError)
  })
})
