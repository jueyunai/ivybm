import { fireEvent, screen, within } from '@testing-library/react'

export const selectUiOption = (
  trigger: HTMLElement,
  target: string | { readonly index: number } | { readonly label: string },
): void => {
  if (!HTMLElement.prototype.hasPointerCapture) {
    HTMLElement.prototype.hasPointerCapture = () => false
  }
  if (!HTMLElement.prototype.setPointerCapture) {
    HTMLElement.prototype.setPointerCapture = () => undefined
  }
  if (!HTMLElement.prototype.releasePointerCapture) {
    HTMLElement.prototype.releasePointerCapture = () => undefined
  }
  if (!HTMLElement.prototype.scrollIntoView) {
    HTMLElement.prototype.scrollIntoView = () => undefined
  }

  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' })

  const listbox = screen.getByRole('listbox')
  const options = within(listbox).getAllByRole('option')
  const option =
    typeof target === 'string'
      ? options.find(
          (item) =>
            item.getAttribute('data-value') === target || item.textContent?.trim() === target,
        )
      : 'label' in target
        ? options.find((item) => item.textContent?.trim() === target.label)
        : options[target.index]

  if (!option) {
    throw new Error(`UiSelect option was not found: ${JSON.stringify(target)}`)
  }

  fireEvent.click(option)
}
