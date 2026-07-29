import React from 'react'

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { Button, PortalState, StatusBadge, Surface } from '@/admin-portal/core/ui'

afterEach(cleanup)

describe('Portal UI primitives', () => {
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
})
