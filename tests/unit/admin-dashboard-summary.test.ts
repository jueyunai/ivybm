import { describe, expect, it, vi } from 'vitest'

import type { Payload, PayloadRequest } from 'payload'

import { DASHBOARD_QUERY_BUDGET, getDashboardSummary } from '@/admin/dashboard/getDashboardSummary'

const createRequest = (role: 'admin' | 'operator' | 'sales'): PayloadRequest =>
  ({
    user: { id: `${role}-user`, role },
  }) as unknown as PayloadRequest

describe('Operations Dashboard read model', () => {
  it('uses the current request, bounded fields, and no access override', async () => {
    const count = vi.fn().mockResolvedValue({ totalDocs: 2 })
    const find = vi.fn().mockResolvedValue({ docs: [] })
    const payload = { count, find } as unknown as Payload
    const req = createRequest('admin')

    const summary = await getDashboardSummary({ payload, req })

    expect(summary.queues).toEqual({
      activeConversations: 2,
      failedJobs: 2,
      handoffRequested: 2,
      newQualifiedLeads: 2,
    })
    expect(count).toHaveBeenCalledTimes(4)
    expect(find).toHaveBeenCalledTimes(3)
    expect(count).toHaveBeenCalledWith(expect.objectContaining({ overrideAccess: false, req }))
    expect(find).toHaveBeenCalledWith(
      expect.objectContaining({
        limit: 3,
        overrideAccess: false,
        pagination: false,
        req,
      }),
    )
    expect(find).not.toHaveBeenCalledWith(expect.objectContaining({ select: expect.objectContaining({ summary: true }) }))
    expect(DASHBOARD_QUERY_BUDGET).toBe(7)
  })

  it('does not query or expose Jobs to operators and scopes sales reads through normal access', async () => {
    const count = vi.fn().mockResolvedValue({ totalDocs: 0 })
    const find = vi.fn().mockResolvedValue({ docs: [] })
    const payload = { count, find } as unknown as Payload
    const req = createRequest('sales')

    const summary = await getDashboardSummary({ payload, req })

    expect(summary.queues.failedJobs).toBeUndefined()
    expect(count).toHaveBeenCalledTimes(3)
    expect(find).toHaveBeenCalledTimes(2)
    expect(count).not.toHaveBeenCalledWith(expect.objectContaining({ collection: 'jobs' }))
    expect(find).not.toHaveBeenCalledWith(expect.objectContaining({ collection: 'jobs' }))
    expect(count).toHaveBeenCalledWith(expect.objectContaining({ overrideAccess: false, req }))
  })

  it('returns only safe task references and no transcript, lead contact, job payload, or secret fields', async () => {
    const count = vi.fn().mockResolvedValue({ totalDocs: 1 })
    const find = vi
      .fn()
      .mockResolvedValueOnce({
        docs: [
          {
            handoffStatus: 'handoff_requested',
            id: 10,
            lastMessageAt: '2026-07-21T08:00:00.000Z',
            publicId: 'conversation-safe-reference',
            updatedAt: '2026-07-21T08:00:00.000Z',
          },
        ],
      })
      .mockResolvedValueOnce({
        docs: [
          {
            id: 20,
            intentLevel: 'a',
            status: 'qualified',
            updatedAt: '2026-07-21T08:05:00.000Z',
          },
        ],
      })
      .mockResolvedValueOnce({
        docs: [
          {
            id: 30,
            status: 'failed',
            type: 'sync-knowledge',
            updatedAt: '2026-07-21T08:10:00.000Z',
          },
        ],
      })
    const payload = { count, find } as unknown as Payload

    const summary = await getDashboardSummary({ payload, req: createRequest('admin') })
    const serialized = JSON.stringify(summary)

    expect(serialized).toContain('conversation-safe-reference')
    expect(serialized).not.toMatch(/content|summary|message|email|phone|payload|token|key/i)
  })
})
