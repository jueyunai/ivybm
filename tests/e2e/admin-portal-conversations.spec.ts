import { expect, test, type Page } from '@playwright/test'

const adminEmail = process.env.E2E_ADMIN_EMAIL ?? process.env.SEED_ADMIN_EMAIL
const adminPassword = process.env.E2E_ADMIN_PASSWORD ?? process.env.SEED_ADMIN_PASSWORD

const login = async (page: Page) => {
  test.skip(!adminEmail || !adminPassword, 'Requires local non-production administrator credentials.')
  if (!adminEmail || !adminPassword) return false
  await page.goto('/dashboard/login?returnTo=%2Fdashboard%2Fconversations')
  await page.getByRole('textbox', { name: '邮箱' }).fill(adminEmail)
  await page.getByRole('textbox', { name: '密码' }).fill(adminPassword)
  await page.getByRole('button', { name: '登录后台' }).click()
  await expect(page).toHaveURL(/\/dashboard\/conversations$/)
  return true
}

const installConversationMock = async (page: Page) => {
  const session = {
    allowedActions: ['take_over'],
    channel: 'website',
    handoffStatus: 'handoff_requested',
    id: 'portal-conversation-e2e',
    locale: 'en',
    messages: [{
      author: 'visitor',
      content: 'We need a technical panel specification.',
      createdAt: '2026-07-30T08:00:00.000Z',
      id: 'message-inbound',
      status: 'sent',
    }],
    requestId: 'request-e2e',
    revision: 1,
  }

  await page.route('**/api/portal/conversations**', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      json: {
        docs: [{
          ...session,
          lastMessageAt: session.messages.at(-1)?.createdAt,
          messages: undefined,
        }],
        page: 1,
        totalDocs: 1,
        totalPages: 1,
      },
      status: 200,
    })
  })

  await page.route('**/api/portal/conversations/portal-conversation-e2e**', async (route) => {
    const request = route.request()
    const pathname = new URL(request.url()).pathname
    if (request.method() === 'GET') {
      await route.fulfill({ contentType: 'application/json', json: session, status: 200 })
      return
    }
    const command = pathname.split('/').at(-1)
    if (command === 'take-over') {
      session.allowedActions = ['send_operator_message', 'resolve']
      session.handoffStatus = 'human_active'
      session.revision += 1
    } else if (command === 'operator-messages') {
      const body = request.postDataJSON() as { text?: string }
      session.messages.push({
        author: 'operator',
        content: body.text ?? '',
        createdAt: '2026-07-30T08:01:00.000Z',
        id: `message-operator-${session.revision}`,
        status: 'sent',
      })
      session.revision += 1
    } else if (command === 'resolve') {
      session.allowedActions = []
      session.handoffStatus = 'resolved'
      session.revision += 1
    } else {
      await route.fulfill({ contentType: 'application/json', json: { error: { code: 'not_found' } }, status: 404 })
      return
    }
    await route.fulfill({ contentType: 'application/json', json: session, status: 200 })
  })
}

test('conversation workspace renders only server-authorized actions and completes takeover, reply, and resolve', async ({ page }, testInfo) => {
  await page.setViewportSize({ height: 900, width: 1440 })
  if (!(await login(page))) return
  await installConversationMock(page)
  await page.goto('/dashboard/conversations?conversation=portal-conversation-e2e')

  await expect(page.getByRole('heading', { level: 2, name: '统一会话' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '#portal-conversation-e2e' })).toBeVisible()
  await expect(page.getByRole('button', { name: '接管会话' })).toBeVisible()
  await expect(page.getByRole('button', { name: '发送回复' })).toHaveCount(0)

  await page.getByRole('button', { name: '接管会话' }).click()
  await expect(page.getByRole('button', { name: '发送回复' })).toBeVisible()
  await page.getByPlaceholder('输入给客户的回复…').fill('We will send the relevant specification today.')
  await expect(page.getByRole('button', { name: '发送回复' })).toBeEnabled()
  await page.getByRole('button', { name: '发送回复' }).click()
  await expect(page.getByText('We will send the relevant specification today.')).toBeVisible()
  await page.getByRole('button', { name: '解决会话' }).click()
  await expect(page.getByText('已解决').first()).toBeVisible()
  await expect(page.getByRole('button', { name: '发送回复' })).toHaveCount(0)
  await expect(page.locator('a[href^="/admin"]')).toHaveCount(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1440)
  await page.screenshot({ fullPage: true, path: testInfo.outputPath('portal-conversations-desktop.png') })
})

test('mobile conversation workspace stays within a 390px viewport', async ({ page }, testInfo) => {
  await page.setViewportSize({ height: 844, width: 390 })
  if (!(await login(page))) return
  await installConversationMock(page)
  await page.goto('/dashboard/conversations')
  await expect(page.getByRole('heading', { level: 2, name: '统一会话' })).toBeVisible()
  await expect(page.locator('.portal-conversations__workspace')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  await page.screenshot({ fullPage: true, path: testInfo.outputPath('portal-conversations-mobile.png') })
})
