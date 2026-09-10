import React from 'react'

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  Button,
  ConfirmDialog,
  FormDialog,
  ModalDialog,
  PortalState,
  SearchInput,
  StatusBadge,
  Surface,
  UiSelect,
} from '@/admin-portal/core/ui'

import { selectUiOption } from './support/uiSelect'

afterEach(cleanup)

describe('Portal UI primitives', () => {
  beforeEach(() => {
    window.HTMLElement.prototype.hasPointerCapture = vi.fn()
    window.HTMLElement.prototype.setPointerCapture = vi.fn()
    window.HTMLElement.prototype.releasePointerCapture = vi.fn()
    window.HTMLElement.prototype.scrollIntoView = vi.fn()
  })

  it('renders a stable button without changing native semantics', () => {
    render(React.createElement(Button, { disabled: true }, 'Save changes'))

    const button = screen.getByRole('button', { name: 'Save changes' }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    expect(button.className).toContain('portal-button')
  })

  it('pairs every status tone with text and a visible semantic icon', () => {
    const { container } = render(
      React.createElement(StatusBadge, { label: 'Needs attention', tone: 'warning' }),
    )

    expect(screen.getByText('Needs attention')).toBeTruthy()
    expect(container.querySelector('svg[aria-hidden="true"]')).toBeTruthy()
    expect(container.querySelector('.portal-status-badge--warning')).toBeTruthy()
  })

  it('renders loading, empty, error, forbidden, blocked, and dependency states accessibly', () => {
    const states = [
      'loading',
      'empty',
      'error',
      'forbidden',
      'blocked',
      'dependency-gated',
    ] as const

    for (const state of states) {
      const { unmount } = render(
        React.createElement(PortalState, {
          description: `${state} description`,
          title: `${state} title`,
          type: state,
        }),
      )
      expect(screen.getByText(`${state} title`)).toBeTruthy()
      expect(screen.getByText(`${state} description`)).toBeTruthy()
      unmount()
    }
  })

  it('uses a semantic element for unframed and framed surfaces', () => {
    const { rerender } = render(React.createElement(Surface, { as: 'section' }, 'Section content'))
    expect(screen.getByText('Section content').tagName).toBe('SECTION')

    rerender(React.createElement(Surface, { as: 'article', variant: 'subtle' }, 'Article content'))
    expect(screen.getByText('Article content').tagName).toBe('ARTICLE')
  })

  it('renders a unified UiSelect component and selects an option through its listbox', async () => {
    const onChange = vi.fn()
    const options = [
      { label: '全部状态', value: 'all' },
      { label: '活跃项', value: 'active' },
      { label: '草稿', value: 'draft' },
    ]
    const { unmount } = render(
      React.createElement(UiSelect, {
        ariaLabel: 'Filter status',
        defaultValue: 'all',
        name: 'status',
        onChange,
        options,
      }),
    )

    const trigger = screen.getByRole('combobox', { name: 'Filter status' })
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(screen.getByText('全部状态')).toBeTruthy()

    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' })
    const listbox = await screen.findByRole('listbox')
    fireEvent.click(within(listbox).getByRole('option', { name: '活跃项' }))

    expect(onChange).toHaveBeenCalledWith('active')
    expect(trigger.textContent).toContain('活跃项')
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    unmount()
  })

  it('supports controlled mode in UiSelect with value prop', () => {
    const onChange = vi.fn()
    const options = [
      { label: '全部平台', value: 'all' },
      { label: 'Facebook', value: 'facebook' },
      { label: 'Instagram', value: 'instagram' },
    ]
    const { rerender, unmount } = render(
      React.createElement(UiSelect, {
        ariaLabel: 'Platform filter',
        name: 'platform',
        onChange,
        options,
        value: 'all',
      }),
    )

    expect(screen.getByRole('combobox', { name: 'Platform filter' })).toBeTruthy()
    expect(screen.getByText('全部平台')).toBeTruthy()

    // 受控模式下由外部重新传入 value 驱动展示文本更新
    rerender(
      React.createElement(UiSelect, {
        ariaLabel: 'Platform filter',
        name: 'platform',
        onChange,
        options,
        value: 'facebook',
      }),
    )
    expect(screen.getByText('Facebook')).toBeTruthy()
    unmount()
  })

  it('supports keyboard selection, skips disabled options, and restores trigger focus', async () => {
    const onChange = vi.fn()
    render(
      React.createElement(UiSelect, {
        ariaLabel: 'Keyboard status',
        defaultValue: 'all',
        onChange,
        options: [
          { label: '全部状态', value: 'all' },
          { disabled: true, label: '不可用', value: 'disabled' },
          { label: '草稿', value: 'draft' },
        ],
      }),
    )

    const trigger = screen.getByRole('combobox', { name: 'Keyboard status' })
    trigger.focus()
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    await screen.findByRole('listbox')
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'ArrowDown' })
    await waitFor(() => expect(document.activeElement?.textContent).toContain('草稿'))
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Enter' })

    expect(onChange).toHaveBeenCalledWith('draft')
    await waitFor(() => expect(document.activeElement).toBe(trigger))
  })

  it('closes a UiSelect with Escape without closing its parent dialog', async () => {
    const onOpenChange = vi.fn()
    render(
      React.createElement(
        ModalDialog,
        {
          onOpenChange,
          open: true,
          title: 'Select dialog',
        },
        React.createElement(UiSelect, {
          ariaLabel: 'Dialog status',
          defaultValue: 'all',
          options: [
            { label: '全部状态', value: 'all' },
            { label: '草稿', value: 'draft' },
          ],
        }),
      ),
    )

    const trigger = screen.getByRole('combobox', { name: 'Dialog status' })
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' })
    const listbox = await screen.findByRole('listbox')
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Escape' })

    await waitFor(() => expect(listbox.getAttribute('data-state')).toBe('closed'))
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
    await waitFor(() => expect(document.activeElement).toBe(trigger))
  })

  it('restores an uncontrolled UiSelect on native form reset', () => {
    const { container } = render(
      React.createElement(
        'form',
        null,
        React.createElement(UiSelect, {
          ariaLabel: 'Resettable status',
          defaultValue: 'all',
          name: 'status',
          options: [
            { label: '全部状态', value: 'all' },
            { label: '活跃项', value: 'active' },
          ],
        }),
      ),
    )
    const form = container.querySelector('form') as HTMLFormElement
    const trigger = screen.getByRole('combobox', { name: 'Resettable status' })

    selectUiOption(trigger, 'active')
    expect(new FormData(form).get('status')).toBe('active')
    fireEvent.reset(form)

    expect(trigger.textContent).toContain('全部状态')
    expect(new FormData(form).get('status')).toBe('all')
  })

  it('preserves required and FormData semantics through the Radix form control', () => {
    const { container } = render(
      React.createElement(
        'form',
        null,
        React.createElement(UiSelect, {
          ariaLabel: 'Required selection',
          name: 'status',
          options: [
            { label: '—', value: '' },
            { label: 'Available option', value: 'available' },
          ],
          required: true,
          value: '',
        }),
      ),
    )

    const trigger = screen.getByRole('combobox', { name: 'Required selection' })
    const form = container.querySelector('form') as HTMLFormElement
    const formControl = form.querySelector('[data-ui-select-control]') as HTMLInputElement

    expect(trigger.getAttribute('aria-required')).toBe('true')
    expect(formControl.required).toBe(true)
    expect(form.checkValidity()).toBe(false)
    expect(new FormData(form).get('status')).toBe('')
  })

  it('clears a custom validity error after the user selects a valid option', () => {
    const { container } = render(
      React.createElement(
        'form',
        null,
        React.createElement(UiSelect, {
          ariaLabel: 'Required selection',
          defaultValue: '',
          name: 'status',
          options: [
            { label: '—', value: '' },
            { label: 'Available option', value: 'available' },
          ],
          required: true,
        }),
      ),
    )

    const form = container.querySelector('form') as HTMLFormElement
    const formControl = form.querySelector('[data-ui-select-control]') as HTMLInputElement
    formControl.setCustomValidity('请选择有效选项')

    selectUiOption(screen.getByRole('combobox', { name: 'Required selection' }), 'available')

    expect(formControl.validationMessage).toBe('')
    expect(form.checkValidity()).toBe(true)
    expect(new FormData(form).get('status')).toBe('available')
  })

  it('renders a unified SearchInput component with search icon and search semantics', () => {
    render(
      React.createElement(SearchInput, {
        name: 'q',
        placeholder: 'Search items...',
      }),
    )

    const input = screen.getByPlaceholderText('Search items...') as HTMLInputElement
    expect(input.type).toBe('search')
    expect(input.name).toBe('q')
  })

  it('renders ModalDialog, ConfirmDialog, and FormDialog accessible markup', () => {
    const onOpenChange = vi.fn()
    const onConfirm = vi.fn()

    const { unmount: unmountConfirm } = render(
      React.createElement(ConfirmDialog, {
        closeLabel: 'Dismiss deletion',
        description: 'Permanent delete test',
        onConfirm,
        onOpenChange,
        open: true,
        title: 'Confirm deletion',
      }),
    )

    expect(screen.getByRole('heading', { name: 'Confirm deletion' })).toBeTruthy()
    expect(screen.getByText('Permanent delete test')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Dismiss deletion' })).toBeTruthy()
    const confirmButton = screen.getByRole('button', { name: '确认' })
    fireEvent.click(confirmButton)
    expect(onConfirm).toHaveBeenCalled()
    unmountConfirm()

    const { unmount: unmountForm } = render(
      React.createElement(
        FormDialog,
        {
          closeLabel: 'Dismiss form',
          description: 'Edit entity form',
          onOpenChange,
          onSubmit: vi.fn(),
          open: true,
          title: 'Edit entity',
        },
        React.createElement('input', { 'aria-label': 'Entity name', defaultValue: 'Test' }),
      ),
    )

    expect(screen.getByRole('heading', { name: 'Edit entity' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Dismiss form' })).toBeTruthy()
    unmountForm()

    const { unmount: unmountModal } = render(
      React.createElement(
        ModalDialog,
        {
          closeLabel: 'Close generic dialog',
          description: 'Generic modal content',
          onOpenChange,
          open: true,
          title: 'Generic modal',
        },
        React.createElement('div', null, 'Inner dialog content'),
      ),
    )

    expect(screen.getByRole('heading', { name: 'Generic modal' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Close generic dialog' })).toBeTruthy()
    unmountModal()
  })
})
