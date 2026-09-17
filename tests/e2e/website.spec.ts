import './require-mutation-launch'
import { expect, test } from '@playwright/test'

import { FacebookE2EHarness } from './admin-portal-facebook.support'

const adminUsername = process.env.E2E_ADMIN_USERNAME ?? process.env.SEED_ADMIN_USERNAME
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
          { timeout: 20000 },
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

  await page.getByRole('button', { name: 'Language' }).click()
  await page.getByRole('option', { name: 'العربية' }).click()
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

for (const viewport of [
  { height: 844, width: 390 },
  { height: 667, width: 375 },
  { height: 800, width: 360 },
] as const) {
  test(`mobile drawer CTA is visible and navigates to contact on ${viewport.width}x${viewport.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport)
    await page.goto('/en')

    const menuButton = page.getByRole('button', { name: 'Menu' })
    await menuButton.click()
    const mobileNav = page.getByRole('navigation', { name: 'Mobile navigation' })
    await expect(mobileNav).toBeVisible()

    // Verify physical bottom-most CTA (WhatsApp or Upload Drawing) is reachable and within viewport
    const ctaLinks = mobileNav.locator('.mobile-nav-cta-group a')
    const ctaCount = await ctaLinks.count()
    expect(ctaCount).toBeGreaterThanOrEqual(1)
    const lastCta = ctaLinks.nth(ctaCount - 1)
    await expect(lastCta).toBeVisible()
    const lastCtaBox = await lastCta.boundingBox()
    expect(lastCtaBox).not.toBeNull()
    expect(lastCtaBox!.y + lastCtaBox!.height).toBeLessThanOrEqual(viewport.height)

    // Verify the physical bottom-most CTA is actionable and clickable (trial click without navigating away)
    await lastCta.click({ trial: true })

    // Click Upload Drawing CTA and confirm navigation
    const mobileCta = mobileNav.getByRole('link', { name: 'Upload Drawing' })
    await expect(mobileCta).toBeVisible()
    await mobileCta.click()

    await expect(page).toHaveURL(/\/en\/contact$/)
    await expect(page.getByRole('navigation', { name: 'Mobile navigation' })).not.toBeVisible()
    const bodyOverflow = await page.evaluate(() => document.body.style.overflow)
    expect(bodyOverflow).toBe('')
  })
}

test('mobile backdrop covers full viewport, locks scroll without jump, and blocks pass-through clicks', async ({
  page,
}) => {
  await page.setViewportSize({ height: 844, width: 390 })
  await page.goto('/en')

  // Wait for content and scroll down so page has a scroll offset
  await expect(page.locator('.hero')).toBeVisible()
  await page.evaluate(() => window.scrollTo({ behavior: 'instant', top: 300 }))
  await page.waitForFunction(() => (window.scrollY || document.documentElement.scrollTop) >= 200)
  const scrollOffsetBefore = await page.evaluate(() => window.scrollY || document.documentElement.scrollTop)
  expect(scrollOffsetBefore).toBeGreaterThanOrEqual(200)

  const menuButton = page.getByRole('button', { name: 'Menu' })
  await menuButton.click()
  const mobileNav = page.getByRole('navigation', { name: 'Mobile navigation' })
  await expect(mobileNav).toBeVisible()

  // 1. Backdrop bounding box matches the entire viewport
  const backdrop = page.locator('.mobile-nav-backdrop')
  await expect(backdrop).toBeVisible()
  const backdropBox = await backdrop.boundingBox()
  expect(backdropBox).not.toBeNull()
  expect(backdropBox?.x).toBe(0)
  expect(backdropBox?.y).toBe(0)
  expect(backdropBox?.width).toBe(390)
  expect(backdropBox?.height).toBe(844)

  // 2. Body scroll lock is applied and scroll position is preserved
  expect(await page.evaluate(() => document.body.style.overflow)).toBe('hidden')
  expect(await page.evaluate(() => window.scrollY || document.documentElement.scrollTop)).toBe(scrollOffsetBefore)

  // Attempt user wheel scroll while menu is open: scroll position must NOT change
  await page.mouse.wheel(0, 200)
  expect(await page.evaluate(() => window.scrollY || document.documentElement.scrollTop)).toBe(scrollOffsetBefore)

  // 3. Header and backdrop are strictly above ChatWidget (elementFromPoint positive assertion)
  const chatLauncher = page.locator('.chat-launcher')
  await expect(chatLauncher).toBeAttached()
  const launcherBox = await chatLauncher.boundingBox()
  expect(launcherBox).not.toBeNull()
  expect(launcherBox!.width).toBeGreaterThan(0)
  expect(launcherBox!.height).toBeGreaterThan(0)

  const hitsBackdrop = await page.evaluate(
    ({ x, y }) => {
      const el = document.elementFromPoint(x, y)
      return el ? Boolean(el.closest('.mobile-nav-backdrop')) : false
    },
    { x: launcherBox!.x + launcherBox!.width / 2, y: launcherBox!.y + launcherBox!.height / 2 },
  )
  expect(hitsBackdrop).toBe(true)

  // 4. Clicking outside the drawer on the backdrop (using safe dynamic coordinate) closes menu
  const navBox = await mobileNav.boundingBox()
  expect(navBox).not.toBeNull()
  const safeBackdropClickY = Math.min(navBox!.y + navBox!.height + 25, 844 - 20)
  await page.mouse.click(195, safeBackdropClickY)
  await expect(mobileNav).not.toBeVisible()
  await expect(backdrop).not.toBeVisible()
  expect(await page.evaluate(() => document.body.style.overflow)).toBe('')
  expect(await page.evaluate(() => window.scrollY || document.documentElement.scrollTop)).toBe(scrollOffsetBefore)
})

test('mobile drawer manages mutual exclusion, route click, popstate navigation, and escape focus', async ({
  page,
}) => {
  await page.setViewportSize({ height: 844, width: 390 })
  await page.goto('/en')

  const menuButton = page.getByRole('button', { name: 'Menu' })
  const langButton = page.getByRole('button', { name: 'Language' })
  const mobileNav = page.getByRole('navigation', { name: 'Mobile navigation' })

  // Mutual exclusion A: Menu open -> Open Language -> Menu closes
  await menuButton.click()
  await expect(mobileNav).toBeVisible()
  await langButton.click()
  await expect(mobileNav).not.toBeVisible()
  await expect(page.getByRole('listbox', { name: 'Language' })).toBeVisible()

  // Mutual exclusion B: Language open -> Open Menu -> Language closes
  await menuButton.click()
  await expect(page.getByRole('listbox', { name: 'Language' })).not.toBeVisible()
  await expect(mobileNav).toBeVisible()

  // Escape key closes menu and returns focus to menu button
  await page.keyboard.press('Escape')
  await expect(mobileNav).not.toBeVisible()
  const isMenuBtnFocused = await page.evaluate(() => {
    const btn = document.querySelector('header button.menu-button')
    return document.activeElement === btn
  })
  expect(isMenuBtnFocused).toBe(true)

  // Drawer link click navigates and closes drawer: build history stack /en -> /en/products -> /en/about
  await menuButton.click()
  await expect(mobileNav).toBeVisible()
  await mobileNav.getByRole('link', { name: 'Products' }).click()
  await expect(page).toHaveURL(/\/en\/products$/)
  await expect(mobileNav).not.toBeVisible()
  expect(await page.evaluate(() => document.body.style.overflow)).toBe('')

  await menuButton.click()
  await expect(mobileNav).toBeVisible()
  await mobileNav.getByRole('link', { name: 'About' }).click()
  await expect(page).toHaveURL(/\/en\/about$/)
  await expect(mobileNav).not.toBeVisible()
  expect(await page.evaluate(() => document.body.style.overflow)).toBe('')

  // Popstate backward navigation: opening drawer then browser back closes drawer and unlocks body
  await menuButton.click()
  await expect(mobileNav).toBeVisible()
  expect(await page.evaluate(() => document.body.style.overflow)).toBe('hidden')
  await page.goBack()
  await expect(page).toHaveURL(/\/en\/products$/)
  await expect(mobileNav).not.toBeVisible()
  expect(await page.evaluate(() => document.body.style.overflow)).toBe('')

  // Popstate forward navigation: opening drawer then browser forward closes drawer and unlocks body
  await menuButton.click()
  await expect(mobileNav).toBeVisible()
  expect(await page.evaluate(() => document.body.style.overflow)).toBe('hidden')
  await page.goForward()
  await expect(page).toHaveURL(/\/en\/about$/)
  await expect(mobileNav).not.toBeVisible()
  expect(await page.evaluate(() => document.body.style.overflow)).toBe('')
})

test('RTL mobile drawer renders with correct direction, reachable CTA and navigates to /ar/contact', async ({
  page,
}) => {
  await page.setViewportSize({ height: 844, width: 390 })
  await page.goto('/ar')
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')

  const arMenuButton = page.getByRole('button', { name: 'القائمة' })
  await arMenuButton.click()
  const arMobileNav = page.getByRole('navigation', { name: 'التنقل عبر الهاتف' })
  await expect(arMobileNav).toBeVisible()

  // Verify RTL layout and text direction on drawer and CTA
  const drawerStyles = await arMobileNav.evaluate((el) => {
    const computed = window.getComputedStyle(el)
    return { direction: computed.direction }
  })
  expect(drawerStyles.direction).toBe('rtl')

  const arCta = arMobileNav.getByRole('link', { name: 'رفع المخططات' })
  await expect(arCta).toBeVisible()
  const ctaStyles = await arCta.evaluate((el) => window.getComputedStyle(el).direction)
  expect(ctaStyles).toBe('rtl')

  // Verify geometric alignment and horizontal containment inside the drawer
  const navBox = await arMobileNav.boundingBox()
  const ctaBox = await arCta.boundingBox()
  expect(navBox).not.toBeNull()
  expect(ctaBox).not.toBeNull()
  expect(ctaBox!.x).toBeGreaterThanOrEqual(navBox!.x - 1)
  expect(ctaBox!.x + ctaBox!.width).toBeLessThanOrEqual(navBox!.x + navBox!.width + 1)

  await arCta.click()
  await expect(page).toHaveURL(/\/ar\/contact$/)
  await expect(arMobileNav).not.toBeVisible()
  expect(await page.evaluate(() => document.body.style.overflow)).toBe('')
})

test('capabilities and for-professionals pages render distinct H1 and H2 in EN and AR', async ({ page }) => {
  await page.goto('/en/capabilities')
  const enCapH1 = await page.getByRole('heading', { level: 1 }).textContent()
  const enCapH2 = await page.getByRole('heading', { level: 2, name: 'Step-by-Step Engineering & Delivery Workflow' }).textContent()
  expect(enCapH1?.trim()).toBe('Engineering & Manufacturing Capabilities')
  expect(enCapH2?.trim()).toBe('Step-by-Step Engineering & Delivery Workflow')

  await page.goto('/ar/capabilities')
  const arCapH1 = await page.getByRole('heading', { level: 1 }).textContent()
  const arCapH2 = await page.getByRole('heading', { level: 2, name: 'مسار العمل الهندسي والتصنيع خطوة بخطوة' }).textContent()
  expect(arCapH1?.trim()).toBe('القدرات الهندسية والتصنيعية')
  expect(arCapH2?.trim()).toBe('مسار العمل الهندسي والتصنيع خطوة بخطوة')

  await page.goto('/en/for-professionals')
  const enProfH1 = await page.getByRole('heading', { level: 1 }).textContent()
  const enProfH2 = await page.getByRole('heading', { level: 2, name: 'Comprehensive Technical Services by Project Role' }).textContent()
  expect(enProfH1?.trim()).toBe('Engineering Support for Facade Professionals')
  expect(enProfH2?.trim()).toBe('Comprehensive Technical Services by Project Role')

  await page.goto('/ar/for-professionals')
  const arProfH1 = await page.getByRole('heading', { level: 1 }).textContent()
  const arProfH2 = await page.getByRole('heading', { level: 2, name: 'خدمات فنية متكاملة حسب دور المشروع' }).textContent()
  expect(arProfH1?.trim()).toBe('الدعم الهندسي للمهنيين واستشاريي الواجهات')
  expect(arProfH2?.trim()).toBe('خدمات فنية متكاملة حسب دور المشروع')
})

test('mobile ChatWidget hides launcher when dialog is open on small screen and restores focus on close', async ({
  page,
}) => {
  await page.setViewportSize({ height: 844, width: 390 })
  await page.goto('/en')

  const launcher = page.getByRole('button', { name: 'Ask our project assistant' })
  await expect(launcher).toBeVisible()
  await launcher.click()

  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expect(page.locator('.chat-launcher')).not.toBeVisible()

  const closeButton = page.getByRole('button', { name: 'Close chat' })
  await expect(closeButton).toBeVisible()
  await closeButton.click()

  await expect(dialog).not.toBeVisible()
  await expect(launcher).toBeVisible()

  // Assert focus restoration to launcher
  const isLauncherFocused = await page.evaluate(() => {
    const launcherEl = document.querySelector('.chat-launcher')
    return document.activeElement === launcherEl
  })
  expect(isLauncherFocused).toBe(true)
})

test('contact form exposes accessible validation without simulated success', async ({ page }) => {
  await page.goto('/en/contact')
  await page.getByRole('button', { name: 'Submit' }).click()
  await expect(page.getByText('This field is required.').first()).toBeVisible()
  await expect(page.getByLabel('Name *')).toHaveAttribute('aria-invalid', 'true')
  await expect(page.getByLabel('Name *')).toHaveAttribute('aria-describedby', 'name-error')
  await expect(page.getByText(/Thank you|success/i)).toHaveCount(0)
})

test('INQ-01 closes website inquiry, idempotent Lead, Portal, and fake Feishu', async ({
  page,
}) => {
  test.skip(
    !adminUsername || !adminPassword,
    'Requires local non-production administrator credentials.',
  )
  if (!adminUsername || !adminPassword) return
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
    await page.getByRole('button', { name: 'Submit' }).click()
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
    await page.getByRole('textbox', { name: '账号' }).fill(adminUsername)
    await page.getByRole('textbox', { name: '密码' }).fill(adminPassword)
    await page.getByRole('button', { name: '登录后台' }).click()
    await expect(page).toHaveURL(/\/dashboard\/leads$/)
    await page.goto(`/dashboard/leads?q=${encodeURIComponent(email)}`)
    const leadRow = page.locator('.portal-leads__list button').filter({ hasText: email })
    await expect(leadRow).toBeVisible()
    await leadRow.click()
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
