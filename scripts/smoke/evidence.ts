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

/**
 * Capture only a caller-confirmed safe region after a workflow failure.
 *
 * Failure pages are often list views that may contain unrelated customer
 * records. Callers must provide locators whose contents are safe to persist;
 * if none are visible, no screenshot is written.
 */
export const captureSafeFailureEvidence = async ({
  candidates,
  path,
}: {
  candidates: Locator[]
  path: string
}): Promise<boolean> => {
  for (const locator of candidates) {
    let count = 0
    try {
      count = await locator.count()
    } catch {
      continue
    }

    for (let index = 0; index < count; index += 1) {
      const candidate = locator.nth(index)
      if (!(await candidate.isVisible().catch(() => false))) continue
      try {
        await candidate.screenshot({ animations: 'disabled', path })
        return true
      } catch {
        // Try the next explicitly safe candidate.
      }
    }
  }
  return false
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
