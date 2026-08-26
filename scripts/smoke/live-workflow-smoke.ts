import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium, expect, type Browser, type BrowserContext } from '@playwright/test'

import { runChatWorkflow, type ChatConversationState } from './chat-workflow'
import { parseSmokeConfig, type SmokeConfig, type SmokeLocale } from './config'
import { runInquiryWorkflow } from './inquiry-workflow'
import { generateCanaryData, generateRunId } from './marker'
import { loginToPortal, markCanaryLeadDisqualified } from './portal'
import {
  SmokeReportBuilder,
  type CleanupResult,
  type SmokeReport,
  type SmokeStage,
  type SmokeStatus,
} from './report'

type ActiveRun = ChatConversationState & {
  contexts: BrowserContext[]
  locale: SmokeLocale
  scenario: 'chat' | 'inquiry'
  stage: SmokeStage
}

type CurrentRun = ChatConversationState & Omit<ActiveRun, 'contexts'>

type SmokeRunnerDependencies = {
  launchBrowser?: (headless: boolean) => Promise<Browser>
}

class SmokeTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Live workflow smoke exceeded the ${timeoutMs}ms overall timeout.`)
    this.name = 'SmokeTimeoutError'
  }
}

const TIMEOUT_STATUSES: Record<SmokeStage, SmokeStatus> = {
  ai: 'FAIL_AI',
  feishu: 'FAIL_FEISHU',
  portal: 'FAIL_PORTAL',
  website: 'FAIL_WEBSITE',
}

const timeoutStatus = (stage: SmokeStage): SmokeStatus => TIMEOUT_STATUSES[stage]

const closeContexts = async (contexts: BrowserContext[]): Promise<void> => {
  await Promise.all(contexts.map((context) => context.close().catch(() => undefined)))
}

const recoverTimedOutConversation = async ({
  active,
  browser,
  config,
  runId,
}: {
  active: ActiveRun
  browser: Browser
  config: SmokeConfig
  runId: string
}): Promise<CleanupResult> => {
  if (
    active.scenario !== 'chat' ||
    !active.sessionId ||
    !active.targetConfirmed ||
    !active.takeoverAttempted ||
    active.resolved
  ) {
    return {
      details: ['No confirmed taken-over canary conversation required timeout recovery.'],
      status: 'SKIPPED',
    }
  }

  const context = await browser.newContext({ viewport: { height: 900, width: 1440 } })
  const page = await context.newPage()
  const data = generateCanaryData(runId, active.locale)
  try {
    await loginToPortal({ config, page, returnTo: '/dashboard/conversations' })
    await page.goto(
      `${config.targetUrl}/dashboard/conversations?conversation=${encodeURIComponent(active.sessionId)}`,
      { timeout: 20_000, waitUntil: 'domcontentloaded' },
    )
    const detail = page.locator('.portal-conversations__detail')
    await expect(
      detail.getByRole('heading', { name: `官网访客 #${active.sessionId.slice(-6)}` }),
    ).toBeVisible({ timeout: 10_000 })
    await expect(detail.getByText(data.chatMessages[0], { exact: true })).toBeVisible()
    if (
      await detail
        .getByText('已解决')
        .first()
        .isVisible()
        .catch(() => false)
    ) {
      return { details: ['Timed-out canary conversation was already resolved.'], status: 'SUCCESS' }
    }
    const resolve = detail.getByRole('button', { name: '解决会话' })
    await expect(resolve).toBeEnabled({ timeout: 10_000 })
    await resolve.click()
    await expect(detail.getByText('已解决').first()).toBeVisible({ timeout: 10_000 })
    return {
      details: ['Resolved the exact confirmed canary conversation after timeout.'],
      status: 'SUCCESS',
    }
  } catch (error) {
    return {
      details: [
        `Timeout recovery could not resolve the exact confirmed canary conversation: ${error instanceof Error ? error.message : String(error)}`,
      ],
      status: 'FAILED',
    }
  } finally {
    await context.close().catch(() => undefined)
  }
}

const cleanupCanaryLeads = async ({
  browser,
  config,
  runDir,
  runId,
}: {
  browser: Browser
  config: SmokeConfig
  runDir: string
  runId: string
}): Promise<CleanupResult[]> => {
  const results: CleanupResult[] = []
  for (const locale of config.locales) {
    const context = await browser.newContext({ viewport: { height: 900, width: 1440 } })
    const page = await context.newPage()
    try {
      results.push(
        await markCanaryLeadDisqualified({
          config,
          data: generateCanaryData(runId, locale),
          page,
          screenshotPath: join(runDir, `cleanup-lead-${locale}.png`),
        }),
      )
    } finally {
      await context.close().catch(() => undefined)
    }
  }
  return results
}

export const runLiveWorkflowSmoke = async (
  config: SmokeConfig,
  customRunId?: string,
  dependencies: SmokeRunnerDependencies = {},
): Promise<{ report: SmokeReport; reportPath: string }> => {
  const runId = customRunId ?? generateRunId()
  const runDir = join(config.outputDir, runId)
  await mkdir(runDir, { recursive: true })

  const reportBuilder = new SmokeReportBuilder({
    locales: config.locales,
    outputDir: config.outputDir,
    runId,
    targetUrl: config.targetUrl,
  })

  let browser: Browser | null = null
  let activeRun: ActiveRun | null = null
  let currentRun: CurrentRun | null = null
  const readActiveRun = (): ActiveRun | null => activeRun
  const readCurrentRun = (): CurrentRun | null => currentRun
  let cancelled = false
  const cleanupResults: CleanupResult[] = []
  let executionError: unknown
  let timedOut = false

  try {
    browser = await (dependencies.launchBrowser
      ? dependencies.launchBrowser(config.headless)
      : chromium.launch({ headless: config.headless }))

    const execute = async (): Promise<void> => {
      if (!browser) return

      if (config.scenario === 'all' || config.scenario === 'inquiry') {
        for (const locale of config.locales) {
          if (cancelled) return
          currentRun = { locale, scenario: 'inquiry', stage: 'website' }
          const contexts = await Promise.all([
            await browser.newContext({ viewport: { height: 900, width: 1440 } }),
            await browser.newContext({ viewport: { height: 900, width: 1440 } }),
            await browser.newContext({ viewport: { height: 900, width: 1440 } }),
          ])
          if (cancelled) {
            await closeContexts(contexts)
            return
          }
          activeRun = { contexts, locale, scenario: 'inquiry', stage: 'website' }
          try {
            const result = await runInquiryWorkflow({
              config,
              feishuContext: contexts[2]!,
              locale,
              onStage: (stage) => {
                if (activeRun) activeRun.stage = stage
                if (currentRun) currentRun.stage = stage
              },
              portalContext: contexts[1]!,
              runDir,
              runId,
              visitorContext: contexts[0]!,
            })
            if (cancelled) return
            reportBuilder.addInquiryRun(result)
          } finally {
            await closeContexts(contexts)
            activeRun = null
            currentRun = null
          }
        }
      }

      if (config.scenario === 'all' || config.scenario === 'chat') {
        for (const locale of config.locales) {
          if (cancelled) return
          currentRun = { locale, scenario: 'chat', stage: 'website' }
          const contexts = await Promise.all([
            await browser.newContext({ viewport: { height: 900, width: 1440 } }),
            await browser.newContext({ viewport: { height: 900, width: 1440 } }),
            await browser.newContext({ viewport: { height: 900, width: 1440 } }),
          ])
          if (cancelled) {
            await closeContexts(contexts)
            return
          }
          activeRun = { contexts, locale, scenario: 'chat', stage: 'website' }
          try {
            const result = await runChatWorkflow({
              config,
              feishuContext: contexts[2]!,
              locale,
              onConversationState: (state) => {
                if (activeRun) Object.assign(activeRun, state)
                if (currentRun) Object.assign(currentRun, state)
              },
              onStage: (stage) => {
                if (activeRun) activeRun.stage = stage
                if (currentRun) currentRun.stage = stage
              },
              portalContext: contexts[1]!,
              runDir,
              runId,
              visitorContext: contexts[0]!,
            })
            if (cancelled) return
            reportBuilder.addChatRun(result)
            if (result.cleanup) cleanupResults.push(result.cleanup)
          } finally {
            await closeContexts(contexts)
            activeRun = null
            currentRun = null
          }
        }
      }
    }

    const execution = execute()
    void execution.catch(() => undefined)
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(
        () => reject(new SmokeTimeoutError(config.timeoutMs)),
        config.timeoutMs,
      )
    })

    try {
      await Promise.race([execution, timeout])
    } catch (error) {
      if (!(error instanceof SmokeTimeoutError)) throw error

      timedOut = true
      cancelled = true
      const timedOutRun = readActiveRun()
      const timedOutIdentity = timedOutRun ?? readCurrentRun()
      if (timedOutRun) {
        await closeContexts(timedOutRun.contexts)
        if (browser) {
          cleanupResults.push(
            await recoverTimedOutConversation({ active: timedOutRun, browser, config, runId }),
          )
        }
      }
      if (timedOutIdentity) {
        const status = timeoutStatus(timedOutIdentity.stage)
        const resultBase = {
          durationMs: config.timeoutMs,
          error: error.message,
          locale: timedOutIdentity.locale,
          screenshots: {},
          status,
        }
        if (timedOutIdentity.scenario === 'inquiry') {
          reportBuilder.addInquiryRun(resultBase)
        } else {
          reportBuilder.addChatRun({
            ...resultBase,
            conversationResolved: Boolean(timedOutIdentity.resolved),
            operatorReplyReceived: false,
            sessionId: timedOutIdentity.sessionId,
          })
        }
      } else {
        throw error
      }

      // Let the in-flight workflow observe cancellation and settle before
      // cleanup starts. Otherwise a delayed inquiry/chat response could create
      // a canary Lead after cleanup has already scanned the Portal.
      await execution.catch(() => undefined)
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle)
    }
  } catch (error) {
    executionError = error
  } finally {
    if (browser && (!executionError || timedOut)) {
      cleanupResults.push(...(await cleanupCanaryLeads({ browser, config, runDir, runId })))
      await browser.close().catch(() => undefined)
    } else if (browser) {
      await browser.close().catch(() => undefined)
    }

    const failedCleanup = cleanupResults.filter((result) => result.status === 'FAILED')
    const successfulCleanup = cleanupResults.filter((result) => result.status === 'SUCCESS')
    reportBuilder.setCleanup({
      details:
        cleanupResults.flatMap((result) => result.details).length > 0
          ? cleanupResults.flatMap((result) => result.details)
          : ['No page-level cleanup was required.'],
      screenshots: cleanupResults.flatMap((result) => result.screenshots ?? []),
      status:
        failedCleanup.length > 0 ? 'FAILED' : successfulCleanup.length > 0 ? 'SUCCESS' : 'SKIPPED',
    })
  }

  if (executionError) throw executionError

  const reportPath = await reportBuilder.saveArtifacts()
  console.log(reportBuilder.formatSummary())
  console.log(`Report JSON saved at: ${reportPath}`)

  return { report: reportBuilder.build(), reportPath }
}

const main = async () => {
  try {
    const config = parseSmokeConfig()
    const { report } = await runLiveWorkflowSmoke(config)
    if (report.overallStatus !== 'PASS') process.exit(1)
  } catch (error) {
    console.error(
      `Live workflow smoke failed to start: ${error instanceof Error ? error.message : String(error)}`,
    )
    process.exit(1)
  }
}

if (process.argv[1] && process.argv[1].endsWith('live-workflow-smoke.ts')) {
  void main()
}
