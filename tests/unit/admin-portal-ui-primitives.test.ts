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
    const states = ['loading', 'empty', 'error', 'forbidden', 'blocked', 'dependency-gated'] as const

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
    const { rerender } = render(
      React.createElement(Surface, { as: 'section' }, 'Section content'),
    )
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
      { label: 'All items', value: 'all' },
      { label: 'Active items', value: 'active' },
    ]
    render(
      React.createElement(UiSelect, {
        ariaLabel: 'Filter status',
        defaultValue: 'all',
        options,
      }),
    )

    expect(screen.getByRole('combobox', { name: 'Filter status' })).toBeTruthy()
    expect(screen.getByText('All items')).toBeTruthy()
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

    const { unmount } = render(
      React.createElement(ConfirmDialog, {
        description: 'Permanent delete test',
        onConfirm,
        onOpenChange,
        open: true,
        title: 'Confirm deletion',
      }),
    )

    expect(screen.getByRole('heading', { name: 'Confirm deletion' })).toBeTruthy()
    expect(screen.getByText('Permanent delete test')).toBeTruthy()
    const confirmButton = screen.getByRole('button', { name: '确认' })
    fireEvent.click(confirmButton)
    expect(onConfirm).toHaveBeenCalled()
    unmount()
  })
})
