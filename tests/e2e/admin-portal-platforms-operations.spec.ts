import { expect, test, type Page } from '@playwright/test'

const adminEmail = process.env.E2E_ADMIN_EMAIL ?? process.env.SEED_ADMIN_EMAIL
const adminPassword = process.env.E2E_ADMIN_PASSWORD ?? process.env.SEED_ADMIN_PASSWORD

const login = async (page: Page, returnTo: string) => {
  test.skip(!adminEmail || !adminPassword, 'Requires local non-production administrator credentials.')
  if (!adminEmail || !adminPassword) return false

  await page.goto(`/dashboard/login?returnTo=${encodeURIComponent(returnTo)}`)
  await page.getByRole('textbox', { name: '邮箱' }).fill(adminEmail)
  await page.getByRole('textbox', { name: '密码' }).fill(adminPassword)
  await page.getByRole('button', { name: '登录后台' }).click()
  await expect(page).toHaveURL(new RegExp(`${returnTo}$`))
  return true
}

test('admin can inspect platform readiness and operation compensation without a technical-admin escape hatch', async ({ page }, testInfo) => {
  await page.setViewportSize({ height: 900, width: 1440 })
  if (!(await login(page, '/dashboard/platforms'))) return

  await expect(page.getByRole('heading', { level: 2, name: '平台状态' })).toBeVisible()
  await expect(page.locator('a[href^="/admin"]')).toHaveCount(0)
  await page.goto('/dashboard/operations')
  await expect(page.getByRole('heading', { level: 2, name: '异常与补偿' })).toBeVisible()
  await expect(page.locator('a[href^="/admin"]')).toHaveCount(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1440)
  await page.screenshot({ fullPage: true, path: testInfo.outputPath('portal-operations-desktop.png') })
})

test('mobile platform readiness and operations stay within 390px', async ({ page }, testInfo) => {
  await page.setViewportSize({ height: 844, width: 390 })
  if (!(await login(page, '/dashboard/platforms'))) return

  await expect(page.getByRole('heading', { level: 2, name: '平台状态' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  await page.goto('/dashboard/operations')
  await expect(page.getByRole('heading', { level: 2, name: '异常与补偿' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  await page.screenshot({ fullPage: true, path: testInfo.outputPath('portal-operations-mobile.png') })
})
