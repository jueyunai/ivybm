import './require-mutation-launch'
import { expect, test } from '@playwright/test'

const uniqueTestIP = () => `2001:db8::${crypto.randomUUID().slice(0, 4)}`

test('English inquiry validates and persists a real success state', async ({ page }) => {
  await page.setExtraHTTPHeaders({ 'x-real-ip': uniqueTestIP() })
  await page.goto('/en/contact')
  await page.getByRole('button', { name: 'Submit' }).click()
  await expect(page.getByText('This field is required.').first()).toBeVisible()

  await page.getByLabel('Name *').fill('E2E Buyer')
  await page.getByLabel('Email *').fill(`e2e-${Date.now()}@example.com`)
  await page.getByLabel('Phone').fill('+971501234567')
  await page.getByLabel('Country *').selectOption('United Arab Emirates')
  await page.getByLabel('Message *').fill('Please quote a double-curved facade package.')
  await page.getByRole('button', { name: 'Submit' }).click()

  await expect(page.getByText(/Inquiry received/)).toBeVisible()
  await expect(page.locator('[data-testid="inquiry-request-id"]')).toHaveText(/^[0-9a-f-]{36}$/)
})

test('Arabic inquiry renders localized failure and success states', async ({ page }) => {
  await page.setExtraHTTPHeaders({ 'x-real-ip': uniqueTestIP() })
  await page.goto('/ar/contact')
  await page.getByRole('button', { name: 'إرسال' }).click()
  await expect(page.getByText('هذا الحقل مطلوب.').first()).toBeVisible()

  await page.getByLabel('الاسم *').fill('عميل اختبار')
  await page.getByLabel('البريد الإلكتروني *').fill(`ar-e2e-${Date.now()}@example.com`)
  await page.getByLabel('الدولة *').selectOption('United Arab Emirates')
  await page.getByLabel('الرسالة *').fill('نريد عرض سعر لمشروع واجهة.')
  await page.getByRole('button', { name: 'إرسال' }).click()

  await expect(page.getByText(/تم استلام الاستفسار/)).toBeVisible()
})

test('the public endpoint is idempotent for browser retries', async ({ request }) => {
  const idempotencyKey = crypto.randomUUID()
  const input = {
    country: 'Oman',
    email: `retry-${Date.now()}@example.com`,
    idempotencyKey,
    locale: 'en',
    message: 'Retry-safe inquiry',
    name: 'Retry Buyer',
    website: '',
  }
  const headers = { 'x-real-ip': uniqueTestIP() }
  const first = await request.post('/api/inquiries', { data: input, headers })
  const second = await request.post('/api/inquiries', {
    data: { ...input, message: 'Retry body' },
    headers,
  })

  expect(first.status()).toBe(201)
  expect(second.status()).toBe(200)
  expect((await second.json()).requestId).toBe((await first.json()).requestId)
})

test('a no-JavaScript form submission returns an understandable result page', async ({
  browser,
}) => {
  const context = await browser.newContext({
    extraHTTPHeaders: { 'x-real-ip': uniqueTestIP() },
    javaScriptEnabled: false,
  })
  const page = await context.newPage()
  await page.goto('/en/contact')
  await page.getByLabel('Name *').fill('No JS Buyer')
  await page.getByLabel('Email *').fill(`no-js-${Date.now()}@example.com`)
  await page.getByLabel('Country *').selectOption('Qatar')
  await page.getByLabel('Message *').fill('No JavaScript inquiry submission.')
  await page.getByRole('button', { name: 'Submit' }).click({ force: true })

  await expect(page.getByRole('heading', { name: 'Inquiry received' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Return to contact page' })).toHaveAttribute(
    'href',
    '/en/contact',
  )
  await context.close()
})
