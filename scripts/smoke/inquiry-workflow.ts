import { join } from 'node:path'
import type { BrowserContext } from '@playwright/test'

import type { SmokeConfig, SmokeLocale } from './config'
import { verifyFeishuRecord } from './feishu-verifier'
import { generateCanaryData, type CanaryData } from './marker'
import { loginToPortal, PortalBlockedError, verifyUniquePortalLead } from './portal'
import type { InquiryRunResult, SmokeStage, SmokeStatus } from './report'

export const runInquiryWorkflow = async ({
  config,
  feishuContext,
  locale,
  onStage,
  portalContext,
  runDir,
  runId,
  visitorContext,
}: {
  config: SmokeConfig
  feishuContext: BrowserContext
  locale: SmokeLocale
  onStage?: (stage: SmokeStage) => void
  portalContext: BrowserContext
  runDir: string
  runId: string
  visitorContext: BrowserContext
}): Promise<InquiryRunResult> => {
  const startTime = Date.now()
  const data: CanaryData = generateCanaryData(runId, locale)
  const screenshots: Record<string, string> = {
    feishu: join(runDir, `inquiry-feishu-${locale}.png`),
    portalLead: join(runDir, `inquiry-portal-lead-${locale}.png`),
    website: join(runDir, `inquiry-website-${locale}.png`),
  }

  let capturedRequestId: string | undefined

  // 1. Visitor Stage
  onStage?.('website')
  const visitorPage = await visitorContext.newPage()
  try {
    await visitorPage.goto(`${config.targetUrl}/${locale}/contact`, {
      timeout: 30_000,
      waitUntil: 'domcontentloaded',
    })

    const nameLabel = locale === 'ar' ? 'الاسم *' : 'Name *'
    const emailLabel = locale === 'ar' ? 'البريد الإلكتروني *' : 'Email *'
    const companyLabel = locale === 'ar' ? 'الشركة' : 'Company'
    const phoneLabel = locale === 'ar' ? 'الهاتف' : 'Phone'
    const countryLabel = locale === 'ar' ? 'الدولة *' : 'Country *'
    const messageLabel = locale === 'ar' ? 'الرسالة *' : 'Message *'
    const submitBtnName = locale === 'ar' ? 'إرسال الاستفسار' : 'Send Inquiry'
    const successRegex = locale === 'ar' ? /تم استلام الاستفسار/ : /Inquiry received/

    await visitorPage.getByLabel(nameLabel).fill(data.name)
    await visitorPage.getByLabel(emailLabel).fill(data.email)
    await visitorPage.getByLabel(companyLabel).fill(data.company)
    await visitorPage.getByLabel(phoneLabel).fill(data.phone)
    await visitorPage.getByLabel(countryLabel).selectOption('United Arab Emirates')
    await visitorPage.getByLabel(messageLabel).fill(data.message)

    const inquiryResponse = visitorPage.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === '/api/inquiries',
    )
    await visitorPage.getByRole('button', { name: submitBtnName }).click()
    const response = await inquiryResponse
    if (!response.ok()) {
      throw new Error(`Inquiry endpoint returned HTTP ${response.status()}.`)
    }
    const responseBody = (await response.json().catch(() => ({}))) as { requestId?: string }
    capturedRequestId = responseBody.requestId

    await visitorPage.getByText(successRegex).waitFor({ state: 'visible', timeout: 20_000 })

    if (!capturedRequestId) {
      const refLocator = visitorPage.locator('[data-testid="inquiry-request-id"]')
      if (await refLocator.isVisible().catch(() => false)) {
        capturedRequestId = (await refLocator.innerText()).trim()
      }
    }

    await visitorPage.screenshot({ fullPage: true, path: screenshots.website })
  } catch (error) {
    await visitorPage.screenshot({ fullPage: true, path: screenshots.website }).catch(() => undefined)
    await visitorPage.close().catch(() => undefined)
    return {
      durationMs: Date.now() - startTime,
      error: `Website inquiry submission failed: ${error instanceof Error ? error.message : String(error)}`,
      locale,
      requestId: capturedRequestId,
      screenshots,
      status: 'FAIL_WEBSITE',
    }
  }
  await visitorPage.close().catch(() => undefined)

  // 2. Portal Lead Stage
  onStage?.('portal')
  const portalPage = await portalContext.newPage()
  try {
    await loginToPortal({
      config,
      page: portalPage,
      returnTo: '/dashboard/leads',
    })
    await verifyUniquePortalLead({
      config,
      data,
      locale,
      page: portalPage,
      screenshotPath: screenshots.portalLead,
    })
  } catch (error) {
    await portalPage.close().catch(() => undefined)
    const errText = error instanceof Error ? error.message : String(error)
    return {
      durationMs: Date.now() - startTime,
      error: `Portal Lead verification failed: ${errText}`,
      locale,
      requestId: capturedRequestId,
      screenshots,
      status: error instanceof PortalBlockedError ? 'BLOCKED_PORTAL_AUTH' : 'FAIL_PORTAL',
    }
  }
  await portalPage.close().catch(() => undefined)

  // 3. Feishu Stage
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
    durationMs: Date.now() - startTime,
    error: feishuError,
    feishuFound,
    locale,
    requestId: capturedRequestId,
    screenshots,
    status: feishuStatus,
  }
}
