import './require-mutation-launch'
import { expect, test } from '@playwright/test'

const adminEmail = process.env.E2E_ADMIN_EMAIL ?? process.env.SEED_ADMIN_EMAIL
const adminPassword = process.env.E2E_ADMIN_PASSWORD ?? process.env.SEED_ADMIN_PASSWORD

const readPublicSurface = async (page: import('@playwright/test').Page) =>
  page.evaluate(() => {
    const body = getComputedStyle(document.body)
    const root = getComputedStyle(document.documentElement)

    return {
      background: body.backgroundColor,
      bodyPortalAccent: body.getPropertyValue('--portal-accent').trim(),
      fontFamily: body.fontFamily,
      rootPortalAccent: root.getPropertyValue('--portal-accent').trim(),
    }
  })

test('Portal tokens and shell styles do not leak into the website or Payload Admin', async ({
  page,
}) => {
  await page.goto('/en')
  await expect(page.locator('.site-header')).toBeVisible()
  await expect(page.locator('.portal-shell')).toHaveCount(0)

  const publicBefore = await readPublicSurface(page)
  expect(publicBefore.bodyPortalAccent).toBe('')
  expect(publicBefore.rootPortalAccent).toBe('')

  await page.goto('/dashboard/login')
  const shell = page.locator('.portal-shell')
  await expect(shell).toBeVisible()
  expect(
    await shell.evaluate((element) =>
      getComputedStyle(element).getPropertyValue('--portal-accent').trim(),
    ),
  ).not.toBe('')

  await page.goto('/en')
  await expect(page.locator('.site-header')).toBeVisible()
  await expect(page.locator('.portal-shell')).toHaveCount(0)
  expect(await readPublicSurface(page)).toEqual(publicBefore)

  await page.goto('/admin/login')
  await expect(page.locator('.portal-shell')).toHaveCount(0)
})

test('login showcase styles stay isolated from protected Portal fields', async ({ page }) => {
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

  const mediaControl = page.locator('.portal-media__search .portal-field__control')
  await expect(mediaControl).toBeVisible()
  await expect(mediaControl).toHaveCSS('border-radius', '4px')
  await expect(mediaControl).toHaveCSS('background-color', 'rgb(247, 249, 251)')
  await expect(mediaControl).toHaveCSS('border-color', 'rgb(199, 196, 216)')
})
