import messageSuccess from '../fixtures/feishu/message.success.json'
import rateLimit from '../fixtures/feishu/rate-limit.json'
import recordCreateSuccess from '../fixtures/feishu/record.create.success.json'
import recordSearchEmpty from '../fixtures/feishu/record.search.empty.json'
import tokenSuccess from '../fixtures/feishu/token.success.json'
import { describe, expect, it, vi } from 'vitest'

import { FeishuClient } from '@/modules/feishu/client'
import {
  FeishuApiError,
  FeishuConfigurationError,
  type FeishuClientPort,
  type FeishuMappingConfig,
  type LeadForFeishu,
} from '@/modules/feishu/contracts'
import { feishuLeadSyncRevision } from '@/modules/feishu/jobs'
import { mapLead } from '@/modules/feishu/mapLead'
import { notifyHandoff, notifyNewLead } from '@/modules/feishu/notify'
import { syncLead } from '@/modules/feishu/syncLead'

const mapping: FeishuMappingConfig = {
  appToken: 'bascn-fixture',
  fieldMappings: [
    { localField: 'localLeadId', required: true, targetField: 'Local Lead ID' },
    { localField: 'customerName', required: true, targetField: 'Customer' },
    { localField: 'country', required: false, targetField: 'Country' },
    { localField: 'source', required: true, targetField: 'Source' },
    { localField: 'intentLevel', required: true, targetField: 'Intent' },
    { localField: 'productNeed', targetField: 'Product Need' },
    { localField: 'email', targetField: 'Email' },
    { localField: 'nextFollowUpAt', targetField: 'Next Follow-up' },
    { localField: 'sourceURL', targetField: 'Source URL' },
    { localField: 'originalInquiry', targetField: 'Original Inquiry' },
  ],
  id: 1,
  key: 'primary-leads',
  memberMappings: [],
  notificationRecipients: [
    { enabled: true, label: 'Sales group', receiveId: 'oc-fixture', receiveIdType: 'chat_id' },
  ],
  revision: '2026-07-29T00:00:00.000Z',
  tableId: 'tbl-fixture',
}

const lead: LeadForFeishu = {
  assignedTo: { email: 'sales@example.invalid', id: 8 },
  company: 'Acme Facades',
  country: 'United Arab Emirates',
  email: 'buyer@example.invalid',
  id: 42,
  intentLevel: 'a',
  interest: 'Double-curved aluminum panels',
  message: 'Please review our drawings.',
  name: 'Buyer Name',
  nextFollowUpAt: '2026-07-30T10:00:00.000Z',
  phone: '+971500000000',
  requestId: '00000000-0000-4000-8000-000000000042',
  source: { id: 2, key: 'website-chat', label: 'Website chat' },
  status: 'qualified',
  sourceURL: 'https://ivybm.example.invalid/en/products',
}

const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
    status,
  })

describe('Feishu CRM contract', () => {
  it('uses the same sync revision for omitted and explicit null country values', () => {
    const { country: _country, ...withoutCountry } = lead

    expect(feishuLeadSyncRevision(withoutCountry)).toBe(
      feishuLeadSyncRevision({ ...withoutCountry, country: null }),
    )
  })

  it('maps normalized lead fields without coupling business code to Bitable field names', () => {
    expect(mapLead({ lead, mapping })).toEqual({
      fields: {
        Country: 'United Arab Emirates',
        Customer: 'Acme Facades',
        Email: 'buyer@example.invalid',
        Intent: 'A',
        'Local Lead ID': '42',
        'Next Follow-up': Date.parse('2026-07-30T10:00:00.000Z'),
        'Product Need': 'Double-curved aluminum panels',
        'Original Inquiry': 'Please review our drawings.',
        Source: 'Website chat',
        'Source URL': 'https://ivybm.example.invalid/en/products',
      },
      localLeadIdField: 'Local Lead ID',
    })
  })

  it('includes structured qualification details in the synced inquiry', () => {
    const qualifiedLead: LeadForFeishu = {
      ...lead,
      budget: 'USD 450000',
      hasDrawings: true,
      procurementPlan: 'Purchase within 3 months',
      projectStage: 'tender',
      quantitySquareMeters: 3200,
      timeline: 'within_3_months',
    }

    expect(mapLead({ lead: qualifiedLead, mapping }).fields['Original Inquiry']).toContain(
      'Project stage: tender',
    )
    expect(mapLead({ lead: qualifiedLead, mapping }).fields['Original Inquiry']).toContain(
      'Budget: USD 450000',
    )
  })

  it('syncs a Lead with an unconfirmed country without inventing a location', () => {
    const countryPending = { ...lead, country: null }

    expect(mapLead({ lead: countryPending, mapping }).fields).not.toHaveProperty('Country')
  })

  it('fails closed when a required field mapping is missing or duplicated', () => {
    expect(() =>
      mapLead({
        lead,
        mapping: {
          ...mapping,
          fieldMappings: mapping.fieldMappings.filter((item) => item.localField !== 'country'),
        },
      }),
    ).toThrow(FeishuConfigurationError)
    expect(() =>
      mapLead({
        lead,
        mapping: {
          ...mapping,
          fieldMappings: [...mapping.fieldMappings, { localField: 'phone', targetField: 'Email' }],
        },
      }),
    ).toThrow('Duplicate Feishu target field')
  })

  it('creates a Bitable record using local lead ID as the idempotent lookup key', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(response(tokenSuccess))
      .mockResolvedValueOnce(response(recordSearchEmpty))
      .mockResolvedValueOnce(response(recordCreateSuccess))
    const client = new FeishuClient({
      appId: 'cli-fixture',
      appSecret: 'secret-fixture',
      baseUrl: 'https://feishu.example.invalid',
      fetch,
    })

    await expect(syncLead({ client, lead, mapping })).resolves.toEqual({
      recordId: 'rec-fixture-001',
      state: 'created',
    })
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('/records/search'),
      expect.objectContaining({
        body: expect.stringContaining('Local Lead ID'),
        method: 'POST',
      }),
    )
  })

  it('updates the existing Bitable record instead of creating a duplicate', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(response(tokenSuccess))
      .mockResolvedValueOnce(
        response({
          code: 0,
          data: { has_more: false, items: [{ record_id: 'rec-existing' }] },
          msg: 'success',
        }),
      )
      .mockResolvedValueOnce(
        response({
          code: 0,
          data: { record: { record_id: 'rec-existing' } },
          msg: 'success',
        }),
      )
    const client = new FeishuClient({
      appId: 'cli-fixture',
      appSecret: 'secret-fixture',
      baseUrl: 'https://feishu.example.invalid',
      fetch,
    })

    await expect(syncLead({ client, lead, mapping })).resolves.toEqual({
      recordId: 'rec-existing',
      state: 'updated',
    })
    expect(fetch).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining('/records/rec-existing'),
      expect.objectContaining({ method: 'PUT' }),
    )
  })

  it('rejects multiple remote records for one local lead as a non-retryable conflict', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(response(tokenSuccess))
      .mockResolvedValueOnce(
        response({
          code: 0,
          data: {
            has_more: false,
            items: [{ record_id: 'rec-first' }, { record_id: 'rec-second' }],
          },
          msg: 'success',
        }),
      )
    const client = new FeishuClient({
      appId: 'cli-fixture',
      appSecret: 'secret-fixture',
      baseUrl: 'https://feishu.example.invalid',
      fetch,
    })

    await expect(syncLead({ client, lead, mapping })).rejects.toMatchObject({
      code: 'duplicate_local_lead_id',
      retryable: false,
    } satisfies Partial<FeishuApiError>)
  })

  it.each([
    ['missing items', { has_more: false }],
    ['a null record', { has_more: false, items: [null] }],
    ['a record without record_id', { has_more: false, items: [{}] }],
  ])('fails closed instead of creating when record search returns %s', async (_case, data) => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(response(tokenSuccess))
      .mockResolvedValueOnce(response({ code: 0, data, msg: 'success' }))
    const client = new FeishuClient({
      appId: 'cli-fixture',
      appSecret: 'secret-fixture',
      baseUrl: 'https://feishu.example.invalid',
      fetch,
    })

    await expect(syncLead({ client, lead, mapping })).rejects.toMatchObject({
      code: 'invalid_search_response',
      retryable: false,
    })
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('refreshes an invalid tenant token once before retrying the request', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(response(tokenSuccess))
      .mockResolvedValueOnce(response({ code: 99991663, msg: 'tenant token invalid' }, 401))
      .mockResolvedValueOnce(
        response({ ...tokenSuccess, tenant_access_token: 'tenant-token-refreshed' }),
      )
      .mockResolvedValueOnce(response(recordSearchEmpty))
      .mockResolvedValueOnce(response(recordCreateSuccess))
    const client = new FeishuClient({
      appId: 'cli-fixture',
      appSecret: 'secret-fixture',
      baseUrl: 'https://feishu.example.invalid',
      fetch,
    })

    await expect(syncLead({ client, lead, mapping })).resolves.toMatchObject({ state: 'created' })
    expect(fetch).toHaveBeenCalledTimes(5)
  })

  it('marks rate limits as retryable without exposing credentials', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(response(tokenSuccess))
      .mockResolvedValueOnce(response(rateLimit, 429))
    const client = new FeishuClient({
      appId: 'cli-fixture',
      appSecret: 'secret-fixture',
      baseUrl: 'https://feishu.example.invalid',
      fetch,
    })

    const error = await syncLead({ client, lead, mapping }).catch((caught: unknown) => caught)
    expect(error).toMatchObject({
      code: 1254290,
      retryable: true,
    } satisfies Partial<FeishuApiError>)
    expect(error).toBeInstanceOf(FeishuApiError)
    expect((error as Error).message).not.toContain('secret-fixture')
  })

  it('sends one idempotent handoff notification per configured recipient', async () => {
    const sendText = vi.fn(async () => ({ messageId: messageSuccess.data.message_id }))
    const client: FeishuClientPort = {
      sendText,
      upsertRecord: vi.fn(async () => ({ recordId: 'unused', state: 'created' as const })),
    }

    await expect(
      notifyHandoff({
        client,
        handoff: {
          conversationPublicId: 'conversation-fixture',
          domainEventId: '10000000-0000-4000-8000-000000000001',
          publicId: 'handoff-fixture',
          reason: 'Customer requested a human quotation review.',
          requestedAt: '2026-07-29T00:00:00.000Z',
          source: 'visitor',
        },
        mapping,
      }),
    ).resolves.toEqual([{ messageId: 'om-fixture-001' }])
    expect(sendText).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: expect.stringContaining('10000000-0000-4000-8000-000000000001'),
        receiveId: 'oc-fixture',
        receiveIdType: 'chat_id',
      }),
    )
  })

  it('routes a new lead directly to the assigned sales member before using the default group', async () => {
    const sendText = vi.fn(async () => ({ messageId: 'om-member-fixture' }))
    const client: FeishuClientPort = {
      sendText,
      upsertRecord: vi.fn(async () => ({ recordId: 'unused', state: 'created' as const })),
    }

    await notifyNewLead({
      client,
      eventRevision: 'notification-event-fixture',
      lead,
      mapping: {
        ...mapping,
        memberMappings: [{ enabled: true, openId: 'ou-sales-fixture', userId: 8 }],
      },
    })

    expect(sendText).toHaveBeenCalledTimes(1)
    expect(sendText).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: expect.stringContaining('notification-event-fixture'),
        receiveId: 'ou-sales-fixture',
        receiveIdType: 'open_id',
      }),
    )
  })
})
