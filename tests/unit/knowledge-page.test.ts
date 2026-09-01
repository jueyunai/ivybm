import { cleanup, render, screen } from '@testing-library/react'
import React from 'react'
import { afterEach, describe, expect, it } from 'vitest'

import { KnowledgeView } from '@/components/website/KnowledgeView'
import type { Post } from '@/payload-types'

afterEach(cleanup)

const mockPost: Post = {
  category: 'industry',
  createdAt: '2026-08-30T00:00:00.000Z',
  excerpt: 'A comprehensive engineering guide on hyperbolic aluminum panel fabrication and quality control.',
  id: 101,
  publishedAt: '2026-08-30T00:00:00.000Z',
  slug: 'hyperbolic-aluminum-guide',
  title: 'Hyperbolic Aluminum Panel Fabrication Guide',
  updatedAt: '2026-08-30T00:00:00.000Z',
} as Post

describe('KnowledgeView component', () => {
  it('renders knowledge category tabs and article cards in English', () => {
    render(
      React.createElement(KnowledgeView, {
        locale: 'en',
        posts: [mockPost],
      }),
    )

    expect(screen.getByRole('heading', { level: 1, name: 'Knowledge' })).toBeDefined()
    expect(screen.getByText('All Topics')).toBeDefined()
    expect(screen.getByText('Material Comparison')).toBeDefined()
    expect(screen.getByText('Technical Guide')).toBeDefined()
    expect(screen.getByText('Procurement & BOQ')).toBeDefined()
    expect(screen.getByText('Quality & Logistics')).toBeDefined()
    expect(screen.getByText('Hyperbolic Aluminum Panel Fabrication Guide')).toBeDefined()
    expect(screen.getByRole('link', { name: /Upload Drawing for Review/i })).toBeDefined()
  })

  it('renders Arabic localized category tabs and consultation CTA', () => {
    render(
      React.createElement(KnowledgeView, {
        locale: 'ar',
        posts: [mockPost],
      }),
    )

    expect(screen.getByRole('heading', { level: 1, name: 'المعرفة الفنية' })).toBeDefined()
    expect(screen.getByText('جميع المواضيع')).toBeDefined()
    expect(screen.getByText('مقارنة المواد')).toBeDefined()
    expect(screen.getByText('دليل فني')).toBeDefined()
    expect(screen.getByText('المشتريات وجداول الكميات')).toBeDefined()
    expect(screen.getByText('الجودة واللوجستيات')).toBeDefined()
    expect(screen.getByRole('link', { name: /رفع المخططات للمراجعة/i })).toBeDefined()
  })
})
