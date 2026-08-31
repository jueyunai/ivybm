import { cleanup, render, screen } from '@testing-library/react'
import React from 'react'
import { afterEach, describe, expect, it } from 'vitest'

import { CapabilitiesView } from '@/components/website/CapabilitiesView'

afterEach(cleanup)

describe('CapabilitiesView component', () => {
  it('renders the 4 engineering workflow steps and neutral craftsmanship labels in English', () => {
    render(
      React.createElement(CapabilitiesView, {
        locale: 'en',
      }),
    )

    expect(screen.getByRole('heading', { level: 1, name: 'Engineering & Manufacturing Capabilities' })).toBeDefined()
    expect(screen.getByText('Design Deepening & 3D Engineering')).toBeDefined()
    expect(screen.getByText('Complex Hyperbolic Fabrication')).toBeDefined()
    expect(screen.getByText('1:1 Mock-up & Precision Inspection')).toBeDefined()
    expect(screen.getByText('Global Export Delivery & Packaging')).toBeDefined()
    expect(screen.getByText('Design Deepening')).toBeDefined()
    expect(screen.getByText('Complex Forming')).toBeDefined()
    expect(screen.getByRole('link', { name: /Request Buildability Review/i })).toBeDefined()
  })

  it('renders localized Arabic content and neutral craftsmanship labels', () => {
    render(
      React.createElement(CapabilitiesView, {
        locale: 'ar',
      }),
    )

    expect(screen.getByRole('heading', { level: 1, name: 'القدرات الهندسية والتصنيعية' })).toBeDefined()
    expect(screen.getByText('تعميق التصميم والنمذجة ثلاثية الأبعاد')).toBeDefined()
    expect(screen.getByText('تعميق التصميم')).toBeDefined()
    expect(screen.getByText('التشكيل المعقد')).toBeDefined()
    expect(screen.getByRole('link', { name: /طلب مراجعة قابلية التصنيع/i })).toBeDefined()
  })
})
