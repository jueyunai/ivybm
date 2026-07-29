import { expect, test } from '@playwright/test'

const adminEmail = process.env.E2E_ADMIN_EMAIL
const adminPassword = process.env.E2E_ADMIN_PASSWORD

const openTaskNavigation = async ({
  mobile = false,
  page,
}: {
  mobile?: boolean
  page: import('@playwright/test').Page
}) => {
  const openNavigation = page.locator('aside.nav--nav-open')

  if ((await openNavigation.count()) === 1) return

  const navToggleClass = mobile ? 'app-header__mobile-nav-toggler' : 'template-default__nav-toggler'
  const openMenuButton = page.locator(
    `button.${navToggleClass}[aria-label="打开 菜单"], button.${navToggleClass}[aria-label="Open menu"]`,
  )

  await expect(openMenuButton).toHaveCount(1)
  await openMenuButton.click()
  await expect(openNavigation).toHaveCount(1)
}

test('operations dashboard and owned navigation remain available after an Admin route change', async ({
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
  const operationsNav = page.getByTestId('operations-nav')
  await expect(dashboard).toBeVisible()
  await expect(operationsNav).toBeVisible()
  await expect(operationsNav.locator('.ops-admin-nav__footer')).toHaveCount(0)
  const adminHeader = page.locator('header.app-header')
  const headerControls = adminHeader.locator('.app-header__controls-wrapper')
  const headerLocalizer = adminHeader.locator('.app-header__localizer.localizer')
  await expect(headerControls).toBeVisible()
  await expect(headerLocalizer).toBeVisible()
  await expect(adminHeader.locator('.app-header__account')).toBeHidden()
  const accountMenuTrigger = page.getByTestId('admin-account-menu-trigger')
  await expect(accountMenuTrigger).toBeVisible()
  await accountMenuTrigger.click()
  const accountMenu = page.getByTestId('admin-account-menu')
  const accountMenuAccountLink = accountMenu.locator('a[href="/admin/account"]')
  const accountMenuSignOut = accountMenu.locator('button[data-action="sign-out"]')
  await expect(accountMenu).toBeVisible()
  await expect(accountMenuAccountLink).toBeVisible()
  await expect(accountMenuSignOut).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(accountMenu).not.toBeVisible()
  await expect(accountMenuTrigger).toBeFocused()
  await accountMenuTrigger.click()
  await expect(accountMenu).toBeVisible()
  await dashboard.click({ position: { x: 20, y: 20 } })
  await expect(accountMenu).not.toBeVisible()
  const highIntentQueueLink = page.locator('a.ops-queue-card__link[href*="intentLevel"]')
  await expect(highIntentQueueLink).toHaveCount(1)
  const highIntentQueueHref = await highIntentQueueLink.getAttribute('href')
  const highIntentQueueURL = new URL(highIntentQueueHref ?? '', page.url())
  expect(highIntentQueueURL.searchParams.get('where[and][0][status][in][0]')).toBe('new')
  expect(highIntentQueueURL.searchParams.get('where[and][0][status][in][1]')).toBe('qualified')
  expect(highIntentQueueURL.searchParams.get('where[and][1][intentLevel][equals]')).toBe('a')
  await openTaskNavigation({ page })
  await expect(operationsNav.getByTestId('ops-nav-section-workspace')).toBeVisible()
  await expect(operationsNav.getByTestId('ops-nav-section-content')).toBeVisible()
  await expect(operationsNav.getByTestId('ops-nav-section-system')).toBeVisible()
  expect(
    await operationsNav.evaluate((element) => {
      const rect = element.getBoundingClientRect()
      return rect.left >= 0 && rect.right <= window.innerWidth && rect.height <= window.innerHeight
    }),
  ).toBe(true)

  await testInfo.attach('operations-dashboard', {
    body: await page.screenshot({ fullPage: false }),
    contentType: 'image/png',
  })

  const leadsLink = operationsNav.locator('a[href="/admin/collections/leads"]')
  await expect(leadsLink).toHaveCount(1)
  await Promise.all([page.waitForURL(/\/admin\/collections\/leads/), leadsLink.click()])
  await expect(page.getByTestId('operations-nav')).toBeVisible()

  await openTaskNavigation({ page })
  const overviewLink = page.getByTestId('operations-nav').locator('a[href="/admin"]')
  await expect(overviewLink).toHaveCount(1)
  await Promise.all([page.waitForURL(/\/admin\/?$/), overviewLink.click()])
  await expect(page.getByTestId('operations-dashboard')).toBeVisible()

  await page.setViewportSize({ height: 844, width: 390 })
  await expect(page.getByTestId('operations-dashboard')).toBeVisible()
  await openTaskNavigation({ mobile: true, page })
  await expect(page.getByTestId('operations-nav')).toBeVisible()
  await expect(page.locator('aside.nav--nav-open')).toHaveCount(1)
  await expect(page.getByTestId('operations-nav-close')).toBeVisible()
  expect(
    await dashboard.evaluate((element) => {
      const rect = element.getBoundingClientRect()
      return rect.left >= 0 && rect.right <= window.innerWidth
    }),
  ).toBe(true)
  expect(
    await page.getByTestId('operations-nav').evaluate((element) => {
      const rect = element.getBoundingClientRect()
      return rect.left >= 0 && rect.right <= window.innerWidth && rect.height <= window.innerHeight
    }),
  ).toBe(true)
  await testInfo.attach('operations-dashboard-mobile', {
    body: await page.screenshot({ fullPage: false }),
    contentType: 'image/png',
  })

  await page.getByTestId('operations-nav-close').click()
  await expect(page.locator('aside.nav--nav-open')).toHaveCount(0)
  await expect(page.locator('.app-header__mobile-nav-toggler')).toBeVisible()
  await expect(headerControls).toBeVisible()
  await expect(headerLocalizer).toBeVisible()
  await expect(accountMenuTrigger).toBeVisible()

  await accountMenuTrigger.press('ArrowUp')
  await expect(accountMenu).toBeVisible()
  await expect(accountMenuSignOut).toBeFocused()
  await page.keyboard.press('Home')
  await expect(accountMenuAccountLink).toBeFocused()
  await page.keyboard.press('End')
  await expect(accountMenuSignOut).toBeFocused()
  expect(
    await accountMenu.evaluate((element) => {
      const rect = element.getBoundingClientRect()
      return (
        rect.left >= 0 &&
        rect.right <= window.innerWidth &&
        rect.top >= 0 &&
        rect.bottom <= window.innerHeight
      )
    }),
  ).toBe(true)
  await page.keyboard.press('Escape')
  await expect(accountMenu).not.toBeVisible()
  await expect(accountMenuTrigger).toBeFocused()
})
