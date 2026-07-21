import { expect, test } from '@playwright/test'

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
  await expect(page.getByRole('link', { name: 'العودة إلى الرئيسية' })).toHaveAttribute('href', '/ar')
})

test('sitemap and robots expose locale-prefixed public routes', async ({ request }) => {
  const sitemap = await request.get('/sitemap.xml')
  expect(sitemap.ok()).toBe(true)
  const sitemapBody = await sitemap.text()
  expect(sitemapBody).toContain('/en/products')
  expect(sitemapBody).toContain('/ar/products')
  expect(sitemapBody).toContain('hreflang="en"')
  expect(sitemapBody).toContain('hreflang="ar"')
  expect(sitemapBody).not.toContain('middle-east-export-support')

  const robots = await request.get('/robots.txt')
  expect(robots.ok()).toBe(true)
  expect(await robots.text()).toContain('Sitemap:')
})

test('anonymous website APIs expose the complete published seed without demo copy', async ({ request }) => {
  for (const [collection, expectedCount] of [
    ['product-categories', 3],
    ['products', 3],
    ['projects', 6],
    ['posts', 3],
  ] as const) {
    const response = await request.get(`/api/${collection}?locale=en&fallback-locale=none&limit=100`)
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

test('dynamic detail pages expose localized metadata and noIndex directives', async ({ page }) => {
  await page.goto('/ar/products/double-curved-aluminum-panel')
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
  await expect(page.locator('head link[rel="canonical"]')).toHaveAttribute(
    'href',
    /\/ar\/products\/double-curved-aluminum-panel$/,
  )
  await expect(page.locator('script[type="application/ld+json"]')).toHaveCount(2)

  await page.goto('/en/news/middle-east-export-support')
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/i)
})
