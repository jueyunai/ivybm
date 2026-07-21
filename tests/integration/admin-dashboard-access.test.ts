import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createLocalReq, getPayload, type Payload } from 'payload'

import { getDashboardSummary } from '@/admin/dashboard/getDashboardSummary'
import type { User } from '@/payload-types'
import config from '@/payload.config'

let payload: Payload
let admin: User
let operator: User
let sales: User
let createdLeadSourceID: number
const createdConversationIDs: number[] = []
const createdJobIDs: number[] = []
const createdLeadIDs: number[] = []
const createdUserIDs: number[] = []
const createdVisitorSessionIDs: number[] = []

const summaryFor = async (user: User) => {
  const req = await createLocalReq({ user }, payload)
  return getDashboardSummary({ payload, req })
}

describe.sequential('Operations Dashboard access', () => {
  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL is required for Operations Dashboard integration tests')
    }

    payload = await getPayload({
      config,
      disableOnInit: true,
      key: 'admin-dashboard-access-integration-tests',
    })

    const suffix = randomUUID()
    admin = await payload.create({
      collection: 'users',
      context: { skipAudit: true },
      data: {
        email: `admin-dashboard-admin-${suffix}@example.invalid`,
        password: 'admin-dashboard-integration-password',
        role: 'admin',
      },
      overrideAccess: true,
    })
    operator = await payload.create({
      collection: 'users',
      context: { skipAudit: true },
      data: {
        email: `admin-dashboard-operator-${suffix}@example.invalid`,
        password: 'admin-dashboard-integration-password',
        role: 'operator',
      },
      overrideAccess: true,
    })
    sales = await payload.create({
      collection: 'users',
      context: { skipAudit: true },
      data: {
        email: `admin-dashboard-sales-${suffix}@example.invalid`,
        password: 'admin-dashboard-integration-password',
        role: 'sales',
      },
      overrideAccess: true,
    })
    createdUserIDs.push(admin.id, operator.id, sales.id)

    const source = await payload.create({
      collection: 'lead-sources',
      context: { skipAudit: true },
      data: {
        channel: 'manual',
        isActive: true,
        key: `admin-dashboard-${suffix}`,
        name: 'Admin dashboard test source',
      },
      overrideAccess: true,
    })
    createdLeadSourceID = source.id

    const assignedLead = await payload.create({
      collection: 'leads',
      context: { skipAudit: true },
      data: {
        assignedTo: sales.id,
        country: 'Test Country',
        email: `assigned-${suffix}@example.invalid`,
        idempotencyKey: `admin-dashboard-assigned-${suffix}`,
        intentLevel: 'a',
        locale: 'en',
        message: 'Sensitive lead details must not reach the dashboard summary.',
        name: 'Assigned lead contact',
        requestId: `admin-dashboard-assigned-${suffix}`,
        source: source.id,
        status: 'qualified',
      },
      overrideAccess: true,
    })
    const unassignedLead = await payload.create({
      collection: 'leads',
      context: { skipAudit: true },
      data: {
        country: 'Test Country',
        email: `unassigned-${suffix}@example.invalid`,
        idempotencyKey: `admin-dashboard-unassigned-${suffix}`,
        intentLevel: 'unscored',
        locale: 'en',
        message: 'Other lead details must remain out of sales scope.',
        name: 'Unassigned lead contact',
        requestId: `admin-dashboard-unassigned-${suffix}`,
        source: source.id,
        status: 'new',
      },
      overrideAccess: true,
    })
    createdLeadIDs.push(assignedLead.id, unassignedLead.id)

    const createConversation = async (assignedTo?: number) => {
      const visitor = await payload.create({
        collection: 'visitor-sessions',
        context: { skipAudit: true },
        data: {
          channel: 'website',
          expiresAt: '2026-08-21T08:00:00.000Z',
          idempotencyKey: `admin-dashboard-visitor-${randomUUID()}`,
          lastSeenAt: '2026-07-21T08:00:00.000Z',
          locale: 'en',
          publicId: `admin-dashboard-visitor-${randomUUID()}`,
          sessionTokenHash: randomUUID().replaceAll('-', ''),
        },
        overrideAccess: true,
      })
      createdVisitorSessionIDs.push(visitor.id)

      const conversation = await payload.create({
        collection: 'conversations',
        context: { skipAudit: true },
        data: {
          ...(assignedTo === undefined ? {} : { assignedTo }),
          channel: 'website',
          handoffStatus: 'handoff_requested',
          intentLevel: 'a',
          lastMessageAt: '2026-07-21T08:00:00.000Z',
          locale: 'en',
          publicId: `admin-dashboard-conversation-${randomUUID()}`,
          requestId: `admin-dashboard-request-${randomUUID()}`,
          revision: 1,
          summary: 'Sensitive transcript summary must not reach the dashboard summary.',
          visitorSession: visitor.id,
        },
        overrideAccess: true,
      })
      createdConversationIDs.push(conversation.id)
    }

    await createConversation(sales.id)
    await createConversation()

    const job = await payload.create({
      collection: 'jobs',
      context: { skipAudit: true },
      data: {
        attempts: 1,
        idempotencyKey: `admin-dashboard-job-${suffix}`,
        manualRetryCount: 0,
        maxAttempts: 5,
        payload: { secret: 'never expose this payload' },
        status: 'failed',
        type: 'admin-dashboard-test',
      },
      overrideAccess: true,
    })
    createdJobIDs.push(job.id)
  })

  afterAll(async () => {
    if (!payload) return

    for (const [collection, ids] of [
      ['jobs', createdJobIDs],
      ['conversations', createdConversationIDs],
      ['visitor-sessions', createdVisitorSessionIDs],
      ['leads', createdLeadIDs],
    ] as const) {
      if (ids.length > 0) {
        await payload.delete({
          collection,
          context: { skipAudit: true },
          overrideAccess: true,
          where: { id: { in: ids } },
        })
      }
    }

    if (createdLeadSourceID) {
      await payload.delete({
        collection: 'lead-sources',
        context: { skipAudit: true },
        id: createdLeadSourceID,
        overrideAccess: true,
      })
    }

    if (createdUserIDs.length > 0) {
      await payload.delete({
        collection: 'audit-logs',
        overrideAccess: true,
        where: { actor: { in: createdUserIDs } },
      })
      await payload.delete({
        collection: 'users',
        context: { skipAudit: true },
        overrideAccess: true,
        where: { id: { in: createdUserIDs } },
      })
    }

    await payload.destroy()
  })

  it('shows global operational queues and failed jobs only to the administrator', async () => {
    const summary = await summaryFor(admin)

    expect(summary.queues.handoffRequested).toBeGreaterThanOrEqual(2)
    expect(summary.queues.newQualifiedLeads).toBeGreaterThanOrEqual(2)
    expect(summary.queues.failedJobs).toBeGreaterThanOrEqual(1)
    expect(JSON.stringify(summary)).not.toMatch(/never expose|Sensitive|secret/i)
  })

  it('allows an operator to read operational queues but never exposes Jobs', async () => {
    const summary = await summaryFor(operator)

    expect(summary.queues.handoffRequested).toBeGreaterThanOrEqual(2)
    expect(summary.queues.newQualifiedLeads).toBeGreaterThanOrEqual(2)
    expect(summary.queues.failedJobs).toBeUndefined()
    expect(summary.urgentItems.some((item) => item.kind === 'job')).toBe(false)
  })

  it('restricts sales summaries and urgent items to only records assigned to that salesperson', async () => {
    const summary = await summaryFor(sales)

    expect(summary.queues.handoffRequested).toBe(1)
    expect(summary.queues.newQualifiedLeads).toBe(1)
    expect(summary.queues.failedJobs).toBeUndefined()
    expect(summary.urgentItems).toHaveLength(2)
    expect(summary.urgentItems.map((item) => item.kind).sort()).toEqual(['conversation', 'lead'])
  })
})
