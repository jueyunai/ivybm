import { expect, test } from '@playwright/test'

const routes = [
  { name: 'home', path: '' },
  { name: 'about', path: '/about' },
  { name: 'products', path: '/products' },
  { name: 'projects', path: '/projects' },
  { name: 'news', path: '/news' },
  { name: 'contact', path: '/contact' },
]

const viewports = [
  { height: 900, name: 'desktop', width: 1440 },
  { height: 1024, name: 'tablet', width: 768 },
  { height: 844, name: 'mobile', width: 390 },
]

for (const locale of ['en', 'ar'] as const) {
  for (const viewport of viewports) {
    test.describe(`${locale} ${viewport.name} visual baseline`, () => {
      test.use({ viewport })

      for (const route of routes) {
        test(`${route.name} matches the approved composition`, async ({ page }) => {
          await page.emulateMedia({ reducedMotion: 'reduce' })
          await page.goto(`/${locale}${route.path}`)
          await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' })
          await expect(page.locator('main')).toBeVisible()
          await expect(page).toHaveScreenshot(`${locale}-${viewport.name}-${route.name}.png`, {
            animations: 'disabled',
            fullPage: true,
            timeout: 10_000,
          })
        })
      }
    })
  }
}
