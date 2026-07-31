import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { getPayload, type Payload } from 'payload'

import { PayloadJobQueue } from '@/modules/jobs/claim'
import type { ClaimedJob } from '@/modules/jobs/contracts'
import {
  createFeishuHandoffNotifyJobHandler,
  createFeishuLeadSyncJobHandler,
  enqueuePendingFeishuJobs,
  FEISHU_HANDOFF_NOTIFY_JOB_TYPE,
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
      where: { type: { in: [FEISHU_LEAD_SYNC_JOB_TYPE, FEISHU_HANDOFF_NOTIFY_JOB_TYPE] } },
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

    await expect(enqueuePendingFeishuJobs({ payload })).resolves.toEqual({
      enabled: false,
      handoffs: { created: 0, duplicate: 0 },
      leads: { created: 0, duplicate: 0 },
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

  it('relays each lead revision and durable handoff event into idempotent jobs', async () => {
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
        source: source.id,
        sourceURL: 'https://ivybm.example.invalid/en/products',
        status: 'qualified',
      },
      overrideAccess: true,
    })
    leadID = lead.id

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
        lead: lead.id,
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
    expect(first).toMatchObject({ enabled: true, handoffs: { created: 1 }, leads: { created: 1 } })
    expect(duplicate).toMatchObject({ handoffs: { duplicate: 1 }, leads: { duplicate: 1 } })

    await payload.update({
      collection: 'leads',
      context,
      data: { message: 'Updated requirements include 1,200 square metres.' },
      id: lead.id,
      overrideAccess: true,
    })
    const revised = await enqueuePendingFeishuJobs({ payload })
    expect(revised).toMatchObject({ handoffs: { duplicate: 1 }, leads: { created: 1 } })

    const jobs = await payload.find({
      collection: 'jobs',
      limit: 10,
      overrideAccess: true,
      where: { type: { in: [FEISHU_LEAD_SYNC_JOB_TYPE, FEISHU_HANDOFF_NOTIFY_JOB_TYPE] } },
    })
    expect(jobs.docs.filter((job) => job.type === FEISHU_LEAD_SYNC_JOB_TYPE)).toHaveLength(2)
    expect(jobs.docs.filter((job) => job.type === FEISHU_HANDOFF_NOTIFY_JOB_TYPE)).toHaveLength(1)
  })

  it('executes lead upsert and handoff notification through the server-only client port', async () => {
    const upsertRecord = vi.fn(async () => ({ recordId: 'rec-fixture', state: 'updated' as const }))
    const sendText = vi.fn(async () => ({ messageId: 'om-fixture' }))
    const client: FeishuClientPort = { sendText, upsertRecord }
    const jobs = await payload.find({
      collection: 'jobs',
      limit: 10,
      overrideAccess: true,
      sort: 'id',
      where: { type: { in: [FEISHU_LEAD_SYNC_JOB_TYPE, FEISHU_HANDOFF_NOTIFY_JOB_TYPE] } },
    })
    const latestLeadJob = jobs.docs.filter((job) => job.type === FEISHU_LEAD_SYNC_JOB_TYPE).at(-1)
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
