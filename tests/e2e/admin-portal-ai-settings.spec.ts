import './require-mutation-launch'
import { expect, test, type Page } from '@playwright/test'

const adminEmail = process.env.E2E_ADMIN_EMAIL ?? process.env.SEED_ADMIN_EMAIL
const adminPassword = process.env.E2E_ADMIN_PASSWORD ?? process.env.SEED_ADMIN_PASSWORD

type AiResource = 'profiles' | 'providers' | 'routes'
type CreatedItem = { id: number; resource: AiResource; updatedAt: string }

const login = async (page: Page) => {
  test.skip(
    !adminEmail || !adminPassword,
    'Requires dedicated non-production E2E or local seed administrator credentials.',
  )
  if (!adminEmail || !adminPassword) return false

  await page.goto('/dashboard/login?returnTo=%2Fdashboard%2Fsettings')
  await page.getByRole('textbox', { name: '邮箱' }).fill(adminEmail)
  await page.getByRole('textbox', { name: '密码' }).fill(adminPassword)
  await page.getByRole('button', { name: '登录后台' }).click()
  await expect(page).toHaveURL(/\/dashboard\/settings$/)
  return true
}

const readCreatedItem = async (
  response: { ok(): boolean; text(): Promise<string> },
  resource: AiResource,
  forbiddenValue?: string,
): Promise<CreatedItem> => {
  const rawBody = await response.text()
  expect(response.ok(), rawBody).toBe(true)
  if (forbiddenValue) expect(rawBody).not.toContain(forbiddenValue)
  const body = JSON.parse(rawBody) as { item?: { id?: number; updatedAt?: string } }
  expect(body.item?.id).toBeDefined()
  expect(body.item?.updatedAt).toBeTruthy()
  return {
    id: body.item?.id as number,
    resource,
    updatedAt: body.item?.updatedAt as string,
  }
}

const waitForCreate = (page: Page, resource: AiResource) =>
  page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      response.url().endsWith(`/api/portal/settings/ai/${resource}`),
  )

const deleteCreatedItems = async (page: Page, items: CreatedItem[]) => {
  for (const item of [...items].reverse()) {
    const response = await page.request.delete(
      `/api/portal/settings/ai/${item.resource}/${item.id}`,
      {
        data: { updatedAt: item.updatedAt },
        headers: { 'Idempotency-Key': `portal-ai-e2e:${crypto.randomUUID()}` },
      },
    )
    expect(response.ok(), await response.text()).toBe(true)
  }
}

test('admin configures shared AI providers, models, and routes without exposing the API key', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ height: 960, width: 1440 })
  if (!(await login(page))) return

  const suffix = `${Date.now()}-${testInfo.workerIndex}`
  const apiKey = `portal-e2e-secret-${crypto.randomUUID()}`
  const providerName = `Portal AI Provider ${suffix}`
  const renamedProvider = `${providerName} Updated`
  const textProfileName = `Portal Text ${suffix}`
  const embeddingProfileName = `Portal Embedding ${suffix}`
  const created: CreatedItem[] = []

  try {
    await expect(page.getByRole('heading', { level: 2, name: '基础设置' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'AI 模型配置' })).toBeVisible()
    await expect(page.locator('a[href^="/admin"]')).toHaveCount(0)

    await page.getByRole('button', { name: '新建供应商' }).click()
    const providerForm = page.locator('form').filter({ hasText: '新建供应商' })
    await providerForm.getByLabel('供应商名称').fill(providerName)
    await providerForm.getByLabel('站点 URL').fill('https://api.example.invalid/v1')
    await providerForm.getByLabel('API Key').fill(apiKey)
    const [providerResponse] = await Promise.all([
      waitForCreate(page, 'providers'),
      providerForm.getByRole('button', { name: '保存' }).click(),
    ])
    const provider = await readCreatedItem(providerResponse, 'providers', apiKey)
    created.push(provider)
    await expect(page.getByText(providerName)).toBeVisible()
    await expect(page.getByText('Key 已配置')).toBeVisible()
    await expect(page.locator('body')).not.toContainText(apiKey)

    await page.getByRole('button', { name: '模型', exact: true }).click()
    await page.getByRole('button', { name: '新建模型' }).click()
    const textForm = page.locator('form').filter({ hasText: '新建模型' })
    await textForm.getByLabel('模型名称').fill(textProfileName)
    await textForm.getByLabel('供应商').selectOption({ label: providerName })
    await textForm.getByLabel('能力').selectOption('text')
    await textForm.getByLabel('模型 ID').fill('portal-text-model')
    const [textProfileResponse] = await Promise.all([
      waitForCreate(page, 'profiles'),
      textForm.getByRole('button', { name: '保存' }).click(),
    ])
    created.push(await readCreatedItem(textProfileResponse, 'profiles'))
    await expect(page.getByText(textProfileName)).toBeVisible()

    await page.getByRole('button', { name: '新建模型' }).click()
    const embeddingForm = page.locator('form').filter({ hasText: '新建模型' })
    await embeddingForm.getByLabel('模型名称').fill(embeddingProfileName)
    await embeddingForm.getByLabel('供应商').selectOption({ label: providerName })
    await embeddingForm.getByLabel('能力').selectOption('embedding')
    await embeddingForm.getByLabel('模型 ID').fill('portal-embedding-model')
    await embeddingForm.getByLabel('向量维度').fill('1536')
    const [embeddingProfileResponse] = await Promise.all([
      waitForCreate(page, 'profiles'),
      embeddingForm.getByRole('button', { name: '保存' }).click(),
    ])
    created.push(await readCreatedItem(embeddingProfileResponse, 'profiles'))
    await expect(page.getByText(embeddingProfileName)).toBeVisible()

    await page.getByRole('button', { name: '用途路由' }).click()
    await page.getByRole('button', { name: '新建路由' }).click()
    const textRouteForm = page.locator('form').filter({ hasText: '新建路由' })
    await textRouteForm.getByLabel('用途键').selectOption('chat.reply')
    await textRouteForm
      .getByLabel('模型配置')
      .selectOption({ label: `${textProfileName} · portal-text-model` })
    const [textRouteResponse] = await Promise.all([
      waitForCreate(page, 'routes'),
      textRouteForm.getByRole('button', { name: '保存' }).click(),
    ])
    created.push(await readCreatedItem(textRouteResponse, 'routes'))
    await expect(page.getByText('chat.reply')).toBeVisible()

    await page.getByRole('button', { name: '新建路由' }).click()
    const embeddingRouteForm = page.locator('form').filter({ hasText: '新建路由' })
    await embeddingRouteForm.getByLabel('用途键').selectOption('knowledge.embedding')
    await embeddingRouteForm
      .getByLabel('模型配置')
      .selectOption({ label: `${embeddingProfileName} · portal-embedding-model` })
    const [embeddingRouteResponse] = await Promise.all([
      waitForCreate(page, 'routes'),
      embeddingRouteForm.getByRole('button', { name: '保存' }).click(),
    ])
    created.push(await readCreatedItem(embeddingRouteResponse, 'routes'))
    await expect(page.getByText('knowledge.embedding')).toBeVisible()

    await page.getByRole('button', { name: '新建路由' }).click()
    const translationRouteForm = page.locator('form').filter({ hasText: '新建路由' })
    await translationRouteForm.getByLabel('用途键').selectOption('knowledge.translation')
    await translationRouteForm
      .getByLabel('模型配置')
      .selectOption({ label: `${textProfileName} · portal-text-model` })
    const [translationRouteResponse] = await Promise.all([
      waitForCreate(page, 'routes'),
      translationRouteForm.getByRole('button', { name: '保存' }).click(),
    ])
    created.push(await readCreatedItem(translationRouteResponse, 'routes'))
    await expect(page.getByText('knowledge.translation')).toBeVisible()

    for (const label of ['AI 客服', '内容工作台', '知识索引', '知识翻译']) {
      await expect(
        page.locator('.portal-ai-settings__readiness article').filter({ hasText: label }),
      ).toContainText('已启用')
    }

    await page.getByRole('button', { name: '供应商', exact: true }).click()
    const providerRow = page
      .locator('.portal-ai-settings__list article')
      .filter({ hasText: providerName })
    await providerRow.getByRole('button', { name: '编辑' }).click()
    const editProviderForm = page.locator('form').filter({ hasText: '编辑' })
    await expect(editProviderForm.getByLabel('API Key')).toHaveValue('')
    await editProviderForm.getByLabel('供应商名称').fill(renamedProvider)
    const [updateResponse] = await Promise.all([
      page.waitForResponse(
        (response) =>
          response.request().method() === 'PATCH' &&
          response.url().endsWith(`/api/portal/settings/ai/providers/${provider.id}`),
      ),
      editProviderForm.getByRole('button', { name: '保存' }).click(),
    ])
    const updatedProvider = await readCreatedItem(updateResponse, 'providers', apiKey)
    created[0] = updatedProvider
    await expect(page.getByText(renamedProvider)).toBeVisible()
    await expect(page.getByText('Key 已配置')).toBeVisible()
    await expect(page.locator('body')).not.toContainText(apiKey)

    const safeSummary = await page.request.get('/api/portal/settings/ai')
    const safeSummaryBody = await safeSummary.text()
    expect(safeSummary.ok(), safeSummaryBody).toBe(true)
    expect(safeSummaryBody).not.toContain(apiKey)
    expect(safeSummaryBody).not.toContain('v1:')
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      1440,
    )

    await page.screenshot({
      fullPage: true,
      path: testInfo.outputPath('portal-ai-settings-desktop.png'),
    })
  } finally {
    await deleteCreatedItems(page, created)
  }
})

test('mobile AI configuration remains readable without horizontal overflow', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ height: 844, width: 390 })
  if (!(await login(page))) return

  await expect(page.getByRole('heading', { level: 2, name: '基础设置' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'AI 模型配置' })).toBeVisible()
  await expect(page.locator('.portal-ai-settings__workspace')).toBeVisible()
  await expect(page.locator('.portal-ai-settings__readiness article')).toHaveCount(4)
  await expect(page.locator('a[href^="/admin"]')).toHaveCount(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)

  await page.screenshot({
    fullPage: true,
    path: testInfo.outputPath('portal-ai-settings-mobile.png'),
  })
})
