import { describe, expect, it, vi } from 'vitest'

vi.mock('payload', async (importOriginal) => {
  const actual = await importOriginal<typeof import('payload')>()
  return {
    ...actual,
    commitTransaction: vi.fn(),
    createLocalReq: vi.fn().mockImplementation(() => ({
      transactionID: Promise.resolve('tx1'),
    })),
    initTransaction: vi.fn(),
    killTransaction: vi.fn(),
  }
})

import type { ClaimedJob } from '@/modules/jobs/contracts'
import {
  createFeishuLeadSyncJobHandler,
  enqueueFeishuLeadAttachmentChange,
  feishuLeadSyncRevision,
  findAssociatedLeadAttachments,
} from '@/modules/feishu/jobs'
import type { FeishuClientPort } from '@/modules/feishu/contracts'

const mapping = {
  appToken: 'bascn-unit-test',
  fieldMappings: [
    { localField: 'localLeadId', required: true, targetField: 'Local Lead ID' },
    { localField: 'customerName', required: true, targetField: 'Customer' },
    { localField: 'country', required: false, targetField: 'Country' },
    { localField: 'source', required: true, targetField: 'Source' },
    { localField: 'intentLevel', required: true, targetField: 'Intent' },
    { localField: 'attachments', required: false, targetField: 'Attachments' },
  ],
  id: 1,
  key: 'unit-leads',
  memberMappings: [],
  notificationRecipients: [
    { enabled: true, label: 'Sales group', receiveId: 'oc_test', receiveIdType: 'chat_id' as const },
  ],
  revision: '2026-08-29T00:00:00.000Z',
  status: 'active',
  tableId: 'tbl-unit',
  updatedAt: '2026-08-29T00:00:00.000Z',
}

const baseLead = {
  id: 88,
  company: 'Façade Tech',
  country: 'UAE',
  intentLevel: 'a',
  message: 'Inquiry with attachment',
  name: 'Lead 88',
  requestId: 'req-88',
  source: { id: 1, label: 'Website' },
  status: 'new',
  updatedAt: '2026-08-29T10:00:00.000Z',
}

describe('Feishu Lead Attachments Sync unit tests', () => {
  it('finds only associated attachments and normalizes the fields', async () => {
    const find = vi.fn().mockResolvedValue({
      docs: [
        {
          byteSize: 1024,
          createdAt: '2026-08-29T10:00:00.000Z',
          filename: 'plan.dwg',
          id: 1,
          mimeType: 'application/acad',
          status: 'associated',
        },
      ],
    })
    const payload = { find, logger: { warn: vi.fn() } } as never

    const result = await findAssociatedLeadAttachments(payload, 88)
    expect(result).toEqual([
      {
        byteSize: 1024,
        createdAt: '2026-08-29T10:00:00.000Z',
        filename: 'plan.dwg',
        id: 1,
        mimeType: 'application/acad',
        status: 'associated',
      },
    ])
    expect(find).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: 'lead-attachments',
        where: {
          and: [{ lead: { equals: 88 } }, { status: { equals: 'associated' } }],
        },
      }),
    )
  })

  it('tolerates attachment query failure by returning empty array and logging warning', async () => {
    const warn = vi.fn()
    const find = vi.fn().mockRejectedValue(new Error('DB connection timeout'))
    const payload = { find, logger: { warn } } as never

    const result = await findAssociatedLeadAttachments(payload, 88)
    expect(result).toEqual([])
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('DB connection timeout'))
  })

  it('calculates deterministic revision regardless of attachment input order and ignores unassociated attachments', () => {
    const attA = { filename: 'a.pdf', id: 10, status: 'associated' }
    const attB = { filename: 'b.pdf', id: 20, status: 'associated' }
    const attPending = { filename: 'c.pdf', id: 30, status: 'pending' }

    const rev1 = feishuLeadSyncRevision(baseLead, [attA, attB])
    const rev2 = feishuLeadSyncRevision(baseLead, [attB, attA])
    const revWithPending = feishuLeadSyncRevision(baseLead, [attA, attB, attPending])

    expect(rev1).toBe(rev2)
    expect(revWithPending).toBe(rev1)

    const revWithoutAtt = feishuLeadSyncRevision(baseLead, [])
    expect(rev1).not.toBe(revWithoutAtt)
  })

  it('triggers lead sync enqueue when an attachment status changes to associated', async () => {
    const execute = vi.fn().mockResolvedValue({ rows: [] })
    const findByID = vi.fn().mockResolvedValue(baseLead)
    const warn = vi.fn()
    const payload = {
      collections: { leads: { config: {} } },
      config: { i18n: {} },
      db: {
        sessions: {
          tx1: { db: { execute } },
        },
      },
      find: vi.fn().mockImplementation(({ collection }) => {
        if (collection === 'feishu-mappings') {
          return Promise.resolve({ docs: [mapping], totalDocs: 1 })
        }
        if (collection === 'lead-attachments') {
          return Promise.resolve({
            docs: [{ filename: 'drawing.dwg', id: 1, status: 'associated' }],
          })
        }
        return Promise.resolve({ docs: [] })
      }),
      findByID,
      logger: { warn },
    } as never

    const req = {
      payload,
      transactionID: Promise.resolve('tx1'),
    } as never

    await enqueueFeishuLeadAttachmentChange({
      collection: {} as never,
      context: {},
      data: {},
      doc: {
        filename: 'drawing.dwg',
        id: 1,
        lead: 88,
        status: 'associated',
      },
      operation: 'update',
      previousDoc: {
        filename: 'drawing.dwg',
        id: 1,
        lead: 88,
        status: 'pending',
      },
      req,
    })

    if (warn.mock.calls.length > 0) {
      console.log('warn calls:', warn.mock.calls)
    }

    expect(findByID).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: 'leads',
        id: 88,
      }),
    )
    expect(execute).toHaveBeenCalled()
    const calls = JSON.stringify(execute.mock.calls)
    expect(calls).toContain('INSERT INTO \\"jobs\\"')
    expect(calls).toContain('feishu.lead.sync')
  })

  it('syncs lead with attachments and stable portal URL to Feishu client port', async () => {
    const attachmentDoc = {
      byteSize: 2048,
      createdAt: '2026-08-29T10:00:00.000Z',
      filename: 'structure.pdf',
      id: 101,
      mimeType: 'application/pdf',
      status: 'associated',
    }
    const revision = feishuLeadSyncRevision(baseLead, [attachmentDoc])
    const upsertRecord = vi.fn().mockResolvedValue({ recordId: 'rec-1', state: 'created' })
    const client: FeishuClientPort = {
      sendText: vi.fn(),
      upsertRecord,
    }

    const payload = {
      config: { i18n: {} },
      db: {
        sessions: {
          tx1: { db: { execute: vi.fn().mockResolvedValue({ rows: [{ id: 88 }] }) } },
        },
      },
      find: vi.fn().mockImplementation(({ collection }) => {
        if (collection === 'feishu-mappings') {
          return Promise.resolve({ docs: [mapping], totalDocs: 1 })
        }
        if (collection === 'lead-attachments') {
          return Promise.resolve({ docs: [attachmentDoc] })
        }
        return Promise.resolve({ docs: [] })
      }),
      findByID: vi.fn().mockResolvedValue(baseLead),
    } as never

    const handler = createFeishuLeadSyncJobHandler({
      client: () => client,
      payload,
    })

    const job: ClaimedJob = {
      attempts: 0,
      completedAt: null,
      deadAt: null,
      lastError: null,
      createdAt: '2026-08-29T10:00:00.000Z',
      id: 1,
      idempotencyKey: 'key-1',
      leaseExpiresAt: '2026-08-29T12:00:00.000Z',
      manualRetryCount: 0,
      maxAttempts: 5,
      nextRunAt: '2026-08-29T10:00:00.000Z',
      ownerToken: 'tok-1',
      payload: {
        entityId: 88,
        entityRevision: revision,
        mappingId: 1,
        mappingRevision: '2026-08-29T00:00:00.000Z',
        notificationIntent: 'none',
      },
      status: 'processing',
      type: 'feishu.lead.sync',
      updatedAt: '2026-08-29T10:00:00.000Z',
    }

    const lease = {
      assertLease: vi.fn(),
      renewLease: vi.fn(),
      signal: new AbortController().signal,
    }

    await handler(job, lease)

    expect(upsertRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        appToken: 'bascn-unit-test',
        fields: expect.objectContaining({
          Attachments: 'structure.pdf: http://localhost:3000/dashboard/leads/88',
          Customer: 'Façade Tech',
          'Local Lead ID': '88',
        }),
      }),
    )
  })
})
