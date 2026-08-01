import { expect, test, type Page } from '@playwright/test'
import { getPayload } from 'payload'

import config from '@/payload.config'

const adminEmail = process.env.E2E_ADMIN_EMAIL ?? process.env.SEED_ADMIN_EMAIL
const adminPassword = process.env.E2E_ADMIN_PASSWORD ?? process.env.SEED_ADMIN_PASSWORD

const login = async (page: Page) => {
  test.skip(
    !adminEmail || !adminPassword,
    'Requires local non-production administrator credentials.',
  )
  if (!adminEmail || !adminPassword) return false

  await page.goto('/dashboard/login?returnTo=%2Fdashboard%2Fcontent-studio')
  await page.getByRole('textbox', { name: '邮箱' }).fill(adminEmail)
  await page.getByRole('textbox', { name: '密码' }).fill(adminPassword)
  await page.getByRole('button', { name: '登录后台' }).click()
  await expect(page).toHaveURL(/\/dashboard\/content-studio$/)
  return true
}

const createReviewedSource = async (suffix: string) => {
  const sourceURL = `https://example.invalid/portal-content-studio/${suffix}`
  const payload = await getPayload({
    config,
    disableOnInit: true,
    key: `portal-content-studio-e2e-${suffix}`,
  })
  try {
    const document = await payload.create({
      collection: 'knowledge-documents',
      data: {
        content: 'Anodized aluminum is available for controlled facade specifications.',
        customerVisible: false,
        indexStatus: 'pending',
        locale: 'en',
        reviewStatus: 'reviewed',
        sourceTitle: `Portal Content Studio source ${suffix}`,
        sourceType: 'technical-specification',
        sourceURL,
        sourceVersion: '1.0',
      },
      overrideAccess: true,
    })
    await payload.update({
      collection: 'knowledge-documents',
      data: {
        embeddingModel: 'portal-e2e-embedding',
        embeddingSpace: 'portal-e2e-space',
        indexStatus: 'ready',
        indexedAt: new Date().toISOString(),
      },
      id: document.id,
      overrideAccess: true,
    })
  } finally {
    await payload.destroy()
  }
  return sourceURL
}

test('Content Studio creates, edits, reviews, and schedules a draft through Portal commands', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ height: 960, width: 1440 })
  if (!(await login(page))) return

  const hydrationErrors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error' && /hydration/i.test(message.text())) {
      hydrationErrors.push(message.text())
    }
  })

  const suffix = `${Date.now()}-${testInfo.workerIndex}`
  const sourceURL = await createReviewedSource(suffix)
  await page.reload()
  const title = `Portal Content Studio ${suffix}`
  const updatedTitle = `${title} Updated`
  let contentID: number | string | null = null
  let updatedAt: string | null = null

  try {
    await page.getByRole('button', { name: '新建草稿' }).click()
    const editor = page.locator('.portal-content-studio__form').first()
    await expect(editor.getByRole('heading', { name: '新建草稿' })).toBeVisible()
    await editor.getByLabel('工作标题').fill(title)
    await editor.getByLabel('平台').selectOption('linkedin')
    await editor.getByLabel('语言').selectOption('en')
    await editor.getByLabel('内容格式').selectOption('post')
    await editor.getByLabel('文案内容').fill('Initial Portal content studio draft.')
    const knowledgeOption = editor
      .locator('.portal-content-studio__multi-options')
      .nth(1)
      .getByRole('checkbox')
      .first()
    await expect(knowledgeOption).toBeVisible()
    await knowledgeOption.check()
    await editor.getByRole('button', { name: '添加事实' }).click()
    await editor
      .getByPlaceholder('事实主张')
      .fill('Anodized aluminum is available for project facades.')
    await editor.getByRole('combobox', { name: '来源' }).selectOption(sourceURL)

    const [createResponse] = await Promise.all([
      page.waitForResponse(
        (response) =>
          response.request().method() === 'POST' &&
          response.url().endsWith('/api/portal/content-studio'),
      ),
      editor.getByRole('button', { name: '创建草稿' }).click(),
    ])
    const createBody = (await createResponse.json()) as {
      content?: { id?: number | string; updatedAt?: string }
    }
    contentID = createBody.content?.id ?? null
    updatedAt = createBody.content?.updatedAt ?? null
    await expect(page.getByText('AI 内容工作台已更新。')).toBeVisible()

    const item = page.getByRole('button', { name: new RegExp(title) })
    await expect(item).toBeVisible()
    await item.click()
    await page.getByRole('button', { name: '编辑' }).click()
    await expect(editor.getByLabel('工作标题')).toHaveValue(title)
    await editor.getByLabel('工作标题').fill(updatedTitle)
    const [updateResponse] = await Promise.all([
      page.waitForResponse(
        (response) =>
          response.request().method() === 'PATCH' &&
          contentID !== null &&
          response.url().endsWith(`/api/portal/content-studio/${contentID}`),
      ),
      editor.getByRole('button', { name: '保存草稿' }).click(),
    ])
    const updateBody = (await updateResponse.json()) as { content?: { updatedAt?: string } }
    updatedAt = updateBody.content?.updatedAt ?? updatedAt
    await expect(page.getByText('AI 内容工作台已更新。')).toBeVisible()

    await page.getByRole('button', { name: '提交审核' }).click()
    await expect(page.getByText('已提交审核')).toBeVisible()
    const reviewButton = page.getByRole('button', { exact: true, name: '审核' })
    await expect(reviewButton).toBeEnabled()
    await reviewButton.click()
    await page.getByLabel('事实可追溯').check()
    await page.getByLabel('技术表述已核对').check()
    await page.getByLabel('未作价格、交期、MOQ、认证或付款承诺').check()
    await page.getByLabel('平台格式已核对').check()
    await page.getByLabel('阿语已校对或不适用').check()
    await page.getByRole('button', { exact: true, name: '批准' }).click()
    await expect(page.getByText('审核结果已保存')).toBeVisible()
    await expect(page.getByRole('button', { name: '创建内部排期' })).toBeVisible()

    await page.getByRole('button', { name: '创建内部排期' }).click()
    const schedule = page.locator('.portal-content-studio__form').first()
    await schedule.getByLabel('计划时间').fill('2026-08-01T10:30')
    await schedule.getByRole('button', { name: '创建内部排期' }).click()
    await expect(page.getByText('已创建内部排期')).toBeVisible()
    expect(hydrationErrors).toEqual([])

    await expect(page.getByRole('button', { name: '删除' })).toHaveCount(0)
    contentID = null
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      1440,
    )
    await page.screenshot({
      fullPage: true,
      path: testInfo.outputPath('portal-content-studio-desktop.png'),
    })
  } finally {
    if (contentID !== null) {
      const document = await page.request
        .get(`/api/generated-contents/${contentID}`)
        .catch(() => null)
      const body = document?.ok()
        ? ((await document.json()) as { doc?: { updatedAt?: string }; updatedAt?: string })
        : null
      const currentUpdatedAt = body?.doc?.updatedAt ?? body?.updatedAt ?? updatedAt
      if (currentUpdatedAt) {
        await page.request
          .delete(`/api/portal/content-studio/${contentID}`, {
            data: { updatedAt: currentUpdatedAt },
          })
          .catch(() => undefined)
      }
    }
  }
})

test('Content Studio deletes an unreviewed draft through the Portal command', async ({
  page,
}, testInfo) => {
  if (!(await login(page))) return

  const title = `Portal disposable draft ${Date.now()}-${testInfo.workerIndex}`
  let contentID: number | string | null = null
  let updatedAt: string | null = null

  try {
    await page.getByRole('button', { name: '新建草稿' }).click()
    const editor = page.locator('.portal-content-studio__form').first()
    await editor.getByLabel('工作标题').fill(title)
    await editor.getByLabel('文案内容').fill('Disposable draft for the Portal delete flow.')

    const [createResponse] = await Promise.all([
      page.waitForResponse(
        (response) =>
          response.request().method() === 'POST' &&
          response.url().endsWith('/api/portal/content-studio'),
      ),
      editor.getByRole('button', { name: '创建草稿' }).click(),
    ])
    const createBody = (await createResponse.json()) as {
      content?: { id?: number | string; updatedAt?: string }
    }
    contentID = createBody.content?.id ?? null
    updatedAt = createBody.content?.updatedAt ?? null

    await expect(page.getByRole('button', { name: new RegExp(title) })).toBeVisible()
    await page.getByRole('button', { name: '删除' }).click()
    await page.getByRole('button', { name: '删除此草稿及其内部发布记录？' }).click()
    await expect(page.getByRole('button', { name: new RegExp(title) })).toHaveCount(0)
    contentID = null
  } finally {
    if (contentID !== null && updatedAt) {
      await page.request
        .delete(`/api/portal/content-studio/${contentID}`, { data: { updatedAt } })
        .catch(() => undefined)
    }
  }
})

test('mobile Content Studio keeps the workspace within 390px', async ({ page }, testInfo) => {
  await page.setViewportSize({ height: 844, width: 390 })
  if (!(await login(page))) return

  await page.goto('/dashboard/content-studio')
  await expect(page.getByRole('heading', { level: 2, name: 'AI 内容工作台' })).toBeVisible()
  await expect(page.locator('.portal-content-studio__workspace')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  await page.screenshot({
    fullPage: true,
    path: testInfo.outputPath('portal-content-studio-mobile.png'),
  })
})
