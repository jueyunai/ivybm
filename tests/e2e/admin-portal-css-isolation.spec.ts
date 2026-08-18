import './require-mutation-launch'
import { expect, test } from '@playwright/test'

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
