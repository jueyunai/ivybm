import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ChatWidget } from '@/components/chat/ChatWidget'
import { createBrowserChatService } from '@/components/chat/service'
import { ChatServiceError, type ChatService, type ChatSession } from '@/modules/conversations/contracts'

import { FakeChatService } from '../fakes/chatService'

const browserSession: ChatSession = {
  allowedActions: ['send_message', 'request_handoff'],
  channel: 'website',
  handoffStatus: 'ai_active',
  id: 'session-1',
  locale: 'en',
  messages: [],
  requestId: 'request-1',
  revision: 1,
}

const renderWidget = (service: ChatService, locale: 'ar' | 'en' = 'en') =>
  render(React.createElement(ChatWidget, { locale, service }))

const openWidget = async () => {
  fireEvent.click(screen.getByRole('button', { name: /project assistant|مساعد المشروع/i }))
  const dialog = await screen.findByRole('dialog')
  await waitFor(() => expect(within(dialog).getByRole('textbox')).toHaveProperty('disabled', false))
  return dialog
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  window.sessionStorage.clear()
})

describe('ChatWidget', () => {
  it('uses the frozen service contract to send a message and render reviewed citations', async () => {
    renderWidget(new FakeChatService())
    await openWidget()

    const composer = screen.getByLabelText('Ask about panels, drawings, finishes, or your project…')
    fireEvent.change(composer, { target: { value: 'Can you explain curved panel options?' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))

    expect(await screen.findByText('Fixture AI reply.')).not.toBeNull()
    expect(screen.getByText('Reviewed sources')).not.toBeNull()
    expect(screen.getByText(/Fixture knowledge source/)).not.toBeNull()
    expect(screen.getByText('Can you explain curved panel options?')).not.toBeNull()
  })

  it('renders Arabic controls and moves into the server-authoritative handoff state', async () => {
    renderWidget(new FakeChatService(), 'ar')
    await openWidget()

    expect(screen.getByRole('dialog', { name: 'مساعد المشروع' })).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'التحدث مع مختص' }))

    expect((await screen.findByTestId('chat-handoff-pending')).textContent).toContain(
      'تمت مشاركة طلبك مع فريق المشروع',
    )
    expect(screen.getByLabelText('اسأل عن الألواح أو مشروعك…')).toHaveProperty(
      'disabled', true,
    )
  })

  it('keeps dialog focus contained, exposes its label, and restores focus on Escape', async () => {
    renderWidget(new FakeChatService())
    const launcher = screen.getByRole('button', { name: 'Ask our project assistant' })
    const dialog = await openWidget()

    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(dialog.getAttribute('aria-labelledby')).toBe('chat-panel-en-title')
    await waitFor(() => expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Close chat' })))
    expect(launcher.getAttribute('aria-controls')).toBe('chat-panel-en')

    fireEvent.keyDown(dialog, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(document.activeElement).toBe(launcher)
  })

  it('reuses a retryable send command key after a lost response', async () => {
    const fake = new FakeChatService()
    const commandKeys: string[] = []
    const service: ChatService = {
      getSession: fake.getSession.bind(fake),
      requestHandoff: fake.requestHandoff.bind(fake),
      resolve: fake.resolve.bind(fake),
      retryMessage: fake.retryMessage.bind(fake),
      sendMessage: async (input) => {
        commandKeys.push(input.idempotencyKey)
        if (commandKeys.length === 1) {
          throw new ChatServiceError('ai_unavailable', 'Provider unavailable', { retryable: true })
        }
        return fake.sendMessage(input)
      },
      sendOperatorMessage: fake.sendOperatorMessage.bind(fake),
      startSession: fake.startSession.bind(fake),
      takeOver: fake.takeOver.bind(fake),
    }
    renderWidget(service)
    await openWidget()

    fireEvent.change(screen.getByLabelText('Ask about panels, drawings, finishes, or your project…'), {
      target: { value: 'Please share panel finish options.' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))

    expect((await screen.findByRole('alert')).textContent).toContain('Chat is temporarily unavailable')
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

    expect(await screen.findByText('Fixture AI reply.')).not.toBeNull()
    expect(commandKeys).toHaveLength(2)
    expect(commandKeys[1]).toBe(commandKeys[0])
  })

  it('does not offer a resend action for a non-retryable server error', async () => {
    const fake = new FakeChatService()
    const service: ChatService = {
      getSession: fake.getSession.bind(fake),
      requestHandoff: fake.requestHandoff.bind(fake),
      resolve: fake.resolve.bind(fake),
      retryMessage: fake.retryMessage.bind(fake),
      sendMessage: async () => {
        throw new ChatServiceError('internal_error', 'Unexpected failure')
      },
      sendOperatorMessage: fake.sendOperatorMessage.bind(fake),
      startSession: fake.startSession.bind(fake),
      takeOver: fake.takeOver.bind(fake),
    }
    renderWidget(service)
    await openWidget()

    fireEvent.change(screen.getByLabelText('Ask about panels, drawings, finishes, or your project…'), {
      target: { value: 'Please share panel finish options.' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))

    const alert = await screen.findByRole('alert')
    expect(within(alert).queryByRole('button', { name: 'Retry' })).toBeNull()
  })

  it('keeps a recoverable stored session after a transient restore error', async () => {
    window.sessionStorage.setItem('ivybm_chat_session_id_en', 'restored-session')
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () =>
      new Response(JSON.stringify({
        error: { code: 'ai_unavailable', message: 'Provider unavailable', retryable: true },
      }), { status: 503 }),
    )
    vi.stubGlobal('fetch', fetchMock)

    render(React.createElement(ChatWidget, { locale: 'en' }))
    fireEvent.click(screen.getByRole('button', { name: 'Ask our project assistant' }))

    expect(await screen.findByRole('alert')).not.toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith('/api/chat/sessions/restored-session', expect.objectContaining({
      credentials: 'same-origin',
    }))
    expect(window.sessionStorage.getItem('ivybm_chat_session_id_en')).toBe('restored-session')
  })

  it('clears a transient handoff refresh error after the next authoritative session update', async () => {
    const fake = new FakeChatService()
    let refreshAttempts = 0
    const service: ChatService = {
      getSession: async (sessionId) => {
        refreshAttempts += 1
        if (refreshAttempts === 1) {
          throw new ChatServiceError('ai_unavailable', 'Provider unavailable', { retryable: true })
        }
        return fake.getSession(sessionId)
      },
      requestHandoff: fake.requestHandoff.bind(fake),
      resolve: fake.resolve.bind(fake),
      retryMessage: fake.retryMessage.bind(fake),
      sendMessage: fake.sendMessage.bind(fake),
      sendOperatorMessage: fake.sendOperatorMessage.bind(fake),
      startSession: fake.startSession.bind(fake),
      takeOver: fake.takeOver.bind(fake),
    }
    renderWidget(service)
    await openWidget()
    vi.useFakeTimers()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Talk to a specialist' }))
      await Promise.resolve()
    })
    expect(screen.getByTestId('chat-handoff-pending')).not.toBeNull()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(12_000)
    })
    expect(screen.getByRole('alert')).not.toBeNull()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(12_000)
    })
    expect(screen.queryByRole('alert')).toBeNull()
    expect(refreshAttempts).toBe(2)
  })

  it('renders one startup error surface instead of duplicating the same failure', async () => {
    const fake = new FakeChatService()
    const service: ChatService = {
      getSession: fake.getSession.bind(fake),
      requestHandoff: fake.requestHandoff.bind(fake),
      resolve: fake.resolve.bind(fake),
      retryMessage: fake.retryMessage.bind(fake),
      sendMessage: fake.sendMessage.bind(fake),
      sendOperatorMessage: fake.sendOperatorMessage.bind(fake),
      startSession: async () => {
        throw new ChatServiceError('ai_unavailable', 'Provider unavailable', { retryable: true })
      },
      takeOver: fake.takeOver.bind(fake),
    }
    renderWidget(service)
    fireEvent.click(screen.getByRole('button', { name: 'Ask our project assistant' }))

    expect(await screen.findAllByRole('alert')).toHaveLength(1)
  })
})

describe('browser ChatService adapter', () => {
  it('uses same-origin credentials and serializes the complete public command surface', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () =>
      new Response(JSON.stringify(browserSession), { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const service = createBrowserChatService()

    await service.startSession({
      channel: 'website',
      idempotencyKey: 'chat-start-1',
      locale: 'en',
      sourceURL: 'https://example.invalid/en',
    })
    await service.sendMessage({ idempotencyKey: 'chat-message-1', sessionId: 'session-1', text: 'Need panels.' })
    await service.requestHandoff({
      idempotencyKey: 'chat-handoff-1',
      reason: 'visitor_requested_assistance',
      sessionId: 'session-1',
      source: 'visitor',
    })
    await service.retryMessage({ idempotencyKey: 'chat-retry-1', messageId: 'message-1', sessionId: 'session-1' })

    const [startPath, startOptions] = fetchMock.mock.calls[0]
    expect(startPath).toBe('/api/chat/sessions')
    expect(startOptions).toMatchObject({ credentials: 'same-origin', method: 'POST' })
    expect(JSON.parse(String(startOptions?.body))).toEqual({
      channel: 'website',
      idempotencyKey: 'chat-start-1',
      locale: 'en',
      sourceURL: 'https://example.invalid/en',
    })

    const [messagePath, messageOptions] = fetchMock.mock.calls[1]
    expect(messagePath).toBe('/api/chat/sessions/session-1/messages')
    expect(messageOptions).toMatchObject({ credentials: 'same-origin', method: 'POST' })
    expect(JSON.parse(String(messageOptions?.body))).toEqual({
      idempotencyKey: 'chat-message-1',
      text: 'Need panels.',
    })

    const [handoffPath, handoffOptions] = fetchMock.mock.calls[2]
    expect(handoffPath).toBe('/api/chat/sessions/session-1/handoff')
    expect(handoffOptions).toMatchObject({ credentials: 'same-origin', method: 'POST' })
    expect(JSON.parse(String(handoffOptions?.body))).toEqual({
      idempotencyKey: 'chat-handoff-1',
      reason: 'visitor_requested_assistance',
    })

    const [retryPath, retryOptions] = fetchMock.mock.calls[3]
    expect(retryPath).toBe('/api/chat/sessions/session-1/messages/message-1/retry')
    expect(retryOptions).toMatchObject({ credentials: 'same-origin', method: 'POST' })
    expect(JSON.parse(String(retryOptions?.body))).toEqual({ idempotencyKey: 'chat-retry-1' })
  })

  it('maps an API error to the shared stable error code', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      error: { code: 'rate_limited', message: 'Slow down', retryAfterSeconds: 30, retryable: true },
    }), { status: 429 })))

    await expect(createBrowserChatService().getSession('session-1')).rejects.toMatchObject({
      code: 'rate_limited',
      retryAfterSeconds: 30,
      retryable: true,
    })
  })

  it('restores only a public session id and revalidates it through the same-origin API', async () => {
    window.sessionStorage.setItem('ivybm_chat_session_id_en', 'restored-session')
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () =>
      new Response(JSON.stringify({ ...browserSession, id: 'restored-session', requestId: 'request-restored' }), {
        status: 200,
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    render(React.createElement(ChatWidget, { locale: 'en' }))
    await openWidget()

    expect(fetchMock).toHaveBeenCalledWith('/api/chat/sessions/restored-session', expect.objectContaining({
      credentials: 'same-origin',
    }))
    expect(fetchMock).not.toHaveBeenCalledWith('/api/chat/sessions', expect.anything())
    expect(window.sessionStorage.getItem('ivybm_chat_session_id_en')).toBe('restored-session')
  })
})
