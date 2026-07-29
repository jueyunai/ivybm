import { expect, test } from '@playwright/test'

const adminEmail = process.env.E2E_ADMIN_EMAIL ?? process.env.SEED_ADMIN_EMAIL
const adminPassword = process.env.E2E_ADMIN_PASSWORD ?? process.env.SEED_ADMIN_PASSWORD

const login = async (page: import('@playwright/test').Page, returnTo: string) => {
  test.skip(
    !adminEmail || !adminPassword,
    'Requires dedicated non-production E2E or local seed administrator credentials.',
  )
  if (!adminEmail || !adminPassword) return

  await page.goto(`/dashboard/login?returnTo=${encodeURIComponent(returnTo)}`)
  await page.getByRole('textbox', { name: '邮箱' }).fill(adminEmail)
  await page.getByRole('textbox', { name: '密码' }).fill(adminPassword)
  await page.getByRole('button', { name: '登录后台' }).click()
  await expect(page).toHaveURL(new RegExp(`${returnTo.replaceAll('/', '\\/')}$`))
}

test('desktop Portal Shell exposes role-safe business navigation and settings', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ height: 900, width: 1440 })
  await login(page, '/dashboard/settings')
  if (!adminEmail || !adminPassword) return

  await expect(page.getByRole('navigation', { name: '运营门户导航' })).toBeVisible()
  await expect(page.getByRole('heading', { level: 2, name: '基础设置' })).toBeVisible()
  await expect(page.getByRole('link', { name: '基础设置' })).toHaveAttribute(
    'aria-current',
    'page',
  )
  await expect(page.getByText(adminEmail)).toBeVisible()
  await expect(page.locator('.portal-sidebar')).toHaveCSS('width', '260px')
  await page.screenshot({
    fullPage: true,
    path: testInfo.outputPath('portal-settings-desktop.png'),
  })

  await page.getByRole('button', { name: '收起导航' }).click()
  await expect(page.locator('.portal-layout')).toHaveClass(/is-collapsed/)
  await expect(page.locator('.portal-sidebar')).toHaveCSS('width', '76px')

  await expect(page.locator('a[href^="/admin"]')).toHaveCount(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1440)
})

test('mobile Portal Shell uses an accessible navigation drawer without horizontal overflow', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ height: 844, width: 390 })
  await login(page, '/dashboard/settings')
  if (!adminEmail || !adminPassword) return

  const trigger = page.getByRole('button', { name: '打开导航' })
  await expect(trigger).toBeVisible()
  await trigger.click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.getByRole('navigation', { name: '运营门户导航' })).toBeVisible()
  await page.screenshot({
    fullPage: true,
    path: testInfo.outputPath('portal-settings-mobile-drawer.png'),
  })

  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toBeHidden()
  await expect(trigger).toBeFocused()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  await page.screenshot({
    fullPage: true,
    path: testInfo.outputPath('portal-settings-mobile.png'),
  })
})
