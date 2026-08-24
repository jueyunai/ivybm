import './require-mutation-launch'

import { randomUUID } from 'node:crypto'

import { expect, test, type Page, type Response } from '@playwright/test'

import { FacebookE2EHarness, type FacebookPublishingFixture } from './admin-portal-facebook.support'

const adminEmail = process.env.E2E_ADMIN_EMAIL ?? process.env.SEED_ADMIN_EMAIL
const adminPassword = process.env.E2E_ADMIN_PASSWORD ?? process.env.SEED_ADMIN_PASSWORD

const login = async (page: Page): Promise<boolean> => {
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

test.describe.serial('FB-PUB-01 Facebook Page publication closure', () => {
  let harness: FacebookE2EHarness | undefined
  let fixture: FacebookPublishingFixture | undefined

  test.beforeEach(async () => {
    harness = await FacebookE2EHarness.create()
    await harness.createFacebookPublishingAccount()
    fixture = await harness.createFacebookPublishingFixture()
  })

  test.afterEach(async () => {
    await harness?.cleanup()
    harness = undefined
    fixture = undefined
  })

  test('Portal approval and one-click publish reaches fake Meta and returns a durable result', async ({
    page,
  }) => {
    test.setTimeout(180_000)
    if (!harness || !fixture) throw new Error('Facebook publishing E2E harness is unavailable')
    if (!(await login(page))) return
    await page.goto('/dashboard/content-studio')

    const suffix = randomUUID().replaceAll('-', '').slice(0, 12)
    const title = `E2E Facebook publish ${suffix}`
    await page.getByRole('button', { name: '新建草稿' }).click()
    const editor = page.locator('.portal-content-studio__form').first()
    await editor.getByLabel('草稿标题').fill(title)
    await editor.getByLabel('平台').selectOption('facebook')
    await editor.getByLabel('语言').selectOption('en')
    await editor.getByLabel('内容格式').selectOption('post')
    await editor
      .getByLabel('文案内容')
      .fill('Controlled Facebook Page publication from the Portal E2E checkpoint.')
    await editor.getByRole('checkbox', { name: fixture.mediaLabel }).check()
    await editor
      .locator('.portal-content-studio__multi-options')
      .nth(1)
      .getByRole('checkbox')
      .first()
      .check()
    await editor.getByRole('button', { name: '添加事实' }).click()
    await editor
      .getByPlaceholder('关键事实 / 论据')
      .fill('Controlled facade publication is available.')
    await editor.getByRole('combobox', { name: '来源' }).selectOption(fixture.knowledgeSourceURL)

    const [createResponse] = await Promise.all([
      page.waitForResponse(
        (response: Response) =>
          response.request().method() === 'POST' &&
          response.url().endsWith('/api/portal/content-studio'),
      ),
      editor.getByRole('button', { name: '创建草稿' }).click(),
    ])
    const createBody = (await createResponse.json()) as {
      content?: { id?: number | string }
    }
    const contentID = Number(createBody.content?.id)
    if (!Number.isSafeInteger(contentID) || contentID < 1) {
      throw new Error('Content Studio did not return a generated content ID')
    }
    harness.trackContent(contentID)
    await expect(page.getByText('AI 内容工作台已更新。')).toBeVisible()

    await page.getByRole('button', { name: new RegExp(title) }).click()
    await page.getByRole('button', { name: '提交审核' }).click()
    await expect(page.getByText('已提交审核')).toBeVisible()
    await page.getByRole('button', { exact: true, name: '审核' }).click()
    await page.getByLabel('事实可追溯').check()
    await page.getByLabel('技术表述已核对').check()
    await page.getByLabel('未作价格、交期、起订量 (MOQ)、认证或付款承诺').check()
    await page.getByLabel('平台格式已核对').check()
    await page.getByLabel('阿语已校对或不适用').check()
    await page.getByRole('button', { exact: true, name: '批准' }).click()
    await expect(page.getByText('审核结果已保存')).toBeVisible()
    await expect(page.getByRole('button', { name: '立即发布' })).toBeVisible()

    await page.getByRole('button', { name: '立即发布' }).click()
    const publishEditor = page
      .locator('.portal-content-studio__form')
      .filter({ has: page.getByRole('heading', { name: '立即发布' }) })
    await expect(publishEditor.getByRole('heading', { name: '立即发布' })).toBeVisible()
    await publishEditor.getByRole('checkbox').first().check()
    const [publishResponse] = await Promise.all([
      page.waitForResponse(
        (response: Response) =>
          response.request().method() === 'POST' &&
          response.url().endsWith(`/api/portal/content-studio/${contentID}`),
      ),
      publishEditor.getByRole('button', { name: '立即发布' }).click(),
    ])
    expect(publishResponse.status()).toBe(202)
    await expect(page.getByText('已为所选平台创建发布任务。')).toBeVisible()

    await harness.runPublicationUntilIdle()
    const state = await harness.readPublishingState(contentID)
    expect(state.publishJobs).toHaveLength(1)
    const publishJob = state.publishJobs[0]!
    expect(publishJob).toMatchObject({
      authorizationRevision: 0,
      externalPublicationId: '129472283584550_7654321',
      externalPublicationUrl:
        'https://www.facebook.com/129472283584550_7654321/posts/e2e-published',
      status: 'published',
    })
    expect(publishJob.requestSnapshot.assets).toHaveLength(1)
    const asset = publishJob.requestSnapshot.assets[0]!
    expect(asset).toMatchObject({
      id: String(fixture.mediaID),
      mimeType: 'image/jpeg',
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      sourceUrl: expect.stringMatching(
        new RegExp(
          `^https://e2e-publication\\.invalid/api/publication-assets/${fixture.mediaID}/[a-f0-9]{64}$`,
          'u',
        ),
      ),
    })

    expect(state.jobs).toHaveLength(3)
    expect(state.jobs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ status: 'succeeded', type: 'platform.publication.execute' }),
      ]),
    )
    expect(state.jobs.map((job) => job.idempotencyKey)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^publication-execute:\d+:0$/u),
        expect.stringMatching(/^publication-status:\d+:1$/u),
        expect.stringMatching(/^publication-execute:\d+:1$/u),
      ]),
    )
    expect(harness.publishingPhotoRequests).toHaveLength(1)
    expect(harness.publishingPhotoRequests[0]).toMatchObject({
      accountExternalId: '129472283584550',
      authorizationRevision: 0,
      platformAccountId: expect.any(Number),
      url: asset.sourceUrl,
    })
    expect(harness.publishingPermalinkRequests).toHaveLength(2)
    expect(state.logs.map(({ event }) => event)).toEqual(
      expect.arrayContaining(['accepted', 'created', 'status-updated']),
    )

    await page.reload()
    await page.getByRole('button', { name: new RegExp(title) }).click()
    await expect(page.getByText('129472283584550_7654321')).toBeVisible()
    await expect(
      page.locator(
        'a[href="https://www.facebook.com/129472283584550_7654321/posts/e2e-published"]',
      ),
    ).toBeVisible()
  })
})
