import './require-mutation-launch'
import { expect, test, type Page } from '@playwright/test'

const adminEmail = process.env.E2E_ADMIN_EMAIL ?? process.env.SEED_ADMIN_EMAIL
const adminPassword = process.env.E2E_ADMIN_PASSWORD ?? process.env.SEED_ADMIN_PASSWORD

const login = async (page: Page) => {
  test.skip(
    !adminEmail || !adminPassword,
    'Requires local non-production administrator credentials.',
  )
  if (!adminEmail || !adminPassword) return false
  await page.goto('/dashboard/login?returnTo=%2Fdashboard%2Fconversations')
  await page.getByRole('textbox', { name: '邮箱' }).fill(adminEmail)
  await page.getByRole('textbox', { name: '密码' }).fill(adminPassword)
  await page.getByRole('button', { name: '登录后台' }).click()
  await expect(page).toHaveURL(/\/dashboard\/conversations$/)
  return true
}

const installConversationMock = async (
  page: Page,
  options?: {
    e2eDelayMs?: number
    secondDelayMs?: number
  },
) => {
  const session = {
    allowedActions: ['take_over'],
    channel: 'website',
    handoffStatus: 'handoff_requested',
    id: 'portal-conversation-e2e',
    locale: 'en',
    messages: [
      {
        author: 'visitor',
        content: 'We need a technical panel specification.',
        createdAt: '2026-07-30T08:00:00.000Z',
        id: 'message-inbound',
        status: 'sent',
      },
    ],
    requestId: 'request-e2e',
    revision: 1,
  }
  const alternateSession = {
    ...session,
    allowedActions: ['take_over'],
    channel: 'facebook',
    id: 'portal-conversation-second',
    messages: [
      {
        author: 'visitor',
        content: 'Second conversation request from visitor.',
        createdAt: '2026-07-30T08:05:00.000Z',
        id: 'message-inbound-second',
        status: 'sent',
      },
    ],
    requestId: 'request-e2e-second',
  }

  const sessions: Record<string, typeof session> = {
    'portal-conversation-e2e': session,
    'portal-conversation-second': alternateSession,
  }

  await page.route('**/api/portal/conversations**', async (route) => {
    const url = new URL(route.request().url())
    const pathSegments = url.pathname.split('/').filter(Boolean)
    if (
      pathSegments.length === 3 &&
      pathSegments[0] === 'api' &&
      pathSegments[1] === 'portal' &&
      pathSegments[2] === 'conversations'
    ) {
      await route.fulfill({
        contentType: 'application/json',
        json: {
          docs: Object.values(sessions).map((s) => ({
            ...s,
            lastMessageAt: s.messages.at(-1)?.createdAt,
            messages: undefined,
          })),
          page: 1,
          totalDocs: Object.keys(sessions).length,
          totalPages: 1,
        },
        status: 200,
      })
      return
    }

    const conversationId = decodeURIComponent(pathSegments[3] ?? '')
    const targetSession = sessions[conversationId]
    if (!targetSession) {
      await route.fulfill({
        contentType: 'application/json',
        json: { error: { code: 'not_found' } },
        status: 404,
      })
      return
    }

    const command = pathSegments[4]
    const request = route.request()

    if (request.method() === 'GET') {
      if (conversationId === 'portal-conversation-e2e' && options?.e2eDelayMs) {
        await new Promise((resolve) => setTimeout(resolve, options.e2eDelayMs))
      }
      if (conversationId === 'portal-conversation-second' && options?.secondDelayMs) {
        await new Promise((resolve) => setTimeout(resolve, options.secondDelayMs))
      }
      await route.fulfill({ contentType: 'application/json', json: targetSession, status: 200 })
      return
    }

    if (command === 'take-over') {
      targetSession.allowedActions = ['send_operator_message', 'resolve']
      targetSession.handoffStatus = 'human_active'
      targetSession.revision += 1
    } else if (command === 'operator-messages') {
      const body = request.postDataJSON() as { text?: string }
      targetSession.messages.push({
        author: 'operator',
        content: body.text ?? '',
        createdAt: '2026-07-30T08:01:00.000Z',
        id: `message-operator-${targetSession.revision}`,
        status: 'sent',
      })
      targetSession.revision += 1
    } else if (command === 'resolve') {
      targetSession.allowedActions = []
      targetSession.handoffStatus = 'resolved'
      targetSession.revision += 1
    } else {
      await route.fulfill({
        contentType: 'application/json',
        json: { error: { code: 'not_found' } },
        status: 404,
      })
      return
    }
    await route.fulfill({ contentType: 'application/json', json: targetSession, status: 200 })
  })
}

test('conversation workspace renders only server-authorized actions and completes takeover, reply, and resolve', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ height: 900, width: 1440 })
  if (!(await login(page))) return
  await installConversationMock(page)
  await page.goto('/dashboard/conversations?conversation=portal-conversation-e2e')

  await expect(page.getByRole('heading', { level: 2, name: '统一会话' })).toBeVisible()
  await expect(page.locator('.portal-page__eyebrow')).toHaveCount(0)
  await expect(page.locator('.portal-header__heading')).toBeVisible()
  await expect(page.getByRole('heading', { name: '#portal-conversation-e2e' })).toBeVisible()
  await expect(page.getByRole('button', { name: '接管会话' })).toBeVisible()
  await expect(page.getByRole('button', { name: '发送回复' })).toHaveCount(0)

  await page.getByRole('button', { name: '接管会话' }).click()
  await expect(page.getByRole('button', { name: '发送回复' })).toBeVisible()
  await page
    .getByPlaceholder('输入给客户的回复…')
    .fill('We will send the relevant specification today.')
  await expect(page.getByRole('button', { name: '发送回复' })).toBeEnabled()
  await page.getByRole('button', { name: '发送回复' }).click()
  await expect(page.getByText('We will send the relevant specification today.')).toBeVisible()
  await page.getByRole('button', { name: '解决会话' }).click()
  await expect(page.getByText('已解决').first()).toBeVisible()
  await expect(page.getByRole('button', { name: '发送回复' })).toHaveCount(0)
  await expect(page.locator('a[href^="/admin"]')).toHaveCount(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1440)
  await page.screenshot({
    fullPage: true,
    path: testInfo.outputPath('portal-conversations-desktop.png'),
  })
})

test('mobile conversation workspace stays within a 390px viewport', async ({ page }, testInfo) => {
  await page.setViewportSize({ height: 844, width: 390 })
  if (!(await login(page))) return
  await installConversationMock(page)
  await page.goto('/dashboard/conversations')
  await expect(page.getByRole('heading', { level: 2, name: '统一会话' })).toBeVisible()
  await expect(page.locator('.portal-conversations__workspace')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  await page.screenshot({
    fullPage: true,
    path: testInfo.outputPath('portal-conversations-mobile.png'),
  })
})

test('a consumed conversation deep link does not override a later manual selection', async ({
  page,
}) => {
  if (!(await login(page))) return
  await installConversationMock(page)
  await page.goto('/dashboard/conversations?conversation=portal-conversation-e2e')

  await expect(page.getByRole('heading', { name: '#portal-conversation-e2e' })).toBeVisible()
  await page.getByRole('button', { name: /#portal-conversation-second/u }).click()
  await expect(page.getByRole('heading', { name: '#portal-conversation-second' })).toBeVisible()

  await page.getByRole('button', { name: '刷新列表' }).click()
  await expect(page.getByRole('heading', { name: '#portal-conversation-second' })).toBeVisible()
})

test('switching conversations isolates reply drafts and clears only the active conversation draft', async ({
  page,
}) => {
  if (!(await login(page))) return
  await installConversationMock(page)
  await page.goto('/dashboard/conversations?conversation=portal-conversation-e2e')

  await expect(page.getByRole('heading', { name: '#portal-conversation-e2e' })).toBeVisible()
  await page.getByRole('button', { name: '接管会话' }).click()
  await expect(page.getByPlaceholder('输入给客户的回复…')).toBeVisible()

  // Type draft for conversation 1
  await page.getByPlaceholder('输入给客户的回复…').fill('Draft reply for conversation 1')
  await expect(page.getByPlaceholder('输入给客户的回复…')).toHaveValue(
    'Draft reply for conversation 1',
  )

  // Switch to conversation 2
  await page.getByRole('button', { name: /#portal-conversation-second/u }).click()
  await expect(page.getByRole('heading', { name: '#portal-conversation-second' })).toBeVisible()
  await page.getByRole('button', { name: '接管会话' }).click()
  await expect(page.getByPlaceholder('输入给客户的回复…')).toBeVisible()

  // Verify conversation 2 has an empty draft initially
  await expect(page.getByPlaceholder('输入给客户的回复…')).toHaveValue('')

  // Type draft for conversation 2
  await page.getByPlaceholder('输入给客户的回复…').fill('Draft reply for conversation 2')
  await expect(page.getByPlaceholder('输入给客户的回复…')).toHaveValue(
    'Draft reply for conversation 2',
  )

  // Switch back to conversation 1
  await page.getByRole('button', { name: /#portal-conversation-e2e/u }).click()
  await expect(page.getByRole('heading', { name: '#portal-conversation-e2e' })).toBeVisible()

  // Verify draft for conversation 1 was preserved
  await expect(page.getByPlaceholder('输入给客户的回复…')).toHaveValue(
    'Draft reply for conversation 1',
  )

  // Send reply on conversation 1
  await page.getByRole('button', { name: '发送回复' }).click()
  await expect(page.getByText('Draft reply for conversation 1')).toBeVisible()
  await expect(page.getByPlaceholder('输入给客户的回复…')).toHaveValue('')

  // Switch back to conversation 2 and verify its draft is still intact
  await page.getByRole('button', { name: /#portal-conversation-second/u }).click()
  await expect(page.getByRole('heading', { name: '#portal-conversation-second' })).toBeVisible()
  await expect(page.getByPlaceholder('输入给客户的回复…')).toHaveValue(
    'Draft reply for conversation 2',
  )
})

test('stale detail response from a previously selected conversation does not overwrite current conversation', async ({
  page,
}) => {
  if (!(await login(page))) return
  await installConversationMock(page, { e2eDelayMs: 1200 })
  await page.goto('/dashboard/conversations')

  // The list auto-selects conversation 1, which has a 1200ms delay.
  // We immediately switch to conversation 2.
  await page.getByRole('button', { name: /#portal-conversation-second/u }).click()

  // Conversation 2 loads and renders
  await expect(page.getByRole('heading', { name: '#portal-conversation-second' })).toBeVisible()
  await expect(page.getByText('Second conversation request from visitor.')).toBeVisible()

  // Wait for the delayed response of conversation 1 to arrive
  await page.waitForTimeout(1600)

  // Assert that conversation 2 remains displayed and was not overwritten by conversation 1
  await expect(page.getByRole('heading', { name: '#portal-conversation-second' })).toBeVisible()
  await expect(page.getByText('Second conversation request from visitor.')).toBeVisible()
  await expect(page.getByRole('heading', { name: '#portal-conversation-e2e' })).toHaveCount(0)
})
