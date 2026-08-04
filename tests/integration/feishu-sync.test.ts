import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { getPayload, type Payload } from 'payload'

import { PayloadJobQueue } from '@/modules/jobs/claim'
import type { ClaimedJob } from '@/modules/jobs/contracts'
import {
  createFeishuFollowUpReminderJobHandler,
  createFeishuHandoffNotifyJobHandler,
  createFeishuLeadSyncFailureJobHandler,
  createFeishuLeadSyncJobHandler,
  enqueuePendingFeishuJobs,
  feishuLeadSyncRevision,
  FEISHU_FOLLOW_UP_REMINDER_JOB_TYPE,
  FEISHU_HANDOFF_NOTIFY_JOB_TYPE,
  FEISHU_LEAD_SYNC_FAILURE_JOB_TYPE,
  FEISHU_LEAD_SYNC_JOB_TYPE,
} from '@/modules/feishu/jobs'
import type { FeishuClientPort } from '@/modules/feishu/contracts'
import config from '@/payload.config'

let payload: Payload
let mappingID: number
let leadID: number
let handoffID: number
let sourceID: number
let visitorID: number
let conversationID: number
const extraLeadIDs: number[] = []
let retryAdminID: number
let historicalLeadID: number

const runID = randomUUID()
const fieldMappings = [
  { localField: 'localLeadId' as const, required: true, targetField: 'Local Lead ID' },
  { localField: 'customerName' as const, required: true, targetField: 'Customer' },
  { localField: 'country' as const, required: true, targetField: 'Country' },
  { localField: 'source' as const, required: true, targetField: 'Source' },
  { localField: 'intentLevel' as const, required: true, targetField: 'Intent' },
  { localField: 'email' as const, targetField: 'Email' },
  { localField: 'sourceURL' as const, targetField: 'Source URL' },
  { localField: 'originalInquiry' as const, targetField: 'Original Inquiry' },
]

const context = { skipAudit: true }
const jobPayload = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
type SendTextInput = Parameters<FeishuClientPort['sendText']>[0]

const claimedJob = async (id: number): Promise<ClaimedJob> => {
  const job = await new PayloadJobQueue({ payload }).getByID(id)
  if (!job) throw new Error(`Missing test job ${id}`)
  return {
    ...job,
    leaseExpiresAt: '2026-07-29T12:00:00.000Z',
    ownerToken: `fixture-owner-${id}`,
    status: 'processing',
  }
}

describe.sequential('Task 11 Feishu CRM integration', () => {
  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required')
    payload = await getPayload({ config, disableOnInit: true, key: 'task11-feishu-integration' })
  })

  afterAll(async () => {
    if (!payload) return
    await payload.delete({
      collection: 'jobs',
      context,
      overrideAccess: true,
      where: {
        type: {
          in: [
            FEISHU_LEAD_SYNC_JOB_TYPE,
            FEISHU_HANDOFF_NOTIFY_JOB_TYPE,
            FEISHU_FOLLOW_UP_REMINDER_JOB_TYPE,
            FEISHU_LEAD_SYNC_FAILURE_JOB_TYPE,
          ],
        },
      },
    })
    if (handoffID)
      await payload.delete({ collection: 'handoffs', context, id: handoffID, overrideAccess: true })
    if (conversationID)
      await payload.delete({
        collection: 'conversations',
        context,
        id: conversationID,
        overrideAccess: true,
      })
    if (visitorID)
      await payload.delete({
        collection: 'visitor-sessions',
        context,
        id: visitorID,
        overrideAccess: true,
      })
    if (leadID)
      await payload.delete({ collection: 'leads', context, id: leadID, overrideAccess: true })
    if (extraLeadIDs.length > 0)
      await payload.delete({
        collection: 'leads',
        context,
        overrideAccess: true,
        where: { id: { in: extraLeadIDs } },
      })
    if (sourceID)
      await payload.delete({
        collection: 'lead-sources',
        context,
        id: sourceID,
        overrideAccess: true,
      })
    if (mappingID)
      await payload.delete({
        collection: 'feishu-mappings',
        context,
        id: mappingID,
        overrideAccess: true,
      })
    if (retryAdminID) {
      await payload.delete({
        collection: 'audit-logs',
        context,
        overrideAccess: true,
        where: { actor: { equals: retryAdminID } },
      })
      await payload.delete({
        collection: 'users',
        context,
        id: retryAdminID,
        overrideAccess: true,
      })
    }
    await payload.destroy()
  })

  it('allows draft design before a Bitable exists and fails closed on invalid activation', async () => {
    const draft = await payload.create({
      collection: 'feishu-mappings',
      context,
      data: { key: `task11-${runID}`, name: 'Task 11 fixture', status: 'draft' },
      overrideAccess: true,
    })
    mappingID = draft.id

    const source = await payload.create({
      collection: 'lead-sources',
      context,
      data: {
        channel: 'ai-chat',
        isActive: true,
        key: `task11-source-${runID}`,
        name: 'Task 11 source',
      },
      overrideAccess: true,
    })
    sourceID = source.id
    const historical = await payload.create({
      collection: 'leads',
      context,
      data: {
        country: 'Qatar',
        email: `historical-${runID}@example.invalid`,
        idempotencyKey: randomUUID(),
        intentLevel: 'a',
        locale: 'en',
        message: 'Existing lead before Feishu was first enabled.',
        name: 'Historical Buyer',
        requestId: randomUUID(),
        source: source.id,
        status: 'qualified',
      },
      overrideAccess: true,
    })
    historicalLeadID = historical.id
    extraLeadIDs.push(historical.id)

    await expect(enqueuePendingFeishuJobs({ payload })).resolves.toEqual({
      enabled: false,
      failures: { created: 0, duplicate: 0 },
      handoffs: { created: 0, duplicate: 0 },
      leads: { created: 0, duplicate: 0 },
      reminders: { created: 0, duplicate: 0 },
    })

    await expect(
      payload.update({
        collection: 'feishu-mappings',
        context,
        data: { status: 'active' },
        id: draft.id,
        overrideAccess: true,
      }),
    ).rejects.toThrow('The following field is invalid: status')

    const active = await payload.update({
      collection: 'feishu-mappings',
      context,
      data: {
        appToken: 'bascn-fixture',
        fieldMappings,
        notificationRecipients: [
          {
            enabled: true,
            label: 'Sales group',
            receiveId: 'oc-fixture',
            receiveIdType: 'chat_id',
          },
        ],
        status: 'active',
        tableId: 'tbl-fixture',
      },
      id: draft.id,
      overrideAccess: true,
    })
    expect(active.status).toBe('active')

    const second = await payload.create({
      collection: 'feishu-mappings',
      context,
      data: {
        appToken: 'bascn-second',
        fieldMappings,
        key: `task11-second-${runID}`,
        name: 'Second fixture',
        notificationRecipients: [
          { enabled: true, receiveId: 'oc-second', receiveIdType: 'chat_id' },
        ],
        status: 'draft',
        tableId: 'tbl-second',
      },
      overrideAccess: true,
    })
    await expect(
      payload.update({
        collection: 'feishu-mappings',
        context,
        data: { status: 'active' },
        id: second.id,
        overrideAccess: true,
      }),
    ).rejects.toThrow('The following field is invalid: status')
    await payload.delete({
      collection: 'feishu-mappings',
      context,
      id: second.id,
      overrideAccess: true,
    })
  })

  it('serializes concurrent revisions for one lead across PostgreSQL worker sessions', async () => {
    const lead = await payload.create({
      collection: 'leads',
      context,
      data: {
        company: 'Acme Facades',
        country: 'United Arab Emirates',
        email: `task11-${runID}@example.invalid`,
        idempotencyKey: randomUUID(),
        intentLevel: 'a',
        interest: 'Aluminum facade panels',
        locale: 'en',
        message: 'Please review our drawings and quotation requirements.',
        name: 'Buyer Name',
        requestId: randomUUID(),
        source: sourceID,
        sourceURL: 'https://ivybm.example.invalid/en/products',
        status: 'qualified',
      },
      overrideAccess: true,
    })
    leadID = lead.id
    await enqueuePendingFeishuJobs({ payload })
    await payload.update({
      collection: 'leads',
      context,
      data: { message: 'Concurrent revision for the same lead.' },
      id: lead.id,
      overrideAccess: true,
    })
    await enqueuePendingFeishuJobs({ payload })

    const jobs = await payload.find({
      collection: 'jobs',
      limit: 100,
      overrideAccess: true,
      sort: 'id',
      where: { type: { equals: FEISHU_LEAD_SYNC_JOB_TYPE } },
    })
    const leadJobs = jobs.docs.filter((job) => jobPayload(job.payload).entityId === leadID)
    expect(leadJobs).toHaveLength(2)
    const staleJob = leadJobs[0]
    const currentJob = leadJobs[1]
    if (!staleJob || !currentJob) throw new Error('Expected stale and current lead sync jobs')

    let recordExists = false
    let createCount = 0
    let activeUpserts = 0
    let maxActiveUpserts = 0
    const upsertRecord = vi.fn(async () => {
      const sawExisting = recordExists
      activeUpserts += 1
      maxActiveUpserts = Math.max(maxActiveUpserts, activeUpserts)
      await new Promise<void>((resolve) => setTimeout(resolve, 40))
      activeUpserts -= 1
      if (!sawExisting) {
        recordExists = true
        createCount += 1
        return { recordId: 'rec-created-once', state: 'created' as const }
      }
      return { recordId: 'rec-created-once', state: 'updated' as const }
    })
    const client: FeishuClientPort = {
      sendText: vi.fn(async () => ({ messageId: 'om-concurrent' })),
      upsertRecord,
    }
    const handler = createFeishuLeadSyncJobHandler({ client: () => client, payload })
    const lease = {
      assertLease: vi.fn(),
      renewLease: vi.fn(),
      signal: new AbortController().signal,
    }

    await handler(await claimedJob(staleJob.id), lease)
    expect(upsertRecord).not.toHaveBeenCalled()

    const firstClaim = await claimedJob(currentJob.id)
    const reclaimedClaim = { ...firstClaim, ownerToken: `${firstClaim.ownerToken}-reclaimed` }
    await Promise.all([handler(firstClaim, lease), handler(reclaimedClaim, lease)])

    expect(upsertRecord).toHaveBeenCalledTimes(2)
    expect(createCount).toBe(1)
    expect(maxActiveUpserts).toBe(1)
  })

  it('queues one reminder per due timestamp and ignores stale reminder jobs', async () => {
    const dueAt = '2026-07-29T10:00:00.000Z'
    const now = new Date('2026-07-29T10:00:00.000Z')
    await payload.update({
      collection: 'leads',
      context,
      data: { nextFollowUpAt: dueAt },
      id: leadID,
      overrideAccess: true,
    })

    const first = await enqueuePendingFeishuJobs({ clock: () => now, payload })
    const duplicate = await enqueuePendingFeishuJobs({ clock: () => now, payload })
    expect(first.reminders.created).toBe(1)
    expect(duplicate.reminders.duplicate).toBe(1)

    const reminder = await payload.find({
      collection: 'jobs',
      limit: 1,
      overrideAccess: true,
      sort: '-id',
      where: { type: { equals: FEISHU_FOLLOW_UP_REMINDER_JOB_TYPE } },
    })
    const reminderJob = reminder.docs[0]
    if (!reminderJob) throw new Error('Expected follow-up reminder job')
    const sendText = vi.fn(async () => ({ messageId: 'om-followup' }))
    const client: FeishuClientPort = {
      sendText,
      upsertRecord: vi.fn(async () => ({ recordId: 'unused', state: 'updated' as const })),
    }
    const handler = createFeishuFollowUpReminderJobHandler({
      client: () => client,
      clock: () => now,
      payload,
    })
    const lease = {
      assertLease: vi.fn(),
      renewLease: vi.fn(),
      signal: new AbortController().signal,
    }
    await handler(await claimedJob(reminderJob.id), lease)
    expect(sendText).toHaveBeenCalledWith(
      expect.objectContaining({ text: expect.stringContaining('客户跟进已到期') }),
    )

    const rescheduledAt = '2027-07-30T10:00:00.000Z'
    await payload.update({
      collection: 'leads',
      context,
      data: { nextFollowUpAt: rescheduledAt },
      id: leadID,
      overrideAccess: true,
    })
    const rescheduled = await enqueuePendingFeishuJobs({
      clock: () => new Date(rescheduledAt),
      payload,
    })
    expect(rescheduled.reminders.created).toBe(1)
    await handler(await claimedJob(reminderJob.id), lease)
    expect(sendText).toHaveBeenCalledTimes(1)
  })

  it('recovers dead lead sync jobs into an idempotent failure notification and manual retry path', async () => {
    const mapping = await payload.findByID({
      collection: 'feishu-mappings',
      depth: 0,
      id: mappingID,
      overrideAccess: true,
    })
    const lead = await payload.findByID({
      collection: 'leads',
      depth: 0,
      id: leadID,
      overrideAccess: true,
    })
    const deadJob = await payload.create({
      collection: 'jobs',
      context,
      data: {
        attempts: 5,
        deadAt: '2026-07-29T11:00:00.000Z',
        idempotencyKey: `dead-lead-sync-${runID}`,
        lastError: 'sanitized sync failure',
        manualRetryCount: 0,
        maxAttempts: 5,
        payload: {
          entityId: leadID,
          entityRevision: feishuLeadSyncRevision(lead),
          mappingId: mapping.id,
          mappingRevision: mapping.updatedAt,
        },
        status: 'dead',
        type: FEISHU_LEAD_SYNC_JOB_TYPE,
      },
      overrideAccess: true,
    })

    const first = await enqueuePendingFeishuJobs({ payload })
    const duplicate = await enqueuePendingFeishuJobs({ payload })
    expect(first.failures.created).toBe(1)
    expect(duplicate.failures.duplicate).toBe(1)

    const notifications = await payload.find({
      collection: 'jobs',
      limit: 10,
      overrideAccess: true,
      where: { type: { equals: FEISHU_LEAD_SYNC_FAILURE_JOB_TYPE } },
    })
    const notification = notifications.docs.find(
      (job) => jobPayload(job.payload).sourceJobId === deadJob.id,
    )
    if (!notification) throw new Error('Expected lead sync failure notification job')
    const sendText = vi.fn(async () => ({ messageId: 'om-sync-failure' }))
    const client: FeishuClientPort = {
      sendText,
      upsertRecord: vi.fn(async () => ({ recordId: 'unused', state: 'updated' as const })),
    }
    await createFeishuLeadSyncFailureJobHandler({ client: () => client, payload })(
      await claimedJob(notification.id),
      {
        assertLease: vi.fn(),
        renewLease: vi.fn(),
        signal: new AbortController().signal,
      },
    )
    expect(sendText).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining(`Job ID：${deadJob.id}`),
      }),
    )
    expect(JSON.stringify(sendText.mock.calls)).not.toContain('sanitized sync failure')

    const retryAdmin = await payload.create({
      collection: 'users',
      context,
      data: {
        email: `task11-retry-${runID}@example.invalid`,
        password: 'task11-review-retry-password',
        role: 'admin',
      },
      overrideAccess: true,
    })
    retryAdminID = retryAdmin.id
    const retried = await new PayloadJobQueue({ payload }).retryManually(deadJob.id, retryAdmin)
    expect(retried).toMatchObject({
      attempts: 0,
      deadAt: null,
      manualRetryCount: 1,
      status: 'pending',
    })
    await payload.update({
      collection: 'jobs',
      context,
      data: {
        attempts: 5,
        deadAt: '2026-07-29T12:00:00.000Z',
        status: 'dead',
      },
      id: deadJob.id,
      overrideAccess: true,
    })

    const secondCycle = await enqueuePendingFeishuJobs({ payload })
    expect(secondCycle.failures.created).toBe(1)
    const cycleNotifications = await payload.find({
      collection: 'jobs',
      limit: 10,
      overrideAccess: true,
      sort: 'id',
      where: { type: { equals: FEISHU_LEAD_SYNC_FAILURE_JOB_TYPE } },
    })
    const secondNotification = cycleNotifications.docs.find(
      (candidate) =>
        jobPayload(candidate.payload).sourceJobId === deadJob.id &&
        jobPayload(candidate.payload).failureCycle === 1,
    )
    if (!secondNotification) throw new Error('Expected second failure-cycle notification job')
    await createFeishuLeadSyncFailureJobHandler({ client: () => client, payload })(
      await claimedJob(secondNotification.id),
      {
        assertLease: vi.fn(),
        renewLease: vi.fn(),
        signal: new AbortController().signal,
      },
    )
    expect(sendText).toHaveBeenCalledTimes(2)
    const failureSendCalls = sendText.mock.calls as unknown as Array<[SendTextInput]>
    expect(failureSendCalls[0]?.[0].idempotencyKey).toContain(
      `lead-sync-dead-job-${deadJob.id}-cycle-0`,
    )
    expect(failureSendCalls[1]?.[0].idempotencyKey).toContain(
      `lead-sync-dead-job-${deadJob.id}-cycle-1`,
    )
    expect(failureSendCalls[0]?.[0].idempotencyKey).not.toBe(
      failureSendCalls[1]?.[0].idempotencyKey,
    )

    let releaseFailureSend: () => void = () => {}
    const failureSendGate = new Promise<void>((resolve) => {
      releaseFailureSend = resolve
    })
    let markFailureSendStarted: () => void = () => {}
    const failureSendStarted = new Promise<void>((resolve) => {
      markFailureSendStarted = resolve
    })
    const lockingClient: FeishuClientPort = {
      sendText: vi.fn(async () => {
        markFailureSendStarted()
        await failureSendGate
        return { messageId: 'om-locking-failure' }
      }),
      upsertRecord: vi.fn(async () => ({ recordId: 'unused', state: 'updated' as const })),
    }
    const lockingHandler = createFeishuLeadSyncFailureJobHandler({
      client: () => lockingClient,
      payload,
    })(await claimedJob(secondNotification.id), {
      assertLease: vi.fn(),
      renewLease: vi.fn(),
      signal: new AbortController().signal,
    })
    await failureSendStarted
    let updateCommitted = false
    const concurrentUpdate = payload
      .update({
        collection: 'leads',
        context,
        data: { message: 'A newer revision synced after the old dead cycle.' },
        id: leadID,
        overrideAccess: true,
      })
      .then(() => {
        updateCommitted = true
      })
    await new Promise<void>((resolve) => setTimeout(resolve, 25))
    expect(updateCommitted).toBe(false)
    releaseFailureSend()
    await Promise.all([lockingHandler, concurrentUpdate])
    expect(updateCommitted).toBe(true)

    const superseded = await enqueuePendingFeishuJobs({ payload })
    expect(superseded.failures.created).toBe(0)
    const sendsBeforeStaleHandler = sendText.mock.calls.length
    await createFeishuLeadSyncFailureJobHandler({ client: () => client, payload })(
      await claimedJob(secondNotification.id),
      {
        assertLease: vi.fn(),
        renewLease: vi.fn(),
        signal: new AbortController().signal,
      },
    )
    expect(sendText).toHaveBeenCalledTimes(sendsBeforeStaleHandler)
  })

  it('syncs historical backfill without presenting it as a new or high-intent event', async () => {
    const historical = await payload.findByID({
      collection: 'leads',
      depth: 0,
      id: historicalLeadID,
      overrideAccess: true,
    })
    await enqueuePendingFeishuJobs({ payload })

    const jobs = await payload.find({
      collection: 'jobs',
      limit: 100,
      overrideAccess: true,
      where: { type: { equals: FEISHU_LEAD_SYNC_JOB_TYPE } },
    })
    const historicalJob = jobs.docs.find(
      (candidate) => jobPayload(candidate.payload).entityId === historical.id,
    )
    if (!historicalJob) throw new Error('Expected historical backfill sync job')
    expect(jobPayload(historicalJob.payload).notificationIntent).toBe('none')
    const sendText = vi.fn(async () => ({ messageId: 'om-unexpected' }))
    const upsertRecord = vi.fn(async () => ({
      recordId: 'rec-backfill',
      state: 'created' as const,
    }))
    await createFeishuLeadSyncJobHandler({
      client: () => ({ sendText, upsertRecord }),
      payload,
    })(await claimedJob(historicalJob.id), {
      assertLease: vi.fn(),
      renewLease: vi.fn(),
      signal: new AbortController().signal,
    })
    expect(upsertRecord).toHaveBeenCalledTimes(1)
    expect(sendText).not.toHaveBeenCalled()
  })

  it('uses the Dashboard predicate for high-intent lead notifications', async () => {
    const cases = [
      { high: true, status: 'new' as const },
      { high: true, status: 'qualified' as const },
      { high: false, status: 'contacted' as const },
      { high: false, status: 'disqualified' as const },
    ]
    const sendText = vi.fn(async () => ({ messageId: randomUUID() }))
    const client: FeishuClientPort = {
      sendText,
      upsertRecord: vi.fn(async () => ({ recordId: randomUUID(), state: 'created' as const })),
    }
    for (const item of cases) {
      const lead = await payload.create({
        collection: 'leads',
        context,
        data: {
          country: 'United Arab Emirates',
          email: `${item.status}-${runID}@example.invalid`,
          idempotencyKey: randomUUID(),
          intentLevel: 'a',
          locale: 'en',
          message: `Predicate fixture for ${item.status}.`,
          name: `${item.status} buyer`,
          requestId: randomUUID(),
          source: sourceID,
          status: item.status,
        },
        overrideAccess: true,
      })
      extraLeadIDs.push(lead.id)
      const revision = feishuLeadSyncRevision(lead)
      const jobs = await payload.find({
        collection: 'jobs',
        limit: 100,
        overrideAccess: true,
        where: { type: { equals: FEISHU_LEAD_SYNC_JOB_TYPE } },
      })
      const job = jobs.docs.find(
        (candidate) =>
          jobPayload(candidate.payload).entityId === lead.id &&
          jobPayload(candidate.payload).entityRevision === revision,
      )
      if (!job) throw new Error(`Expected ${item.status} lead-created sync job`)
      const before = sendText.mock.calls.length
      await createFeishuLeadSyncJobHandler({ client: () => client, payload })(
        await claimedJob(job.id),
        {
          assertLease: vi.fn(),
          renewLease: vi.fn(),
          signal: new AbortController().signal,
        },
      )
      const messages = (sendText.mock.calls as unknown as Array<[SendTextInput]>)
        .slice(before)
        .map(([input]) => input.text)
      expect(messages.some((text) => text.includes('收到新客户线索'))).toBe(true)
      expect(messages.some((text) => text.includes('发现高意向客户'))).toBe(item.high)
    }
  })

  it('relays each lead revision and durable handoff event into idempotent jobs', async () => {
    const visitor = await payload.create({
      collection: 'visitor-sessions',
      context,
      data: {
        channel: 'website',
        expiresAt: '2026-08-05T00:00:00.000Z',
        idempotencyKey: randomUUID(),
        lastSeenAt: '2026-07-29T00:00:00.000Z',
        locale: 'en',
        publicId: `visitor-${runID}`,
        sessionTokenHash: `hash-${runID}`,
      },
      overrideAccess: true,
    })
    visitorID = visitor.id
    const conversation = await payload.create({
      collection: 'conversations',
      context,
      data: {
        channel: 'website',
        handoffStatus: 'handoff_requested',
        intentLevel: 'a',
        lead: leadID,
        locale: 'en',
        publicId: `conversation-${runID}`,
        requestId: randomUUID(),
        revision: 2,
        visitorSession: visitor.id,
      },
      overrideAccess: true,
    })
    conversationID = conversation.id
    const handoff = await payload.create({
      collection: 'handoffs',
      context,
      data: {
        conversation: conversation.id,
        domainEventId: randomUUID(),
        idempotencyKey: randomUUID(),
        publicId: `handoff-${runID}`,
        reason: 'High intent customer requested a human quotation.',
        requestedAt: '2026-07-29T00:00:00.000Z',
        source: 'ai_policy',
        status: 'requested',
      },
      overrideAccess: true,
    })
    handoffID = handoff.id

    const first = await enqueuePendingFeishuJobs({ payload })
    const duplicate = await enqueuePendingFeishuJobs({ payload })
    expect(first).toMatchObject({
      enabled: true,
      handoffs: { created: 1 },
    })
    expect(first.leads.created).toBe(0)
    expect(first.leads.duplicate).toBeGreaterThanOrEqual(1)
    expect(duplicate.handoffs.duplicate).toBeGreaterThanOrEqual(1)
    expect(duplicate.leads.created).toBe(0)
    expect(duplicate.leads.duplicate).toBeGreaterThanOrEqual(1)

    await payload.update({
      collection: 'leads',
      context,
      data: { message: 'Updated requirements include 1,200 square metres.' },
      id: leadID,
      overrideAccess: true,
    })
    const revised = await enqueuePendingFeishuJobs({ payload })
    expect(revised.handoffs.duplicate).toBeGreaterThanOrEqual(1)
    expect(revised.leads.created).toBe(0)
    expect(revised.leads.duplicate).toBeGreaterThanOrEqual(1)

    const jobs = await payload.find({
      collection: 'jobs',
      limit: 100,
      overrideAccess: true,
      where: { type: { in: [FEISHU_LEAD_SYNC_JOB_TYPE, FEISHU_HANDOFF_NOTIFY_JOB_TYPE] } },
    })
    const leadSyncJobs = jobs.docs.filter(
      (job) =>
        job.type === FEISHU_LEAD_SYNC_JOB_TYPE && jobPayload(job.payload).entityId === leadID,
    )
    expect(leadSyncJobs.length).toBeGreaterThanOrEqual(2)
    const currentLead = await payload.findByID({
      collection: 'leads',
      depth: 0,
      id: leadID,
      overrideAccess: true,
    })
    expect(
      leadSyncJobs.some(
        (job) => jobPayload(job.payload).entityRevision === feishuLeadSyncRevision(currentLead),
      ),
    ).toBe(true)
    expect(
      jobs.docs.filter(
        (job) =>
          job.type === FEISHU_HANDOFF_NOTIFY_JOB_TYPE &&
          jobPayload(job.payload).entityId === handoffID,
      ),
    ).toHaveLength(1)
  })

  it('executes lead upsert and handoff notification through the server-only client port', async () => {
    const upsertRecord = vi.fn(async () => ({ recordId: 'rec-fixture', state: 'updated' as const }))
    const sendText = vi.fn(async () => ({ messageId: 'om-fixture' }))
    const client: FeishuClientPort = { sendText, upsertRecord }
    const jobs = await payload.find({
      collection: 'jobs',
      limit: 100,
      overrideAccess: true,
      sort: 'id',
      where: { type: { in: [FEISHU_LEAD_SYNC_JOB_TYPE, FEISHU_HANDOFF_NOTIFY_JOB_TYPE] } },
    })
    const latestLeadJob = jobs.docs
      .filter(
        (job) =>
          job.type === FEISHU_LEAD_SYNC_JOB_TYPE && jobPayload(job.payload).entityId === leadID,
      )
      .at(-1)
    const handoffJob = jobs.docs.find((job) => job.type === FEISHU_HANDOFF_NOTIFY_JOB_TYPE)
    if (!latestLeadJob || !handoffJob) throw new Error('Expected Feishu jobs were not relayed')
    const execution = {
      assertLease: vi.fn(),
      renewLease: vi.fn(),
      signal: new AbortController().signal,
    }

    await createFeishuLeadSyncJobHandler({ client: () => client, payload })(
      await claimedJob(latestLeadJob.id),
      execution,
    )
    await createFeishuHandoffNotifyJobHandler({ client: () => client, payload })(
      await claimedJob(handoffJob.id),
      execution,
    )

    expect(upsertRecord).toHaveBeenCalledTimes(1)
    expect(upsertRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        fields: expect.objectContaining({ Customer: 'Acme Facades', Intent: 'A' }),
        localLeadId: String(leadID),
      }),
    )
    expect(sendText).toHaveBeenCalledTimes(3)
    expect(sendText).toHaveBeenCalledWith(
      expect.objectContaining({ text: expect.stringContaining('新客户线索') }),
    )
    expect(sendText).toHaveBeenCalledWith(
      expect.objectContaining({ text: expect.stringContaining('高意向客户') }),
    )
    expect(sendText).toHaveBeenCalledWith(
      expect.objectContaining({ text: expect.stringContaining('人工接管') }),
    )

    await payload.update({
      collection: 'feishu-mappings',
      context,
      data: { status: 'disabled' },
      id: mappingID,
      overrideAccess: true,
    })
    await createFeishuLeadSyncJobHandler({ client: () => client, payload })(
      await claimedJob(latestLeadJob.id),
      execution,
    )
    expect(upsertRecord).toHaveBeenCalledTimes(1)
    expect(sendText).toHaveBeenCalledTimes(3)
  })
})
