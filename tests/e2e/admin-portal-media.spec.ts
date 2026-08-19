import './require-mutation-launch'
import { expect, test } from '@playwright/test'

const adminEmail = process.env.E2E_ADMIN_EMAIL ?? process.env.SEED_ADMIN_EMAIL
const adminPassword = process.env.E2E_ADMIN_PASSWORD ?? process.env.SEED_ADMIN_PASSWORD

const login = async (page: import('@playwright/test').Page) => {
  test.skip(
    !adminEmail || !adminPassword,
    'Requires dedicated non-production E2E or local seed administrator credentials.',
  )
  if (!adminEmail || !adminPassword) return

  await page.goto('/dashboard/login?returnTo=%2Fdashboard%2Fmedia')
  await page.getByRole('textbox', { name: '邮箱' }).fill(adminEmail)
  await page.getByRole('textbox', { name: '密码' }).fill(adminPassword)
  await page.getByRole('button', { name: '登录后台' }).click()
  await expect(page).toHaveURL(/\/dashboard\/media$/)
}

test('media workspace filters safe assets and exposes grid/list detail views', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ height: 900, width: 1440 })
  await login(page)
  if (!adminEmail || !adminPassword) return

  await expect(page.getByRole('heading', { level: 2, name: '媒体素材' })).toBeVisible()
  await expect(page.locator('.portal-media__asset')).not.toHaveCount(0)
  await expect(page.getByRole('button', { name: '上传素材' })).toBeEnabled()
  await expect(page.locator('a[href^="/admin"]')).toHaveCount(0)

  await page.getByLabel('类型').selectOption('pdf')
  await page.getByRole('button', { name: '筛选' }).click()
  await expect(page).toHaveURL(/kind=pdf/)
  await expect(page.locator('.portal-media__asset')).not.toHaveCount(0)
  await expect(
    page.locator('.portal-media__asset').getByText('PDF', { exact: true }).first(),
  ).toBeVisible()

  await page.getByRole('link', { name: '列表视图' }).click()
  await expect(page).toHaveURL(/view=list/)
  await expect(page.locator('.portal-media__library')).toHaveClass(/is-list/)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1440)

  await page.screenshot({
    fullPage: true,
    path: testInfo.outputPath('portal-media-desktop.png'),
  })
})

test('mobile media workspace keeps filters, cards, and detail within the viewport', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ height: 844, width: 390 })
  await login(page)
  if (!adminEmail || !adminPassword) return

  await expect(page.getByRole('heading', { level: 2, name: '媒体素材' })).toBeVisible()
  await expect(page.getByRole('searchbox', { name: '搜索素材' })).toBeVisible()
  await expect(page.locator('.portal-media__workspace')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)

  await page.screenshot({
    fullPage: true,
    path: testInfo.outputPath('portal-media-mobile.png'),
  })
})

test('media editor completes upload, metadata update, and safe delete in the Portal', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ height: 960, width: 1440 })
  await login(page)
  if (!adminEmail || !adminPassword) return

  const suffix = `${Date.now()}-${testInfo.workerIndex}`
  const filename = `portal-e2e-media-${suffix}.png`
  const initialAlt = `Portal E2E media ${suffix}`
  const updatedAlt = `${initialAlt} updated`
  let created: null | { id: number | string; updatedAt: string } = null

  try {
    await page.getByRole('button', { name: '上传素材' }).click()
    await expect(page.getByRole('heading', { name: '上传素材' })).toBeVisible()
    await page.getByLabel('文件').setInputFiles({
      buffer: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
        'base64',
      ),
      mimeType: 'image/png',
      name: filename,
    })
    await page.getByLabel('替代文本 alt').fill(initialAlt)
    await page.getByLabel('版权 / 来源').fill('IVYBM generated local E2E fixture')
    await page.getByLabel('允许公开读取').check()
    const [uploadResponse] = await Promise.all([
      page.waitForResponse(
        (response) =>
          response.request().method() === 'POST' && response.url().endsWith('/api/portal/media'),
      ),
      page.getByRole('button', { name: '上传素材' }).last().click(),
    ])
    const uploadBody = (await uploadResponse.json()) as {
      result?: { filename?: string; id?: number | string; updatedAt?: string }
    }
    if (uploadBody.result?.id !== undefined && uploadBody.result.updatedAt) {
      created = { id: uploadBody.result.id, updatedAt: uploadBody.result.updatedAt }
    }
    const savedFilename = uploadBody.result?.filename ?? filename

    const asset = page.getByRole('button', { name: `选择素材: ${savedFilename}` })
    await expect(asset).toBeVisible()
    await asset.click()
    await page.getByRole('button', { name: '编辑元数据' }).click()
    await expect(page.getByLabel('替代文本 alt')).toHaveValue(initialAlt)
    await page.getByLabel('替代文本 alt').fill(updatedAlt)
    const [updateResponse] = await Promise.all([
      page.waitForResponse(
        (response) =>
          response.request().method() === 'PATCH' &&
          created !== null &&
          response.url().endsWith(`/api/portal/media/${created.id}`),
      ),
      page.getByRole('button', { name: '保存元数据' }).click(),
    ])
    const updateBody = (await updateResponse.json()) as { result?: { updatedAt?: string } }
    if (created && updateBody.result?.updatedAt) created.updatedAt = updateBody.result.updatedAt
    await expect(page.getByText('素材元数据已保存。')).toBeVisible()
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.screenshot({
      fullPage: true,
      path: testInfo.outputPath('portal-media-editor-desktop.png'),
    })

    await page.getByRole('button', { name: '删除' }).click()
    await page.getByRole('button', { name: '确认永久删除' }).click()
    await expect(page.getByRole('button', { name: `选择素材: ${savedFilename}` })).toHaveCount(0)
    created = null
  } finally {
    if (created) {
      await page.request.delete(`/api/portal/media/${created.id}`, {
        data: { updatedAt: created.updatedAt },
        headers: { 'Idempotency-Key': `portal-e2e-media:${crypto.randomUUID()}` },
      })
    }
  }
})
