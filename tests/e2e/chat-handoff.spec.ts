import './require-mutation-launch'
import { expect, test, type Page } from '@playwright/test'

type ChatLocale = 'ar' | 'en'

type ChatFixture = {
  allowedActions: string[]
  channel: 'website'
  handoffStatus: 'ai_active' | 'handoff_requested'
  id: string
  locale: ChatLocale
  messages: Array<{
    author: 'ai' | 'visitor'
    citations?: Array<{ documentId: string; title: string; version: string }>
    content: string
    createdAt: string
    id: string
    status: 'failed' | 'sent'
  }>
  requestId: string
  revision: number
}

type ChatMockOptions = {
  failFirstMessage?: boolean
}

const createdAt = '2026-07-19T00:00:00.000Z'

const makeFixture = (locale: ChatLocale): ChatFixture => ({
  allowedActions: ['send_message', 'request_handoff'],
  channel: 'website',
  handoffStatus: 'ai_active',
  id: `chat-${locale}-fixture`,
  locale,
  messages: [],
  requestId: `request-${locale}-fixture`,
  revision: 1,
})

const installChatMock = async (page: Page, locale: ChatLocale, options: ChatMockOptions = {}) => {
  const session = makeFixture(locale)
  const handoffCommands: Array<Record<string, unknown>> = []
  const messageCommands: Array<Record<string, unknown>> = []
  const starts: Array<Record<string, unknown>> = []
  let messageAttempts = 0

  await page.route('**/api/chat/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const body = request.postDataJSON() as Record<string, unknown> | null

    if (request.method() === 'POST' && url.pathname === '/api/chat/sessions') {
      if (
        !body ||
        body.channel !== 'website' ||
        body.locale !== locale ||
        typeof body.idempotencyKey !== 'string' ||
        !body.idempotencyKey ||
        typeof body.sourceURL !== 'string'
      ) {
        await route.fulfill({
          contentType: 'application/json',
          json: { error: { code: 'invalid_request', message: 'Invalid start command', retryable: false } },
          status: 400,
        })
        return
      }
      starts.push(body || {})
      await route.fulfill({ contentType: 'application/json', json: session, status: 201 })
      return
    }

    if (request.method() === 'GET' && url.pathname === `/api/chat/sessions/${session.id}`) {
      await route.fulfill({ contentType: 'application/json', json: session, status: 200 })
      return
    }

    if (request.method() === 'POST' && url.pathname === `/api/chat/sessions/${session.id}/handoff`) {
      if (
        !body ||
        typeof body.idempotencyKey !== 'string' ||
        !body.idempotencyKey ||
        typeof body.reason !== 'string' ||
        !body.reason ||
        'source' in body
      ) {
        await route.fulfill({
          contentType: 'application/json',
          json: { error: { code: 'invalid_request', message: 'Invalid handoff command', retryable: false } },
          status: 400,
        })
        return
      }
      handoffCommands.push(body)
      session.allowedActions = []
      session.handoffStatus = 'handoff_requested'
      session.revision += 1
      await route.fulfill({ contentType: 'application/json', json: session, status: 200 })
      return
    }

    if (request.method() === 'POST' && url.pathname === `/api/chat/sessions/${session.id}/messages`) {
      if (!body || typeof body.idempotencyKey !== 'string' || !body.idempotencyKey || typeof body.text !== 'string' || !body.text) {
        await route.fulfill({
          contentType: 'application/json',
          json: { error: { code: 'invalid_request', message: 'Invalid message command', retryable: false } },
          status: 400,
        })
        return
      }
      messageCommands.push(body)
      messageAttempts += 1
      if (options.failFirstMessage && messageAttempts === 1) {
        await route.fulfill({
          contentType: 'application/json',
          json: { error: { code: 'ai_unavailable', message: 'Provider unavailable', retryable: true } },
          status: 503,
        })
        return
      }

      const text = String(body?.text || '')
      session.messages.push(
        {
          author: 'visitor',
          content: text,
          createdAt,
          id: `visitor-${messageAttempts}`,
          status: 'sent',
        },
        {
          author: 'ai',
          citations: [{ documentId: 'knowledge-fixture', title: 'Reviewed panel guide', version: '1.0' }],
          content: 'Fixture answer based on reviewed knowledge.',
          createdAt,
          id: `assistant-${messageAttempts}`,
          status: 'sent',
        },
      )
      session.revision += 1
      await route.fulfill({ contentType: 'application/json', json: session, status: 200 })
      return
    }

    await route.fulfill({
      contentType: 'application/json',
      json: { error: { code: 'not_found', message: 'Unexpected chat request', retryable: false } },
      status: 404,
    })
  })

  return { handoffCommands, messageAttempts: () => messageAttempts, messageCommands, starts }
}

test('English ChatWidget sends through the frozen browser contract and displays citations', async ({ page }) => {
  const mock = await installChatMock(page, 'en')
  await page.goto('/en')

  const widget = page.getByTestId('chat-widget')
  await widget.getByRole('button', { name: 'Ask our project assistant' }).click()
  await expect(widget.getByRole('dialog', { name: 'Project Assistant' })).toBeVisible()
  await widget.getByLabel('Ask about panels, drawings, finishes, or your project…').fill(
    'Can you explain double-curved panel options?',
  )
  await widget.getByRole('button', { name: 'Send' }).click()

  await expect(widget.getByText('Fixture answer based on reviewed knowledge.')).toBeVisible()
  await expect(widget.getByText('Reviewed sources')).toBeVisible()
  await expect(widget.getByText(/Reviewed panel guide/)).toBeVisible()
  expect(mock.starts).toHaveLength(1)
  expect(mock.starts[0]).toMatchObject({
    channel: 'website',
    idempotencyKey: expect.any(String),
    locale: 'en',
    sourceURL: expect.stringContaining('/en'),
  })
  expect(mock.messageCommands).toEqual([{
    idempotencyKey: expect.any(String),
    text: 'Can you explain double-curved panel options?',
  }])
})

test('Arabic ChatWidget respects RTL and displays the authoritative handoff state', async ({ page }) => {
  const mock = await installChatMock(page, 'ar')
  await page.goto('/ar')

  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
  const widget = page.getByTestId('chat-widget')
  await widget.getByRole('button', { name: 'اسأل مساعد المشروع' }).click()
  await expect(widget.getByRole('dialog', { name: 'مساعد المشروع' })).toBeVisible()
  await widget.getByRole('button', { name: 'التحدث مع مختص' }).click()

  await expect(widget.getByTestId('chat-handoff-pending')).toContainText('تمت مشاركة طلبك مع فريق المشروع')
  await expect(widget.getByLabel('اسأل عن الألواح أو مشروعك…')).toBeDisabled()
  const box = await widget.boundingBox()
  expect(box).not.toBeNull()
  expect(box?.x).toBeLessThan(100)
  expect(mock.handoffCommands).toEqual([{
    idempotencyKey: expect.any(String),
    reason: 'visitor_requested_assistance',
  }])
})

test('ChatWidget exposes a safe retry after a retryable server error', async ({ page }) => {
  const mock = await installChatMock(page, 'en', { failFirstMessage: true })
  await page.goto('/en/contact')

  const widget = page.getByTestId('chat-widget')
  await widget.getByRole('button', { name: 'Ask our project assistant' }).click()
  await widget.getByLabel('Ask about panels, drawings, finishes, or your project…').fill('Need panel information.')
  await widget.getByRole('button', { name: 'Send' }).click()

  await expect(widget.getByRole('alert')).toContainText('Chat is temporarily unavailable')
  await widget.getByRole('button', { name: 'Retry' }).click()
  await expect(widget.getByText('Fixture answer based on reviewed knowledge.')).toBeVisible()
  expect(mock.messageAttempts()).toBe(2)
  expect(mock.messageCommands).toHaveLength(2)
  expect(mock.messageCommands[1].idempotencyKey).toBe(mock.messageCommands[0].idempotencyKey)
})
