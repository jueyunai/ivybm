import type { Locator, Page } from '@playwright/test'

import type { SmokeStatus } from './report'

export type FeishuVerificationResult = {
  found: boolean
  message?: string
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

const screenshotMatchedRecord = async ({
  locators,
  page,
  path,
}: {
  locators: Locator[]
  page: Page
  path: string
}): Promise<boolean> => {
  const boxes = await Promise.all(locators.map((locator) => locator.first().boundingBox()))
  if (boxes.some((box) => !box)) return false

  const safeBoxes = boxes.filter((box): box is NonNullable<typeof box> => Boolean(box))
  const left = Math.min(...safeBoxes.map((box) => box.x))
  const top = Math.min(...safeBoxes.map((box) => box.y))
  const right = Math.max(...safeBoxes.map((box) => box.x + box.width))
  const bottom = Math.max(...safeBoxes.map((box) => box.y + box.height))
  const padding = 12
  if (bottom - top + padding * 2 > 220) return false
  const viewport = page.viewportSize()
  const x = Math.max(0, left - padding)
  const y = Math.max(0, top - padding)
  const clip = {
    height: bottom - top + padding * 2,
    width: viewport
      ? Math.min(viewport.width - x, right + padding - x)
      : right - left + padding * 2,
    x,
    y,
  }
  if (clip.height <= 0 || clip.width <= 0) return false

  await page.screenshot({ animations: 'disabled', clip, path })
  return true
}

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
  const companyMatches = page.getByText(company, { exact: true })
  const nameMatches = page.getByText(name, { exact: true })
  const searchInput = page
    .locator('input[type="search"], input[placeholder*="搜索"], input[placeholder*="Search" i]')
    .first()
  let searchVisible = false
  let searchAttempted = false
  const startTime = Date.now()

  while (Date.now() - startTime < timeoutMs) {
    searchVisible = await searchInput.isVisible().catch(() => false)
    const [emailCount, companyCount, nameCount] = await Promise.all([
      visibleCount(emailMatches),
      visibleCount(companyMatches),
      visibleCount(nameMatches),
    ])

    if (emailCount > 1 || companyCount > 1 || nameCount > 1) {
      return {
        found: false,
        message: `Feishu search is ambiguous: name=${nameCount}, email=${emailCount}, company=${companyCount}.`,
        status: 'FAIL_FEISHU',
      }
    }

    if (emailCount === 1 && companyCount === 1 && nameCount === 1) {
      if (
        screenshotPath &&
        !(await screenshotMatchedRecord({
          locators: [nameMatches, emailMatches, companyMatches],
          page,
          path: screenshotPath,
        }))
      ) {
        return {
          found: false,
          message:
            'Feishu record is visible but cannot be captured without including unrelated rows.',
          status: 'BLOCKED_FEISHU_UI',
        }
      }
      return { found: true, status: 'PASS' }
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
