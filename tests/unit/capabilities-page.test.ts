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

    const h1 = screen.getByRole('heading', { level: 1, name: 'Engineering & Manufacturing Capabilities' })
    const h2 = screen.getByRole('heading', { level: 2, name: 'Step-by-Step Engineering & Delivery Workflow' })
    expect(h1).toBeDefined()
    expect(h2).toBeDefined()
    expect(h1.textContent).not.toBe(h2.textContent)
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

    const h1 = screen.getByRole('heading', { level: 1, name: 'القدرات الهندسية والتصنيعية' })
    const h2 = screen.getByRole('heading', { level: 2, name: 'مسار العمل الهندسي والتصنيع خطوة بخطوة' })
    expect(h1).toBeDefined()
    expect(h2).toBeDefined()
    expect(h1.textContent).not.toBe(h2.textContent)
    expect(screen.getByText('تعميق التصميم والنمذجة ثلاثية الأبعاد')).toBeDefined()
    expect(screen.getByText('تعميق التصميم')).toBeDefined()
    expect(screen.getByText('التشكيل المعقد')).toBeDefined()
    expect(screen.getByRole('link', { name: /طلب مراجعة قابلية التصنيع/i })).toBeDefined()
  })
})
