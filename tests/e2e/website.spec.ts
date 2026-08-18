import './require-mutation-launch'
import { expect, test } from '@playwright/test'

import { FacebookE2EHarness } from './admin-portal-facebook.support'

const adminEmail = process.env.E2E_ADMIN_EMAIL ?? process.env.SEED_ADMIN_EMAIL
const adminPassword = process.env.E2E_ADMIN_PASSWORD ?? process.env.SEED_ADMIN_PASSWORD

const routes = ['', '/about', '/products', '/projects', '/news', '/contact']

for (const locale of ['en', 'ar'] as const) {
  test.describe(`${locale} website`, () => {
    for (const route of routes) {
      test(`${route || '/'} renders localized metadata and direction`, async ({ page }) => {
        const response = await page.goto(`/${locale}${route}`)

        expect(response?.ok()).toBe(true)
        await expect(page.locator('html')).toHaveAttribute('lang', locale)
        await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr')
        await expect(page.locator('head link[rel="canonical"]')).toHaveAttribute(
          'href',
          new RegExp(`/${locale}${route || ''}$`),
        )
        await expect(page.locator('head link[hreflang="en"]')).toHaveCount(1)
        await expect(page.locator('head link[hreflang="ar"]')).toHaveCount(1)
        await expect(page.locator('script[type="application/ld+json"]')).toHaveCount(1)
      })
    }
  })
}

test('root redirects to English and unknown public content returns 404', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveURL(/\/en$/)

  const response = await page.goto('/en/products/not-a-real-product')
  expect(response?.status()).toBe(404)

  const arabicResponse = await page.goto('/ar/products/not-a-real-product')
  expect(arabicResponse?.status()).toBe(404)
  await expect(page.getByRole('heading', { name: 'الصفحة غير موجودة' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'العودة إلى الرئيسية' })).toHaveAttribute(
    'href',
    '/ar',
  )
})

test('sitemap and robots expose locale-prefixed public routes', async ({ request }) => {
  const sitemap = await request.get('/sitemap.xml')
  expect(sitemap.ok()).toBe(true)
  const sitemapBody = await sitemap.text()
  expect(sitemapBody).toContain('/en/products')
  expect(sitemapBody).toContain('/ar/products')
  expect(sitemapBody).toContain('hreflang="en"')
  expect(sitemapBody).toContain('hreflang="ar"')
  expect(sitemapBody).toContain('/en/news/what-is-double-curved-aluminum-panel')

  const robots = await request.get('/robots.txt')
  expect(robots.ok()).toBe(true)
  const robotsBody = await robots.text()
  expect(robotsBody).toContain('Sitemap:')
  for (const privatePath of ['/admin', '/api', '/dashboard']) {
    expect(robotsBody).toContain(`Disallow: ${privatePath}`)
  }
})

test('anonymous website APIs expose the complete published seed without demo copy', async ({
  request,
}) => {
  for (const [collection, expectedCount] of [
    ['product-categories', 3],
    ['products', 3],
    ['projects', 3],
    ['posts', 3],
  ] as const) {
    const response = await request.get(
      `/api/${collection}?locale=en&fallback-locale=none&limit=100`,
    )
    expect(response.ok()).toBe(true)
    const body = await response.json()
    expect(body.totalDocs).toBe(expectedCount)
    expect(JSON.stringify(body.docs)).not.toMatch(/\bdemo\b|\bfake\b/i)
  }
})

test('mobile navigation, locale switch, carousel and product filtering work', async ({ page }) => {
  await page.setViewportSize({ height: 844, width: 390 })
  await page.goto('/en')

  await page.getByRole('button', { name: 'Menu' }).click()
  await expect(page.getByRole('navigation', { name: 'Mobile navigation' })).toBeVisible()

  await page.getByLabel('Language').selectOption('ar')
  await expect(page).toHaveURL(/\/ar$/)
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')

  await page.goto('/en')
  const activeSlide = page.locator('[data-testid="hero-slide"][data-active="true"]')
  const firstSlideID = await activeSlide.getAttribute('data-slide-id')
  await page.getByRole('button', { name: 'Next slide' }).click()
  await expect(activeSlide).not.toHaveAttribute('data-slide-id', firstSlideID ?? '')

  await page.goto('/en/products')
  await expect(page.locator('.product-tabs .tab')).toHaveText([
    'All',
    'Double-Curved',
    'Single-Curved',
    'Standard Facade',
  ])
  await expect(page.locator('[data-testid="product-card"]')).toHaveCount(3)
  expect(
    await page
      .locator('.product-card-image')
      .evaluateAll((images) =>
        images.every((image) => getComputedStyle(image).objectFit === 'contain'),
      ),
  ).toBe(true)
  await page.getByRole('button', { exact: true, name: 'Double-Curved' }).click()
  await expect(page.locator('[data-testid="product-card"]:visible')).toHaveCount(1)
  await expect(page.getByRole('heading', { name: 'Double-Curved Aluminum Panel' })).toBeVisible()
  await expect(page.getByRole('table')).toBeVisible()
  await expect(page.getByRole('rowheader', { name: 'Thickness' })).toBeVisible()
})

test('contact form exposes accessible validation without simulated success', async ({ page }) => {
  await page.goto('/en/contact')
  await page.getByRole('button', { name: 'Send Inquiry' }).click()
  await expect(page.getByText('This field is required.').first()).toBeVisible()
  await expect(page.getByLabel('Name *')).toHaveAttribute('aria-invalid', 'true')
  await expect(page.getByLabel('Name *')).toHaveAttribute('aria-describedby', 'name-error')
  await expect(page.getByText(/Thank you|success/i)).toHaveCount(0)
})

test('INQ-01 closes website inquiry, idempotent Lead, Portal, and fake Feishu', async ({
  page,
}) => {
  test.skip(
    !adminEmail || !adminPassword,
    'Requires local non-production administrator credentials.',
  )
  if (!adminEmail || !adminPassword) return
  const harness = await FacebookE2EHarness.create()
  try {
    await harness.createFeishuMapping()
    const suffix = crypto.randomUUID()
    const email = `e2e-inquiry-${suffix}@example.invalid`
    await page.goto('/en/contact')
    await page.getByLabel('Name *').fill('E2E Inquiry Buyer')
    await page.getByLabel('Email *').fill(email)
    await page.getByLabel('Phone').fill('+971501234567')
    await page.getByLabel('Country *').selectOption('United Arab Emirates')
    await page.getByLabel('Message *').fill('Please quote aluminum facade panels for our project.')
    const submittedRequest = page.waitForRequest(
      (request) =>
        request.method() === 'POST' && new URL(request.url()).pathname === '/api/inquiries',
    )
    await page.getByRole('button', { name: 'Send Inquiry' }).click()
    const requestBody = (await submittedRequest).postDataJSON() as Record<string, unknown>
    await expect(page.getByText(/Inquiry received/)).toBeVisible()
    const requestId = await page.locator('[data-testid="inquiry-request-id"]').textContent()
    if (!requestId) throw new Error('Inquiry response did not expose a request ID')
    harness.trackLeadRequest(requestId)

    await expect(harness.runUntilIdle()).resolves.toEqual(['succeeded', 'idle'])
    const lead = await harness.readLeadByRequestId(requestId)
    expect(lead).toMatchObject({ email, name: 'E2E Inquiry Buyer', status: 'new' })
    expect(harness.feishuUpserts).toHaveLength(1)
    expect(harness.feishuUpserts[0]).toMatchObject({ localLeadId: String(lead.id) })
    expect(harness.feishuMessages).toHaveLength(1)
    expect(harness.feishuMessages[0]?.text).toContain('新客户线索')

    const replay = await page.request.post('/api/inquiries', { data: requestBody })
    expect(replay.status()).toBe(200)
    await expect(replay.json()).resolves.toMatchObject({ duplicate: true, requestId })
    await expect(harness.runUntilIdle()).resolves.toEqual(['idle'])
    await expect(
      harness.payload.count({
        collection: 'leads',
        overrideAccess: true,
        where: { requestId: { equals: requestId } },
      }),
    ).resolves.toEqual({ totalDocs: 1 })
    expect(harness.feishuUpserts).toHaveLength(1)

    await page.goto('/dashboard/login?returnTo=%2Fdashboard%2Fleads')
    await page.getByRole('textbox', { name: '邮箱' }).fill(adminEmail)
    await page.getByRole('textbox', { name: '密码' }).fill(adminPassword)
    await page.getByRole('button', { name: '登录后台' }).click()
    await expect(page).toHaveURL(/\/dashboard\/leads$/)
    await expect(page.getByRole('definition').filter({ hasText: email })).toBeVisible()
  } finally {
    await harness.cleanup()
  }
})

test('dynamic detail pages expose localized metadata and migrated project and article content', async ({
  page,
}) => {
  await page.goto('/ar/products/double-curved-aluminum-panel')
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
  await expect(page.locator('head link[rel="canonical"]')).toHaveAttribute(
    'href',
    /\/ar\/products\/double-curved-aluminum-panel$/,
  )
  await expect(page.locator('script[type="application/ld+json"]')).toHaveCount(2)
  await expect(page.getByRole('heading', { name: 'لوح منحن في اتجاهين' })).toBeVisible()
  await expect(page.locator('.product-quote-button')).toHaveAttribute(
    'href',
    '/ar/contact?product=double-curved-aluminum-panel',
  )
  await expect(
    page.getByRole('img', { name: 'ألواح ألمنيوم مزدوجة الانحناء — الصورة 1 من 5' }),
  ).toBeVisible()
  await expect(
    page.getByRole('heading', { name: 'صور المشاريع والتصنيع من الموقع السابق' }),
  ).toBeVisible()
  await expect(page.getByRole('heading', { name: 'مرجع المنتج التاريخي' })).toBeVisible()

  const mainImage = page.locator('.product-gallery-main-image')
  await expect
    .poll(() => mainImage.evaluate((image) => (image as HTMLImageElement).currentSrc))
    .not.toBe('')
  const mainFit = await mainImage.evaluate((image) => {
    const stage = image.closest('.product-gallery-stage')?.getBoundingClientRect()
    const rect = image.getBoundingClientRect()
    const element = image as HTMLImageElement
    return {
      height: rect.height,
      fit: getComputedStyle(element).objectFit,
      source: element.currentSrc,
      stageHeight: stage?.height ?? 0,
      stageWidth: stage?.width ?? 0,
      width: rect.width,
    }
  })
  expect(Math.abs(mainFit.width - mainFit.stageWidth)).toBeLessThanOrEqual(2)
  expect(Math.abs(mainFit.height - mainFit.stageHeight)).toBeLessThanOrEqual(2)
  expect(mainFit.fit).toBe('contain')
  expect(mainFit.source).not.toBe('')

  await page.getByRole('button', { name: /فتح الصورة بالحجم الكامل/ }).click()
  await expect(
    page.getByRole('dialog', { name: 'صور ألواح ألمنيوم مزدوجة الانحناء بالحجم الكامل' }),
  ).toBeVisible()
  const lightboxImage = page.locator('.product-gallery-lightbox-image')
  await expect
    .poll(() => lightboxImage.evaluate((image) => (image as HTMLImageElement).currentSrc))
    .not.toBe('')
  const lightboxFit = await lightboxImage.evaluate((image) => {
    const stage = image.closest('.product-gallery-lightbox-stage')?.getBoundingClientRect()
    const rect = image.getBoundingClientRect()
    const element = image as HTMLImageElement
    return {
      height: rect.height,
      fit: getComputedStyle(element).objectFit,
      source: element.currentSrc,
      stageHeight: stage?.height ?? 0,
      stageWidth: stage?.width ?? 0,
      width: rect.width,
    }
  })
  expect(Math.abs(lightboxFit.width - lightboxFit.stageWidth)).toBeLessThanOrEqual(2)
  expect(Math.abs(lightboxFit.height - lightboxFit.stageHeight)).toBeLessThanOrEqual(2)
  expect(lightboxFit.fit).toBe('contain')
  expect(lightboxFit.source).not.toBe('')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)

  await page.goto('/en/contact?product=double-curved-aluminum-panel')
  await expect(page.getByLabel('Product Interest')).toHaveValue('double-curved-aluminum-panel')

  await page.goto('/en/about')
  await expect(page.locator('.about-gallery img')).toHaveCount(4)

  await page.goto('/en/projects/canada-double-curved')
  await expect(page.getByTestId('product-gallery')).toBeVisible()
  await expect(page.getByText('Image 1 of 7')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Project overview' })).toBeVisible()
  await page.setViewportSize({ height: 844, width: 390 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  )

  await page.goto('/ar/projects/canada-double-curved')
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
  await expect(page.getByText('الصورة 1 من 7')).toBeVisible()

  await page.goto('/en/news/what-is-double-curved-aluminum-panel')
  await expect(
    page.getByRole('heading', { name: 'A panel formed in two directions' }),
  ).toBeVisible()

  await page.goto('/ar/news/what-is-double-curved-aluminum-panel')
  await expect(page.getByRole('heading', { name: 'لوح منحن في اتجاهين' })).toBeVisible()

  await page.goto('/en/news/aluminum-panel-thickness-guide')
  await expect(
    page.getByRole('heading', { name: 'Archived thickness comparison table' }),
  ).toBeVisible()
  await expect(
    page.getByRole('img', {
      name: 'Aluminum panel samples shown in the legacy IVY thickness article',
    }),
  ).toBeVisible()
  await expect(
    page.getByRole('table', { name: /Legacy IVY nominal-to-base-material/ }),
  ).toBeVisible()
  await expect(page.getByRole('cell', { name: '1.35 mm' })).toBeVisible()
})
