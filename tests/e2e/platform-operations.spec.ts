import { expect, test } from '@playwright/test'

const adminEmail = process.env.E2E_ADMIN_EMAIL
const adminPassword = process.env.E2E_ADMIN_PASSWORD

test('platform operations supports readiness, mock execution, blockers, and mobile layout', async ({
  page,
}, testInfo) => {
  test.skip(
    !adminEmail || !adminPassword,
    'Requires a dedicated non-production E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD.',
  )
  if (!adminEmail || !adminPassword) return

  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.setViewportSize({ height: 960, width: 1440 })
  await page.goto('/admin/login')
  await page.locator('input[type="email"]').fill(adminEmail)
  await page.locator('input[type="password"]').fill(adminPassword)
  await Promise.all([page.waitForURL(/\/admin\/?$/), page.locator('button[type="submit"]').click()])

  await page.goto('/admin/platforms')
  const workspace = page.getByTestId('platform-operations')
  await expect(workspace).toBeVisible()
  await expect(
    page.getByRole('heading', { name: /平台联调中心|Platform operations/ }),
  ).toBeVisible()
  await expect(page.locator('.platform-ops-card')).toHaveCount(4)
  await expect(page.getByRole('link', { name: /管理账号|Manage accounts/ })).toBeVisible()
  await expect(page.locator('.platform-ops-card--tiktok')).toContainText(
    /Webhook 验签.*可受控测试|Webhook signature.*Controlled test ready/,
  )
  await expect(page.locator('.platform-ops-card--linkedin')).toContainText(
    /辅助发布包.*可受控测试|Assisted package.*Controlled test ready/,
  )
  await testInfo.attach('platform-operations-readiness-desktop', {
    body: await page.screenshot({ fullPage: false }),
    contentType: 'image/png',
  })

  const readinessTab = page.getByRole('tab', { name: /状态矩阵|Readiness/ })
  const simulationTab = page.getByRole('tab', { name: /Mock 演练|Mock lab/ })
  await readinessTab.focus()
  await readinessTab.press('ArrowRight')
  await expect(simulationTab).toBeFocused()
  await expect(simulationTab).toHaveAttribute('aria-selected', 'true')
  await page.getByRole('button', { name: /未知结果恢复|Unknown outcome recovery/ }).click()
  await page.getByRole('button', { name: /运行演练|Run simulation/ }).click()
  await expect(page.getByTestId('platform-simulation-result')).toContainText('delivery_unknown')
  await expect(page.getByTestId('platform-simulation-result')).toContainText(
    /未执行盲目重发|Blind resend was prevented/,
  )

  await page.getByRole('tab', { name: /阻塞项|Blockers/ }).click()
  await expect(page.locator('.platform-ops-blockers')).toContainText('PublishJobs / PublishLogs')
  expect(
    await workspace.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBe(true)
  await testInfo.attach('platform-operations-desktop', {
    body: await page.screenshot({ fullPage: false }),
    contentType: 'image/png',
  })

  await page.setViewportSize({ height: 844, width: 390 })
  await page.getByRole('tab', { name: /状态矩阵|Readiness/ }).click()
  await expect(page.locator('.platform-ops-card')).toHaveCount(4)
  expect(
    await workspace.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBe(true)
  for (const element of await page.locator('.platform-ops-card, .platform-ops__tabs').all()) {
    expect(
      await element.evaluate((node) => {
        const rect = node.getBoundingClientRect()
        return rect.left >= 0 && rect.right <= window.innerWidth
      }),
    ).toBe(true)
  }
  await testInfo.attach('platform-operations-mobile', {
    body: await page.screenshot({ fullPage: false }),
    contentType: 'image/png',
  })
})
