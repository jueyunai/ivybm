import { expect, test } from '@playwright/test'

const adminEmail = process.env.E2E_ADMIN_EMAIL ?? process.env.SEED_ADMIN_EMAIL
const adminPassword = process.env.E2E_ADMIN_PASSWORD ?? process.env.SEED_ADMIN_PASSWORD

const login = async (page: import('@playwright/test').Page) => {
  test.skip(
    !adminEmail || !adminPassword,
    'Requires dedicated non-production E2E or local seed administrator credentials.',
  )
  if (!adminEmail || !adminPassword) return

  await page.goto('/dashboard/login?returnTo=%2Fdashboard%2Fmedia')
  await page.getByRole('textbox', { name: '邮箱' }).fill(adminEmail)
  await page.getByRole('textbox', { name: '密码' }).fill(adminPassword)
  await page.getByRole('button', { name: '登录后台' }).click()
  await expect(page).toHaveURL(/\/dashboard\/media$/)
}

test('media workspace filters safe assets and exposes grid/list detail views', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ height: 900, width: 1440 })
  await login(page)
  if (!adminEmail || !adminPassword) return

  await expect(page.getByRole('heading', { level: 2, name: '媒体素材' })).toBeVisible()
  await expect(page.locator('.portal-media__asset')).not.toHaveCount(0)
  await expect(page.getByRole('button', { name: '上传素材' })).toBeDisabled()
  await expect(page.locator('a[href^="/admin"]')).toHaveCount(0)

  await page.getByLabel('类型').selectOption('pdf')
  await page.getByRole('button', { name: '筛选' }).click()
  await expect(page).toHaveURL(/kind=pdf/)
  await expect(page.locator('.portal-media__asset')).not.toHaveCount(0)
  await expect(
    page.locator('.portal-media__asset').getByText('PDF', { exact: true }).first(),
  ).toBeVisible()

  await page.getByRole('link', { name: '列表视图' }).click()
  await expect(page).toHaveURL(/view=list/)
  await expect(page.locator('.portal-media__library')).toHaveClass(/is-list/)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1440)

  await page.screenshot({
    fullPage: true,
    path: testInfo.outputPath('portal-media-desktop.png'),
  })
})

test('mobile media workspace keeps filters, cards, and detail within the viewport', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ height: 844, width: 390 })
  await login(page)
  if (!adminEmail || !adminPassword) return

  await expect(page.getByRole('heading', { level: 2, name: '媒体素材' })).toBeVisible()
  await expect(page.getByRole('searchbox', { name: '搜索素材' })).toBeVisible()
  await expect(page.locator('.portal-media__workspace')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)

  await page.screenshot({
    fullPage: true,
    path: testInfo.outputPath('portal-media-mobile.png'),
  })
})
