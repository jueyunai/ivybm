import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PortalPreferencesProvider } from '@/admin-portal/core/navigation/PortalPreferences'
import {
  ConversationWorkspace,
  mergeConversationSnapshots,
} from '@/admin-portal/modules/conversations/ConversationWorkspace'
import { CONVERSATIONS_MODULE } from '@/admin-portal/modules/conversations/manifest'
import {
  ConversationClientError,
  executeConversationCommand,
  fetchConversationDetail,
  fetchConversationList,
  isChatSession,
} from '@/admin-portal/modules/conversations/conversationClient'
import type { ChatSession } from '@/modules/conversations/contracts'

let currentSearchParams = new URLSearchParams()

vi.mock('next/navigation', () => ({
  useSearchParams: () => currentSearchParams,
}))

const session1: ChatSession = {
  allowedActions: ['send_operator_message', 'resolve'],
  channel: 'website',
  handoffStatus: 'human_active',
  id: 'conv-1',
  locale: 'en',
  messages: [
    {
      author: 'visitor',
      content: 'First visitor message',
      createdAt: '2026-08-01T10:00:00.000Z',
      id: 'm1',
      status: 'sent',
    },
  ],
  requestId: 'req-1',
  revision: 1,
}

const session2: ChatSession = {
  allowedActions: ['send_operator_message', 'resolve'],
  channel: 'facebook',
  handoffStatus: 'human_active',
  id: 'conv-2',
  locale: 'en',
  messages: [
    {
      author: 'visitor',
      content: 'Second visitor message',
      createdAt: '2026-08-01T10:05:00.000Z',
      id: 'm2',
      status: 'sent',
    },
  ],
  requestId: 'req-2',
  revision: 1,
}

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
    status,
  })

const renderWorkspace = (initialConversationId?: string) =>
  render(
    React.createElement(
      PortalPreferencesProvider,
      null,
      React.createElement(ConversationWorkspace, {
        enabled: true,
        initialConversationId,
        role: 'operator',
      }),
    ),
  )

beforeEach(() => {
  currentSearchParams = new URLSearchParams()
})

afterEach(() => {
  cleanup()
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
      jsonResponse({
        docs: [{ ...session1, messages: undefined }],
        page: 2,
        totalDocs: 21,
        totalPages: 2,
      }),
    )
    vi.stubGlobal('fetch', fetch)

    await expect(
      fetchConversationList({ page: 2, status: 'handoff_requested' }),
    ).resolves.toMatchObject({
      docs: [{ id: 'conv-1' }],
      page: 2,
    })
    expect(String(fetch.mock.calls[0]?.[0])).toContain('page=2')
    expect(String(fetch.mock.calls[0]?.[0])).toContain('status=handoff_requested')
  })

  it('sends operator replies only through the existing authoritative API command', async () => {
    const fetch = vi.fn().mockResolvedValue(jsonResponse(session1))
    vi.stubGlobal('fetch', fetch)

    await expect(
      executeConversationCommand({
        command: 'operator-messages',
        id: session1.id,
        idempotencyKey: 'portal-test-key',
        text: 'We can help with the technical details.',
      }),
    ).resolves.toMatchObject({ id: session1.id })

    expect(fetch).toHaveBeenCalledWith(
      `/api/portal/conversations/${session1.id}/operator-messages`,
      expect.objectContaining({ method: 'POST' }),
    )
    const request = fetch.mock.calls[0]?.[1] as RequestInit
    expect(JSON.parse(String(request.body))).toEqual({
      idempotencyKey: 'portal-test-key',
      text: 'We can help with the technical details.',
    })
  })

  it('rejects malformed server DTOs instead of rendering an unsafe inbox state', async () => {
    expect(isChatSession({ ...session1, handoffStatus: 'invented-state' })).toBe(false)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ docs: [] })))

    await expect(fetchConversationList()).rejects.toBeInstanceOf(ConversationClientError)
  })

  it('propagates AbortSignal and rethrows AbortError on cancelled requests', async () => {
    const controller = new AbortController()
    controller.abort()

    const fetchMock = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      if (init?.signal?.aborted) {
        const error = new DOMException('The operation was aborted', 'AbortError')
        return Promise.reject(error)
      }
      return Promise.resolve(jsonResponse(session1))
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchConversationDetail('conv-1', { signal: controller.signal })).rejects.toThrow()
    await expect(fetchConversationList({ signal: controller.signal })).rejects.toThrow()
    await expect(
      executeConversationCommand({
        command: 'resolve',
        id: 'conv-1',
        idempotencyKey: 'key',
        signal: controller.signal,
      }),
    ).rejects.toThrow()
  })

  it('isolates reply drafts per conversation ID and clears only the sent conversation draft', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      const urlStr = String(url)
      if (
        urlStr.startsWith('/api/portal/conversations?') ||
        urlStr === '/api/portal/conversations'
      ) {
        return Promise.resolve(
          jsonResponse({
            docs: [
              { ...session1, lastMessageAt: session1.messages[0]?.createdAt, messages: undefined },
              { ...session2, lastMessageAt: session2.messages[0]?.createdAt, messages: undefined },
            ],
            page: 1,
            totalDocs: 2,
            totalPages: 1,
          }),
        )
      }
      if (urlStr.includes('/api/portal/conversations/conv-1/operator-messages')) {
        const parsed = JSON.parse(String(init?.body)) as { text: string }
        return Promise.resolve(
          jsonResponse({
            ...session1,
            messages: [
              ...session1.messages,
              {
                author: 'operator',
                content: parsed.text,
                createdAt: '2026-08-01T10:10:00.000Z',
                id: 'm-reply-1',
                status: 'sent',
              },
            ],
            revision: session1.revision + 1,
          }),
        )
      }
      if (urlStr.includes('/api/portal/conversations/conv-1')) {
        return Promise.resolve(jsonResponse(session1))
      }
      if (urlStr.includes('/api/portal/conversations/conv-2')) {
        return Promise.resolve(jsonResponse(session2))
      }
      return Promise.reject(new Error(`Unhandled: ${urlStr}`))
    })
    vi.stubGlobal('fetch', fetchMock)

    renderWorkspace('conv-1')

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: '官网访客 #conv-1' })).toBeDefined()
    })

    const textarea = screen.getByPlaceholderText('输入给客户的回复…') as HTMLTextAreaElement
    expect(textarea.value).toBe('')

    fireEvent.change(textarea, { target: { value: 'Draft for conversation 1' } })
    expect(textarea.value).toBe('Draft for conversation 1')

    // Switch to conv-2
    const conv2Button = screen.getByRole('button', { name: /Facebook客户 #conv-2/u })
    fireEvent.click(conv2Button)

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Facebook客户 #conv-2' })).toBeDefined()
    })

    const textarea2 = screen.getByPlaceholderText('输入给客户的回复…') as HTMLTextAreaElement
    expect(textarea2.value).toBe('')

    fireEvent.change(textarea2, { target: { value: 'Draft for conversation 2' } })
    expect(textarea2.value).toBe('Draft for conversation 2')

    // Switch back to conv-1
    const conv1Button = screen.getByRole('button', { name: /官网访客 #conv-1/u })
    fireEvent.click(conv1Button)

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: '官网访客 #conv-1' })).toBeDefined()
    })

    const textarea1Restored = screen.getByPlaceholderText(
      '输入给客户的回复…',
    ) as HTMLTextAreaElement
    expect(textarea1Restored.value).toBe('Draft for conversation 1')

    // Send reply on conv-1
    const sendButton = screen.getByRole('button', { name: '发送回复' })
    fireEvent.click(sendButton)

    await waitFor(() => {
      expect(textarea1Restored.value).toBe('')
    })

    // Switch back to conv-2 and verify its draft was preserved
    fireEvent.click(screen.getByRole('button', { name: /Facebook客户 #conv-2/u }))

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Facebook客户 #conv-2' })).toBeDefined()
    })

    const textarea2Preserved = screen.getByPlaceholderText(
      '输入给客户的回复…',
    ) as HTMLTextAreaElement
    expect(textarea2Preserved.value).toBe('Draft for conversation 2')
  })

  it('does not clear a newer draft when an earlier reply completes', async () => {
    let resolveCommand: (value: Response) => void = () => {}
    const commandPromise = new Promise<Response>((resolve) => {
      resolveCommand = resolve
    })
    const commandRequests: Array<{
      url: string
      body: { idempotencyKey?: string; text?: string }
    }> = []

    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      const urlStr = String(url)
      if (
        urlStr.startsWith('/api/portal/conversations?') ||
        urlStr === '/api/portal/conversations'
      ) {
        return Promise.resolve(
          jsonResponse({
            docs: [
              { ...session1, lastMessageAt: session1.messages[0]?.createdAt, messages: undefined },
              { ...session2, lastMessageAt: session2.messages[0]?.createdAt, messages: undefined },
            ],
            page: 1,
            totalDocs: 2,
            totalPages: 1,
          }),
        )
      }
      if (urlStr.includes('/api/portal/conversations/conv-1/operator-messages')) {
        commandRequests.push({
          body: JSON.parse(String(init?.body)) as { idempotencyKey?: string; text?: string },
          url: urlStr,
        })
        return commandPromise
      }
      if (urlStr.includes('/api/portal/conversations/conv-1')) {
        return Promise.resolve(jsonResponse(session1))
      }
      if (urlStr.includes('/api/portal/conversations/conv-2')) {
        return Promise.resolve(jsonResponse(session2))
      }
      return Promise.reject(new Error(`Unhandled: ${urlStr}`))
    })
    vi.stubGlobal('fetch', fetchMock)

    renderWorkspace('conv-1')

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: '官网访客 #conv-1' })).toBeDefined()
    })

    const textarea = screen.getByPlaceholderText('输入给客户的回复…') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: 'first draft' } })
    fireEvent.click(screen.getByRole('button', { name: '发送回复' }))
    expect(commandRequests).toHaveLength(1)

    fireEvent.change(textarea, { target: { value: 'second unsent draft' } })
    expect(textarea.value).toBe('second unsent draft')

    await act(async () => {
      resolveCommand(
        jsonResponse({
          ...session1,
          messages: [
            ...session1.messages,
            {
              author: 'operator',
              content: 'first draft',
              createdAt: '2026-08-01T10:10:00.000Z',
              id: 'm-reply-1',
              status: 'sent',
            },
          ],
          revision: session1.revision + 1,
        }),
      )
    })

    await waitFor(() => {
      expect(textarea.value).toBe('second unsent draft')
    })
    expect(commandRequests).toHaveLength(1)
    expect(commandRequests[0]).toMatchObject({
      body: {
        idempotencyKey: expect.stringMatching(/^portal:operator-messages:conv-1:/u),
        text: 'first draft',
      },
      url: '/api/portal/conversations/conv-1/operator-messages',
    })
  })

  it('keeps the original idempotency key after a successful command response cannot be parsed', async () => {
    let commandAttempts = 0
    const commandRequests: Array<{ idempotencyKey?: string; text?: string }> = []
    const sentSession: ChatSession = {
      ...session1,
      messages: [
        ...session1.messages,
        {
          author: 'operator',
          content: 'same key retry',
          createdAt: '2026-08-01T10:10:00.000Z',
          id: 'm-same-key',
          status: 'sent',
        },
      ],
      revision: session1.revision + 1,
    }

    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      const urlStr = String(url)
      if (
        urlStr.startsWith('/api/portal/conversations?') ||
        urlStr === '/api/portal/conversations'
      ) {
        return Promise.resolve(
          jsonResponse({
            docs: [
              { ...session1, lastMessageAt: session1.messages[0]?.createdAt, messages: undefined },
            ],
            page: 1,
            totalDocs: 1,
            totalPages: 1,
          }),
        )
      }
      if (urlStr.includes('/api/portal/conversations/conv-1/operator-messages')) {
        commandAttempts += 1
        commandRequests.push(
          JSON.parse(String(init?.body)) as { idempotencyKey?: string; text?: string },
        )
        return commandAttempts === 1
          ? Promise.resolve(new Response('{', { status: 200 }))
          : Promise.resolve(jsonResponse(sentSession))
      }
      if (urlStr.includes('/api/portal/conversations/conv-1')) {
        return Promise.resolve(jsonResponse(session1))
      }
      return Promise.reject(new Error(`Unhandled: ${urlStr}`))
    })
    vi.stubGlobal('fetch', fetchMock)

    renderWorkspace('conv-1')
    await waitFor(() => expect(screen.getByRole('heading', { name: '官网访客 #conv-1' })).toBeDefined())

    const textarea = screen.getByPlaceholderText('输入给客户的回复…') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: 'same key retry' } })
    fireEvent.click(screen.getByRole('button', { name: '发送回复' }))
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('invalid JSON'))
    expect(textarea.value).toBe('same key retry')

    fireEvent.click(screen.getByRole('button', { name: '发送回复' }))
    await waitFor(() => expect(commandAttempts).toBe(2))
    expect(commandRequests[0]?.idempotencyKey).toBe(commandRequests[1]?.idempotencyKey)
    expect(commandRequests[0]?.text).toBe(commandRequests[1]?.text)
  })

  it('does not show a command result for conversation A after list refresh selects conversation B', async () => {
    let resolveCommand: (value: Response) => void = () => {}
    const commandPromise = new Promise<Response>((resolve) => {
      resolveCommand = resolve
    })
    let listRequests = 0
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      const urlStr = String(url)
      if (
        urlStr.startsWith('/api/portal/conversations?') ||
        urlStr === '/api/portal/conversations'
      ) {
        listRequests += 1
        const docs = listRequests > 1 ? [session2] : [session1, session2]
        return Promise.resolve(
          jsonResponse({
            docs: docs.map((session) => ({
              ...session,
              lastMessageAt: session.messages[0]?.createdAt,
              messages: undefined,
            })),
            page: 1,
            totalDocs: docs.length,
            totalPages: 1,
          }),
        )
      }
      if (urlStr.includes('/api/portal/conversations/conv-1/resolve')) return commandPromise
      if (urlStr.includes('/api/portal/conversations/conv-1'))
        return Promise.resolve(jsonResponse(session1))
      if (urlStr.includes('/api/portal/conversations/conv-2'))
        return Promise.resolve(jsonResponse(session2))
      return Promise.reject(new Error(`Unhandled: ${urlStr}`))
    })
    vi.stubGlobal('fetch', fetchMock)

    renderWorkspace('conv-1')
    await waitFor(() => expect(screen.getByRole('heading', { name: '官网访客 #conv-1' })).toBeDefined())
    fireEvent.click(screen.getByRole('button', { name: '解决会话' }))

    await act(async () => {
      resolveCommand(
        jsonResponse({
          ...session1,
          allowedActions: [],
          handoffStatus: 'resolved',
          revision: session1.revision + 1,
        }),
      )
    })

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Facebook客户 #conv-2' })).toBeDefined())
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('merges same-revision message delivery status without regressing sent to pending', () => {
    const pending: ChatSession = {
      ...session1,
      messages: [{ ...session1.messages[0], id: 'delivery-1', status: 'pending' }],
    }
    const sent: ChatSession = {
      ...pending,
      messages: [{ ...pending.messages[0], status: 'sent' }],
    }
    const stalePending: ChatSession = {
      ...sent,
      messages: [{ ...sent.messages[0], status: 'pending' }],
    }

    expect(mergeConversationSnapshots(pending, sent).messages[0]?.status).toBe('sent')
    expect(mergeConversationSnapshots(sent, stalePending).messages[0]?.status).toBe('sent')
  })

  it('refreshes using the current filter after an older command completes', async () => {
    let resolveCommand: (value: Response) => void = () => {}
    const commandPromise = new Promise<Response>((resolve) => {
      resolveCommand = resolve
    })
    const listUrls: string[] = []
    const resolvedSession: ChatSession = {
      ...session2,
      allowedActions: [],
      handoffStatus: 'resolved',
    }

    const fetchMock = vi.fn().mockImplementation((url: string) => {
      const urlStr = String(url)
      if (urlStr.startsWith('/api/portal/conversations?')) {
        listUrls.push(urlStr)
        const isResolved =
          new URL(`http://localhost${urlStr}`).searchParams.get('status') === 'resolved'
        const docs = isResolved ? [resolvedSession] : [session1, session2]
        return Promise.resolve(
          jsonResponse({
            docs: docs.map((session) => ({
              ...session,
              lastMessageAt: session.messages[0]?.createdAt,
              messages: undefined,
            })),
            page: 1,
            totalDocs: docs.length,
            totalPages: 1,
          }),
        )
      }
      if (urlStr.includes('/api/portal/conversations/conv-1/resolve')) {
        return commandPromise
      }
      if (urlStr.includes('/api/portal/conversations/conv-1')) {
        return Promise.resolve(jsonResponse(session1))
      }
      if (urlStr.includes('/api/portal/conversations/conv-2')) {
        return Promise.resolve(jsonResponse(resolvedSession))
      }
      return Promise.reject(new Error(`Unhandled: ${urlStr}`))
    })
    vi.stubGlobal('fetch', fetchMock)

    renderWorkspace('conv-1')

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: '官网访客 #conv-1' })).toBeDefined()
    })
    fireEvent.click(screen.getByRole('button', { name: '解决会话' }))

    const listRequestCountBeforeFilter = listUrls.length
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'resolved' } })
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Facebook客户 #conv-2' })).toBeDefined()
      expect(screen.getAllByText('已解决').length).toBeGreaterThan(0)
    })
    const listRequestCountBeforeCommandCompletion = listUrls.length

    await act(async () => {
      resolveCommand(
        jsonResponse({
          ...session1,
          allowedActions: [],
          handoffStatus: 'resolved',
          revision: session1.revision + 1,
        }),
      )
    })

    await waitFor(() => {
      expect(listUrls.length).toBeGreaterThan(listRequestCountBeforeCommandCompletion)
    })
    const refreshedListUrls = listUrls.slice(listRequestCountBeforeFilter)
    expect(refreshedListUrls.length).toBeGreaterThan(0)
    expect(
      refreshedListUrls.every(
        (url) => new URL(`http://localhost${url}`).searchParams.get('status') === 'resolved',
      ),
    ).toBe(true)
    expect(screen.queryByRole('heading', { name: '官网访客 #conv-1' })).toBeNull()
    expect(screen.getByRole('heading', { name: 'Facebook客户 #conv-2' })).toBeDefined()
  })

  it('prevents stale conversation detail response from mutating active session or leaking actions', async () => {
    let resolveConv1: (val: Response) => void = () => {}
    const conv1Promise = new Promise<Response>((resolve) => {
      resolveConv1 = resolve
    })

    const fetchMock = vi.fn().mockImplementation((url: string) => {
      const urlStr = String(url)
      if (
        urlStr.startsWith('/api/portal/conversations?') ||
        urlStr === '/api/portal/conversations'
      ) {
        return Promise.resolve(
          jsonResponse({
            docs: [
              { ...session1, lastMessageAt: session1.messages[0]?.createdAt, messages: undefined },
              { ...session2, lastMessageAt: session2.messages[0]?.createdAt, messages: undefined },
            ],
            page: 1,
            totalDocs: 2,
            totalPages: 1,
          }),
        )
      }
      if (urlStr.includes('/api/portal/conversations/conv-1')) {
        return conv1Promise
      }
      if (urlStr.includes('/api/portal/conversations/conv-2')) {
        return Promise.resolve(jsonResponse(session2))
      }
      return Promise.reject(new Error(`Unhandled: ${urlStr}`))
    })
    vi.stubGlobal('fetch', fetchMock)

    renderWorkspace('conv-1')

    // conv-1 detail is pending, so detail panel should show loading, not conv-1 content yet
    expect(screen.getAllByText('正在加载会话…').length).toBeGreaterThan(0)

    // Rapidly switch to conv-2
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Facebook客户 #conv-2/u })).toBeDefined()
    })
    fireEvent.click(screen.getByRole('button', { name: /Facebook客户 #conv-2/u }))

    // conv-2 loads and completes
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Facebook客户 #conv-2' })).toBeDefined()
      expect(screen.getByText('Second visitor message')).toBeDefined()
    })

    // Now resolve the stale conv-1 response
    await act(async () => {
      resolveConv1(jsonResponse(session1))
    })

    // Ensure conv-2 is still visible and was NOT overwritten by conv-1
    expect(screen.getByRole('heading', { name: 'Facebook客户 #conv-2' })).toBeDefined()
    expect(screen.queryByText('First visitor message')).toBeNull()
  })

  it('prevents stale in-flight command on old conversation from overwriting newly selected conversation', async () => {
    let resolveCommand: (val: Response) => void = () => {}
    const commandPromise = new Promise<Response>((resolve) => {
      resolveCommand = resolve
    })

    const fetchMock = vi.fn().mockImplementation((url: string) => {
      const urlStr = String(url)
      if (
        urlStr.startsWith('/api/portal/conversations?') ||
        urlStr === '/api/portal/conversations'
      ) {
        return Promise.resolve(
          jsonResponse({
            docs: [
              { ...session1, lastMessageAt: session1.messages[0]?.createdAt, messages: undefined },
              { ...session2, lastMessageAt: session2.messages[0]?.createdAt, messages: undefined },
            ],
            page: 1,
            totalDocs: 2,
            totalPages: 1,
          }),
        )
      }
      if (urlStr.includes('/api/portal/conversations/conv-1/resolve')) {
        return commandPromise
      }
      if (urlStr.includes('/api/portal/conversations/conv-1')) {
        return Promise.resolve(jsonResponse(session1))
      }
      if (urlStr.includes('/api/portal/conversations/conv-2')) {
        return Promise.resolve(jsonResponse(session2))
      }
      return Promise.reject(new Error(`Unhandled: ${urlStr}`))
    })
    vi.stubGlobal('fetch', fetchMock)

    renderWorkspace('conv-1')

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: '官网访客 #conv-1' })).toBeDefined()
    })

    // Trigger resolve command on conv-1
    const resolveButton = screen.getByRole('button', { name: '解决会话' })
    fireEvent.click(resolveButton)

    // Switch to conv-2 while conv-1 resolve is in-flight
    fireEvent.click(screen.getByRole('button', { name: /Facebook客户 #conv-2/u }))

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Facebook客户 #conv-2' })).toBeDefined()
    })

    // Now resolve the conv-1 command
    await act(async () => {
      resolveCommand(
        jsonResponse({
          ...session1,
          allowedActions: [],
          handoffStatus: 'resolved',
          revision: session1.revision + 1,
        }),
      )
    })

    // Ensure conv-2 remains active and its UI is not replaced by conv-1
    expect(screen.getByRole('heading', { name: 'Facebook客户 #conv-2' })).toBeDefined()
    expect(screen.getByText('Second visitor message')).toBeDefined()
  })

  it('keeps a newer same-conversation revision after switching away and back', async () => {
    let resolveCommand: (value: Response) => void = () => {}
    const commandPromise = new Promise<Response>((resolve) => {
      resolveCommand = resolve
    })
    let conv1DetailRequests = 0
    const authoritativeSession: ChatSession = {
      ...session1,
      allowedActions: [],
      handoffStatus: 'resolved',
      messages: [
        ...session1.messages,
        {
          author: 'system',
          content: 'Authoritative revision 3',
          createdAt: '2026-08-01T10:15:00.000Z',
          id: 'm-authoritative-3',
          status: 'sent',
        },
      ],
      revision: 3,
    }

    const fetchMock = vi.fn().mockImplementation((url: string) => {
      const urlStr = String(url)
      if (
        urlStr.startsWith('/api/portal/conversations?') ||
        urlStr === '/api/portal/conversations'
      ) {
        return Promise.resolve(
          jsonResponse({
            docs: [
              { ...session1, lastMessageAt: session1.messages[0]?.createdAt, messages: undefined },
              { ...session2, lastMessageAt: session2.messages[0]?.createdAt, messages: undefined },
            ],
            page: 1,
            totalDocs: 2,
            totalPages: 1,
          }),
        )
      }
      if (urlStr.includes('/api/portal/conversations/conv-1/operator-messages')) {
        return commandPromise
      }
      if (urlStr.includes('/api/portal/conversations/conv-1')) {
        conv1DetailRequests += 1
        return Promise.resolve(
          jsonResponse(conv1DetailRequests === 1 ? session1 : authoritativeSession),
        )
      }
      if (urlStr.includes('/api/portal/conversations/conv-2')) {
        return Promise.resolve(jsonResponse(session2))
      }
      return Promise.reject(new Error(`Unhandled: ${urlStr}`))
    })
    vi.stubGlobal('fetch', fetchMock)

    renderWorkspace('conv-1')

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: '官网访客 #conv-1' })).toBeDefined()
    })
    fireEvent.change(screen.getByPlaceholderText('输入给客户的回复…'), {
      target: { value: 'Delayed revision 2 reply' },
    })
    fireEvent.click(screen.getByRole('button', { name: '发送回复' }))

    fireEvent.click(screen.getByRole('button', { name: /Facebook客户 #conv-2/u }))
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Facebook客户 #conv-2' })).toBeDefined()
    })

    fireEvent.click(screen.getByRole('button', { name: /官网访客 #conv-1/u }))
    await waitFor(() => {
      expect(screen.getByText('Authoritative revision 3')).toBeDefined()
      expect(screen.getByText('v3')).toBeDefined()
    })

    await act(async () => {
      resolveCommand(
        jsonResponse({
          ...session1,
          messages: [
            ...session1.messages,
            {
              author: 'operator',
              content: 'Delayed revision 2 reply',
              createdAt: '2026-08-01T10:10:00.000Z',
              id: 'm-stale-2',
              status: 'sent',
            },
          ],
          revision: 2,
        }),
      )
    })

    await waitFor(() => {
      expect(screen.getByText('Authoritative revision 3')).toBeDefined()
      expect(screen.getByText('v3')).toBeDefined()
    })
    expect(screen.queryByText('Delayed revision 2 reply')).toBeNull()
    expect(screen.queryByRole('button', { name: '发送回复' })).toBeNull()
    expect(screen.queryByRole('button', { name: '解决会话' })).toBeNull()
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('keeps command busy state isolated per conversation', async () => {
    let resolveConv1Command: (value: Response) => void = () => {}
    const conv1CommandPromise = new Promise<Response>((resolve) => {
      resolveConv1Command = resolve
    })
    const commandRequests: Array<{
      body: { idempotencyKey?: string }
      url: string
    }> = []

    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      const urlStr = String(url)
      if (
        urlStr.startsWith('/api/portal/conversations?') ||
        urlStr === '/api/portal/conversations'
      ) {
        return Promise.resolve(
          jsonResponse({
            docs: [
              { ...session1, lastMessageAt: session1.messages[0]?.createdAt, messages: undefined },
              { ...session2, lastMessageAt: session2.messages[0]?.createdAt, messages: undefined },
            ],
            page: 1,
            totalDocs: 2,
            totalPages: 1,
          }),
        )
      }
      if (urlStr.includes('/resolve')) {
        commandRequests.push({
          body: JSON.parse(String(init?.body)) as { idempotencyKey?: string },
          url: urlStr,
        })
        if (urlStr.includes('/conv-1/')) return conv1CommandPromise
        if (urlStr.includes('/conv-2/')) {
          return Promise.resolve(
            jsonResponse({
              ...session2,
              allowedActions: [],
              handoffStatus: 'resolved',
              revision: 2,
            }),
          )
        }
      }
      if (urlStr.includes('/api/portal/conversations/conv-1')) {
        return Promise.resolve(jsonResponse(session1))
      }
      if (urlStr.includes('/api/portal/conversations/conv-2')) {
        return Promise.resolve(jsonResponse(session2))
      }
      return Promise.reject(new Error(`Unhandled: ${urlStr}`))
    })
    vi.stubGlobal('fetch', fetchMock)

    renderWorkspace('conv-1')

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: '官网访客 #conv-1' })).toBeDefined()
    })
    fireEvent.click(screen.getByRole('button', { name: '解决会话' }))
    await waitFor(() => expect(commandRequests).toHaveLength(1))

    fireEvent.click(screen.getByRole('button', { name: /Facebook客户 #conv-2/u }))
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Facebook客户 #conv-2' })).toBeDefined()
    })
    const conv2Resolve = screen.getByRole('button', { name: '解决会话' })
    expect((conv2Resolve as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(conv2Resolve)

    await waitFor(() => {
      expect(commandRequests).toHaveLength(2)
      expect(screen.getAllByText('已解决').length).toBeGreaterThan(0)
    })
    expect(commandRequests.map(({ url }) => url)).toEqual([
      '/api/portal/conversations/conv-1/resolve',
      '/api/portal/conversations/conv-2/resolve',
    ])
    expect(commandRequests[0]?.body.idempotencyKey).toMatch(/^portal:resolve:conv-1:/u)
    expect(commandRequests[1]?.body.idempotencyKey).toMatch(/^portal:resolve:conv-2:/u)
    expect(commandRequests[0]?.body.idempotencyKey).not.toBe(
      commandRequests[1]?.body.idempotencyKey,
    )

    await act(async () => {
      resolveConv1Command(
        jsonResponse({
          ...session1,
          allowedActions: [],
          handoffStatus: 'resolved',
          revision: 2,
        }),
      )
    })
  })

  it('surfaces a new visitor message through live refresh without an operator action', async () => {
    vi.useFakeTimers()
    try {
      const withThirdMessage: ChatSession = {
        ...session1,
        messages: [
          ...session1.messages,
          {
            author: 'visitor',
            content: 'Third visitor message',
            createdAt: '2026-08-01T10:06:00.000Z',
            id: 'm3',
            status: 'sent',
          },
        ],
        revision: session1.revision + 1,
      }
      let detailResponses = 0
      const fetchMock = vi.fn().mockImplementation((url: string) => {
        const urlStr = String(url)
        if (
          urlStr.startsWith('/api/portal/conversations?') ||
          urlStr === '/api/portal/conversations'
        ) {
          return Promise.resolve(
            jsonResponse({
              docs: [
                {
                  ...session1,
                  lastMessageAt: session1.messages[0]?.createdAt,
                  messages: undefined,
                },
              ],
              page: 1,
              totalDocs: 1,
              totalPages: 1,
            }),
          )
        }
        if (urlStr.includes('/api/portal/conversations/conv-1')) {
          detailResponses += 1
          return Promise.resolve(jsonResponse(detailResponses >= 2 ? withThirdMessage : session1))
        }
        return Promise.reject(new Error(`Unhandled: ${urlStr}`))
      })
      vi.stubGlobal('fetch', fetchMock)

      renderWorkspace('conv-1')
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })
      expect(screen.getByText('First visitor message')).toBeDefined()
      expect(screen.queryByText('Third visitor message')).toBeNull()

      await act(async () => {
        await vi.advanceTimersByTimeAsync(5_000)
      })
      expect(screen.getByText('Third visitor message')).toBeDefined()
    } finally {
      vi.useRealTimers()
    }
  })

  it('pauses live refresh while the tab is hidden and resumes on visibility regain', async () => {
    vi.useFakeTimers()
    const visibility = Object.getOwnPropertyDescriptor(document, 'visibilityState')
    try {
      let detailResponses = 0
      const fetchMock = vi.fn().mockImplementation((url: string) => {
        const urlStr = String(url)
        if (
          urlStr.startsWith('/api/portal/conversations?') ||
          urlStr === '/api/portal/conversations'
        ) {
          return Promise.resolve(
            jsonResponse({
              docs: [
                {
                  ...session1,
                  lastMessageAt: session1.messages[0]?.createdAt,
                  messages: undefined,
                },
              ],
              page: 1,
              totalDocs: 1,
              totalPages: 1,
            }),
          )
        }
        if (urlStr.includes('/api/portal/conversations/conv-1')) {
          detailResponses += 1
          return Promise.resolve(jsonResponse(session1))
        }
        return Promise.reject(new Error(`Unhandled: ${urlStr}`))
      })
      vi.stubGlobal('fetch', fetchMock)

      renderWorkspace('conv-1')
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })
      expect(detailResponses).toBe(1)

      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        value: 'hidden',
      })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(15_000)
      })
      expect(detailResponses).toBe(1)

      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        value: 'visible',
      })
      await act(async () => {
        document.dispatchEvent(new Event('visibilitychange'))
        await vi.advanceTimersByTimeAsync(0)
      })
     expect(detailResponses).toBe(2)
   } finally {
     if (visibility) Object.defineProperty(document, 'visibilityState', visibility)
     vi.useRealTimers()
   }
 })

  it('tolerates transient network errors during background live refresh without wiping active session', async () => {
    vi.useFakeTimers()
    try {
      let failRefresh = false
      const fetchMock = vi.fn().mockImplementation((url: string) => {
        const urlStr = String(url)
        if (
          urlStr.startsWith('/api/portal/conversations?') ||
          urlStr === '/api/portal/conversations'
        ) {
          if (failRefresh) {
            return Promise.resolve(new Response('Bad Gateway', { status: 502 }))
          }
          return Promise.resolve(
            jsonResponse({
              docs: [
                {
                  ...session1,
                  lastMessageAt: session1.messages[0]?.createdAt,
                  messages: undefined,
                },
              ],
              page: 1,
              totalDocs: 1,
              totalPages: 1,
            }),
          )
        }
        if (urlStr.includes('/api/portal/conversations/conv-1')) {
          if (failRefresh) {
            return Promise.resolve(new Response('Gateway Timeout', { status: 504 }))
          }
          return Promise.resolve(jsonResponse(session1))
        }
        return Promise.reject(new Error(`Unhandled: ${urlStr}`))
      })
      vi.stubGlobal('fetch', fetchMock)

     renderWorkspace('conv-1')
     await act(async () => {
       await vi.advanceTimersByTimeAsync(0)
     })
     expect(screen.getByText('First visitor message')).toBeDefined()

     failRefresh = true
     await act(async () => {
       await vi.advanceTimersByTimeAsync(5_000)
     })

     expect(screen.getByText('First visitor message')).toBeDefined()
     expect(screen.queryByText(/502|504|Bad Gateway|Gateway Timeout/)).toBeNull()
   } finally {
     vi.useRealTimers()
   }
 })

 it('retains active selected conversation across background list refresh even if item is not on the first page', async () => {
   vi.useFakeTimers()
   try {
     let pageRefresh = false
     const fetchMock = vi.fn().mockImplementation((url: string) => {
       const urlStr = String(url)
       if (
         urlStr.startsWith('/api/portal/conversations?') ||
         urlStr === '/api/portal/conversations'
       ) {
         if (pageRefresh) {
           return Promise.resolve(
             jsonResponse({
               docs: [
                 {
                   ...session2,
                   lastMessageAt: session2.messages[0]?.createdAt,
                   messages: undefined,
                 },
               ],
               page: 1,
               totalDocs: 1,
               totalPages: 1,
             }),
           )
         }
         return Promise.resolve(
           jsonResponse({
             docs: [
               {
                 ...session1,
                 lastMessageAt: session1.messages[0]?.createdAt,
                 messages: undefined,
               },
             ],
             page: 1,
             totalDocs: 1,
             totalPages: 1,
           }),
         )
       }
       if (urlStr.includes('/api/portal/conversations/conv-1')) {
         return Promise.resolve(jsonResponse(session1))
       }
       if (urlStr.includes('/api/portal/conversations/conv-2')) {
         return Promise.resolve(jsonResponse(session2))
       }
       return Promise.reject(new Error(`Unhandled: ${urlStr}`))
     })
     vi.stubGlobal('fetch', fetchMock)

     renderWorkspace('conv-1')
     await act(async () => {
       await vi.advanceTimersByTimeAsync(0)
     })
     expect(screen.getByText('First visitor message')).toBeDefined()

     pageRefresh = true
     await act(async () => {
       await vi.advanceTimersByTimeAsync(5_000)
     })

     expect(screen.getByText('First visitor message')).toBeDefined()
   } finally {
     vi.useRealTimers()
   }
 })

 it('clears a conversation when background refresh reports it was removed', async () => {
   vi.useFakeTimers()
   try {
     let refresh = false
     const fetchMock = vi.fn().mockImplementation((url: string) => {
       const urlStr = String(url)
       if (urlStr.startsWith('/api/portal/conversations?') || urlStr === '/api/portal/conversations') {
         return Promise.resolve(
           jsonResponse(
             refresh
               ? { docs: [], page: 1, totalDocs: 0, totalPages: 1 }
               : { docs: [{ ...session1, messages: undefined }], page: 1, totalDocs: 1, totalPages: 1 },
           ),
         )
       }
       if (urlStr.includes('/api/portal/conversations/conv-1')) {
         return refresh
           ? Promise.resolve(jsonResponse({ error: { code: 'not_found', message: 'removed' } }, 404))
           : Promise.resolve(jsonResponse(session1))
       }
       return Promise.reject(new Error(`Unhandled: ${urlStr}`))
     })
     vi.stubGlobal('fetch', fetchMock)
     renderWorkspace('conv-1')
     await act(async () => { await vi.advanceTimersByTimeAsync(0) })
     expect(screen.getByText('First visitor message')).toBeDefined()
     refresh = true
     await act(async () => { await vi.advanceTimersByTimeAsync(5_000) })
     expect(screen.queryByText('First visitor message')).toBeNull()
     expect(screen.getByText('会话服务读取失败，请检查网络连接后刷新重试。')).toBeDefined()
   } finally {
     vi.useRealTimers()
   }
 })
})
