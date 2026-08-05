import { expect, test } from '@playwright/test'

const adminEmail = process.env.E2E_ADMIN_EMAIL ?? process.env.SEED_ADMIN_EMAIL
const adminPassword = process.env.E2E_ADMIN_PASSWORD ?? process.env.SEED_ADMIN_PASSWORD

const login = async (page: import('@playwright/test').Page) => {
  test.skip(
    !adminEmail || !adminPassword,
    'Requires dedicated non-production E2E or local seed administrator credentials.',
  )
  if (!adminEmail || !adminPassword) return

  await page.goto('/dashboard/login?returnTo=%2Fdashboard%2Fcontent')
  await page.getByRole('textbox', { name: '邮箱' }).fill(adminEmail)
  await page.getByRole('textbox', { name: '密码' }).fill(adminPassword)
  await page.getByRole('button', { name: '登录后台' }).click()
  await expect(page).toHaveURL(/\/dashboard\/content$/)
}

test('website content hub exposes six safe content types, filters, detail, and preview', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ height: 900, width: 1440 })
  await login(page)
  if (!adminEmail || !adminPassword) return

  await page.goto('/dashboard/content?type=products')
  await expect(page.getByRole('heading', { level: 2, name: '官网内容' })).toBeVisible()
  await expect(page.getByRole('navigation', { name: '官网内容' }).getByRole('link')).toHaveCount(6)
  await expect(page.getByRole('link', { name: /^产品 \d/ })).toHaveAttribute('aria-current', 'page')
  await expect(page.getByRole('button', { name: '新增内容' }).first()).toBeVisible()
  await expect(page.getByRole('button', { name: '编辑内容' })).toBeVisible()
  await expect(page.locator('.portal-content__item')).not.toHaveCount(0)
  await expect(page.locator('a[href^="/admin"]')).toHaveCount(0)
  await expect(page.getByRole('link', { name: '英文预览' })).toHaveAttribute(
    'href',
    /\/en\/products\//,
  )
  await expect(page.getByRole('link', { name: '阿语预览' })).toHaveAttribute(
    'href',
    /\/ar\/products\//,
  )
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1440)

  await page.getByRole('searchbox', { name: '搜索内容' }).fill('no-content-should-match-this')
  await page.getByRole('button', { name: '筛选' }).click()
  await expect(page).toHaveURL(/q=no-content-should-match-this/)
  await expect(page.getByRole('heading', { name: '没有匹配内容' })).toBeVisible()

  await page.screenshot({
    fullPage: true,
    path: testInfo.outputPath('portal-content-desktop-empty.png'),
  })
})

test('mobile website content hub keeps filters and content workspace within the viewport', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ height: 844, width: 390 })
  await login(page)
  if (!adminEmail || !adminPassword) return

  await page.goto('/dashboard/content?type=products')
  await expect(page.getByRole('heading', { level: 2, name: '官网内容' })).toBeVisible()
  await expect(page.getByRole('searchbox', { name: '搜索内容' })).toBeVisible()
  await expect(page.locator('.portal-content__workspace')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)

  await page.screenshot({
    fullPage: true,
    path: testInfo.outputPath('portal-content-mobile.png'),
  })
})

test('website content editor completes create, update, and safe delete from the Portal', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ height: 960, width: 1440 })
  await login(page)
  if (!adminEmail || !adminPassword) return

  const suffix = `${Date.now()}-${testInfo.workerIndex}`
  const slug = `portal-e2e-category-${suffix}`
  const initialTitle = `Portal E2E Category ${suffix}`
  const updatedTitle = `${initialTitle} Updated`
  let createdId: number | string | null = null

  try {
    await page.goto('/dashboard/content?type=product-categories')
    await page.getByRole('button', { name: '新增内容' }).first().click()
    await expect(page.getByRole('heading', { name: '新增内容' })).toBeVisible()
    await page.getByLabel('标题', { exact: true }).fill(initialTitle)
    await page.getByLabel('固定链接标识', { exact: true }).fill(slug)
    await page
      .getByLabel('描述', { exact: true })
      .fill('Created through the redesigned Portal editor.')
    const [createResponse] = await Promise.all([
      page.waitForResponse(
        (response) =>
          response.request().method() === 'POST' &&
          response.url().endsWith('/api/portal/content/product-categories'),
      ),
      page.getByRole('button', { name: '保存修改' }).click(),
    ])
    const createBody = (await createResponse.json()) as { result?: { id?: number | string } }
    createdId = createBody.result?.id ?? null

    const createdItem = page.getByRole('button', { name: new RegExp(initialTitle) })
    await expect(createdItem).toBeVisible()
    await createdItem.click()
    await page.getByRole('button', { name: '编辑内容' }).click()
    await expect(page.getByLabel('固定链接标识', { exact: true })).toHaveValue(slug)
    await expect(page.getByLabel('标题', { exact: true })).toHaveValue(initialTitle)
    await page.getByLabel('标题', { exact: true }).fill(updatedTitle)
    await expect(page.getByLabel('标题', { exact: true })).toHaveValue(updatedTitle)
    await page.getByRole('button', { name: '保存修改' }).click()
    await expect(page.getByText('保存成功，列表已刷新。')).toBeVisible()
    await page.getByRole('button', { name: '取消' }).click()

    const updatedItem = page.getByRole('button', { name: new RegExp(updatedTitle) })
    await expect(updatedItem).toBeVisible()
    await updatedItem.click()
    await page.getByRole('button', { name: '编辑内容' }).click()
    await page.getByRole('button', { name: '删除' }).click()
    await page.getByRole('button', { name: '确认永久删除' }).click()
    await expect(page.getByRole('button', { name: new RegExp(updatedTitle) })).toHaveCount(0)
    createdId = null
  } finally {
    if (createdId !== null) {
      const detail = await page.request.get(
        `/api/portal/content/product-categories/${createdId}?locale=en`,
      )
      if (detail.ok()) {
        const body = (await detail.json()) as { record?: { updatedAt?: string } }
        if (body.record?.updatedAt) {
          await page.request.delete(`/api/portal/content/product-categories/${createdId}`, {
            data: { updatedAt: body.record.updatedAt },
            headers: { 'Idempotency-Key': `portal-e2e-content:${crypto.randomUUID()}` },
          })
        }
      }
    }
  }
})
