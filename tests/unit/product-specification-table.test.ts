// @vitest-environment node

import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { SpecificationTable } from '../../src/components/website/Cards'

describe('SpecificationTable', () => {
  it('renders only rows with both a non-empty label and value', () => {
    const markup = renderToStaticMarkup(
      React.createElement(SpecificationTable, {
        rows: [
          { label: 'Thickness', value: '2.0 mm' },
          { label: '', value: 'PVDF' },
          { label: 'Finish', value: '   ' },
        ],
      }),
    )

    expect(markup).toContain('Thickness')
    expect(markup).toContain('2.0 mm')
    expect(markup).not.toContain('PVDF')
    expect(markup.match(/<tr>/g)).toHaveLength(1)
  })

  it('does not render a table when every row is incomplete', () => {
    const markup = renderToStaticMarkup(
      React.createElement(SpecificationTable, {
        rows: [
          { label: '', value: '' },
          { label: 'Finish', value: '   ' },
        ],
      }),
    )

    expect(markup).toBe('')
  })
})
