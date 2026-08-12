import { expect, test, type Page } from '@playwright/test'

const adminEmail = process.env.E2E_ADMIN_EMAIL ?? process.env.SEED_ADMIN_EMAIL
const adminPassword = process.env.E2E_ADMIN_PASSWORD ?? process.env.SEED_ADMIN_PASSWORD

const login = async (page: Page) => {
  test.skip(!adminEmail || !adminPassword, 'Requires local non-production administrator credentials.')
  if (!adminEmail || !adminPassword) return false
  await page.goto('/dashboard/login?returnTo=%2Fdashboard%2Fleads')
  await page.getByRole('textbox', { name: '邮箱' }).fill(adminEmail)
  await page.getByRole('textbox', { name: '密码' }).fill(adminPassword)
  await page.getByRole('button', { name: '登录后台' }).click()
  await expect(page).toHaveURL(/\/dashboard\/leads$/)
  return true
}

const createSource = async (page: Page, key: string) => {
  const response = await page.request.post('/api/lead-sources', {
    data: { channel: 'manual', description: 'Temporary Portal E2E source', isActive: true, key, name: `Portal E2E ${key}` },
  })
  const raw = await response.text()
  expect(response.ok(), raw).toBe(true)
  const body = JSON.parse(raw) as { doc?: { id?: number | string }; id?: number | string }
  const id = body.doc?.id ?? body.id
  expect(id).toBeDefined()
  return id as number | string
}

test('lead workspace creates, edits, and deletes an ACL-aware Portal lead', async ({ page }, testInfo) => {
  await page.setViewportSize({ height: 940, width: 1440 })
  if (!(await login(page))) return
  const suffix = `${Date.now()}-${testInfo.workerIndex}`
  const sourceID = await createSource(page, `portal-e2e-${suffix}`)
  let leadID: number | string | null = null
  let leadUpdatedAt: string | null = null
  const name = `Portal Lead ${suffix}`
  try {
    await page.goto('/dashboard/leads')
    await expect(page.getByRole('heading', { level: 2, name: '线索管理' })).toBeVisible()
    await expect(page.locator('.portal-page__eyebrow')).toHaveCount(0)
    await expect(page.locator('.portal-header__heading')).toBeVisible()
    await page.getByRole('button', { name: '新增线索' }).click()
    await page.getByLabel('联系人').fill(name)
    await page.getByLabel('邮箱').fill(`portal-lead-${suffix}@example.invalid`)
    await page.getByLabel('国家 / 地区').fill('United Arab Emirates')
    await page.getByLabel('关注产品 / 需求').fill('Aluminum facade panels')
    await page.getByLabel('需求说明').fill('Portal E2E lead needs tender specification.')
    await page.getByLabel('来源').selectOption(String(sourceID))
    const [createResponse] = await Promise.all([
      page.waitForResponse((response) => response.request().method() === 'POST' && response.url().endsWith('/api/portal/leads')),
      page.getByRole('button', { name: '创建线索' }).click(),
    ])
    const createBody = await createResponse.json() as { result?: { id?: number | string; updatedAt?: string } }
    leadID = createBody.result?.id ?? null
    leadUpdatedAt = createBody.result?.updatedAt ?? null
    await expect(page.getByRole('heading', { name })).toBeVisible()
    await page.getByRole('button', { name: '编辑线索' }).click()
    const editor = page.locator('.portal-leads-editor')
    await expect(editor).toBeVisible()
    await editor.getByLabel('状态').selectOption('contacted')
    await expect(editor.getByRole('button', { name: '保存修改' })).toBeEnabled()
    const [updateResponse] = await Promise.all([
      page.waitForResponse((response) => response.request().method() === 'PATCH' && leadID !== null && response.url().endsWith(`/api/portal/leads/${leadID}`)),
      editor.getByRole('button', { name: '保存修改' }).click(),
    ])
    const updateBody = await updateResponse.json() as { result?: { updatedAt?: string } }
    leadUpdatedAt = updateBody.result?.updatedAt ?? leadUpdatedAt
    await expect(page.getByText('线索已保存。')).toBeVisible()
    await page.getByRole('button', { name: '编辑线索' }).click()
    await expect(editor).toBeVisible()
    await editor.getByRole('button', { name: '删除' }).click()
    await Promise.all([
      page.waitForResponse((response) => response.request().method() === 'DELETE' && leadID !== null && response.url().endsWith(`/api/portal/leads/${leadID}`)),
      editor.getByRole('button', { name: '确认永久删除' }).click(),
    ])
    await expect(page.getByRole('heading', { name })).toHaveCount(0)
    leadID = null
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1440)
    await page.screenshot({ fullPage: true, path: testInfo.outputPath('portal-leads-desktop.png') })
  } finally {
    if (leadID && leadUpdatedAt) await page.request.delete(`/api/portal/leads/${leadID}`, { data: { updatedAt: leadUpdatedAt }, headers: { 'Idempotency-Key': `portal-e2e-leads:${crypto.randomUUID()}` }, timeout: 5_000 }).catch(() => undefined)
    await page.request.delete(`/api/lead-sources/${sourceID}`, { timeout: 5_000 }).catch(() => undefined)
  }
})

test('mobile lead workspace stays within 390px', async ({ page }, testInfo) => {
  await page.setViewportSize({ height: 844, width: 390 })
  if (!(await login(page))) return
  await page.goto('/dashboard/leads')
  await expect(page.getByRole('heading', { level: 2, name: '线索管理' })).toBeVisible()
  await expect(page.locator('.portal-leads__workspace')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  await page.screenshot({ fullPage: true, path: testInfo.outputPath('portal-leads-mobile.png') })
})
