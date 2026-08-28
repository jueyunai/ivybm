import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ChatWidget } from '@/components/chat/ChatWidget'
import { createBrowserChatService } from '@/components/chat/service'
import { ChatServiceError, type ChatService, type ChatSession } from '@/modules/conversations/contracts'

import { FakeChatService } from '../fakes/chatService'

type InjectedChatService = NonNullable<React.ComponentProps<typeof ChatWidget>['service']>

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

const renderWidget = (service: InjectedChatService, locale: 'ar' | 'en' = 'en') =>
  render(React.createElement(ChatWidget, { locale, service }))

const openWidget = async () => {
  fireEvent.click(screen.getByRole('button', { name: /project assistant|مساعد المشروع/i }))
  const dialog = await screen.findByRole('dialog')
  await waitFor(() => expect(within(dialog).getByRole('textbox')).toHaveProperty('disabled', false))
  return dialog
}

const createQualificationService = (
  locale: ChatSession['locale'],
  qualificationQuestions: [string, string],
): InjectedChatService => {
  let session: ChatSession = {
    ...browserSession,
    id: `qualification-${locale}`,
    locale,
    qualificationState: { askedFields: [], awaitingFields: [], roundCount: 0 },
    requestId: `qualification-request-${locale}`,
  }
  let visitorRound = 0
  const unexpectedCommand = async (): Promise<never> => {
    throw new Error('Unexpected ChatWidget command')
  }

  return {
    getSession: async () => structuredClone(session),
    requestHandoff: unexpectedCommand,
    retryMessage: unexpectedCommand,
    sendMessage: async ({ text }) => {
      const next = structuredClone(session)
      visitorRound += 1
      next.messages.push({
        author: 'visitor',
        content: text,
        createdAt: '2026-08-12T00:00:00.000Z',
        id: `${locale}-visitor-${visitorRound}`,
        status: 'sent',
      })
      if (visitorRound <= qualificationQuestions.length) {
        next.messages.push({
          author: 'ai',
          content: qualificationQuestions[visitorRound - 1],
          createdAt: '2026-08-12T00:00:01.000Z',
          id: `${locale}-qualification-${visitorRound}`,
          status: 'sent',
        })
        next.qualificationState =
          visitorRound === 1
            ? { askedFields: ['quantity', 'timeline'], awaitingFields: ['quantity', 'timeline'], roundCount: 1 }
            : { askedFields: ['quantity', 'timeline', 'contact'], awaitingFields: ['contact'], roundCount: 2 }
      } else {
        next.allowedActions = []
        next.handoffStatus = 'handoff_requested'
      }
      next.revision += 1
      session = next
      return structuredClone(session)
    },
    startSession: async (input) => {
      if (input.locale !== locale) throw new Error('Unexpected qualification locale')
      return structuredClone(session)
    },
  }
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
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

  it.each([
    {
      contactQuestion:
        'What work email address should our team use to follow up? You may also share a phone number.',
      firstAnswer: 'We are at tender stage in UAE. I work at Acme Facades.',
      firstQuestion:
        'What approximate area or quantity do you need? When do you expect to purchase or start the project?',
      handoffCopy: 'Your request has been shared with our project team',
      inputLabel: 'Ask about panels, drawings, finishes, or your project…',
      locale: 'en' as const,
      secondAnswer:
        'We need 1,200 sqm, have drawings, a USD 450000 budget, and plan to buy within 3 months.',
      sendLabel: 'Send',
      thirdAnswer: 'Contact buyer@example.invalid.',
    },
    {
      contactQuestion:
        'ما عنوان البريد الإلكتروني للعمل الذي يستخدمه فريقنا للمتابعة؟ ويمكنكم أيضاً مشاركة رقم هاتف.',
      firstAnswer: 'اسم الشركة: شركة النور. المشروع في السعودية ومرحلة مناقصة.',
      firstQuestion:
        'ما المساحة أو الكمية التقريبية المطلوبة؟ متى تتوقعون الشراء أو بدء المشروع؟',
      handoffCopy: 'تمت مشاركة طلبك مع فريق المشروع',
      inputLabel: 'اسأل عن الألواح أو مشروعك…',
      locale: 'ar' as const,
      secondAnswer: 'نحتاج 1200 متر مربع ولدينا رسومات وميزانية 300000 ريال والشراء خلال 3 أشهر.',
      sendLabel: 'إرسال',
      thirdAnswer: 'البريد buyer@example.invalid.',
    },
  ])(
    'renders $locale qualification follow-ups and automatic handoff',
    async ({
      contactQuestion,
      firstAnswer,
      firstQuestion,
      handoffCopy,
      inputLabel,
      locale,
      secondAnswer,
      sendLabel,
      thirdAnswer,
    }) => {
      renderWidget(createQualificationService(locale, [firstQuestion, contactQuestion]), locale)
      await openWidget()

      const composer = screen.getByLabelText(inputLabel)
      fireEvent.change(composer, { target: { value: firstAnswer } })
      fireEvent.click(screen.getByRole('button', { name: sendLabel }))
      expect(await screen.findByText(firstQuestion)).not.toBeNull()

      fireEvent.change(composer, { target: { value: secondAnswer } })
      fireEvent.click(screen.getByRole('button', { name: sendLabel }))
      expect(await screen.findByText(contactQuestion)).not.toBeNull()

      fireEvent.change(composer, { target: { value: thirdAnswer } })
      fireEvent.click(screen.getByRole('button', { name: sendLabel }))

      expect((await screen.findByTestId('chat-handoff-pending')).textContent).toContain(handoffCopy)
      expect(composer).toHaveProperty('disabled', true)
    },
  )

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

  it('reuses a start command key after a session was committed but its response was lost', async () => {
    const fake = new FakeChatService()
    const commandKeys: string[] = []
    const service: ChatService = {
      getSession: fake.getSession.bind(fake),
      requestHandoff: fake.requestHandoff.bind(fake),
      resolve: fake.resolve.bind(fake),
      retryMessage: fake.retryMessage.bind(fake),
      sendMessage: fake.sendMessage.bind(fake),
      sendOperatorMessage: fake.sendOperatorMessage.bind(fake),
      startSession: async (input) => {
        commandKeys.push(input.idempotencyKey)
        const session = await fake.startSession(input)
        if (commandKeys.length === 1) throw new TypeError('Response lost after commit')
        return session
      },
      takeOver: fake.takeOver.bind(fake),
    }
    renderWidget(service)
    fireEvent.click(screen.getByRole('button', { name: 'Ask our project assistant' }))

    expect(await screen.findByRole('alert')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

    await waitFor(() => expect(screen.getByRole('textbox')).toHaveProperty('disabled', false))
    expect(commandKeys).toHaveLength(2)
    expect(commandKeys[1]).toBe(commandKeys[0])
  })

  it('reuses a handoff command key when the first response and recovery read are lost', async () => {
    const fake = new FakeChatService()
    const commandKeys: string[] = []
    let failRecoveryRead = true
    const service: ChatService = {
      getSession: async (sessionId) => {
        if (failRecoveryRead) {
          failRecoveryRead = false
          throw new TypeError('Recovery read lost')
        }
        return fake.getSession(sessionId)
      },
      requestHandoff: async (input) => {
        commandKeys.push(input.idempotencyKey)
        const session = await fake.requestHandoff(input)
        if (commandKeys.length === 1) throw new TypeError('Response lost after commit')
        return session
      },
      resolve: fake.resolve.bind(fake),
      retryMessage: fake.retryMessage.bind(fake),
      sendMessage: fake.sendMessage.bind(fake),
      sendOperatorMessage: fake.sendOperatorMessage.bind(fake),
      startSession: fake.startSession.bind(fake),
      takeOver: fake.takeOver.bind(fake),
    }
    renderWidget(service)
    await openWidget()

    fireEvent.click(screen.getByRole('button', { name: 'Talk to a specialist' }))
    expect(await screen.findByRole('alert')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Talk to a specialist' }))

    expect(await screen.findByTestId('chat-handoff-pending')).not.toBeNull()
    expect(commandKeys).toHaveLength(2)
    expect(commandKeys[1]).toBe(commandKeys[0])
  })

  it('reuses a persisted failed-message key and removes its retry action after success', async () => {
    const failedSession: ChatSession = {
      ...browserSession,
      allowedActions: ['retry_message'],
      id: 'failed-session',
      messages: [{
        author: 'visitor',
        content: 'Please retry this question.',
        createdAt: '2026-07-20T00:00:00.000Z',
        id: 'failed-message',
        status: 'failed',
      }],
      requestId: 'failed-request',
    }
    const commandKeys: string[] = []
    const service: ChatService = {
      getSession: async () => failedSession,
      requestHandoff: async () => failedSession,
      resolve: async () => failedSession,
      retryMessage: async (input) => {
        commandKeys.push(input.idempotencyKey)
        if (commandKeys.length === 1) throw new TypeError('Response lost after retry commit')
        return failedSession
      },
      sendMessage: async () => failedSession,
      sendOperatorMessage: async () => failedSession,
      startSession: async () => failedSession,
      takeOver: async () => failedSession,
    }
    renderWidget(service)
    fireEvent.click(screen.getByRole('button', { name: 'Ask our project assistant' }))
    await screen.findByRole('dialog')

    fireEvent.click(screen.getByRole('button', { name: 'Retry message' }))
    expect(await screen.findByRole('alert')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Retry message' }))

    await waitFor(() => expect(screen.queryByRole('button', { name: 'Retry message' })).toBeNull())
    expect(commandKeys).toHaveLength(2)
    expect(commandKeys[1]).toBe(commandKeys[0])
  })

  it('keeps an in-memory session when browser storage rejects writes', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Storage unavailable', 'SecurityError')
    })
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(browserSession), { status: 201 }))
    vi.stubGlobal('fetch', fetchMock)

    render(React.createElement(ChatWidget, { locale: 'en' }))
    fireEvent.click(screen.getByRole('button', { name: 'Ask our project assistant' }))

    await waitFor(() => expect(screen.getByRole('textbox')).toHaveProperty('disabled', false))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(1)
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
      await vi.advanceTimersByTimeAsync(5_000)
    })
    expect(screen.getByRole('alert')).not.toBeNull()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000)
    })
    expect(screen.queryByRole('alert')).toBeNull()
    expect(refreshAttempts).toBe(2)
  })

  it('does not overwrite a newer handoff snapshot when an older poll response arrives late', async () => {
    const fake = new FakeChatService()
    const fakeGetSession = fake.getSession.bind(fake)
    const pollResolvers: Array<(session: ChatSession) => void> = []
    const service: ChatService = {
      getSession: () => new Promise((resolve) => {
        pollResolvers.push(resolve)
      }),
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

    const handoffRequested = await fakeGetSession('fake-session-1')
    const humanActive: ChatSession = {
      ...handoffRequested,
      allowedActions: ['send_message'],
      handoffStatus: 'human_active',
      revision: handoffRequested.revision + 1,
    }
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000)
    })
    expect(pollResolvers).toHaveLength(2)

    await act(async () => {
      pollResolvers[1](humanActive)
      await Promise.resolve()
    })
    expect(screen.getAllByText('A project specialist has joined this conversation.')).not.toHaveLength(0)

    await act(async () => {
      pollResolvers[0](handoffRequested)
      await Promise.resolve()
    })
    expect(screen.getAllByText('A project specialist has joined this conversation.')).not.toHaveLength(0)
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
