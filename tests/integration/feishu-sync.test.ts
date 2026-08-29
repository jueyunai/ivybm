import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { getPayload, type Payload } from 'payload'

import { PayloadJobQueue } from '@/modules/jobs/claim'
import type { ClaimedJob } from '@/modules/jobs/contracts'
import { findActiveFeishuMapping } from '@/modules/feishu/config'
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
import { createFeishuLeadResyncPlan, executeFeishuLeadResync } from '@/modules/feishu/resync'
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


const buildMinimalPDF = (): Buffer => {
  const objects = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n",
    "4 0 obj\n<< /Length 48 >>\nstream\nBT /F1 12 Tf 36 72 Td (IVYBM demo PDF) Tj ET\nendstream\nendobj\n",
    "5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n",
  ]
  let pdf = "%PDF-1.4\n"
  const offsets: number[] = []

  for (const object of objects) {
    offsets.push(Buffer.byteLength(pdf))
    pdf += object
  }

  const xrefOffset = Buffer.byteLength(pdf)
  pdf += `xref\n0 ${objects.length + 1}\n`
  pdf += "0000000000 65535 f \n"
  pdf += offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`
  pdf += `startxref\n${xrefOffset}\n%%EOF\n`

  return Buffer.from(pdf)
}

const runID = randomUUID()
const fieldMappings = [
  { localField: 'localLeadId' as const, required: true, targetField: 'Local Lead ID' },
  { localField: 'customerName' as const, required: true, targetField: 'Customer' },
  { localField: 'country' as const, required: false, targetField: 'Country' },
  { localField: 'source' as const, required: true, targetField: 'Source' },
  { localField: 'intentLevel' as const, required: true, targetField: 'Intent' },
  { localField: 'productNeed' as const, targetField: 'Product Need' },
  { localField: 'projectStage' as const, targetField: 'Project Stage' },
  { localField: 'email' as const, targetField: 'Email' },
  { localField: 'sourceURL' as const, targetField: 'Source URL' },
  { localField: 'originalInquiry' as const, targetField: 'Original Inquiry' },
  { localField: 'attachments' as const, required: false, targetField: 'Attachments' },
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
    await payload.delete({
      collection: 'jobs',
      context,
      overrideAccess: true,
      where: { id: { exists: true } },
    })
    await payload.delete({
      collection: 'feishu-mappings',
      context,
      overrideAccess: true,
      where: { id: { exists: true } },
    })
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
    await payload.delete({ collection: 'lead-attachments', context, overrideAccess: true, where: { id: { exists: true } } })
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
        hasDrawings: true,
        locale: 'en',
        message: 'Please review our drawings and quotation requirements.',
        name: 'Buyer Name',
        projectStage: 'tender',
        quantitySquareMeters: 3200,
        requestId: randomUUID(),
        source: sourceID,
        sourceURL: 'https://ivybm.example.invalid/en/products',
        status: 'qualified',
        timeline: 'within_3_months',
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

  it('creates an audited, explicit-ID resync job without notification side effects', async () => {
    const plan = await createFeishuLeadResyncPlan({ leadIds: [leadID], payload })
    expect(plan.leadIds).toEqual([leadID])
    expect(plan.planHash).toMatch(/^[a-f0-9]{64}$/u)

    const admin = await payload.create({
      collection: 'users',
      context,
      data: {
        email: `task11-resync-${runID}@example.invalid`,
        password: 'task11-resync-password',
        role: 'admin',
      },
      overrideAccess: true,
    })
    retryAdminID = admin.id

    const result = await executeFeishuLeadResync({
      payload,
      plan,
      requestedBy: admin.id,
    })
    expect(result).toMatchObject({ created: 1, duplicate: 0, planHash: plan.planHash })
    const job = result.jobs[0]
    if (!job) throw new Error('Expected explicit resync job')
    const createdJob = await payload.findByID({
      collection: 'jobs',
      depth: 0,
      id: job.id,
      overrideAccess: true,
    })
    expect(createdJob.type).toBe(FEISHU_LEAD_SYNC_JOB_TYPE)
    expect(jobPayload(createdJob.payload)).toMatchObject({
      entityId: leadID,
      notificationIntent: 'none',
    })

    const audit = await payload.find({
      collection: 'audit-logs',
      limit: 10,
      overrideAccess: true,
      where: {
        and: [
          { actor: { equals: admin.id } },
          { documentId: { equals: String(leadID) } },
          { resource: { equals: `feishu.lead.resync:${plan.planHash}` } },
        ],
      },
    })
    expect(audit.totalDocs).toBe(1)

    const duplicate = await executeFeishuLeadResync({
      payload,
      plan,
      requestedBy: admin.id,
    })
    expect(duplicate).toMatchObject({ created: 0, duplicate: 1, planHash: plan.planHash })
    const duplicateAudit = await payload.find({
      collection: 'audit-logs',
      limit: 10,
      overrideAccess: true,
      where: { resource: { equals: `feishu.lead.resync:${plan.planHash}` } },
    })
    expect(duplicateAudit.totalDocs).toBe(1)
  })

  it('rejects a resync plan when the Lead changes after dry-run', async () => {
    const plan = await createFeishuLeadResyncPlan({ leadIds: [leadID], payload })
    await payload.update({
      collection: 'leads',
      context,
      data: { message: 'Changed after the dry-run plan.' },
      id: leadID,
      overrideAccess: true,
    })
    await expect(
      executeFeishuLeadResync({ payload, plan, requestedBy: retryAdminID || 1 }),
    ).rejects.toThrow('plan changed')
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

  it('syncs and notifies a high-intent Lead whose country is still unconfirmed', async () => {
    const lead = await payload.create({
      collection: 'leads',
      context,
      data: {
        country: null,
        email: `country-pending-${runID}@example.invalid`,
        idempotencyKey: randomUUID(),
        intentLevel: 'a',
        locale: 'en',
        message: 'Please contact me about a facade project.',
        name: 'Country Pending Buyer',
        requestId: randomUUID(),
        source: sourceID,
        status: 'new',
      },
      overrideAccess: true,
    })
    extraLeadIDs.push(lead.id)
    const jobs = await payload.find({
      collection: 'jobs',
      limit: 100,
      overrideAccess: true,
      where: { type: { equals: FEISHU_LEAD_SYNC_JOB_TYPE } },
    })
    const job = jobs.docs.find(
      (candidate) =>
        jobPayload(candidate.payload).entityId === lead.id &&
        jobPayload(candidate.payload).entityRevision === feishuLeadSyncRevision(lead),
    )
    if (!job) throw new Error('Expected country-pending lead sync job')
    const sendText = vi.fn(async () => ({ messageId: randomUUID() }))
    const upsertRecord = vi.fn(async () => ({
      recordId: randomUUID(),
      state: 'created' as const,
    }))

    await createFeishuLeadSyncJobHandler({
      client: () => ({ sendText, upsertRecord }),
      payload,
    })(await claimedJob(job.id), {
      assertLease: vi.fn(),
      renewLease: vi.fn(),
      signal: new AbortController().signal,
    })

    expect(upsertRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        fields: expect.not.objectContaining({ Country: expect.anything() }),
      }),
    )
    expect(
      (sendText.mock.calls as unknown as Array<[SendTextInput]>)
        .map(([input]) => input.text)
        .join('\n'),
    ).toContain('待确认')
  })

  it('syncs and notifies an email-less social Lead through its verified messaging identity', async () => {
    const lead = await payload.create({
      collection: 'leads',
      context,
      data: {
        company: 'Messenger Facade Buyer',
        country: 'United Arab Emirates',
        email: null,
        idempotencyKey: randomUUID(),
        intentLevel: 'a',
        locale: 'en',
        message: 'Please quote our facade project through Messenger.',
        messagingAccountExternalId: 'page-feishu-02',
        messagingPlatform: 'facebook-messenger',
        messagingSenderExternalId: 'sender-feishu-02',
        messagingThreadExternalId: 'page-feishu-02:sender-feishu-02',
        name: 'Messenger Facade Buyer',
        phone: null,
        requestId: randomUUID(),
        source: sourceID,
        status: 'new',
      },
      overrideAccess: true,
    })
    extraLeadIDs.push(lead.id)
    const jobs = await payload.find({
      collection: 'jobs',
      limit: 100,
      overrideAccess: true,
      where: { type: { equals: FEISHU_LEAD_SYNC_JOB_TYPE } },
    })
    const job = jobs.docs.find(
      (candidate) =>
        jobPayload(candidate.payload).entityId === lead.id &&
        jobPayload(candidate.payload).entityRevision === feishuLeadSyncRevision(lead),
    )
    if (!job) throw new Error('Expected email-less social Lead sync job')
    const sendText = vi.fn(async () => ({ messageId: randomUUID() }))
    const upsertRecord = vi.fn(async () => ({
      recordId: randomUUID(),
      state: 'created' as const,
    }))

    await createFeishuLeadSyncJobHandler({
      client: () => ({ sendText, upsertRecord }),
      payload,
    })(await claimedJob(job.id), {
      assertLease: vi.fn(),
      renewLease: vi.fn(),
      signal: new AbortController().signal,
    })

    expect(upsertRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        fields: expect.objectContaining({
          Source: expect.stringContaining(
            'Facebook Messenger · Account page-feishu-02 · Sender sender-feishu-02 · Thread page-feishu-02:sender-feishu-02',
          ),
        }),
      }),
    )
    const upsert = (
      upsertRecord.mock.calls as unknown as Array<[Parameters<FeishuClientPort['upsertRecord']>[0]]>
    )[0]?.[0]
    expect(upsert?.fields).not.toHaveProperty('Email')
    const notifications = (sendText.mock.calls as unknown as Array<[SendTextInput]>)
      .map(([input]) => input.text)
      .join('\n')
    expect(notifications).toContain('新客户线索')
    expect(notifications).toContain('高意向客户')
    expect(notifications).toContain('Facebook Messenger')
    expect(notifications).toContain('sender-feishu-02')
    expect(notifications).not.toContain('@example.invalid')
  })

  it('delivers a new high-intent event when a lead returns to a prior content revision', async () => {
    const lead = await payload.create({
      collection: 'leads',
      context,
      data: {
        country: 'United Arab Emirates',
        email: `revisited-intent-${runID}@example.invalid`,
        idempotencyKey: randomUUID(),
        intentLevel: 'b',
        locale: 'en',
        message: 'Revisit a previously synchronized high-intent state.',
        name: 'Revisited Intent Buyer',
        requestId: randomUUID(),
        source: sourceID,
        status: 'new',
      },
      overrideAccess: true,
    })
    extraLeadIDs.push(lead.id)

    const leadJobs = async () => {
      const result = await payload.find({
        collection: 'jobs',
        limit: 100,
        overrideAccess: true,
        sort: 'id',
        where: { type: { equals: FEISHU_LEAD_SYNC_JOB_TYPE } },
      })
      return result.docs.filter((job) => jobPayload(job.payload).entityId === lead.id)
    }
    const complete = async (jobId: number) => {
      await payload.update({
        collection: 'jobs',
        context,
        data: {
          attempts: 1,
          completedAt: new Date().toISOString(),
          status: 'succeeded',
        },
        id: jobId,
        overrideAccess: true,
      })
    }
    const sendText = vi.fn(async () => ({ messageId: randomUUID() }))
    const client: FeishuClientPort = {
      sendText,
      upsertRecord: vi.fn(async () => ({ recordId: randomUUID(), state: 'updated' as const })),
    }
    const handler = createFeishuLeadSyncJobHandler({ client: () => client, payload })
    const lease = {
      assertLease: vi.fn(),
      renewLease: vi.fn(),
      signal: new AbortController().signal,
    }

    const createdJobs = await leadJobs()
    expect(createdJobs).toHaveLength(1)
    await complete(createdJobs[0]!.id)

    await payload.update({
      collection: 'leads',
      context,
      data: { message: 'Revisit a previously synchronized high-intent state.' },
      id: lead.id,
      overrideAccess: true,
    })
    expect(await leadJobs()).toHaveLength(1)

    await payload.update({
      collection: 'leads',
      context,
      data: { intentLevel: 'a' },
      id: lead.id,
      overrideAccess: true,
    })
    const firstHighJobs = await leadJobs()
    expect(firstHighJobs).toHaveLength(2)
    const firstHigh = firstHighJobs[1]!
    expect(jobPayload(firstHigh.payload).notificationIntent).toBe('high_intent')
    await handler(await claimedJob(firstHigh.id), lease)
    await complete(firstHigh.id)

    await payload.update({
      collection: 'leads',
      context,
      data: { intentLevel: 'b' },
      id: lead.id,
      overrideAccess: true,
    })
    const lowJobs = await leadJobs()
    expect(lowJobs).toHaveLength(3)
    await complete(lowJobs[2]!.id)

    await payload.update({
      collection: 'leads',
      context,
      data: { intentLevel: 'a' },
      id: lead.id,
      overrideAccess: true,
    })
    const revisitedJobs = await leadJobs()
    expect(revisitedJobs).toHaveLength(4)
    const revisitedHigh = revisitedJobs[3]!
    expect(jobPayload(revisitedHigh.payload).notificationIntent).toBe('high_intent')
    expect(jobPayload(revisitedHigh.payload).entityRevision).toBe(
      jobPayload(firstHigh.payload).entityRevision,
    )
    expect(jobPayload(revisitedHigh.payload).notificationEventRevision).not.toBe(
      jobPayload(firstHigh.payload).notificationEventRevision,
    )
    expect(revisitedHigh.idempotencyKey).not.toBe(firstHigh.idempotencyKey)

    await handler(await claimedJob(revisitedHigh.id), lease)
    const highIntentMessages = (sendText.mock.calls as unknown as Array<[SendTextInput]>).filter(
      ([input]) => input.text.includes('发现高意向客户'),
    )
    expect(highIntentMessages).toHaveLength(2)
    expect(highIntentMessages.map(([input]) => input.idempotencyKey)).toEqual([
      expect.stringContaining(String(jobPayload(firstHigh.payload).notificationEventRevision)),
      expect.stringContaining(String(jobPayload(revisitedHigh.payload).notificationEventRevision)),
    ])
    expect(highIntentMessages[0]?.[0].idempotencyKey).not.toBe(
      highIntentMessages[1]?.[0].idempotencyKey,
    )
  })

  it('carries one pending notification event across lead revisions', async () => {
    const lead = await payload.create({
      collection: 'leads',
      context,
      data: {
        country: 'Saudi Arabia',
        email: `pending-notification-${runID}@example.invalid`,
        idempotencyKey: randomUUID(),
        intentLevel: 'b',
        locale: 'en',
        message: 'Initial pending notification revision.',
        name: 'Pending Notification Buyer',
        requestId: randomUUID(),
        source: sourceID,
        status: 'new',
      },
      overrideAccess: true,
    })
    extraLeadIDs.push(lead.id)
    const leadJobs = async () => {
      const result = await payload.find({
        collection: 'jobs',
        limit: 100,
        overrideAccess: true,
        sort: 'id',
        where: { type: { equals: FEISHU_LEAD_SYNC_JOB_TYPE } },
      })
      return result.docs.filter((job) => jobPayload(job.payload).entityId === lead.id)
    }

    const createdJobs = await leadJobs()
    expect(createdJobs).toHaveLength(1)
    const createdJob = createdJobs[0]!
    const eventRevision = jobPayload(createdJob.payload).notificationEventRevision
    expect(jobPayload(createdJob.payload).notificationIntent).toBe('new_lead')
    expect(eventRevision).toEqual(expect.any(String))

    await payload.update({
      collection: 'leads',
      context,
      data: { message: 'A newer revision carries the same pending notification.' },
      id: lead.id,
      overrideAccess: true,
    })
    const revisedJobs = await leadJobs()
    expect(revisedJobs).toHaveLength(2)
    const revisedJob = revisedJobs[1]!
    expect(jobPayload(revisedJob.payload)).toMatchObject({
      notificationEventRevision: eventRevision,
      notificationIntent: 'new_lead',
    })

    await payload.update({
      collection: 'leads',
      context,
      data: { message: 'A newer revision carries the same pending notification.' },
      id: lead.id,
      overrideAccess: true,
    })
    expect(await leadJobs()).toHaveLength(2)

    const sendText = vi.fn(async () => ({ messageId: randomUUID() }))
    const upsertRecord = vi.fn(async () => ({
      recordId: randomUUID(),
      state: 'updated' as const,
    }))
    const handler = createFeishuLeadSyncJobHandler({
      client: () => ({ sendText, upsertRecord }),
      payload,
    })
    const lease = {
      assertLease: vi.fn(),
      renewLease: vi.fn(),
      signal: new AbortController().signal,
    }
    await handler(await claimedJob(createdJob.id), lease)
    expect(upsertRecord).not.toHaveBeenCalled()
    expect(sendText).not.toHaveBeenCalled()

    await handler(await claimedJob(revisedJob.id), lease)
    expect(upsertRecord).toHaveBeenCalledTimes(1)
    expect(sendText).toHaveBeenCalledTimes(1)
    expect(sendText).toHaveBeenCalledWith(
      expect.objectContaining({ text: expect.stringContaining('收到新客户线索') }),
    )
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
        reason: 'high_intent',
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

  it('fails closed pre-existing website recovery jobs at execution and preserves normal website and social notifications', async () => {
    const mapping = await findActiveFeishuMapping(payload)
    if (!mapping) throw new Error('Expected an active Feishu mapping')
    const queue = new PayloadJobQueue({ payload })
    const sendText = vi.fn(async () => ({ messageId: randomUUID() }))
    const upsertRecord = vi.fn(async () => ({
      recordId: randomUUID(),
      state: 'updated' as const,
    }))
    const client = vi.fn(async () => ({ sendText, upsertRecord }))
    const handler = createFeishuHandoffNotifyJobHandler({ client, payload })
    const execution = {
      assertLease: vi.fn(),
      renewLease: vi.fn(),
      signal: new AbortController().signal,
    }
    const extraHandoffIDs: number[] = []
    const extraJobIDs: number[] = []
    let socialConversationID: number | undefined
    let socialVisitorID: number | undefined

    const createHandoffJob = async ({
      channelConversationID,
      reason,
    }: {
      channelConversationID: number
      reason: string
    }): Promise<number> => {
      const suffix = randomUUID()
      const handoff = await payload.create({
        collection: 'handoffs',
        context,
        data: {
          conversation: channelConversationID,
          domainEventId: suffix,
          idempotencyKey: suffix,
          publicId: `handler-handoff-${suffix}`,
          reason,
          requestedAt: '2026-07-29T00:05:00.000Z',
          source: 'ai_policy',
          status: 'requested',
        },
        overrideAccess: true,
      })
      extraHandoffIDs.push(handoff.id)
      const queued = await queue.enqueue({
        idempotencyKey: `handler-job-${suffix}`,
        payload: {
          entityId: handoff.id,
          mappingId: mapping.id,
          mappingRevision: mapping.revision,
        },
        type: FEISHU_HANDOFF_NOTIFY_JOB_TYPE,
      })
      extraJobIDs.push(queued.job.id)
      return queued.job.id
    }

    try {
      const normalJobs = await payload.find({
        collection: 'jobs',
        limit: 100,
        overrideAccess: true,
        where: { type: { equals: FEISHU_HANDOFF_NOTIFY_JOB_TYPE } },
      })
      const highIntentJob = normalJobs.docs.find(
        (job) => jobPayload(job.payload).entityId === handoffID,
      )
      if (!highIntentJob) throw new Error('Expected the normal website high-intent job')
      await handler(await claimedJob(highIntentJob.id), execution)

      const qualificationJobID = await createHandoffJob({
        channelConversationID: conversationID,
        reason: 'qualification_complete',
      })
      await handler(await claimedJob(qualificationJobID), execution)
      expect(sendText).toHaveBeenCalledTimes(2)
      expect(client).toHaveBeenCalledTimes(2)

      for (const reason of [
        'ai_service_unavailable',
        'high_risk_topic',
        'reviewed_knowledge_unavailable',
      ]) {
        const recoveryJobID = await createHandoffJob({
          channelConversationID: conversationID,
          reason,
        })
        await handler(await claimedJob(recoveryJobID), execution)
        await handler(await claimedJob(recoveryJobID), execution)
      }
      expect(sendText).toHaveBeenCalledTimes(2)
      expect(upsertRecord).not.toHaveBeenCalled()
      expect(client).toHaveBeenCalledTimes(2)

      const socialVisitor = await payload.create({
        collection: 'visitor-sessions',
        context,
        data: {
          channel: 'facebook',
          expiresAt: '2026-08-05T00:00:00.000Z',
          idempotencyKey: randomUUID(),
          lastSeenAt: '2026-07-29T00:00:00.000Z',
          locale: 'en',
          publicId: `handler-social-visitor-${runID}`,
          sessionTokenHash: `handler-social-hash-${runID}`,
        },
        overrideAccess: true,
      })
      socialVisitorID = socialVisitor.id
      const socialConversation = await payload.create({
        collection: 'conversations',
        context,
        data: {
          channel: 'facebook',
          externalAccountId: 'handler-page-fixture',
          externalSenderId: 'handler-sender-fixture',
          externalThreadId: 'handler-page-fixture:handler-sender-fixture',
          handoffStatus: 'handoff_requested',
          intentLevel: 'a',
          locale: 'en',
          publicId: `handler-social-conversation-${runID}`,
          requestId: randomUUID(),
          revision: 1,
          visitorSession: socialVisitor.id,
        },
        overrideAccess: true,
      })
      socialConversationID = socialConversation.id
      const socialJobID = await createHandoffJob({
        channelConversationID: socialConversation.id,
        reason: 'high_risk_topic',
      })
      await handler(await claimedJob(socialJobID), execution)
      expect(sendText).toHaveBeenCalledTimes(3)
      expect(client).toHaveBeenCalledTimes(3)
    } finally {
      if (extraJobIDs.length > 0) {
        await payload.delete({
          collection: 'jobs',
          context,
          overrideAccess: true,
          where: { id: { in: extraJobIDs } },
        })
      }
      if (extraHandoffIDs.length > 0) {
        await payload.delete({
          collection: 'handoffs',
          context,
          overrideAccess: true,
          where: { id: { in: extraHandoffIDs } },
        })
      }
      if (socialConversationID) {
        await payload.delete({
          collection: 'conversations',
          context,
          id: socialConversationID,
          overrideAccess: true,
        })
      }
      if (socialVisitorID) {
        await payload.delete({
          collection: 'visitor-sessions',
          context,
          id: socialVisitorID,
          overrideAccess: true,
        })
      }
    }
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
        fields: expect.objectContaining({
          Country: 'United Arab Emirates',
          Customer: 'Acme Facades',
          Intent: 'A',
          'Original Inquiry': expect.stringMatching(
            /Project stage: tender[\s\S]*Quantity \(sqm\): 3200[\s\S]*Drawings available: Yes[\s\S]*Purchase timeline: within_3_months/u,
          ),
          'Product Need': 'Aluminum facade panels',
          'Project Stage': 'tender',
        }),
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
  it('syncs associated lead attachments to Feishu CRM with stable Portal URL and updates on attachment change', async () => {
    await payload.update({
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
      id: mappingID,
      overrideAccess: true,
    })

    const attachmentLead = await payload.create({
      collection: 'leads',
      context,
      data: {
        company: 'Facade Attachment Co',
        country: 'United Arab Emirates',
        email: `attachment-lead-${runID}@example.invalid`,
        idempotencyKey: randomUUID(),
        intentLevel: 'a',
        locale: 'en',
        message: 'Lead with private attachments.',
        name: 'Attachment Buyer',
        requestId: randomUUID(),
        source: sourceID,
        status: 'new',
      },
      overrideAccess: true,
    })
    extraLeadIDs.push(attachmentLead.id)

    const pdfBytes = buildMinimalPDF();
    const attachment = await payload.create({
      collection: 'lead-attachments',
      context,
      data: {
        associatedAt: new Date().toISOString(),
        byteSize: pdfBytes.byteLength,
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
        filename: 'facade-specs.pdf',
        lead: attachmentLead.id,
        mimeType: 'application/pdf',
        status: 'associated',
        ticketHash: 'hash-fixture',
      },
      file: {
        data: pdfBytes,
        mimetype: 'application/pdf',
        name: 'facade-specs.pdf',
        size: pdfBytes.byteLength,
      },
      overrideAccess: true,
    })

    const jobs = await payload.find({
      collection: 'jobs',
      limit: 100,
      overrideAccess: true,
      sort: '-id',
      where: { type: { equals: FEISHU_LEAD_SYNC_JOB_TYPE } },
    })
    const latestJob = jobs.docs.find(
      (job) => jobPayload(job.payload).entityId === attachmentLead.id,
    )
    if (!latestJob) throw new Error('Expected lead sync job for attachment lead')

    const upsertRecord = vi.fn(async () => ({ recordId: 'rec-att-1', state: 'created' as const }))
    const sendText = vi.fn(async () => ({ messageId: 'om-att' }))
    const client: FeishuClientPort = { sendText, upsertRecord }
    const handler = createFeishuLeadSyncJobHandler({ client: () => client, payload })

    await handler(await claimedJob(latestJob.id), {
      assertLease: vi.fn(),
      renewLease: vi.fn(),
      signal: new AbortController().signal,
    })

    expect(upsertRecord).toHaveBeenCalledTimes(1)
    expect(upsertRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        fields: expect.objectContaining({
          Attachments: `facade-specs.pdf: http://localhost:3000/dashboard/leads/${attachmentLead.id}`,
          Customer: 'Facade Attachment Co',
          'Local Lead ID': String(attachmentLead.id),
        }),
      }),
    )

    await payload.delete({
      collection: 'lead-attachments',
      context,
      id: attachment.id,
      overrideAccess: true,
    })
  })
});
