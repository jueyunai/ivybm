import { cleanup, render, screen } from '@testing-library/react'
import React from 'react'
import { afterEach, describe, expect, it } from 'vitest'

import { ForProfessionalsView } from '@/components/website/ForProfessionalsView'

afterEach(cleanup)

describe('ForProfessionalsView component', () => {
  it('renders the 3 key professional decision-maker roles in English', () => {
    render(
      React.createElement(ForProfessionalsView, {
        locale: 'en',
      }),
    )

    expect(screen.getByRole('heading', { level: 1, name: 'Engineering Support for Facade Professionals' })).toBeDefined()
    expect(screen.getByText('Architects & Facade Consultants')).toBeDefined()
    expect(screen.getByText('Curtain Wall & Facade Contractors')).toBeDefined()
    expect(screen.getByText('Main Contractors & Procurement Heads')).toBeDefined()
    expect(screen.getAllByRole('link', { name: /Request Buildability Review/i }).length).toBe(3)
    expect(screen.getByRole('link', { name: /Upload Project Drawings/i })).toBeDefined()
  })

  it('renders localized Arabic content for all 3 professional roles', () => {
    render(
      React.createElement(ForProfessionalsView, {
        locale: 'ar',
      }),
    )

    expect(screen.getByRole('heading', { level: 1, name: 'الدعم الهندسي للمهنيين واستشاريي الواجهات' })).toBeDefined()
    expect(screen.getByText('المعماريون واستشاريو الواجهات')).toBeDefined()
    expect(screen.getByText('مقاولو الواجهات وكسوات الجدران')).toBeDefined()
    expect(screen.getByText('المقاولون الرئيسيون ومديرو المشتريات')).toBeDefined()
    expect(screen.getByRole('link', { name: /رفع مخططات المشروع/i })).toBeDefined()
  })
})
