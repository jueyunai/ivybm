import { expect, test, type Page } from '@playwright/test'

const adminEmail = process.env.E2E_ADMIN_EMAIL ?? process.env.SEED_ADMIN_EMAIL
const adminPassword = process.env.E2E_ADMIN_PASSWORD ?? process.env.SEED_ADMIN_PASSWORD

const login = async (page: Page, returnTo: string) => {
  test.skip(
    !adminEmail || !adminPassword,
    'Requires local non-production administrator credentials.',
  )
  if (!adminEmail || !adminPassword) return false

  await page.goto(`/dashboard/login?returnTo=${encodeURIComponent(returnTo)}`)
  await page.getByRole('textbox', { name: '邮箱' }).fill(adminEmail)
  await page.getByRole('textbox', { name: '密码' }).fill(adminPassword)
  await page.getByRole('button', { name: '登录后台' }).click()
  await expect(page).toHaveURL(new RegExp(`${returnTo}$`))
  return true
}

test('admin can inspect platform readiness and operation compensation without a technical-admin escape hatch', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ height: 900, width: 1440 })
  if (!(await login(page, '/dashboard/platforms'))) return

  await expect(page.getByRole('heading', { exact: true, level: 2, name: '平台账号' })).toBeVisible()
  await expect(page.locator('a[href^="/admin"]')).toHaveCount(0)
  await page.screenshot({
    fullPage: true,
    path: testInfo.outputPath('portal-platforms-desktop.png'),
  })
  await page.goto('/dashboard/operations')
  await expect(page.getByRole('heading', { level: 2, name: '异常与补偿' })).toBeVisible()
  await expect(page.locator('a[href^="/admin"]')).toHaveCount(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1440)
  await page.screenshot({
    fullPage: true,
    path: testInfo.outputPath('portal-operations-desktop.png'),
  })
})

test('mobile platform readiness and operations stay within 390px', async ({ page }, testInfo) => {
  await page.setViewportSize({ height: 844, width: 390 })
  if (!(await login(page, '/dashboard/platforms'))) return

  await expect(page.getByRole('heading', { exact: true, level: 2, name: '平台账号' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  await page.screenshot({
    fullPage: true,
    path: testInfo.outputPath('portal-platforms-mobile.png'),
  })
  await page.goto('/dashboard/operations')
  await expect(page.getByRole('heading', { level: 2, name: '异常与补偿' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  await page.screenshot({
    fullPage: true,
    path: testInfo.outputPath('portal-operations-mobile.png'),
  })
})

test('admin can create and edit a platform account without entering /admin', async ({ page }) => {
  await page.setViewportSize({ height: 900, width: 1440 })
  if (!(await login(page, '/dashboard/platforms'))) return

  await page.getByRole('button', { name: '添加账号' }).click()
  await page.getByRole('textbox', { name: '显示名称' }).fill('E2E LinkedIn Member')
  await page.getByRole('combobox', { name: '平台类型' }).selectOption('linkedin-member')
  await page.getByRole('textbox', { name: '外部账号 ID' }).fill('e2e-member-001')
  await page.getByRole('textbox', { name: '备注' }).fill('Keep this note while editing')
  await page.getByRole('button', { name: /^保存/ }).click()

  await expect(page.getByRole('heading', { name: 'E2E LinkedIn Member' })).toBeVisible()
  await expect(page.locator('a[href^="/admin"]')).toHaveCount(0)

  const card = page.locator('article', {
    has: page.getByRole('heading', { name: 'E2E LinkedIn Member' }),
  })
  await card.getByRole('button', { name: '编辑' }).click()
  await card.getByRole('textbox', { name: '显示名称' }).fill('E2E LinkedIn Member Updated')
  await expect(card.getByRole('textbox', { name: '备注' })).toHaveValue(
    'Keep this note while editing',
  )
  await card.getByRole('button', { name: /^保存/ }).click()

  await expect(page.getByRole('heading', { name: 'E2E LinkedIn Member Updated' })).toBeVisible()
  await expect(page.locator('a[href^="/admin"]')).toHaveCount(0)
})

test('admin sees connect action for an unconnected account and no /admin dependency', async ({
  page,
}) => {
  await page.setViewportSize({ height: 900, width: 1440 })
  if (!(await login(page, '/dashboard/platforms'))) return

  await page.getByRole('button', { name: '添加账号' }).click()
  await page.getByRole('textbox', { name: '显示名称' }).fill('E2E Facebook Page')
  await page.getByRole('combobox', { name: '平台类型' }).selectOption('facebook-page')
  await page.getByRole('textbox', { name: '外部账号 ID' }).fill('123456789012345')
  await page.getByRole('button', { name: /^保存/ }).click()

  const card = page.locator('article', {
    has: page.getByRole('heading', { name: 'E2E Facebook Page' }),
  })
  const connectLink = card.getByRole('link', { name: '连接' })
  await expect(connectLink).toBeVisible()
  await expect(connectLink).toHaveAttribute(
    'href',
    /\/api\/platforms\/meta\/oauth\/start\?accountId=/,
  )
  await expect(page.locator('a[href^="/admin"]')).toHaveCount(0)
})

test('admin can delete a platform account without entering /admin', async ({ page }) => {
  await page.setViewportSize({ height: 900, width: 1440 })
  if (!(await login(page, '/dashboard/platforms'))) return

  await page.getByRole('button', { name: '添加账号' }).click()
  await page.getByRole('textbox', { name: '显示名称' }).fill('E2E Delete Target')
  await page.getByRole('combobox', { name: '平台类型' }).selectOption('instagram-professional')
  await page.getByRole('textbox', { name: '外部账号 ID' }).fill('e2e-delete-001')
  await page.getByRole('button', { name: /^保存/ }).click()

  const card = page.locator('article', {
    has: page.getByRole('heading', { name: 'E2E Delete Target' }),
  })
  await card.getByRole('button', { name: '删除' }).click()
  await card.getByRole('button', { name: /^删除账号/ }).click()

  await expect(page.getByRole('heading', { name: 'E2E Delete Target' })).toHaveCount(0)
  await expect(page.locator('a[href^="/admin"]')).toHaveCount(0)
})

test('platform type options do not include TikTok in the customer flow', async ({ page }) => {
  await page.setViewportSize({ height: 900, width: 1440 })
  if (!(await login(page, '/dashboard/platforms'))) return

  await page.getByRole('button', { name: '添加账号' }).click()
  const select = page.getByRole('combobox', { name: '平台类型' })
  const options = await select.locator('option').allTextContents()
  const optionValues = await select
    .locator('option')
    .evaluateAll((elements) => elements.map((element) => (element as HTMLOptionElement).value))

  expect(options.some((label) => label.toLowerCase().includes('tiktok'))).toBe(false)
  expect(optionValues.some((value) => value.includes('tiktok'))).toBe(false)
  await expect(page.locator('a[href^="/admin"]')).toHaveCount(0)
})
