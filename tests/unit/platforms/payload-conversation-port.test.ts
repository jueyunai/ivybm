import { beforeEach, describe, expect, it, vi } from 'vitest'

const conversationServiceMock = vi.hoisted(() => ({ createConversationService: vi.fn() }))

vi.mock('@/modules/conversations/service', () => conversationServiceMock)

import { resolveInstagramOAuthAccountId } from '@/modules/platforms/payloadConversationPort'
import { PayloadPlatformConversationPort } from '@/modules/platforms/payloadConversationPort'
import type { NormalizedInboundMessage } from '@/modules/platforms/types'

const instagramMessage = (accountExternalId = '178414000000001'): NormalizedInboundMessage => ({
  accountExternalId,
  content: { messageType: 'text', text: 'Hello from Instagram.' },
  externalEventId: 'instagram-message-1',
  idempotencyKey: 'instagram-event-key',
  kind: 'inbound-message',
  occurredAt: '2026-08-30T00:00:00.000Z',
  platform: 'instagram',
  recipientExternalId: accountExternalId,
  senderExternalId: 'sender-1',
})

beforeEach(() => {
  vi.clearAllMocks()
})

describe('platform conversation account identity resolution', () => {
  it('resolves Instagram messaging identity to the OAuth profile identity', async () => {
    const payload = {
      find: vi.fn().mockResolvedValue({ docs: [{ externalAccountId: '987654321098765' }] }),
    }

    await expect(
      resolveInstagramOAuthAccountId(payload as never, '178414000000001'),
    ).resolves.toBe('987654321098765')
    expect(payload.find).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: 'platform-accounts',
        limit: 2,
        select: { externalAccountId: true },
        where: {
          and: [
            { accountKind: { equals: 'instagram-professional' } },
            { messagingExternalAccountId: { equals: '178414000000001' } },
          ],
        },
      }),
    )
  })

  it('fails closed for an ambiguous or incomplete Instagram mapping', async () => {
    for (const docs of [[{ externalAccountId: '987654321098765' }, { externalAccountId: '987654321098766' }], [{ externalAccountId: null }]]) {
      const payload = { find: vi.fn().mockResolvedValue({ docs }) }
      await expect(
        resolveInstagramOAuthAccountId(payload as never, '178414000000001'),
      ).rejects.toThrow('Instagram OAuth identity is unavailable')
    }
  })

  it('passes the OAuth profile identity to the conversation service', async () => {
    const ingestExternalMessage = vi.fn().mockResolvedValue({ status: 'accepted' })
    conversationServiceMock.createConversationService.mockReturnValue({ ingestExternalMessage })
    const payload = {
      find: vi.fn().mockResolvedValue({ docs: [{ externalAccountId: '987654321098765' }] }),
    }

    await expect(
      new PayloadPlatformConversationPort({ payload: payload as never }).writeInboundMessage(
        instagramMessage(),
      ),
    ).resolves.toEqual({ idempotencyKey: 'instagram-event-key', status: 'accepted' })
    expect(ingestExternalMessage).toHaveBeenCalledWith({
      channel: 'instagram',
      externalAccountId: '987654321098765',
      externalMessageId: 'instagram-message-1',
      externalSenderId: 'sender-1',
      externalThreadId: '178414000000001:sender-1',
      locale: 'en',
      text: 'Hello from Instagram.',
    })
  })
})
