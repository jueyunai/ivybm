import { expect, test } from '@playwright/test'

const adminEmail = process.env.E2E_ADMIN_EMAIL ?? process.env.SEED_ADMIN_EMAIL
const adminPassword = process.env.E2E_ADMIN_PASSWORD ?? process.env.SEED_ADMIN_PASSWORD

type CreatedDocument = { id: number | string; title: string }

const login = async (page: import('@playwright/test').Page) => {
  test.skip(
    !adminEmail || !adminPassword,
    'Requires dedicated non-production E2E or local seed administrator credentials.',
  )
  if (!adminEmail || !adminPassword) return false

  await page.goto('/dashboard/login?returnTo=%2Fdashboard%2Fknowledge')
  await page.getByRole('textbox', { name: '邮箱' }).fill(adminEmail)
  await page.getByRole('textbox', { name: '密码' }).fill(adminPassword)
  await page.getByRole('button', { name: '登录后台' }).click()
  await expect(page).toHaveURL(/\/dashboard\/knowledge$/)
  return true
}

const createDocument = async (
  page: import('@playwright/test').Page,
  title: string,
  reviewStatus: 'draft' | 'reviewed',
): Promise<CreatedDocument> => {
  const response = await page.request.post('/api/knowledge-documents', {
    data: {
      content: `Private E2E content for ${title}`,
      customerVisible: reviewStatus === 'reviewed',
      indexStatus: 'pending',
      locale: 'en',
      reviewStatus,
      sourceTitle: title,
      sourceType: 'product-manual',
      sourceVersion: '1.0',
    },
  })
  const rawBody = await response.text()
  expect(response.ok(), rawBody).toBe(true)
  const body = JSON.parse(rawBody) as {
    doc?: { id?: number | string }
    id?: number | string
  }
  const id = body.doc?.id ?? body.id
  expect(id).toBeDefined()
  return { id: id as number | string, title }
}

const removeDocuments = async (
  page: import('@playwright/test').Page,
  documents: CreatedDocument[],
) => {
  for (const document of documents) {
    const response = await page.request.delete(`/api/knowledge-documents/${document.id}`)
    expect(response.ok(), `Failed to remove knowledge fixture ${document.id}`).toBe(true)
  }
}

const createFixtures = async (page: import('@playwright/test').Page) => {
  const suffix = crypto.randomUUID()
  return [
    await createDocument(page, `Portal E2E Reviewed ${suffix}`, 'reviewed'),
    await createDocument(page, `Portal E2E Draft ${suffix}`, 'draft'),
  ]
}

test('knowledge workspace shows review/index truth and submits an idempotent index command', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ height: 900, width: 1440 })
  if (!(await login(page))) return

  const documents = await createFixtures(page)
  const [reviewed, draft] = documents

  try {
    await page.goto('/dashboard/knowledge')
    await expect(page.getByRole('heading', { level: 2, name: '知识文档' })).toBeVisible()
    await expect(page.getByLabel('知识库状态指标').locator('article')).toHaveCount(4)
    await expect(page.getByRole('region', { name: '知识文档双状态列表' })).toBeVisible()

    const reviewedRow = page.locator('tr').filter({ hasText: reviewed.title })
    await expect(reviewedRow).toContainText('审核通过')
    await expect(reviewedRow).toContainText('等待索引')

    const draftRow = page.locator('tr').filter({ hasText: draft.title })
    await expect(draftRow).toContainText('待审核')
    await expect(draftRow).toContainText('等待索引')
    await expect(page.getByRole('button', { name: '新增文档' })).toBeEnabled()
    await expect(page.locator('a[href^="/admin"]')).toHaveCount(0)

    await reviewedRow.getByRole('button').click()
    await page.route('**/api/portal/knowledge/documents/*/index', async (route) => {
      await route.fulfill({
        contentType: 'application/json',
        json: { jobId: 71, state: 'created', status: 'pending' },
        status: 202,
      })
    })
    await page.getByRole('button', { name: '开始索引' }).click()
    await expect(page.locator('.portal-knowledge__feedback[role="status"]')).toContainText(
      '索引任务已进入队列',
    )
    await page.unroute('**/api/portal/knowledge/documents/*/index')

    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      1440,
    )
    await page.screenshot({
      fullPage: true,
      path: testInfo.outputPath('portal-knowledge-desktop.png'),
    })
  } finally {
    await removeDocuments(page, documents)
  }
})

test('mobile knowledge workspace keeps filters and dual-state content within the viewport', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ height: 844, width: 390 })
  if (!(await login(page))) return

  const documents = await createFixtures(page)

  try {
    await page.goto('/dashboard/knowledge')
    await expect(page.getByRole('heading', { level: 2, name: '知识文档' })).toBeVisible()
    await expect(page.getByRole('searchbox', { name: '搜索文档' })).toBeVisible()
    await expect(page.locator('.portal-knowledge__workspace')).toBeVisible()
    await expect(page.locator('tr').filter({ hasText: documents[0].title })).toBeVisible()
    await expect(page.locator('tr').filter({ hasText: documents[1].title })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)

    await page.screenshot({
      fullPage: true,
      path: testInfo.outputPath('portal-knowledge-mobile.png'),
    })
  } finally {
    await removeDocuments(page, documents)
  }
})

test('knowledge editor completes draft, review, AI debug, and delete in the Portal', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ height: 960, width: 1440 })
  if (!(await login(page))) return

  const suffix = `${Date.now()}-${testInfo.workerIndex}`
  const title = `Portal Knowledge CRUD ${suffix}`
  let created: null | { id: number | string; updatedAt: string } = null

  try {
    await page.getByRole('button', { name: '新增文档' }).click()
    await expect(page.getByRole('heading', { name: '新增文档' })).toBeVisible()
    const editor = page.locator('.portal-knowledge-editor')
    await editor.getByLabel('来源标题').fill(title)
    await editor.getByLabel('来源类型').selectOption('faq')
    await editor.getByLabel('语言').selectOption('en')
    await editor.getByLabel('来源版本').fill('1.0')
    await editor.getByLabel('来源 URL').fill('https://docs.example.invalid/e2e')
    await editor.getByLabel('知识正文').fill('Initial Portal knowledge content.')
    await editor.getByLabel('审核且索引完成后允许客户使用').check()
    const [createResponse] = await Promise.all([
      page.waitForResponse(
        (response) =>
          response.request().method() === 'POST' &&
          response.url().endsWith('/api/portal/knowledge/documents'),
      ),
      editor.getByRole('button', { name: '保存草稿' }).click(),
    ])
    const createBody = (await createResponse.json()) as {
      result?: { id?: number | string; updatedAt?: string }
    }
    if (createBody.result?.id !== undefined && createBody.result.updatedAt) {
      created = { id: createBody.result.id, updatedAt: createBody.result.updatedAt }
    }

    const rowButton = page.getByRole('button', { name: new RegExp(title) })
    await expect(rowButton).toBeVisible()
    await rowButton.click()
    await page.getByRole('button', { name: '编辑文档' }).click()
    await expect(editor.getByLabel('来源标题')).toHaveValue(title)
    await editor.getByLabel('来源版本').fill('1.1')
    await editor.getByLabel('知识正文').fill('Updated Portal knowledge content.')
    const [saveResponse] = await Promise.all([
      page.waitForResponse(
        (response) =>
          response.request().method() === 'PATCH' &&
          created !== null &&
          response.url().endsWith(`/api/portal/knowledge/documents/${created.id}`),
      ),
      editor.getByRole('button', { name: '保存草稿' }).click(),
    ])
    const saveBody = (await saveResponse.json()) as { result?: { updatedAt?: string } }
    if (created && saveBody.result?.updatedAt) created.updatedAt = saveBody.result.updatedAt
    await expect(page.getByText('文档已保存，并回到待审核 / 待索引。')).toBeVisible()

    const [reviewResponse] = await Promise.all([
      page.waitForResponse(
        (response) =>
          response.request().method() === 'PATCH' &&
          created !== null &&
          response.url().endsWith(`/api/portal/knowledge/documents/${created.id}`),
      ),
      editor.getByRole('button', { name: '审核通过' }).click(),
    ])
    const reviewBody = (await reviewResponse.json()) as { result?: { updatedAt?: string } }
    if (created && reviewBody.result?.updatedAt) created.updatedAt = reviewBody.result.updatedAt
    await expect(page.getByText('审核状态已更新，可以提交索引。')).toBeVisible()
    await editor.getByRole('button', { name: '取消' }).click()
    await expect(page.locator('tr').filter({ hasText: title })).toContainText('审核通过')

    await page.route('**/api/portal/knowledge/ai-debug', async (route) => {
      await route.fulfill({
        contentType: 'application/json',
        json: {
          result: {
            durationMs: 12,
            text: 'Safe local debug result',
            usage: { inputTokens: 4, outputTokens: 3, totalTokens: 7 },
          },
        },
        status: 200,
      })
    })
    await page.getByLabel('调试输入').fill('Use reviewed knowledge only')
    await page.getByRole('button', { name: '运行调试' }).click()
    await expect(page.getByText('Safe local debug result', { exact: false })).toBeVisible()
    await page.unroute('**/api/portal/knowledge/ai-debug')

    await rowButton.click()
    await page.getByRole('button', { name: '编辑文档' }).click()
    await editor.getByRole('button', { name: '保存草稿' }).click()
    await expect(page.getByText('文档已保存，并回到待审核 / 待索引。')).toBeVisible()
    await editor.getByRole('button', { name: '取消' }).click()
    await rowButton.click()
    await page.getByRole('button', { name: '编辑文档' }).click()
    await editor.getByRole('button', { name: '删除' }).click()
    await editor.getByRole('button', { name: '确认永久删除' }).click()
    await expect(page.locator('tr').filter({ hasText: title })).toHaveCount(0)
    created = null

    await page.evaluate(() => window.scrollTo(0, 0))
    await page.screenshot({
      fullPage: true,
      path: testInfo.outputPath('portal-knowledge-crud-desktop.png'),
    })
  } finally {
    if (created) {
      await page.request.delete(`/api/portal/knowledge/documents/${created.id}`, {
        data: { updatedAt: created.updatedAt },
      })
    }
  }
})
