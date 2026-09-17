import { describe, expect, it, vi } from 'vitest'
import { NotFound } from 'payload'

import {
  FeishuApiError,
  FeishuConfigurationError,
  type FeishuClientPort,
  type HandoffForFeishu,
} from '@/modules/feishu/contracts'
import {
  createFeishuHandoffNotifyJobHandler,
  enqueueFeishuHandoffChange,
  FEISHU_HANDOFF_NOTIFY_JOB_TYPE,
} from '@/modules/feishu/jobs'
import { formatHandoffNotification } from '@/modules/feishu/notify'
import { resolvePortalConversationUrl } from '@/modules/feishu/mapLead'

const baseMappingDoc: Record<string, unknown> = {
  appToken: 'app-fixture',
  fieldMappings: [
    { localField: 'localLeadId', targetField: 'Local Lead ID' },
    { localField: 'customerName', targetField: 'Customer Name' },
    { localField: 'country', targetField: 'Country' },
    { localField: 'source', targetField: 'Source' },
    { localField: 'intentLevel', targetField: 'Intent Level' },
  ],
  id: 'mapping-1',
  key: 'default',
  memberMappings: [],
  notificationRecipients: [
    { enabled: true, receiveId: 'oc-chat-fixture', receiveIdType: 'chat_id' },
  ],
  tableId: 'tbl-fixture',
  updatedAt: '2026-09-16T12:00:00.000Z',
}

const fullHandoff: HandoffForFeishu = {
  channel: 'website',
  conversationPublicId: 'session-83444c82-a0d6-4a2e-8184-63da382f9586',
  country: '沙特阿拉伯',
  domainEventId: 'domain-event-001',
  email: 'ahmed@example.test',
  latestVisitorMessage:
    'Urgent inquiry: Need 2000 sqm architectural aluminum panels for hospital facade project in Riyadh. We have CAD drawings ready.',
  phone: '+971 50 123 4567',
  portalUrl:
    'https://ivybm.com/dashboard/conversations?conversation=session-83444c82-a0d6-4a2e-8184-63da382f9586',
  productInterest: '6063-T5 阳极氧化铝板',
  publicId: 'handoff-public-001',
  quantitySquareMeters: 2000,
  reason: 'high_intent',
  requestedAt: '2026-09-16T17:35:00.000Z',
  source: 'ai_policy',
}

describe('Feishu Handoff Notification Formatting', () => {
  it('formats full structured text notification matching the design specification', () => {
    const text = formatHandoffNotification(fullHandoff)
    expect(text).toBe(
      [
        '🔔【AI 客服需要人工接管】',
        '• 渠道来源：官方网站 (Website)',
        '• 接管原因：高意向工程咨询 (high_intent)',
        '• 客户国家：沙特阿拉伯',
        '• 关注产品：6063-T5 阳极氧化铝板 / 2,000 m²',
        '• 联系方式：ahmed@example.test / +971 50 123 4567',
        '• 请求时间：2026-09-16 17:35 (UTC)',
        '-----------------------------------------',
        '💬 最新客户留言：',
        '“Urgent inquiry: Need 2000 sqm architectural aluminum panels for hospital facade project in Riyadh. We have CAD drawings ready.”',
        '-----------------------------------------',
        '🔗 工作台一键接管：',
        'https://ivybm.com/dashboard/conversations?conversation=session-83444c82-a0d6-4a2e-8184-63da382f9586',
      ].join('\n'),
    )
  })

  it('maps known reasons and safely compresses/truncates unknown reasons to 120 code points', () => {
    const known = formatHandoffNotification({ ...fullHandoff, reason: 'high_risk_topic' })
    expect(known).toContain('• 接管原因：涉及敏感话题 (high_risk_topic)')

    const unknownLong =
      'Custom reason: ' + '🌟'.repeat(150) + '\n\n   with   lots    of   whitespace   '
    const formattedUnknown = formatHandoffNotification({ ...fullHandoff, reason: unknownLong })
    // Code points: 15 for prefix 'Custom reason: ', followed by 105 emojis
    const expectedReason = 'Custom reason: ' + '🌟'.repeat(105)
    expect(formattedUnknown).toContain(`• 接管原因：${expectedReason}`)
  })

  it('compresses whitespace and truncates latest visitor message to 150 Unicode code points', () => {
    const longMessage = 'Need panels. ' + '📦'.repeat(160) + '\n\n' + 'urgent'
    const text = formatHandoffNotification({ ...fullHandoff, latestVisitorMessage: longMessage })
    const expected = '“Need panels. ' + '📦'.repeat(137) + '”'
    expect(text).toContain(expected)
  })

  it('gracefully degrades when country, interest, contact, or visitor message are missing', () => {
    const minimal: HandoffForFeishu = {
      channel: 'website',
      conversationPublicId: 'session-min-001',
      domainEventId: 'event-min',
      portalUrl: 'https://ivybm.com/dashboard/conversations?conversation=session-min-001',
      publicId: 'handoff-min',
      reason: 'visitor',
      requestedAt: '2026-09-16T10:00:00.000Z',
      source: 'visitor',
    }
    const text = formatHandoffNotification(minimal)
    expect(text).toContain('• 客户国家：待确认')
    expect(text).toContain('• 关注产品：详见最新留言')
    expect(text).toContain('• 联系方式：暂未留资（客户可继续输入）')
    expect(text).toContain('• 接管原因：访客主动申请 (visitor)')
    expect(text).toContain('💬 最新客户留言：\n（暂无留言）')
  })

  it('formats single contact channel (email only or phone only)', () => {
    const emailOnly = formatHandoffNotification({ ...fullHandoff, phone: null })
    expect(emailOnly).toContain('• 联系方式：ahmed@example.test')

    const phoneOnly = formatHandoffNotification({ ...fullHandoff, email: null })
    expect(phoneOnly).toContain('• 联系方式：+971 50 123 4567')
  })

  it('formats interest without quantity or quantity without interest', () => {
    const interestOnly = formatHandoffNotification({ ...fullHandoff, quantitySquareMeters: null })
    expect(interestOnly).toContain('• 关注产品：6063-T5 阳极氧化铝板')

    const quantityOnly = formatHandoffNotification({ ...fullHandoff, productInterest: null })
    expect(quantityOnly).toContain('• 关注产品：2,000 m²')
  })

  it('correctly maps various social and chat channels', () => {
    expect(formatHandoffNotification({ ...fullHandoff, channel: 'facebook' })).toContain(
      '• 渠道来源：Facebook Messenger',
    )
    expect(formatHandoffNotification({ ...fullHandoff, channel: 'instagram' })).toContain(
      '• 渠道来源：Instagram',
    )
    expect(formatHandoffNotification({ ...fullHandoff, channel: 'whatsapp' })).toContain(
      '• 渠道来源：WhatsApp',
    )
    expect(formatHandoffNotification({ ...fullHandoff, channel: 'tiktok' })).toContain(
      '• 渠道来源：TikTok',
    )
  })
})

describe('resolvePortalConversationUrl', () => {
  const originalEnv = { ...process.env }

  it('resolves conversation URL with proper parameter encoding', () => {
    const url = resolvePortalConversationUrl('session/with special & characters', 'https://ivybm.com')
    expect(url).toBe(
      'https://ivybm.com/dashboard/conversations?conversation=session%2Fwith%20special%20%26%20characters',
    )
  })

  it('respects origin priority: explicitOrigin > IVYBM_RUNTIME_SERVER_URL > NEXT_PUBLIC_SERVER_URL', () => {
    process.env.IVYBM_RUNTIME_SERVER_URL = 'https://runtime.ivybm.com'
    process.env.NEXT_PUBLIC_SERVER_URL = 'https://public.ivybm.com'

    expect(resolvePortalConversationUrl('session-1', 'https://explicit.ivybm.com')).toBe(
      'https://explicit.ivybm.com/dashboard/conversations?conversation=session-1',
    )
    expect(resolvePortalConversationUrl('session-1')).toBe(
      'https://runtime.ivybm.com/dashboard/conversations?conversation=session-1',
    )

    delete process.env.IVYBM_RUNTIME_SERVER_URL
    expect(resolvePortalConversationUrl('session-1')).toBe(
      'https://public.ivybm.com/dashboard/conversations?conversation=session-1',
    )

    process.env = { ...originalEnv }
  })

  it('throws FeishuConfigurationError in production if origin resolves to localhost, 127.0.0.1, 0.0.0.0, or ::1', () => {
    const prevNodeEnv = process.env.NODE_ENV
    const prevRuntime = process.env.IVYBM_RUNTIME_SERVER_URL
    const prevPublic = process.env.NEXT_PUBLIC_SERVER_URL

    ;(process.env as Record<string, string | undefined>).NODE_ENV = 'production'
    delete process.env.IVYBM_RUNTIME_SERVER_URL
    delete process.env.NEXT_PUBLIC_SERVER_URL

    expect(() => resolvePortalConversationUrl('session-1')).toThrow(FeishuConfigurationError)
    expect(() => resolvePortalConversationUrl('session-1', 'http://localhost:3000')).toThrow(
      'Cannot generate Feishu notification link with localhost origin in production',
    )
    expect(() => resolvePortalConversationUrl('session-1', 'http://127.0.0.1:8080')).toThrow(
      'Cannot generate Feishu notification link with localhost origin in production',
    )
    expect(() => resolvePortalConversationUrl('session-1', 'http://0.0.0.0:3000')).toThrow(
      'Cannot generate Feishu notification link with localhost origin in production',
    )
    expect(() => resolvePortalConversationUrl('session-1', 'http://[::1]:8080')).toThrow(
      'Cannot generate Feishu notification link with localhost origin in production',
    )

    ;(process.env as Record<string, string | undefined>).NODE_ENV = prevNodeEnv
    process.env.IVYBM_RUNTIME_SERVER_URL = prevRuntime
    process.env.NEXT_PUBLIC_SERVER_URL = prevPublic
  })
})

describe('enqueueFeishuHandoffChange afterChange hook', () => {
  it('no-ops when operation is not create or status is not requested', async () => {
    const enqueue = vi.fn()
    const req = {
      payload: {
        find: vi.fn(),
      },
    } as unknown as Parameters<typeof enqueueFeishuHandoffChange>[0]['req']

    const updated = await enqueueFeishuHandoffChange({
      doc: { domainEventId: 'ev-1', id: 1, status: 'requested' },
      operation: 'update',
      previousDoc: null,
      req,
    } as unknown as Parameters<typeof enqueueFeishuHandoffChange>[0])
    expect(updated).toEqual({ domainEventId: 'ev-1', id: 1, status: 'requested' })
    expect(enqueue).not.toHaveBeenCalled()

    const resolved = await enqueueFeishuHandoffChange({
      doc: { domainEventId: 'ev-2', id: 2, status: 'resolved' },
      operation: 'create',
      previousDoc: null,
      req,
    } as unknown as Parameters<typeof enqueueFeishuHandoffChange>[0])
    expect(resolved).toEqual({ domainEventId: 'ev-2', id: 2, status: 'resolved' })
  })

  it('gracefully degrades and logs structured error without throwing when enqueue fails', async () => {
    const loggerError = vi.fn()
    // We pass doc that causes an error in enqueue
    const doc = {
      domainEventId: 'ev-err',
      id: 99,
      status: 'requested',
    }

    const errorReq = {
      payload: {
        find: vi.fn(async () => {
          throw new Error('DB connection refused')
        }),
        logger: { error: loggerError },
      },
    } as unknown as Parameters<typeof enqueueFeishuHandoffChange>[0]['req']

    const result = await enqueueFeishuHandoffChange({
      doc,
      operation: 'create',
      previousDoc: null,
      req: errorReq,
    } as unknown as Parameters<typeof enqueueFeishuHandoffChange>[0])
    expect(result).toBe(doc)
    expect(loggerError).toHaveBeenCalledWith(
      expect.stringContaining('Feishu handoff notification enqueue failed for handoff 99 (ev-err)'),
    )
  })
})

describe('createFeishuHandoffNotifyJobHandler', () => {
  it('silences recovery handoffs (ai_service_unavailable) but sends high_risk_topic', async () => {
    const sendText = vi.fn(async () => ({ messageId: 'msg-1' }))
    const client = vi.fn(async () => ({ sendText, upsertRecord: vi.fn() } as unknown as FeishuClientPort))

    const mockHandoff = {
      conversation: 10,
      domainEventId: 'ev-high-risk',
      id: 1,
      publicId: 'ho-1',
      reason: 'high_risk_topic',
      requestedAt: '2026-09-16T12:00:00.000Z',
      source: 'ai_policy',
      status: 'requested',
    }
    const mockConversation = {
      channel: 'website',
      id: 10,
      lead: null,
      publicId: 'conv-10',
    }

    const payload = {
      find: vi.fn(async ({ collection }) => {
        if (collection === 'feishu-mappings') {
          return { docs: [{ ...baseMappingDoc, updatedAt: '2026-09-16T13:00:00.000Z' }], totalDocs: 1 }
        }
        if (collection === 'messages') {
          return { docs: [{ content: 'Is this certified for fire safety?' }], totalDocs: 1 }
        }
        return { docs: [], totalDocs: 0 }
      }),
      findByID: vi.fn(async ({ collection }) => {
        if (collection === 'handoffs') return mockHandoff
        if (collection === 'conversations') return mockConversation
        return null
      }),
    } as never

    const handler = createFeishuHandoffNotifyJobHandler({ client, payload })
    const execution = { assertLease: vi.fn(), signal: undefined }

    // Job had old revision 'old-revision'
    await handler(
      {
        attempts: 1,
        id: 100,
        payload: { entityId: 1, mappingId: 'mapping-1', mappingRevision: 'old-revision' },
        status: 'processing',
        type: FEISHU_HANDOFF_NOTIFY_JOB_TYPE,
      } as never,
      execution as never,
    )

    // high_risk_topic MUST be sent (not silenced)
    expect(sendText).toHaveBeenCalledTimes(1)
    expect(sendText).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining('涉及敏感话题 (high_risk_topic)'),
      }),
    )

    // Now test ai_service_unavailable (MUST be silenced)
    sendText.mockClear()
    const mockSilentHandoff = { ...mockHandoff, reason: 'ai_service_unavailable' }
    const silentPayload = {
      ...(payload as Record<string, unknown>),
      findByID: vi.fn(async ({ collection }) => {
        if (collection === 'handoffs') return mockSilentHandoff
        if (collection === 'conversations') return mockConversation
        return null
      }),
    } as never
    const silentHandler = createFeishuHandoffNotifyJobHandler({ client, payload: silentPayload })

    await silentHandler(
      {
        attempts: 1,
        id: 101,
        payload: { entityId: 1, mappingId: 'mapping-1', mappingRevision: 'old-revision' },
        status: 'processing',
        type: FEISHU_HANDOFF_NOTIFY_JOB_TYPE,
      } as never,
      execution as never,
    )

    expect(sendText).not.toHaveBeenCalled()
  })

  it('throws retryable FeishuApiError when active Feishu mapping is temporarily unavailable', async () => {
    const payload = {
      find: vi.fn(async () => ({ docs: [], totalDocs: 0 })),
    } as never
    const client = vi.fn()
    const handler = createFeishuHandoffNotifyJobHandler({ client, payload })
    const execution = { assertLease: vi.fn(), signal: undefined }

    await expect(
      handler(
        {
          attempts: 1,
          id: 102,
          payload: { entityId: 1, mappingId: 'mapping-1', mappingRevision: 'rev-1' },
          status: 'processing',
          type: FEISHU_HANDOFF_NOTIFY_JOB_TYPE,
        } as never,
        execution as never,
      ),
    ).rejects.toMatchObject({
      code: 'feishu_mapping_inactive',
      retryable: true,
    } satisfies Partial<FeishuApiError>)
  })

  it('propagates unexpected database errors so the job can be retried', async () => {
    const payload = {
      find: vi.fn(async () => ({
        docs: [{ ...baseMappingDoc, updatedAt: '2026-09-16T13:00:00.000Z' }],
        totalDocs: 1,
      })),
      findByID: vi.fn(async () => {
        throw new Error('Postgres connection pool exhausted')
      }),
    } as never
    const client = vi.fn()
    const handler = createFeishuHandoffNotifyJobHandler({ client, payload })
    const execution = { assertLease: vi.fn(), signal: undefined }

    await expect(
      handler(
        {
          attempts: 1,
          id: 103,
          payload: { entityId: 1, mappingId: 'mapping-1', mappingRevision: 'rev-1' },
          status: 'processing',
          type: FEISHU_HANDOFF_NOTIFY_JOB_TYPE,
        } as never,
        execution as never,
      ),
    ).rejects.toThrow('Postgres connection pool exhausted')
  })

  it('completes cleanly without sending notification if handoff or conversation is permanently NotFound', async () => {
    const sendText = vi.fn()
    const client = vi.fn(async () => ({ sendText } as unknown as FeishuClientPort))

    const notFoundPayload = {
      find: vi.fn(async () => ({
        docs: [{ ...baseMappingDoc, updatedAt: '2026-09-16T13:00:00.000Z' }],
        totalDocs: 1,
      })),
      findByID: vi.fn(async () => {
        throw new NotFound()
      }),
    } as never
    const handler = createFeishuHandoffNotifyJobHandler({ client, payload: notFoundPayload })
    const execution = { assertLease: vi.fn(), signal: undefined }

    await expect(
      handler(
        {
          attempts: 1,
          id: 104,
          payload: { entityId: 999, mappingId: 'mapping-1', mappingRevision: 'rev-1' },
          status: 'processing',
          type: FEISHU_HANDOFF_NOTIFY_JOB_TYPE,
        } as never,
        execution as never,
      ),
    ).resolves.toBeUndefined()
    expect(sendText).not.toHaveBeenCalled()
  })
})
