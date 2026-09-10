import { expect, type Locator } from '@playwright/test'

export type UiSelectTarget =
  | string
  | { readonly index: number }
  | { readonly label: string }
  | { readonly value: string }

export const selectUiOption = async (trigger: Locator, target: UiSelectTarget): Promise<void> => {
  await expect(trigger).toBeVisible()
  await trigger.click()

  const listbox = trigger.page().getByRole('listbox')
  await expect(listbox).toBeVisible()
  const options = listbox.getByRole('option')
  const optionCount = await options.count()
  let option: Locator | null = null

  if (typeof target === 'object' && 'index' in target) {
    option = options.nth(target.index)
  } else {
    const targetValue =
      typeof target === 'string' ? target : 'value' in target ? target.value : undefined
    const targetLabel =
      typeof target === 'string' ? target : 'label' in target ? target.label : undefined

    for (let index = 0; index < optionCount; index += 1) {
      const candidate = options.nth(index)
      const [value, label] = await Promise.all([
        candidate.getAttribute('data-value'),
        candidate.textContent(),
      ])
      if (value === targetValue || label?.trim() === targetLabel) {
        option = candidate
        break
      }
    }
  }

  if (!option) {
    throw new Error(`UiSelect option was not found: ${JSON.stringify(target)}`)
  }

  const expectedLabel = (await option.textContent())?.trim() ?? ''
  await expect(option).toBeVisible()
  await option.click()
  await expect(listbox).toBeHidden()
  await expect(trigger).toContainText(expectedLabel)
}
