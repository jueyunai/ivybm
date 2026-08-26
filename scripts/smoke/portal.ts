import { expect, type Page } from '@playwright/test'

import type { SmokeConfig, SmokeLocale } from './config'
import { capturePageEvidence } from './evidence'
import type { CanaryData } from './marker'
import type { CleanupResult } from './report'

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
  await page.goto(`${config.targetUrl}/dashboard/login?returnTo=${encodeURIComponent(returnTo)}`, {
    timeout: 30_000,
    waitUntil: 'domcontentloaded',
  })

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
    const forbidden = page
      .getByText(/当前账号无权管理线索|This account cannot manage leads/u)
      .first()
    if (await forbidden.isVisible().catch(() => false)) {
      throw new PortalBlockedError(
        (await forbidden.textContent())?.trim() || 'Portal account cannot read Leads.',
      )
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

export const markCanaryLeadDisqualified = async ({
  config,
  data,
  page,
  screenshotPath,
}: {
  config: SmokeConfig
  data: CanaryData
  page: Page
  screenshotPath: string
}): Promise<CleanupResult> => {
  const screenshots: string[] = []
  const captureFailure = async (): Promise<void> => {
    if (await capturePageEvidence({ page, path: screenshotPath })) screenshots.push(screenshotPath)
  }

  try {
    await loginToPortal({ config, page, returnTo: '/dashboard/leads' })
    const searchUrl = `${config.targetUrl}/dashboard/leads?q=${encodeURIComponent(data.email)}`
    await page.goto(searchUrl, { timeout: 20_000, waitUntil: 'domcontentloaded' })

    if (new URL(page.url()).pathname === '/dashboard/login') {
      throw new PortalBlockedError('Portal session was rejected during Canary Lead cleanup.')
    }
    const forbidden = page
      .getByText(/当前账号无权管理线索|This account cannot manage leads/u)
      .first()
    if (await forbidden.isVisible().catch(() => false)) {
      throw new PortalBlockedError(
        (await forbidden.textContent())?.trim() || 'Portal account cannot manage Leads.',
      )
    }

    const leadButtons = page.locator('.portal-leads__list li > button')
    const count = await leadButtons.count()
    if (count === 0) {
      await captureFailure()
      return {
        details: [`Skipped Canary Lead cleanup because no exact Lead exists for ${data.email}.`],
        screenshots,
        status: 'SKIPPED',
      }
    }
    if (count !== 1) {
      await captureFailure()
      return {
        details: [
          `Refused Canary Lead cleanup because ${count} Leads match ${data.email}; no write was attempted.`,
        ],
        screenshots,
        status: 'FAILED',
      }
    }

    const leadButton = leadButtons.first()
    await expect(leadButton).toContainText(data.name)
    await expect(leadButton).toContainText(data.company)
    await leadButton.click()

    const detail = page.locator('.portal-leads__detail').first()
    await expect(detail.getByText(data.email, { exact: true })).toBeVisible()
    await expect(detail.getByText(data.company, { exact: true })).toBeVisible()

    const disqualified = detail.getByText(/不合格|Disqualified/u, { exact: true }).first()
    if (await disqualified.isVisible().catch(() => false)) {
      return {
        details: [`Canary Lead ${data.email} was already marked disqualified.`],
        status: 'SUCCESS',
      }
    }

    const edit = detail.getByRole('button', { name: /编辑线索|Edit lead/u }).first()
    if (!(await edit.isVisible().catch(() => false))) {
      await captureFailure()
      return {
        details: [
          `Skipped Canary Lead cleanup because the smoke account cannot edit ${data.email}.`,
        ],
        screenshots,
        status: 'SKIPPED',
      }
    }

    await edit.click()
    const editor = page.locator('.portal-leads-editor, .portal-leads__editor').first()
    await expect(editor).toBeVisible({ timeout: 10_000 })
    await editor.locator('select').first().selectOption('disqualified')
    await editor.getByRole('button', { name: /保存修改|Save changes/u }).click()

    try {
      await expect(
        page.getByRole('status').filter({ hasText: /线索已保存|Lead saved/u }),
      ).toBeVisible({
        timeout: 15_000,
      })
      await expect(detail.getByText(/不合格|Disqualified/u, { exact: true }).first()).toBeVisible()
    } catch (error) {
      const alert = editor.getByRole('alert').first()
      const alertText = (await alert.isVisible().catch(() => false))
        ? ((await alert.textContent().catch(() => null))?.trim() ?? '')
        : ''
      if (
        /无权|权限|forbidden|not authorized|not permitted|permission|cannot manage/iu.test(
          alertText,
        )
      ) {
        await captureFailure()
        return {
          details: [
            `Skipped Canary Lead cleanup because the Portal rejected update permission: ${alertText}`,
          ],
          screenshots,
          status: 'SKIPPED',
        }
      }
      throw error
    }

    return {
      details: [`Marked the exact Canary Lead ${data.email} as disqualified through Portal UI.`],
      status: 'SUCCESS',
    }
  } catch (error) {
    await captureFailure()
    if (error instanceof PortalBlockedError) {
      return {
        details: [`Skipped Canary Lead cleanup: ${error.message}`],
        screenshots,
        status: 'SKIPPED',
      }
    }
    return {
      details: [
        `Failed to mark the exact Canary Lead ${data.email} as disqualified: ${error instanceof Error ? error.message : String(error)}`,
      ],
      screenshots,
      status: 'FAILED',
    }
  }
}
