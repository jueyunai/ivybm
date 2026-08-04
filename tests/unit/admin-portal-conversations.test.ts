import { afterEach, describe, expect, it, vi } from 'vitest'

import { CONVERSATIONS_MODULE } from '@/admin-portal/modules/conversations/manifest'
import {
  ConversationClientError,
  executeConversationCommand,
  fetchConversationList,
  isChatSession,
} from '@/admin-portal/modules/conversations/conversationClient'

const session = {
  allowedActions: ['take_over'],
  channel: 'website',
  handoffStatus: 'handoff_requested',
  id: 'conversation-unit',
  locale: 'en',
  messages: [],
  requestId: 'request-unit',
  revision: 2,
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Portal conversations module', () => {
  it('registers the real workflow and server commands', () => {
    expect(CONVERSATIONS_MODULE).toMatchObject({
      availability: 'available',
      allowedRoles: ['admin', 'operator', 'sales'],
      commands: [
        'conversations:take-over',
        'conversations:send-operator-message',
        'conversations:resolve',
      ],
    })
  })

  it('reads a bounded inbox list and passes the status filter to the existing operator API', async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          docs: [{ ...session, messages: undefined }],
          page: 2,
          totalDocs: 21,
          totalPages: 2,
        }),
        { status: 200 },
      ),
    )
    vi.stubGlobal('fetch', fetch)

    await expect(fetchConversationList({ page: 2, status: 'handoff_requested' })).resolves.toMatchObject({
      docs: [{ id: 'conversation-unit' }],
      page: 2,
    })
    expect(String(fetch.mock.calls[0]?.[0])).toContain('page=2')
    expect(String(fetch.mock.calls[0]?.[0])).toContain('status=handoff_requested')
  })

  it('sends operator replies only through the existing authoritative API command', async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(session), { status: 200 }),
    )
    vi.stubGlobal('fetch', fetch)

    await expect(
      executeConversationCommand({
        command: 'operator-messages',
        id: session.id,
        idempotencyKey: 'portal-test-key',
        text: 'We can help with the technical details.',
      }),
    ).resolves.toMatchObject({ id: session.id })

    expect(fetch).toHaveBeenCalledWith(
      `/api/portal/conversations/${session.id}/operator-messages`,
      expect.objectContaining({ method: 'POST' }),
    )
    const request = fetch.mock.calls[0]?.[1] as RequestInit
    expect(JSON.parse(String(request.body))).toEqual({
      idempotencyKey: 'portal-test-key',
      text: 'We can help with the technical details.',
    })
  })

  it('rejects malformed server DTOs instead of rendering an unsafe inbox state', async () => {
    expect(isChatSession({ ...session, handoffStatus: 'invented-state' })).toBe(false)
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ docs: [] }), { status: 200 })),
    )

    await expect(fetchConversationList()).rejects.toBeInstanceOf(ConversationClientError)
  })
})
