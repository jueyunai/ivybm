import './require-mutation-launch'
import { expect, test } from '@playwright/test'

const adminEmail = process.env.E2E_ADMIN_EMAIL ?? process.env.SEED_ADMIN_EMAIL
const adminPassword = process.env.E2E_ADMIN_PASSWORD ?? process.env.SEED_ADMIN_PASSWORD

const login = async (page: import('@playwright/test').Page) => {
  test.skip(
    !adminEmail || !adminPassword,
    'Requires dedicated non-production E2E or local seed administrator credentials.',
  )
  if (!adminEmail || !adminPassword) return

  await page.goto('/dashboard/login?returnTo=%2Fdashboard')
  await page.getByRole('textbox', { name: '邮箱' }).fill(adminEmail)
  await page.getByRole('textbox', { name: '密码' }).fill(adminPassword)
  await page.getByRole('button', { name: '登录后台' }).click()
  await expect(page).toHaveURL(/\/dashboard$/)
}

test('admin overview renders real queues and dependency-gated work without internal links', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ height: 900, width: 1440 })
  await login(page)
  if (!adminEmail || !adminPassword) return

  await expect(page.getByRole('heading', { level: 2, name: '今日运营要务' })).toBeVisible()
  await expect(page.getByRole('heading', { level: 3, name: '待接管会话' })).toBeVisible()
  await expect(page.getByRole('heading', { level: 3, name: '人工服务中' })).toBeVisible()
  await expect(page.getByRole('heading', { level: 3, name: '新增 A 类线索' })).toBeVisible()
  await expect(page.getByRole('heading', { level: 3, name: '失败 / Dead 任务' })).toBeVisible()
  await expect(page.getByText('DEPENDENCY-GATED')).toBeVisible()
  await expect(page.locator('a[href^="/admin"]')).toHaveCount(0)
  await expect(page.locator('.portal-overview__queue-card')).toHaveCount(4)
  await expect(page.getByRole('link', { name: /待接管会话/ })).toHaveAttribute(
    'href',
    '/dashboard?queue=handoff-requested',
  )
  await page.getByRole('link', { name: /待接管会话/ }).click()
  await expect(page).toHaveURL(/\/dashboard\?queue=handoff-requested$/)
  await expect(page.getByRole('link', { name: '显示全部' })).toHaveAttribute('href', '/dashboard')
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1440)

  await page.screenshot({
    fullPage: true,
    path: testInfo.outputPath('portal-overview-desktop.png'),
  })
})

test('mobile overview preserves queue priority and has no horizontal overflow', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ height: 844, width: 390 })
  await login(page)
  if (!adminEmail || !adminPassword) return

  await expect(page.getByRole('heading', { level: 2, name: '今日运营要务' })).toBeVisible()
  await expect(page.locator('.portal-overview__queue-card')).toHaveCount(4)
  await expect(page.locator('.portal-overview__queue-card').first()).toBeInViewport()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)

  await page.screenshot({
    fullPage: true,
    path: testInfo.outputPath('portal-overview-mobile.png'),
  })
})
