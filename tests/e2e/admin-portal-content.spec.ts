import { expect, test } from '@playwright/test'

const adminEmail = process.env.E2E_ADMIN_EMAIL ?? process.env.SEED_ADMIN_EMAIL
const adminPassword = process.env.E2E_ADMIN_PASSWORD ?? process.env.SEED_ADMIN_PASSWORD

const login = async (page: import('@playwright/test').Page) => {
  test.skip(
    !adminEmail || !adminPassword,
    'Requires dedicated non-production E2E or local seed administrator credentials.',
  )
  if (!adminEmail || !adminPassword) return

  await page.goto('/dashboard/login?returnTo=%2Fdashboard%2Fcontent')
  await page.getByRole('textbox', { name: '邮箱' }).fill(adminEmail)
  await page.getByRole('textbox', { name: '密码' }).fill(adminPassword)
  await page.getByRole('button', { name: '登录后台' }).click()
  await expect(page).toHaveURL(/\/dashboard\/content$/)
}

test('website content hub exposes six safe content types, filters, detail, and preview', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ height: 900, width: 1440 })
  await login(page)
  if (!adminEmail || !adminPassword) return

  await page.goto('/dashboard/content?type=products')
  await expect(page.getByRole('heading', { level: 2, name: '官网内容' })).toBeVisible()
  await expect(page.getByRole('navigation', { name: '官网内容' }).getByRole('link')).toHaveCount(6)
  await expect(page.getByRole('link', { name: /^产品 \d/ })).toHaveAttribute('aria-current', 'page')
  await expect(page.getByText('编辑能力受限')).toBeVisible()
  await expect(page.locator('.portal-content__item')).not.toHaveCount(0)
  await expect(page.locator('a[href^="/admin"]')).toHaveCount(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1440)

  await page.getByRole('searchbox', { name: '搜索内容' }).fill('no-content-should-match-this')
  await page.getByRole('button', { name: '筛选' }).click()
  await expect(page).toHaveURL(/q=no-content-should-match-this/)
  await expect(page.getByRole('heading', { name: '没有匹配内容' })).toBeVisible()

  await page.screenshot({
    fullPage: true,
    path: testInfo.outputPath('portal-content-desktop-empty.png'),
  })
})

test('mobile website content hub keeps filters and content workspace within the viewport', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ height: 844, width: 390 })
  await login(page)
  if (!adminEmail || !adminPassword) return

  await page.goto('/dashboard/content?type=products')
  await expect(page.getByRole('heading', { level: 2, name: '官网内容' })).toBeVisible()
  await expect(page.getByRole('searchbox', { name: '搜索内容' })).toBeVisible()
  await expect(page.locator('.portal-content__workspace')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)

  await page.screenshot({
    fullPage: true,
    path: testInfo.outputPath('portal-content-mobile.png'),
  })
})
