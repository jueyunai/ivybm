import './require-mutation-launch'
import { expect, test, type Page } from '@playwright/test'

import { WebsiteChatE2EHarness } from './website-chat.support'

const adminEmail = process.env.E2E_ADMIN_EMAIL ?? process.env.SEED_ADMIN_EMAIL
const adminPassword = process.env.E2E_ADMIN_PASSWORD ?? process.env.SEED_ADMIN_PASSWORD

type Scenario = {
  email: string
  expectedHandoffReason: 'high_intent' | 'high_risk_topic'
  expectedCompany: string
  inputLabel: string
  launcher: string
  locale: 'ar' | 'en'
  messages: [string, string, string]
  send: string
}

const scenarios: Scenario[] = [
  {
    email: 'e2e-chat-en@example.invalid',
    expectedCompany: 'E2E Facades LLC',
    expectedHandoffReason: 'high_intent',
    inputLabel: 'Ask about panels, drawings, finishes, or your project…',
    launcher: 'Ask our project assistant',
    locale: 'en',
    messages: [
      'We need aluminum facade panels for a project in the United Arab Emirates.',
      'Company: E2E Facades LLC. The project is at design stage and needs 300 m2.',
      'We have drawings. Budget is USD 100000 and our purchase plan is approved. We will buy in 3 months. Email e2e-chat-en@example.invalid.',
    ],
    send: 'Send',
  },
  {
    email: 'e2e-chat-ar@example.invalid',
    expectedCompany: 'E2E Arabia LLC',
    expectedHandoffReason: 'high_risk_topic',
    inputLabel: 'اسأل عن الألواح أو مشروعك…',
    launcher: 'اسأل مساعد المشروع',
    locale: 'ar',
    messages: [
      'نحتاج aluminum panels لمشروع في الإمارات العربية المتحدة.',
      'اسم الشركة: E2E Arabia LLC، المشروع في مرحلة تصميم ونحتاج 300 م².',
      'لدينا رسومات. الميزانية: 100000 دولار وخطة الشراء معتمدة. الشراء خلال 3 أشهر. البريد e2e-chat-ar@example.invalid.',
    ],
    send: 'إرسال',
  },
]

const completeWebsiteChat = async (
  page: Page,
  harness: WebsiteChatE2EHarness,
  scenario: Scenario,
): Promise<string> => {
  await page.goto(`/${scenario.locale}`)
  const started = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === '/api/chat/sessions',
  )
  const widget = page.getByTestId('chat-widget')
  await widget.getByRole('button', { name: scenario.launcher }).click()
  const startResponse = await started
  expect(startResponse.status()).toBe(201)
  const session = (await startResponse.json()) as { id: string }
  harness.trackSession(session.id)

  for (const [index, message] of scenario.messages.entries()) {
    await widget.getByLabel(scenario.inputLabel).fill(message)
    const sent = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === `/api/chat/sessions/${session.id}/messages`,
    )
    await widget.getByRole('button', { name: scenario.send }).click()
    expect((await sent).status()).toBe(200)
    await expect(widget.getByText(message)).toBeVisible()
    if (index < 2) {
      const answers = widget.getByText(/Reviewed knowledge|المعرفة المراجعة/)
      await expect(answers).toHaveCount(index + 1)
      await expect(answers.last()).toBeVisible()
    }
  }

  await expect(widget.getByTestId('chat-handoff-pending')).toBeVisible()
  await expect(widget.getByLabel(scenario.inputLabel)).toBeDisabled()
  return session.id
}

test('WEB-CHAT-01 closes EN and AR website AI qualification, Lead, handoff, Portal, and fake Feishu', async ({
  page,
}) => {
  if (!adminEmail || !adminPassword) {
    throw new Error('WEB-CHAT-01 requires non-production E2E administrator credentials')
  }

  const harness = await WebsiteChatE2EHarness.create()
  try {
    await harness.createKnowledgeFixtures()
    await harness.createFeishuMapping()
    const sessionIDs: string[] = []
    for (const scenario of scenarios) {
      sessionIDs.push(await completeWebsiteChat(page, harness, scenario))
    }

    for (const [index, sessionID] of sessionIDs.entries()) {
      const state = await harness.readSessionState(sessionID)
      expect(state.conversation).toMatchObject({
        handoffStatus: 'handoff_requested',
        intentLevel: 'a',
        locale: scenarios[index]?.locale,
        qualificationRoundCount: 2,
      })
      expect(state.messages.filter(({ author }) => author === 'visitor')).toHaveLength(3)
      expect(state.messages.filter(({ author }) => author === 'ai')).toHaveLength(2)
      expect(state.messages.every(({ status }) => status === 'sent')).toBe(true)
      expect(state.leads).toEqual([
        expect.objectContaining({
          company: scenarios[index]?.expectedCompany,
          email: scenarios[index]?.email,
          intentLevel: 'a',
        }),
      ])
      expect(state.handoffs).toEqual([
        expect.objectContaining({
          reason: scenarios[index]?.expectedHandoffReason,
          source: 'ai_policy',
          status: 'requested',
        }),
      ])
    }
    expect(await harness.countAiUsage()).toBe(8)

    const relay = await harness.relayFeishuJobs()
    expect(relay.leads.created).toBe(0)
    expect(relay.leads.duplicate).toBe(2)
    expect(relay.handoffs.created).toBe(2)
    await expect(harness.runUntilIdle()).resolves.toEqual([
      'succeeded',
      'succeeded',
      'succeeded',
      'succeeded',
      'idle',
    ])
    expect(harness.feishuUpserts).toHaveLength(2)
    expect(
      harness.feishuMessages.filter(({ text }) => text.includes('AI 客服需要人工接管')),
    ).toHaveLength(2)

    await page.goto('/dashboard/login?returnTo=%2Fdashboard%2Fconversations')
    await page.getByRole('textbox', { name: '邮箱' }).fill(adminEmail)
    await page.getByRole('textbox', { name: '密码' }).fill(adminPassword)
    await page.getByRole('button', { name: '登录后台' }).click()
    await expect(page).toHaveURL(/\/dashboard\/conversations$/)

    for (const [index, sessionID] of sessionIDs.entries()) {
      await page.goto(`/dashboard/conversations?conversation=${encodeURIComponent(sessionID)}`)
      await expect(
        page.getByRole('heading', { name: `官网访客 #${sessionID.slice(-6)}` }),
      ).toBeVisible()
      await page.getByRole('button', { name: '接管会话' }).click()
      const operatorReply = `E2E operator response ${scenarios[index]?.locale}`
      await page.getByPlaceholder('输入给客户的回复…').fill(operatorReply)
      await page.getByRole('button', { name: '发送回复' }).click()
      await expect(page.getByText(operatorReply)).toBeVisible()
      const resolve = page.getByRole('button', { name: '解决会话' })
      await expect(resolve).toBeEnabled()
      await resolve.click()
      await expect
        .poll(async () => (await harness.readSessionState(sessionID)).conversation.handoffStatus)
        .toBe('resolved')
      await expect(page.locator('.portal-conversations__detail').getByText('已解决')).toBeVisible()
    }

    await page.goto('/dashboard/leads')
    for (const scenario of scenarios) {
      await page.getByRole('button', { name: new RegExp(scenario.expectedCompany, 'u') }).click()
      await expect(
        page.locator('.portal-leads__detail').getByText(scenario.email, { exact: true }),
      ).toBeVisible()
    }
  } finally {
    await harness.cleanup()
  }
})

test('WEB-CHAT-02 fails closed to one recoverable handoff for knowledge, AI, and risk paths', async ({
  page,
}) => {
  const harness = await WebsiteChatE2EHarness.create()
  const openFreshSession = async (): Promise<{
    input: ReturnType<Page['getByLabel']>
    sessionID: string
    widget: ReturnType<Page['getByTestId']>
  }> => {
    await page.goto('/en')
    await page.evaluate(() => window.sessionStorage.clear())
    await page.reload()
    const started = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === '/api/chat/sessions',
    )
    const widget = page.getByTestId('chat-widget')
    await widget.getByRole('button', { name: 'Ask our project assistant' }).click()
    const startResponse = await started
    expect(startResponse.status()).toBe(201)
    const session = (await startResponse.json()) as { id: string }
    harness.trackSession(session.id)
    return {
      input: widget.getByLabel('Ask about panels, drawings, finishes, or your project…'),
      sessionID: session.id,
      widget,
    }
  }

  const sendAndReplay = async ({
    expectedReason,
    message,
  }: {
    expectedReason: string
    message: string
  }): Promise<void> => {
    const { input, sessionID, widget } = await openFreshSession()
    await input.fill(message)
    const commandRequest = page.waitForRequest(
      (request) =>
        request.method() === 'POST' &&
        new URL(request.url()).pathname === `/api/chat/sessions/${sessionID}/messages`,
    )
    const commandResponse = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === `/api/chat/sessions/${sessionID}/messages`,
    )
    await widget.getByRole('button', { name: 'Send' }).click()
    const [originalRequest, originalResponse] = await Promise.all([commandRequest, commandResponse])
    expect(originalResponse.status()).toBe(200)
    await expect(widget.getByTestId('chat-handoff-pending')).toBeVisible()
    await expect(input).toBeDisabled()

    const command = originalRequest.postDataJSON() as Record<string, unknown> | null
    if (!command) throw new Error('Expected website chat command body')
    const replay = await page.request.post(originalRequest.url(), { data: command })
    expect(replay.status()).toBe(200)

    const state = await harness.readSessionState(sessionID)
    expect(state.messages.filter(({ author }) => author === 'visitor')).toHaveLength(1)
    expect(state.messages.filter(({ author }) => author === 'ai')).toHaveLength(0)
    expect(state.leads).toHaveLength(0)
    expect(state.handoffs).toEqual([
      expect.objectContaining({ reason: expectedReason, source: 'ai_policy', status: 'requested' }),
    ])
  }

  try {
    await sendAndReplay({
      expectedReason: 'reviewed_knowledge_unavailable',
      message: 'Which aluminum panel options suit a facade project?',
    })

    await harness.createKnowledgeFixtures()
    await sendAndReplay({
      expectedReason: 'ai_service_unavailable',
      message: 'Show reviewed aluminum panel options [E2E_AI_UNAVAILABLE].',
    })

    const usageBeforeRisk = await harness.countAiUsage()
    await sendAndReplay({
      expectedReason: 'high_risk_topic',
      message: 'Can you guarantee the final price, exact delivery date, and certification?',
    })
    expect(await harness.countAiUsage()).toBe(usageBeforeRisk)
    expect(await harness.relayFeishuJobs()).toMatchObject({ enabled: false })
    expect(harness.feishuMessages).toHaveLength(0)
    expect(harness.feishuUpserts).toHaveLength(0)
  } finally {
    await harness.cleanup()
  }
})
