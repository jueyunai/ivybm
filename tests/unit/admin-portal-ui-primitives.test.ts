import React from 'react'

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  Button,
  ConfirmDialog,
  FormDialog,
  ModalDialog,
  PortalState,
  SearchInput,
  Select,
  StatusBadge,
  Surface,
  UiSelect,
} from '@/admin-portal/core/ui'

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

  it('renders a unified Select component with options and chevron', () => {
    const options = [
      { label: 'All items', value: 'all' },
      { label: 'Active items', value: 'active' },
    ]
    render(
      React.createElement(Select, {
        'aria-label': 'Filter status',
        defaultValue: 'all',
        options,
      }),
    )

    const select = screen.getByRole('combobox', { name: 'Filter status' }) as HTMLSelectElement
    expect(select.value).toBe('all')
    expect(screen.getByText('Active items')).toBeTruthy()
  })

  it('renders a unified UiSelect component with Radix trigger', () => {
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
        options,
      }),
    )

    const trigger = screen.getByRole('combobox', { name: 'Filter status' })
    expect(trigger).toBeTruthy()
    expect(screen.getByText('全部状态')).toBeTruthy()
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

  it('passes required semantics to the native UiSelect control', () => {
    render(
      React.createElement(UiSelect, {
        ariaLabel: 'Required selection',
        options: [
          { label: '—', value: '' },
          { label: 'Available option', value: 'available' },
        ],
        required: true,
        value: '',
      }),
    )

    const select = screen.getByRole('combobox', {
      name: 'Required selection',
    }) as HTMLSelectElement
    expect(select.required).toBe(true)
    expect(select.checkValidity()).toBe(false)
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
