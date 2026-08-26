import type { Locator, Page } from '@playwright/test'

export const capturePageEvidence = async ({
  fullPage = true,
  page,
  path,
}: {
  fullPage?: boolean
  page: Page
  path: string
}): Promise<boolean> => {
  try {
    await page.screenshot({ animations: 'disabled', fullPage, path })
    return true
  } catch {
    return false
  }
}

export const captureLocatorEvidence = async ({
  locator,
  path,
}: {
  locator: Locator
  path: string
}): Promise<boolean> => {
  try {
    await locator.screenshot({ animations: 'disabled', path })
    return true
  } catch {
    return false
  }
}
