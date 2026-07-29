import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createLocalReq, getPayload, type Payload } from 'payload'

import { getPortalOverview } from '@/admin-portal/modules/overview/getPortalOverview'
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

const overviewFor = async (user: User) => {
  const req = await createLocalReq({ user }, payload)
  return getPortalOverview({ payload, req })
}

describe.sequential('Portal overview access', () => {
  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL is required for Portal overview integration tests')
    }

    payload = await getPayload({
      config,
      disableOnInit: true,
      key: 'admin-portal-overview-access-integration-tests',
    })

    const suffix = randomUUID()
    admin = await payload.create({
      collection: 'users',
      context: { skipAudit: true },
      data: {
        email: `portal-overview-admin-${suffix}@example.invalid`,
        password: 'portal-overview-integration-password',
        role: 'admin',
      },
      overrideAccess: true,
    })
    operator = await payload.create({
      collection: 'users',
      context: { skipAudit: true },
      data: {
        email: `portal-overview-operator-${suffix}@example.invalid`,
        password: 'portal-overview-integration-password',
        role: 'operator',
      },
      overrideAccess: true,
    })
    sales = await payload.create({
      collection: 'users',
      context: { skipAudit: true },
      data: {
        email: `portal-overview-sales-${suffix}@example.invalid`,
        password: 'portal-overview-integration-password',
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
        key: `portal-overview-${suffix}`,
        name: 'Portal overview integration source',
      },
      overrideAccess: true,
    })
    createdLeadSourceID = source.id

    for (const assignedTo of [sales.id, undefined]) {
      const lead = await payload.create({
        collection: 'leads',
        context: { skipAudit: true },
        data: {
          ...(assignedTo === undefined ? {} : { assignedTo }),
          country: 'Sensitive Country',
          email: `portal-overview-${randomUUID()}@example.invalid`,
          idempotencyKey: `portal-overview-lead-${randomUUID()}`,
          intentLevel: 'a',
          locale: 'en',
          message: 'Sensitive lead message must never reach the Portal overview.',
          name: 'Sensitive lead name',
          requestId: `portal-overview-lead-${randomUUID()}`,
          source: source.id,
          status: 'qualified',
        },
        overrideAccess: true,
      })
      createdLeadIDs.push(lead.id)
    }

    const createConversation = async (
      handoffStatus: 'handoff_requested' | 'human_active',
      assignedTo?: number,
    ) => {
      const visitor = await payload.create({
        collection: 'visitor-sessions',
        context: { skipAudit: true },
        data: {
          channel: 'website',
          expiresAt: '2026-08-30T08:00:00.000Z',
          idempotencyKey: `portal-overview-visitor-${randomUUID()}`,
          lastSeenAt: '2026-07-30T08:00:00.000Z',
          locale: 'en',
          publicId: `portal-overview-visitor-${randomUUID()}`,
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
          handoffStatus,
          intentLevel: 'a',
          lastMessageAt: new Date().toISOString(),
          locale: 'en',
          publicId: `CNV-${randomUUID()}`,
          requestId: `portal-overview-request-${randomUUID()}`,
          revision: 1,
          summary: 'Sensitive transcript summary must never reach the Portal overview.',
          visitorSession: visitor.id,
        },
        overrideAccess: true,
      })
      createdConversationIDs.push(conversation.id)
    }

    await createConversation('handoff_requested', sales.id)
    await createConversation('human_active', sales.id)
    await createConversation('handoff_requested')

    const job = await payload.create({
      collection: 'jobs',
      context: { skipAudit: true },
      data: {
        attempts: 1,
        idempotencyKey: `portal-overview-job-${suffix}`,
        manualRetryCount: 0,
        maxAttempts: 5,
        payload: { secret: 'never expose this Portal job payload' },
        status: 'failed',
        type: 'portal-overview.integration',
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

  it('returns global safe queues and failed jobs only to administrators', async () => {
    const summary = await overviewFor(admin)

    expect(summary.queues.handoffRequested).toBeGreaterThanOrEqual(2)
    expect(summary.queues.activeConversations).toBeGreaterThanOrEqual(1)
    expect(summary.queues.newQualifiedLeads).toBeGreaterThanOrEqual(2)
    expect(summary.queues.failedJobs).toBeGreaterThanOrEqual(1)
    expect(summary.priorityItems.some((item) => item.kind === 'job')).toBe(true)
    expect(JSON.stringify(summary)).not.toMatch(
      /Sensitive|never expose|example\.invalid|secret|\/admin/i,
    )
  })

  it('never queries or returns Jobs for operators', async () => {
    const summary = await overviewFor(operator)

    expect(summary.queues.handoffRequested).toBeGreaterThanOrEqual(2)
    expect(summary.queues.failedJobs).toBeUndefined()
    expect(summary.priorityItems.some((item) => item.kind === 'job')).toBe(false)
  })

  it('lets Payload access restrict sales to assigned conversations and leads', async () => {
    const summary = await overviewFor(sales)

    expect(summary.queues.handoffRequested).toBe(1)
    expect(summary.queues.activeConversations).toBe(1)
    expect(summary.queues.newQualifiedLeads).toBe(1)
    expect(summary.queues.failedJobs).toBeUndefined()
    expect(summary.priorityItems.map((item) => item.kind).sort()).toEqual([
      'active-conversation',
      'handoff-request',
      'lead',
    ])
  })
})
