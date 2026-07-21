import { expect, test } from '@playwright/test'

const adminEmail = process.env.E2E_ADMIN_EMAIL
const adminPassword = process.env.E2E_ADMIN_PASSWORD

const openTaskNavigation = async (page: import('@playwright/test').Page) => {
  const openMenuButton = page.getByRole('button', { name: /^(打开\s*菜单|open\s*menu)$/i })

  if ((await openMenuButton.count()) === 1) {
    await openMenuButton.click()
  }
}

test('operations dashboard and task navigation remain available after an Admin route change', async ({
  page,
}, testInfo) => {
  test.skip(
    !adminEmail || !adminPassword,
    'Requires a dedicated non-production E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD.',
  )

  if (!adminEmail || !adminPassword) return

  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.setViewportSize({ height: 900, width: 1440 })
  await page.goto('/admin/login')

  const emailInput = page.locator('input[type="email"]')
  const passwordInput = page.locator('input[type="password"]')
  const submitButton = page.locator('button[type="submit"]')

  await expect(emailInput).toHaveCount(1)
  await expect(passwordInput).toHaveCount(1)
  await expect(submitButton).toHaveCount(1)

  await emailInput.fill(adminEmail)
  await passwordInput.fill(adminPassword)
  await Promise.all([page.waitForURL(/\/admin\/?$/), submitButton.click()])

  const dashboard = page.getByTestId('operations-dashboard')
  const taskNav = page.getByTestId('task-nav-links')
  await expect(dashboard).toBeVisible()
  await expect(taskNav).toBeVisible()
  await expect(taskNav.locator('a')).toHaveCount(3)
  await openTaskNavigation(page)

  await testInfo.attach('operations-dashboard', {
    body: await page.screenshot({ fullPage: false }),
    contentType: 'image/png',
  })

  const leadsLink = taskNav.locator('a[href="/admin/collections/leads"]')
  await expect(leadsLink).toHaveCount(1)
  await Promise.all([page.waitForURL(/\/admin\/collections\/leads/), leadsLink.click()])
  await expect(page.getByTestId('task-nav-links')).toBeVisible()

  await openTaskNavigation(page)
  const overviewLink = page.getByTestId('task-nav-links').locator('a[href="/admin"]')
  await expect(overviewLink).toHaveCount(1)
  await Promise.all([page.waitForURL(/\/admin\/?$/), overviewLink.click()])
  await expect(page.getByTestId('operations-dashboard')).toBeVisible()

  await page.setViewportSize({ height: 844, width: 390 })
  await expect(page.getByTestId('operations-dashboard')).toBeVisible()
  expect(
    await dashboard.evaluate((element) => {
      const rect = element.getBoundingClientRect()
      return rect.left >= 0 && rect.right <= window.innerWidth
    }),
  ).toBe(true)
  await testInfo.attach('operations-dashboard-mobile', {
    body: await page.screenshot({ fullPage: false }),
    contentType: 'image/png',
  })
})
