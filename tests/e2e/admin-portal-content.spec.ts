import './require-mutation-launch'
import { expect, test, type Browser, type Page, type TestInfo } from '@playwright/test'
import { getPayload, type Where } from 'payload'

import config from '@/payload.config'

const adminEmail = process.env.E2E_ADMIN_EMAIL ?? process.env.SEED_ADMIN_EMAIL
const adminPassword = process.env.E2E_ADMIN_PASSWORD ?? process.env.SEED_ADMIN_PASSWORD

type CmsContentType = 'posts' | 'products' | 'projects'

interface CmsLocaleFields {
  application?: string
  body: string
  excerpt?: string
  location?: string
  seoDescription: string
  seoTitle: string
  shortDescription?: string
  summary?: string
  title: string
}

interface CmsFixture {
  ar: CmsLocaleFields
  en: CmsLocaleFields
  publicPath: 'news' | 'products' | 'projects'
  slug: string
  type: CmsContentType
  updatedEnglishTitle: string
}

interface CmsRecord {
  id: number | string
  slug: string
  type: CmsContentType
}

const cmsFixtures = (suffix: string): CmsFixture[] => [
  {
    ar: {
      body: 'تفاصيل منتج اختبارية للتحقق من دورة النشر الكاملة عبر البوابة.',
      seoDescription: 'وصف بحث عربي لمنتج اختبار النشر عبر البوابة.',
      seoTitle: 'منتج اختبار النشر عبر البوابة',
      shortDescription: 'وصف عربي قصير لمنتج اختبار النشر.',
      title: `منتج اختبار البوابة ${suffix}`,
    },
    en: {
      body: 'Synthetic product detail used to verify the complete Portal publishing lifecycle.',
      seoDescription: 'Search description for the Portal CMS publication test product.',
      seoTitle: 'Portal CMS publication test product',
      shortDescription: 'English summary for the Portal CMS publication test product.',
      title: `Portal CMS Product ${suffix}`,
    },
    publicPath: 'products',
    slug: `portal-cms-product-${suffix}`,
    type: 'products',
    updatedEnglishTitle: `Portal CMS Product ${suffix} Updated`,
  },
  {
    ar: {
      application: 'واجهة معمارية اختبارية',
      body: 'تفاصيل حالة اختبارية للتحقق من تحديث موقع المشروع بعد النشر.',
      location: 'دبي، الإمارات العربية المتحدة',
      seoDescription: 'وصف بحث عربي لحالة اختبار النشر عبر البوابة.',
      seoTitle: 'حالة اختبار النشر عبر البوابة',
      summary: 'ملخص عربي لحالة اختبار النشر عبر البوابة.',
      title: `حالة اختبار البوابة ${suffix}`,
    },
    en: {
      application: 'Synthetic architectural facade',
      body: 'Synthetic project detail used to verify public refresh after Portal publication.',
      location: 'Dubai, United Arab Emirates',
      seoDescription: 'Search description for the Portal CMS publication test project.',
      seoTitle: 'Portal CMS publication test project',
      summary: 'English summary for the Portal CMS publication test project.',
      title: `Portal CMS Project ${suffix}`,
    },
    publicPath: 'projects',
    slug: `portal-cms-project-${suffix}`,
    type: 'projects',
    updatedEnglishTitle: `Portal CMS Project ${suffix} Updated`,
  },
  {
    ar: {
      body: 'محتوى مقالة اختبارية للتحقق من القراءة العامة والتحديث والإلغاء.',
      excerpt: 'ملخص عربي لمقالة اختبار النشر عبر البوابة.',
      seoDescription: 'وصف بحث عربي لمقالة اختبار النشر عبر البوابة.',
      seoTitle: 'مقالة اختبار النشر عبر البوابة',
      title: `مقالة اختبار البوابة ${suffix}`,
    },
    en: {
      body: 'Synthetic article content used to verify public reading, refresh, and unpublishing.',
      excerpt: 'English excerpt for the Portal CMS publication test article.',
      seoDescription: 'Search description for the Portal CMS publication test article.',
      seoTitle: 'Portal CMS publication test article',
      title: `Portal CMS Article ${suffix}`,
    },
    publicPath: 'news',
    slug: `portal-cms-article-${suffix}`,
    type: 'posts',
    updatedEnglishTitle: `Portal CMS Article ${suffix} Updated`,
  },
]

const editor = (page: Page) => page.locator('.portal-content-editor')

const fillSeo = async (page: Page, fields: CmsLocaleFields) => {
  const seo = page.locator('details.portal-content-editor__seo')
  if (!(await seo.evaluate((element) => (element as HTMLDetailsElement).open))) {
    await seo.locator('summary').click()
  }
  await page.getByLabel('搜索标题', { exact: true }).fill(fields.seoTitle)
  await page.getByLabel('搜索摘要', { exact: true }).fill(fields.seoDescription)
}

const fillLocalizedContent = async (page: Page, fixture: CmsFixture, locale: 'ar' | 'en') => {
  const fields = fixture[locale]
  await page.getByLabel('标题', { exact: true }).fill(fields.title)
  await page.getByLabel('正文', { exact: true }).fill(fields.body)

  if (fixture.type === 'products') {
    await page
      .getByLabel('简短介绍', { exact: true })
      .fill(fields.shortDescription ?? 'Synthetic product summary')
  } else if (fixture.type === 'projects') {
    await page
      .getByLabel('摘要', { exact: true })
      .fill(fields.summary ?? 'Synthetic project summary')
    await page
      .getByLabel('项目地点', { exact: true })
      .fill(fields.location ?? 'Synthetic project location')
    await page
      .getByLabel('应用场景', { exact: true })
      .fill(fields.application ?? 'Synthetic project application')
  } else {
    await page
      .getByLabel('摘要', { exact: true })
      .fill(fields.excerpt ?? 'Synthetic article excerpt')
  }

  await fillSeo(page, fields)
}

const selectFirstImage = async (page: Page, label: '封面图' | '特色图') => {
  const group = page.getByRole('group', { name: label })
  await expect(group.getByRole('radio')).not.toHaveCount(0)
  await group.getByRole('radio').first().check({ force: true })
}

const selectFirstProductCategory = async (page: Page) => {
  const category = editor(page).getByRole('combobox', { name: '产品分类' })
  await expect(category.locator('option')).toHaveCount(4)
  await category.selectOption({ index: 1 }, { force: true })
  await expect(category).not.toHaveValue('')
}

const openContentEditor = async (page: Page, fixture: CmsFixture) => {
  await page.goto(`/dashboard/content?type=${fixture.type}&q=${fixture.slug}`)
  const item = page.locator('.portal-content__item').filter({ hasText: `/${fixture.slug}` })
  await expect(item).toHaveCount(1)
  await item.click()
  await page.getByRole('button', { name: '编辑内容' }).click()
  await expect(editor(page)).toBeVisible()
  await expect(page.getByLabel('固定链接标识', { exact: true })).toHaveValue(fixture.slug)
}

const createAndPublishContent = async (page: Page, fixture: CmsFixture): Promise<CmsRecord> => {
  await page.goto(`/dashboard/content?type=${fixture.type}`)
  await page.getByRole('button', { name: '新增内容' }).first().click()
  await expect(editor(page)).toBeVisible()
  await page.getByLabel('固定链接标识', { exact: true }).fill(fixture.slug)
  await fillLocalizedContent(page, fixture, 'en')

  if (fixture.type === 'products') {
    await selectFirstProductCategory(page)
    await selectFirstImage(page, '封面图')
  } else if (fixture.type === 'projects') {
    await selectFirstImage(page, '封面图')
  } else {
    await selectFirstImage(page, '特色图')
  }

  const [response] = await Promise.all([
    page.waitForResponse(
      (candidate) =>
        candidate.request().method() === 'POST' &&
        candidate.url().endsWith(`/api/portal/content/${fixture.type}`),
    ),
    page.getByRole('button', { name: '发布', exact: true }).click(),
  ])
  expect(response.status()).toBe(201)
  const body = (await response.json()) as {
    result?: { id?: number | string; slug?: string; status?: string }
  }
  expect(body.result).toMatchObject({ slug: fixture.slug, status: 'published' })
  if (body.result?.id === undefined)
    throw new Error(`CMS create did not return an id for ${fixture.type}`)
  await expect(
    page.locator('.portal-content__item').filter({ hasText: `/${fixture.slug}` }),
  ).toBeVisible()
  return { id: body.result.id, slug: fixture.slug, type: fixture.type }
}

const publishArabicTranslation = async (page: Page, fixture: CmsFixture, record: CmsRecord) => {
  await openContentEditor(page, fixture)
  const arabicEditorResponse = page.waitForResponse((candidate) => {
    const url = new URL(candidate.url())
    return (
      candidate.request().method() === 'GET' &&
      url.pathname === `/api/portal/content/${fixture.type}/${record.id}` &&
      url.searchParams.get('locale') === 'ar'
    )
  })
  await page.getByRole('button', { name: '阿语', exact: true }).click()
  const arabicResponse = await arabicEditorResponse
  expect(arabicResponse.ok()).toBe(true)
  await expect(arabicResponse.json()).resolves.toMatchObject({
    record: { data: { title: '' }, locale: 'ar' },
  })
  await expect(editor(page)).toBeVisible()
  await expect(editor(page).locator('.portal-content-editor__fields').first()).toHaveAttribute(
    'dir',
    'rtl',
  )
  await expect(page.getByLabel('标题', { exact: true })).toHaveValue('')
  await expect(page.getByLabel('固定链接标识', { exact: true })).toHaveValue(fixture.slug)
  await fillLocalizedContent(page, fixture, 'ar')

  const [response] = await Promise.all([
    page.waitForResponse(
      (candidate) =>
        candidate.request().method() === 'PATCH' &&
        new URL(candidate.url()).pathname.startsWith(`/api/portal/content/${fixture.type}/`),
    ),
    page.getByRole('button', { name: '保存并发布', exact: true }).click(),
  ])
  expect(response.ok()).toBe(true)
  await expect(response.json()).resolves.toMatchObject({
    result: { slug: fixture.slug, status: 'published' },
  })
  await page.getByRole('button', { name: '取消', exact: true }).click()
}

const updateEnglishTitle = async (page: Page, fixture: CmsFixture) => {
  await openContentEditor(page, fixture)
  await page.getByLabel('标题', { exact: true }).fill(fixture.updatedEnglishTitle)
  const [response] = await Promise.all([
    page.waitForResponse(
      (candidate) =>
        candidate.request().method() === 'PATCH' &&
        new URL(candidate.url()).pathname.startsWith(`/api/portal/content/${fixture.type}/`),
    ),
    page.getByRole('button', { name: '保存并发布', exact: true }).click(),
  ])
  expect(response.ok()).toBe(true)
  await expect(response.json()).resolves.toMatchObject({
    result: { slug: fixture.slug, status: 'published', title: fixture.updatedEnglishTitle },
  })
  await expect(page.getByLabel('固定链接标识', { exact: true })).toHaveValue(fixture.slug)
  await page.getByRole('button', { name: '取消', exact: true }).click()
}

const unpublishContent = async (page: Page, fixture: CmsFixture) => {
  await openContentEditor(page, fixture)
  const [response] = await Promise.all([
    page.waitForResponse(
      (candidate) =>
        candidate.request().method() === 'PATCH' &&
        new URL(candidate.url()).pathname.startsWith(`/api/portal/content/${fixture.type}/`),
    ),
    page.getByRole('button', { name: '下架', exact: true }).click(),
  ])
  expect(response.ok()).toBe(true)
  await expect(response.json()).resolves.toMatchObject({
    result: { slug: fixture.slug, status: 'unpublished' },
  })
  await page.getByRole('button', { name: '取消', exact: true }).click()
}

const verifyPayloadLocale = async (
  page: Page,
  record: CmsRecord,
  locale: 'ar' | 'en',
  expectedTitle: string,
) => {
  const response = await page.request.get(
    `/api/${record.type}/${record.id}?locale=${locale}&fallback-locale=none&depth=0&draft=true`,
  )
  expect(response.ok()).toBe(true)
  await expect(response.json()).resolves.toMatchObject({
    _status: 'published',
    id: record.id,
    slug: record.slug,
    title: expectedTitle,
  })
}

const cleanupCmsRecords = async (page: Page, records: CmsRecord[], receiptKeys: Set<string>) => {
  for (const record of [...records].reverse()) {
    const detail = await page.request.get(
      `/api/portal/content/${record.type}/${record.id}?locale=en`,
    )
    if (!detail.ok()) continue
    const body = (await detail.json()) as { record?: { updatedAt?: string } }
    if (!body.record?.updatedAt) continue
    const idempotencyKey = `portal-e2e-cms-cleanup:${crypto.randomUUID()}`
    receiptKeys.add(idempotencyKey)
    const deletion = await page.request.delete(`/api/portal/content/${record.type}/${record.id}`, {
      data: { locale: 'en', updatedAt: body.record.updatedAt },
      headers: { 'Idempotency-Key': idempotencyKey },
    })
    expect(deletion.ok()).toBe(true)
  }
}

const cleanupCmsCommandArtifacts = async (
  records: CmsRecord[],
  receiptKeys: Set<string>,
  suffix: string,
) => {
  const payload = await getPayload({
    config,
    disableOnInit: true,
    key: `portal-cms-e2e-cleanup-${suffix}`,
  })
  const auditWhere = {
    or: records.map((record): Where => ({
      and: [{ resource: { equals: record.type } }, { documentId: { equals: String(record.id) } }],
    })),
  }
  const receiptWhere = { idempotencyKey: { in: [...receiptKeys] } }

  try {
    if (records.length > 0) {
      await payload.delete({
        collection: 'audit-logs',
        context: { skipAudit: true },
        overrideAccess: true,
        where: auditWhere,
      })
      await expect(
        payload.count({ collection: 'audit-logs', overrideAccess: true, where: auditWhere }),
      ).resolves.toMatchObject({ totalDocs: 0 })
    }
    if (receiptKeys.size > 0) {
      await payload.delete({
        collection: 'portal-command-receipts',
        context: { skipAudit: true },
        overrideAccess: true,
        where: receiptWhere,
      })
      await expect(
        payload.count({
          collection: 'portal-command-receipts',
          overrideAccess: true,
          where: receiptWhere,
        }),
      ).resolves.toMatchObject({ totalDocs: 0 })
    }
  } finally {
    await payload.destroy()
  }
}

const publicUrl = (fixture: CmsFixture, locale: 'ar' | 'en') =>
  `/${locale}/${fixture.publicPath}/${fixture.slug}`

const verifyPublishedWebsite = async (
  browser: Browser,
  fixtures: CmsFixture[],
  testInfo: TestInfo,
) => {
  const projectBaseURL = testInfo.project.use.baseURL
  const context = await browser.newContext({
    baseURL: typeof projectBaseURL === 'string' ? projectBaseURL : 'http://localhost:3000',
  })
  const page = await context.newPage()
  try {
    for (const fixture of fixtures) {
      for (const locale of ['en', 'ar'] as const) {
        const response = await page.goto(publicUrl(fixture, locale))
        expect(response?.ok()).toBe(true)
        await expect(page.locator('html')).toHaveAttribute('lang', locale)
        await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr')
        await expect(
          page.getByRole('heading', { level: 1, name: fixture[locale].title }),
        ).toBeVisible()
        await expect(page.getByText(fixture[locale].body, { exact: true })).toBeVisible()
      }
      await page.screenshot({
        fullPage: true,
        path: testInfo.outputPath(`cms-01-${fixture.type}-ar.png`),
      })
    }
  } finally {
    await context.close()
  }
}

const verifyUpdatedWebsite = async (
  browser: Browser,
  fixtures: CmsFixture[],
  testInfo: TestInfo,
) => {
  const projectBaseURL = testInfo.project.use.baseURL
  const context = await browser.newContext({
    baseURL: typeof projectBaseURL === 'string' ? projectBaseURL : 'http://localhost:3000',
  })
  const page = await context.newPage()
  try {
    for (const fixture of fixtures) {
      const response = await page.goto(publicUrl(fixture, 'en'))
      expect(response?.ok()).toBe(true)
      await page.reload()
      await expect(
        page.getByRole('heading', { level: 1, name: fixture.updatedEnglishTitle }),
      ).toBeVisible()
      expect(page.url()).toMatch(new RegExp(`/${fixture.publicPath}/${fixture.slug}$`))
    }
  } finally {
    await context.close()
  }
}

const verifyUnpublishedWebsite = async (
  browser: Browser,
  fixtures: CmsFixture[],
  testInfo: TestInfo,
) => {
  const projectBaseURL = testInfo.project.use.baseURL
  const context = await browser.newContext({
    baseURL: typeof projectBaseURL === 'string' ? projectBaseURL : 'http://localhost:3000',
  })
  const page = await context.newPage()
  try {
    for (const fixture of fixtures) {
      for (const locale of ['en', 'ar'] as const) {
        const response = await page.goto(publicUrl(fixture, locale))
        expect(response?.status()).toBe(404)
      }
    }
  } finally {
    await context.close()
  }
}

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

test('CMS-01 publishes localized product, project, and article lifecycles from the Portal', async ({
  browser,
  page,
}, testInfo) => {
  test.setTimeout(360_000)
  await page.setViewportSize({ height: 960, width: 1440 })
  await login(page)
  if (!adminEmail || !adminPassword) return

  const suffix = `${Date.now()}-${testInfo.workerIndex}`
  const fixtures = cmsFixtures(suffix)
  const records: CmsRecord[] = []
  const receiptKeys = new Set<string>()
  page.on('request', (request) => {
    if (!new URL(request.url()).pathname.startsWith('/api/portal/content/')) return
    const idempotencyKey = request.headers()['idempotency-key']?.trim()
    if (idempotencyKey) receiptKeys.add(idempotencyKey)
  })

  try {
    for (const fixture of fixtures) {
      const record = await createAndPublishContent(page, fixture)
      records.push(record)
      await publishArabicTranslation(page, fixture, record)
    }

    for (const [index, record] of records.entries()) {
      const fixture = fixtures[index]
      if (!fixture) throw new Error(`Missing CMS fixture for ${record.type}`)
      await verifyPayloadLocale(page, record, 'en', fixture.en.title)
      await verifyPayloadLocale(page, record, 'ar', fixture.ar.title)
    }

    await verifyPublishedWebsite(browser, fixtures, testInfo)

    for (const fixture of fixtures) await updateEnglishTitle(page, fixture)
    await verifyUpdatedWebsite(browser, fixtures, testInfo)

    for (const fixture of fixtures) await unpublishContent(page, fixture)
    await verifyUnpublishedWebsite(browser, fixtures, testInfo)
  } finally {
    try {
      await cleanupCmsRecords(page, records, receiptKeys)
    } finally {
      await cleanupCmsCommandArtifacts(records, receiptKeys, suffix)
    }
  }
})
