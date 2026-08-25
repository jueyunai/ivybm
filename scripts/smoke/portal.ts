import { expect, type Page } from '@playwright/test'

import type { SmokeConfig, SmokeLocale } from './config'
import type { CanaryData } from './marker'

export class PortalBlockedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PortalBlockedError'
  }
}

export const loginToPortal = async ({
  config,
  page,
  returnTo,
}: {
  config: SmokeConfig
  page: Page
  returnTo: '/dashboard/conversations' | '/dashboard/leads'
}): Promise<void> => {
  await page.goto(
    `${config.targetUrl}/dashboard/login?returnTo=${encodeURIComponent(returnTo)}`,
    { timeout: 30_000, waitUntil: 'domcontentloaded' },
  )

  await page.getByRole('textbox', { name: '邮箱' }).fill(config.portalEmail)
  await page.getByRole('textbox', { name: '密码' }).fill(config.portalPassword)
  await page.getByRole('button', { name: '登录后台' }).click()

  try {
    await expect(page).toHaveURL(new RegExp(`${returnTo.replaceAll('/', '\\/')}(?:\\?.*)?$`, 'u'), {
      timeout: 25_000,
    })
  } catch (error) {
    const alert = page.getByRole('alert').first()
    const alertText = (await alert.isVisible().catch(() => false))
      ? (await alert.textContent().catch(() => null))?.trim()
      : null
    if (new URL(page.url()).pathname === '/dashboard/login' || alertText) {
      throw new PortalBlockedError(alertText || 'Portal login did not leave the login page.')
    }
    throw error
  }
}

export const verifyUniquePortalLead = async ({
  config,
  data,
  expectHighIntent = false,
  locale,
  page,
  screenshotPath,
}: {
  config: SmokeConfig
  data: CanaryData
  expectHighIntent?: boolean
  locale: SmokeLocale
  page: Page
  screenshotPath: string
}): Promise<void> => {
  const searchUrl = `${config.targetUrl}/dashboard/leads?q=${encodeURIComponent(data.email)}`
  const deadline = Date.now() + 30_000
  const leadButtons = page.locator('.portal-leads__list li > button')
  let count = 0

  while (Date.now() < deadline) {
    await page.goto(searchUrl, { timeout: 20_000, waitUntil: 'domcontentloaded' })
    if (new URL(page.url()).pathname === '/dashboard/login') {
      throw new PortalBlockedError('Portal session was rejected while reading Leads.')
    }
    const forbidden = page.getByText(/当前账号无权管理线索|This account cannot manage leads/u).first()
    if (await forbidden.isVisible().catch(() => false)) {
      throw new PortalBlockedError((await forbidden.textContent())?.trim() || 'Portal account cannot read Leads.')
    }

    count = await leadButtons.count()
    if (count > 0) break
    await page.waitForTimeout(2_000)
  }

  if (count !== 1) {
    throw new Error(`Expected exactly one Portal Lead for ${data.email}, found ${count}.`)
  }

  const leadButton = leadButtons.first()
  await expect(leadButton).toContainText(data.name)
  await expect(leadButton).toContainText(data.company)
  if (expectHighIntent) {
    await expect(leadButton).toContainText(/A 高意向|A high intent/u)
  }
  await leadButton.click()

  const detail = page.locator('.portal-leads__detail').first()
  await expect(detail.getByText(data.name, { exact: true })).toBeVisible()
  await expect(detail.getByText(data.email, { exact: true })).toBeVisible()
  await expect(detail.getByText(data.company, { exact: true })).toBeVisible()
  await expect(detail.getByText(locale.toUpperCase(), { exact: true })).toBeVisible()
  await expect(detail).toBeVisible()
  await detail.screenshot({ path: screenshotPath })
}
