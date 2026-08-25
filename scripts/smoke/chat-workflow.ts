import { join } from 'node:path'
import { expect, type BrowserContext, type Page } from '@playwright/test'

import type { SmokeConfig, SmokeLocale } from './config'
import { verifyFeishuRecord } from './feishu-verifier'
import { generateCanaryData, type CanaryData } from './marker'
import { loginToPortal, PortalBlockedError, verifyUniquePortalLead } from './portal'
import type { ChatRunResult, CleanupResult, SmokeStage, SmokeStatus } from './report'

export const determineChatStatus = ({
  conversationResolved,
  feishuStatus,
  operatorReplyReceived,
}: {
  conversationResolved: boolean
  feishuStatus: SmokeStatus
  operatorReplyReceived: boolean
}): SmokeStatus => {
  if (!operatorReplyReceived) return 'FAIL_WEBSITE'
  if (!conversationResolved) return 'FAIL_PORTAL'
  return feishuStatus
}

export type ChatConversationState = {
  resolved?: boolean
  sessionId?: string
  takeoverAttempted?: boolean
  targetConfirmed?: boolean
}

export const runChatWorkflow = async ({
  config,
  feishuContext,
  locale,
  onConversationState,
  onStage,
  portalContext,
  runDir,
  runId,
  visitorContext,
}: {
  config: SmokeConfig
  feishuContext: BrowserContext
  locale: SmokeLocale
  onConversationState?: (state: ChatConversationState) => void
  onStage?: (stage: SmokeStage) => void
  portalContext: BrowserContext
  runDir: string
  runId: string
  visitorContext: BrowserContext
}): Promise<ChatRunResult> => {
  const startTime = Date.now()
  const data: CanaryData = generateCanaryData(runId, locale)
  const screenshots: Record<string, string> = {
    feishu: join(runDir, `chat-feishu-${locale}.png`),
    portalConversation: join(runDir, `chat-portal-conversation-${locale}.png`),
    portalLead: join(runDir, `chat-portal-lead-${locale}.png`),
    visitor: join(runDir, `chat-visitor-${locale}.png`),
  }

  let capturedSessionId: string | undefined
  let capturedRequestId: string | undefined
  let operatorReplyReceived = false
  let conversationResolved = false
  let takeoverCompleted = false
  let targetConversationConfirmed = false
  let cleanup: CleanupResult | undefined

  const visitorPage = await visitorContext.newPage()
  let portalPage: Page | null = null

  // 1. Visitor Stage
  onStage?.('website')
  try {
    await visitorPage.goto(`${config.targetUrl}/${locale}`, {
      timeout: 30_000,
      waitUntil: 'domcontentloaded',
    })

    const launcherName = locale === 'ar' ? 'اسأل مساعد المشروع' : 'Ask our project assistant'
    const dialogName = locale === 'ar' ? 'مساعد المشروع' : 'Project Assistant'
    const inputPlaceholder =
      locale === 'ar'
        ? 'اسأل عن الألواح أو مشروعك…'
        : 'Ask about panels, drawings, finishes, or your project…'
    const sendBtnName = locale === 'ar' ? 'إرسال' : 'Send'

    const widget = visitorPage.getByTestId('chat-widget')
    const sessionResponse = visitorPage.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === '/api/chat/sessions',
    )
    await widget.getByRole('button', { name: launcherName }).click()
    const started = await sessionResponse
    if (started.status() !== 201) {
      throw new Error(`Chat session endpoint returned HTTP ${started.status()}.`)
    }
    const startedBody = (await started.json().catch(() => ({}))) as {
      id?: number | string
      requestId?: string
    }
    capturedSessionId = startedBody.id === undefined ? undefined : String(startedBody.id)
    capturedRequestId = startedBody.requestId
    if (!capturedSessionId) {
      throw new Error('Chat session response did not include a session ID; refusing any Portal write.')
    }
    onConversationState?.({ sessionId: capturedSessionId })
    await widget.getByRole('dialog', { name: dialogName }).waitFor({ state: 'visible', timeout: 15_000 })

    const chatInput = widget.getByLabel(inputPlaceholder).or(widget.locator('textarea, input[type="text"]')).first()
    const sendBtn = widget.getByRole('button', { name: sendBtnName }).or(widget.locator('button[type="submit"]')).first()

    // 3 rounds of qualification
    const assistantMessages = widget.locator('[data-author="assistant"]')
    const reviewedSources = locale === 'ar' ? 'مصادر مراجَعة' : 'Reviewed sources'
    for (let index = 0; index < 3; index += 1) {
      const message = data.chatMessages[index]
      const assistantCountBefore = await assistantMessages.count()
      await chatInput.fill(message)
      const messageResponse = visitorPage.waitForResponse(
        (response) =>
          response.request().method() === 'POST' &&
          new URL(response.url()).pathname ===
            `/api/chat/sessions/${encodeURIComponent(capturedSessionId!)}/messages`,
      )
      await sendBtn.click()
      const sent = await messageResponse
      if (!sent.ok()) {
        throw new Error(`Chat message round ${index + 1} returned HTTP ${sent.status()}.`)
      }

      // Verify visitor bubble appears
      await widget.getByText(message).waitFor({ state: 'visible', timeout: 10_000 })

      if (index < 2) {
        onStage?.('ai')
        try {
          await expect(assistantMessages).toHaveCount(assistantCountBefore + 1, { timeout: 45_000 })
          const assistantMessage = assistantMessages.last()
          await expect(assistantMessage.locator('.chat-message-content > p')).not.toHaveText('')
          await expect(assistantMessage.locator('.chat-citations')).toContainText(reviewedSources)
        } catch (error) {
          await widget.screenshot({ path: screenshots.visitor }).catch(() => undefined)
          await visitorPage.close().catch(() => undefined)
          return {
            durationMs: Date.now() - startTime,
            error: `AI assistant did not respond in round ${index + 1} within 45s: ${error instanceof Error ? error.message : String(error)}`,
            locale,
            requestId: capturedRequestId,
            screenshots,
            sessionId: capturedSessionId,
            status: 'FAIL_AI',
          }
        }
        onStage?.('website')
      }
    }

    // Round 3 should transition to handoff state
    const handoffPending = widget
      .getByTestId('chat-handoff-pending')
      .or(widget.getByText(/Your request has been shared|تمت مشاركة طلبك/i))
    await handoffPending.first().waitFor({ state: 'visible', timeout: 20_000 })
    await expect(chatInput).toBeDisabled({ timeout: 10_000 })

    await widget.screenshot({ path: screenshots.visitor })
  } catch (error) {
    await visitorPage.getByTestId('chat-widget').screenshot({ path: screenshots.visitor }).catch(() => undefined)
    await visitorPage.close().catch(() => undefined)
    return {
      durationMs: Date.now() - startTime,
      error: `Visitor chat qualification failed: ${error instanceof Error ? error.message : String(error)}`,
      locale,
      requestId: capturedRequestId,
      screenshots,
      sessionId: capturedSessionId,
      status: 'FAIL_WEBSITE',
    }
  }

  // 2. Portal Takeover & Reply Stage
  onStage?.('portal')
  portalPage = await portalContext.newPage()
  try {
    await loginToPortal({
      config,
      page: portalPage,
      returnTo: '/dashboard/conversations',
    })
    await portalPage.goto(
      `${config.targetUrl}/dashboard/conversations?conversation=${encodeURIComponent(capturedSessionId)}`,
      { timeout: 20_000, waitUntil: 'domcontentloaded' },
    )

    const conversationDetail = portalPage.locator('.portal-conversations__detail')
    await expect(
      conversationDetail.getByRole('heading', {
        name: `官网访客 #${capturedSessionId.slice(-6)}`,
      }),
    ).toBeVisible({ timeout: 20_000 })
    await expect(
      conversationDetail.getByText(data.chatMessages[0], { exact: true }),
    ).toBeVisible()
    targetConversationConfirmed = true
    onConversationState?.({ targetConfirmed: true })

    // Wait for conversation takeover button
    const takeOverBtn = conversationDetail.getByRole('button', { name: '接管会话' })
    await expect(takeOverBtn).toBeVisible({ timeout: 20_000 })
    onConversationState?.({ takeoverAttempted: true })
    await takeOverBtn.click()

    // Send operator reply
    const replyInput = conversationDetail.getByPlaceholder('输入给客户的回复…')
    await expect(replyInput).toBeVisible({ timeout: 10_000 })
    takeoverCompleted = true
    await replyInput.fill(data.operatorReply)

    const sendReplyBtn = conversationDetail.getByRole('button', { name: '发送回复' })
    await sendReplyBtn.click()

    await expect(conversationDetail.getByText(data.operatorReply, { exact: true })).toBeVisible({
      timeout: 15_000,
    })
    await conversationDetail.screenshot({ path: screenshots.portalConversation })

    // 3. Verify operator reply arrives at visitor ChatWidget (polling up to 30s)
    onStage?.('website')
    try {
      await visitorPage
        .getByTestId('chat-widget')
        .getByText(data.operatorReply, { exact: true })
        .waitFor({ state: 'visible', timeout: 30_000 })
      operatorReplyReceived = true
    } catch {
      operatorReplyReceived = false
    }

    // 4. Resolve conversation in Portal
    onStage?.('portal')
    const resolveBtn = conversationDetail.getByRole('button', { name: '解决会话' })
    await expect(resolveBtn).toBeEnabled({ timeout: 10_000 })
    await resolveBtn.click()
    await expect(conversationDetail.getByText('已解决').first()).toBeVisible({ timeout: 10_000 })
    conversationResolved = true
    onConversationState?.({ resolved: true })

    // 5. Verify Portal Lead
    await verifyUniquePortalLead({
      config,
      data,
      expectHighIntent: true,
      locale,
      page: portalPage,
      screenshotPath: screenshots.portalLead,
    })
  } catch (error) {
    if (portalPage) {
      if (targetConversationConfirmed) {
        const detail = portalPage.locator('.portal-conversations__detail')
        await detail.screenshot({ path: screenshots.portalConversation }).catch(() => undefined)
      }
      if (targetConversationConfirmed && takeoverCompleted && !conversationResolved) {
        try {
          const resolve = portalPage
            .locator('.portal-conversations__detail')
            .getByRole('button', { name: '解决会话' })
          await expect(resolve).toBeEnabled({ timeout: 5_000 })
          await resolve.click()
          await expect(
            portalPage.locator('.portal-conversations__detail').getByText('已解决').first(),
          ).toBeVisible({ timeout: 5_000 })
          cleanup = { details: ['Resolved the confirmed canary conversation after failure.'], status: 'SUCCESS' }
          onConversationState?.({ resolved: true })
        } catch (cleanupError) {
          cleanup = {
            details: [
              `Failed to resolve the confirmed canary conversation: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`,
            ],
            status: 'FAILED',
          }
        }
      }
      await portalPage.close().catch(() => undefined)
    }
    await visitorPage.close().catch(() => undefined)
    const errText = error instanceof Error ? error.message : String(error)
    return {
      cleanup,
      conversationResolved,
      durationMs: Date.now() - startTime,
      error: `Portal takeover / reply / lead verification failed: ${errText}`,
      locale,
      operatorReplyReceived,
      requestId: capturedRequestId,
      screenshots,
      sessionId: capturedSessionId,
      status: error instanceof PortalBlockedError ? 'BLOCKED_PORTAL_AUTH' : 'FAIL_PORTAL',
    }
  }

  await visitorPage.close().catch(() => undefined)
  if (portalPage) {
    await portalPage.close().catch(() => undefined)
  }

  // 6. Feishu Stage
  onStage?.('feishu')
  const feishuPage = await feishuContext.newPage()
  let feishuFound = false
  let feishuStatus: SmokeStatus = 'PASS'
  let feishuError: string | undefined

  try {
    const feishuResult = await verifyFeishuRecord({
      company: data.company,
      email: data.email,
      name: data.name,
      page: feishuPage,
      screenshotPath: screenshots.feishu,
      tableUrl: config.feishuTableUrl,
      timeoutMs: 60_000,
    })
    feishuFound = feishuResult.found
    feishuStatus = feishuResult.status
    if (!feishuResult.found) {
      feishuError = feishuResult.message
    }
  } catch (error) {
    feishuStatus = 'FAIL_FEISHU'
    feishuError = error instanceof Error ? error.message : String(error)
  } finally {
    await feishuPage.close().catch(() => undefined)
  }

  return {
    conversationResolved,
    durationMs: Date.now() - startTime,
    error:
      !operatorReplyReceived
        ? 'Operator reply was not visible in the original Visitor browser within 30s.'
        : !conversationResolved
          ? 'Portal conversation was not confirmed as resolved.'
          : feishuError,
    feishuFound,
    locale,
    operatorReplyReceived,
    requestId: capturedRequestId,
    screenshots,
    sessionId: capturedSessionId,
    status: determineChatStatus({ conversationResolved, feishuStatus, operatorReplyReceived }),
  }
}
