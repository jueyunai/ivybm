import { expect, test } from '@playwright/test'

const adminEmail = process.env.E2E_ADMIN_EMAIL ?? process.env.SEED_ADMIN_EMAIL
const adminPassword = process.env.E2E_ADMIN_PASSWORD ?? process.env.SEED_ADMIN_PASSWORD
const localBaseURL = process.env.BASE_URL || 'http://localhost:3000'

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
  await expect(page.getByRole('heading', { name: '登录后台' })).toBeVisible()

  await page.goto('/dashboard/login?returnTo=https%3A%2F%2Fevil.example%2Fdashboard')
  await expect(page.getByRole('heading', { name: '登录后台' })).toBeVisible()

  await fillPortalLogin(page, 'invalid@example.invalid', 'invalid-password-123')
  await page.getByRole('button', { name: '登录后台' }).click()
  await expect(page.locator('.portal-login-form__error')).toContainText('邮箱或密码不正确')
  expect(page.url()).not.toContain('password')
  expect(page.url()).not.toContain('invalid%40example.invalid')
})

test('Portal login exposes stable locked, unavailable, and network failure states', async ({ page }) => {
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

test('the native no-JavaScript fallback never submits credentials in the URL', async ({ browser }) => {
  const context = await browser.newContext({ baseURL: localBaseURL, javaScriptEnabled: false })
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
