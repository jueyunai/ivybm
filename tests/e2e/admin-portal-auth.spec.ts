import './require-mutation-launch'
import { expect, test } from '@playwright/test'

const adminEmail = process.env.E2E_ADMIN_EMAIL ?? process.env.SEED_ADMIN_EMAIL
const adminPassword = process.env.E2E_ADMIN_PASSWORD ?? process.env.SEED_ADMIN_PASSWORD

const fillPortalLogin = async (
  page: import('@playwright/test').Page,
  email: string,
  password: string,
) => {
  await page.getByRole('textbox', { name: '邮箱' }).fill(email)
  await page.getByRole('textbox', { name: '密码' }).fill(password)
}

test('unauthenticated Portal requests preserve a safe return target', async ({ page }) => {
  await page.goto('/dashboard')

  await expect(page).toHaveURL(/\/dashboard\/login\?returnTo=%2Fdashboard$/)
  await expect(page.getByRole('heading', { name: '欢迎登录 IVYBM' })).toBeVisible()

  await page.goto('/dashboard/login?returnTo=https%3A%2F%2Fevil.example%2Fdashboard')
  await expect(page.getByRole('heading', { name: '欢迎登录 IVYBM' })).toBeVisible()

  await fillPortalLogin(page, 'invalid@example.invalid', 'invalid-password-123')
  await page.getByRole('button', { name: '登录后台' }).click()
  await expect(page.locator('.portal-login-form__error')).toContainText('邮箱或密码不正确')
  expect(page.url()).not.toContain('password')
  expect(page.url()).not.toContain('invalid%40example.invalid')
})

test('Portal login keeps the primary action reachable on narrow and zoomed viewports', async ({
  page,
}) => {
  for (const viewport of [
    { width: 320, height: 568 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport)
    await page.goto('/dashboard/login')

    const submit = page.getByRole('button', { name: '登录后台' })
    await expect(submit).toBeVisible()
    await expect(submit).toBeInViewport()
  }

  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/dashboard/login')
  await page.evaluate(() => {
    document.documentElement.style.zoom = '2'
  })

  await expect(page.getByRole('button', { name: '登录后台' })).toBeVisible()
  await expect(page.getByRole('button', { name: '登录后台' })).toBeInViewport()
})

test('Portal login keeps every scenario control reachable at narrow and zoomed viewports', async ({
  page,
}) => {
  for (const { viewport, zoom } of [
    { viewport: { width: 320, height: 568 }, zoom: 1 },
    { viewport: { width: 390, height: 844 }, zoom: 2 },
  ]) {
    await page.setViewportSize(viewport)
    await page.goto('/dashboard/login')
    if (zoom !== 1) {
      await page.evaluate((value) => {
        document.documentElement.style.zoom = String(value)
      }, zoom)
    }

    const scenarioGroup = page.locator('.scenario-pill-group')
    await scenarioGroup.scrollIntoViewIfNeeded()

    for (const country of ['沙特阿拉伯', '德国', '美国']) {
      const button = page.getByRole('button', { name: new RegExp(country) })
      await expect(button).toBeVisible()
      await expect(button).toBeInViewport({ ratio: 1 })
    }

    await expect(page.getByText(/买家原始接入 \(示例买家 A\)/)).toBeVisible()
    const unitedStates = page.getByRole('button', { name: /美国/ })
    await unitedStates.click()
    await expect(unitedStates).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByText(/买家原始接入 \(示例买家 C\)/)).toBeVisible()
  }
})

test('Portal login exposes stable locked, unavailable, and network failure states', async ({
  page,
}) => {
  await page.goto('/dashboard/login')

  for (const [status, message] of [
    [429, '登录尝试次数过多，请稍后再试。'],
    [503, '登录服务暂不可用，请稍后重试。'],
  ] as const) {
    await page.route('**/api/users/login', async (route) => {
      await route.fulfill({ body: 'internal provider detail', status })
    })
    await fillPortalLogin(page, 'operator@example.invalid', 'wrong-password-123')
    await page.getByRole('button', { name: '登录后台' }).click()
    await expect(page.locator('.portal-login-form__error')).toHaveText(message)
    await page.unroute('**/api/users/login')
  }

  await page.route('**/api/users/login', async (route) => route.abort('failed'))
  await page.getByRole('button', { name: '登录后台' }).click()
  await expect(page.locator('.portal-login-form__error')).toHaveText(
    '网络连接失败，请检查连接后重试。',
  )
  await page.unroute('**/api/users/login')
})

test('Portal login reuses the Payload session and keeps the existing Admin route available', async ({
  page,
}) => {
  test.skip(
    !adminEmail || !adminPassword,
    'Requires dedicated non-production E2E or local seed administrator credentials.',
  )
  if (!adminEmail || !adminPassword) return

  await page.goto('/dashboard/login?returnTo=%2Fdashboard')
  await fillPortalLogin(page, adminEmail, adminPassword)

  const submit = page.getByRole('button', { name: '登录后台' })
  await submit.click()
  await expect(page).toHaveURL(/\/dashboard$/)
  await expect(page.getByRole('heading', { level: 2, name: '今日运营要务' })).toBeVisible()

  const session = await page.request.get('/api/users/me')
  expect(session.ok()).toBe(true)
  await expect(session.json()).resolves.toMatchObject({ user: { role: 'admin' } })

  await page.goto('/admin')
  await expect(page).toHaveURL(/\/admin\/?$/)
  await expect(page.getByTestId('operations-dashboard')).toBeVisible()

  const logout = await page.request.post('/api/users/logout')
  expect(logout.ok()).toBe(true)
  await page.goto('/dashboard')
  await expect(page).toHaveURL(/\/dashboard\/login\?returnTo=%2Fdashboard$/)
})

test('the account menu preserves the session when logout fails and allows a successful retry', async ({
  page,
}) => {
  test.skip(
    !adminEmail || !adminPassword,
    'Requires dedicated non-production E2E or local seed administrator credentials.',
  )
  if (!adminEmail || !adminPassword) return

  await page.goto('/dashboard/login?returnTo=%2Fdashboard%2Fsettings')
  await fillPortalLogin(page, adminEmail, adminPassword)
  await page.getByRole('button', { name: '登录后台' }).click()
  await expect(page).toHaveURL(/\/dashboard\/settings$/)

  await page.route('**/api/users/logout', async (route) => {
    await route.fulfill({ body: 'temporary logout failure', status: 503 })
  })

  await page.getByRole('button', { name: '账户菜单' }).click()
  await page.getByRole('menuitem', { name: '退出登录' }).click()
  await expect(page.locator('.portal-account__error[role="alert"]')).toHaveText(
    '退出失败，请重试。',
  )
  await expect(page).toHaveURL(/\/dashboard\/settings$/)

  const sessionAfterFailure = await page.request.get('/api/users/me')
  expect(sessionAfterFailure.ok()).toBe(true)
  await expect(sessionAfterFailure.json()).resolves.toMatchObject({ user: { role: 'admin' } })

  await page.unroute('**/api/users/logout')
  await page.getByRole('menuitem', { name: '退出登录' }).click()
  await expect(page).toHaveURL(/\/dashboard\/login$/)
})

test('the native no-JavaScript fallback never submits credentials in the URL', async ({
  browser,
}, testInfo) => {
  const projectBaseURL = testInfo.project.use.baseURL
  const context = await browser.newContext({
    baseURL: typeof projectBaseURL === 'string' ? projectBaseURL : 'http://localhost:3000',
    javaScriptEnabled: false,
  })
  const page = await context.newPage()

  try {
    await page.goto('/dashboard/login')
    await fillPortalLogin(page, 'operator@example.invalid', 'native-password-123')

    const requestPromise = page.waitForRequest(
      (request) => request.url().includes('/dashboard/login') && request.method() === 'POST',
    )
    await page.getByRole('button', { name: '登录后台' }).click()
    const request = await requestPromise

    expect(request.method()).toBe('POST')
    expect(request.url()).not.toContain('email=')
    expect(request.url()).not.toContain('password=')
  } finally {
    await context.close()
  }
})
