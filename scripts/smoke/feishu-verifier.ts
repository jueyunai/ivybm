import type { Locator, Page } from '@playwright/test'

import { captureLocatorEvidence } from './evidence'
import type { SmokeStatus } from './report'

export type FeishuVerificationResult = {
  found: boolean
  message?: string
  screenshotSaved?: boolean
  status: SmokeStatus
}

const visibleCount = async (locator: Locator): Promise<number> => {
  let count = 0
  for (let index = 0; index < (await locator.count()); index += 1) {
    if (
      await locator
        .nth(index)
        .isVisible()
        .catch(() => false)
    )
      count += 1
  }
  return count
}

const uniqueVisibleLocator = async (locator: Locator): Promise<Locator | null> => {
  let match: Locator | null = null
  for (let index = 0; index < (await locator.count()); index += 1) {
    const candidate = locator.nth(index)
    if (!(await candidate.isVisible().catch(() => false))) continue
    if (match) return null
    match = candidate
  }
  return match
}

const recordContainerFor = (emailMatch: Locator): Locator =>
  emailMatch.locator(
    'xpath=ancestor-or-self::*[self::tr or @role="row" or @data-row-id or @data-row-index or @data-record-id or @data-record-key or contains(@class, "record-row") or contains(@class, "table-row") or contains(@class, "grid-row")][1]',
  )

export const verifyFeishuRecord = async ({
  company,
  email,
  name,
  page,
  screenshotPath,
  tableUrl,
  timeoutMs = 60_000,
}: {
  company: string
  email: string
  name: string
  page: Page
  screenshotPath?: string
  tableUrl: string
  timeoutMs?: number
}): Promise<FeishuVerificationResult> => {
  try {
    await page.goto(tableUrl, {
      timeout: Math.min(30_000, timeoutMs),
      waitUntil: 'domcontentloaded',
    })
  } catch (error) {
    return {
      found: false,
      message: `Failed to load Feishu public table page: ${error instanceof Error ? error.message : String(error)}`,
      status: 'BLOCKED_FEISHU_UI',
    }
  }

  const currentUrl = new URL(page.url())
  const blockingDialog = page
    .getByRole('dialog')
    .filter({ hasText: /扫码登录|验证码|Access Denied|Scan QR|Verification code/iu })
    .first()
  const captcha = page.locator('iframe[src*="captcha" i], [class*="captcha" i]').first()
  const redirectedToLogin =
    /(?:accounts|passport)\.(?:feishu|larksuite)\.cn$/u.test(currentUrl.hostname) ||
    /\/(?:login|passport)(?:\/|$)/u.test(currentUrl.pathname)
  if (
    redirectedToLogin ||
    (await blockingDialog.isVisible().catch(() => false)) ||
    (await captcha.isVisible().catch(() => false))
  ) {
    return {
      found: false,
      message: 'Feishu public table requires authentication, QR scan, or CAPTCHA.',
      status: 'BLOCKED_FEISHU_UI',
    }
  }

  const emailMatches = page.getByText(email, { exact: true })
  const searchInput = page
    .locator('input[type="search"], input[placeholder*="搜索"], input[placeholder*="Search" i]')
    .first()
  let searchVisible = false
  let searchAttempted = false
  const startTime = Date.now()

  while (Date.now() - startTime < timeoutMs) {
    searchVisible = await searchInput.isVisible().catch(() => false)
    const emailCount = await visibleCount(emailMatches)

    if (emailCount > 1) {
      return {
        found: false,
        message: `Feishu search is ambiguous: email=${emailCount}.`,
        status: 'FAIL_FEISHU',
      }
    }

    if (emailCount === 1) {
      const emailMatch = await uniqueVisibleLocator(emailMatches)
      const record = emailMatch ? recordContainerFor(emailMatch) : null
      const recordVisible = record ? await record.isVisible().catch(() => false) : false
      if (!record || !recordVisible) {
        return {
          found: false,
          message: 'Feishu email is visible but no safe row or record container can be identified.',
          status: 'BLOCKED_FEISHU_UI',
        }
      }

      const [companyCount, nameCount] = await Promise.all([
        visibleCount(record.getByText(company, { exact: true })),
        visibleCount(record.getByText(name, { exact: true })),
      ])
      if (companyCount === 1 && nameCount === 1) {
        const screenshotSaved = screenshotPath
          ? await captureLocatorEvidence({ locator: record, path: screenshotPath })
          : undefined
        if (screenshotPath && !screenshotSaved) {
          return {
            found: false,
            message: 'Feishu record is visible but its unique row could not be captured.',
            status: 'BLOCKED_FEISHU_UI',
          }
        }
        return { found: true, screenshotSaved, status: 'PASS' }
      }
    }

    if (searchVisible && !searchAttempted) {
      await searchInput.fill(email)
      await page.keyboard.press('Enter')
      searchAttempted = true
    }
    await page.waitForTimeout(2_000)
  }

  if (!searchVisible) {
    return {
      found: false,
      message:
        'Feishu public table is visible but has no usable search control for safe unique-record verification.',
      status: 'BLOCKED_FEISHU_UI',
    }
  }

  return {
    found: false,
    message: `Unique record for "${email}" was not visible with matching name and company within ${timeoutMs / 1000}s.`,
    status: 'FAIL_FEISHU',
  }
}
