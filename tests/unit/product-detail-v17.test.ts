import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import ProductDetailPage from '@/app/(frontend)/[locale]/products/[slug]/page'
import type { Product, SiteSetting } from '@/payload-types'

const mockProduct: Product & Record<string, unknown> = {
  category: 1,
  coverImage: 1,
  createdAt: '2026-08-30T00:00:00.000Z',
  id: 1,
  shortDescription: 'Premium double-curved aluminum facade panel.',
  slug: 'double-curved-aluminum-panel',
  title: 'Double-Curved Aluminum Panel',
  updatedAt: '2026-08-30T00:00:00.000Z',
}

const mockSettings: SiteSetting = {
  defaultSeo: {},
  siteName: 'IVYBM',
} as SiteSetting

vi.mock('@/lib/website-data', () => ({
  getProductBySlug: vi.fn(),
  getSiteSettings: vi.fn(),
}))

import { getProductBySlug, getSiteSettings } from '@/lib/website-data'

afterEach(cleanup)

describe('ProductDetailPage v1.7 CMS Workflow & Disclaimer', () => {
  it('renders default 4-step engineering workflow and fallback disclaimer when CMS fields are empty', async () => {
    vi.mocked(getProductBySlug).mockResolvedValueOnce(mockProduct)
    vi.mocked(getSiteSettings).mockResolvedValueOnce(mockSettings)

    const pageElement = await ProductDetailPage({
      params: Promise.resolve({ locale: 'en', slug: 'double-curved-aluminum-panel' }),
    })
    render(pageElement)

    expect(screen.getByText('Engineering Workflow & Production Control')).toBeDefined()
    expect(screen.getByText('Design Deepening & 3D Engineering')).toBeDefined()
    expect(screen.getByText('Complex Hyperbolic Fabrication')).toBeDefined()
    expect(screen.getByText('1:1 Mock-up & Precision Inspection')).toBeDefined()
    expect(screen.getByText('Global Export Delivery & Packaging')).toBeDefined()
  })

  it('renders CMS engineering workflow and disclaimer when CMS fields are present', async () => {
    const productWithCmsFields = {
      ...mockProduct,
      disclaimer: 'Custom project-specific compliance disclaimer from CMS.',
      engineeringWorkflow: [
        { description: 'Parametric BIM mesh generation.', step: '01', title: 'BIM Deepening' },
        { description: 'Multi-axis CNC roll-bending.', step: '02', title: 'CNC Bending' },
      ],
    }
    vi.mocked(getProductBySlug).mockResolvedValueOnce(productWithCmsFields as Product)
    vi.mocked(getSiteSettings).mockResolvedValueOnce(mockSettings)

    const pageElement = await ProductDetailPage({
      params: Promise.resolve({ locale: 'en', slug: 'double-curved-aluminum-panel' }),
    })
    render(pageElement)

    expect(screen.getByText('BIM Deepening')).toBeDefined()
    expect(screen.getByText('Parametric BIM mesh generation.')).toBeDefined()
    expect(screen.getByText('CNC Bending')).toBeDefined()
    expect(screen.getByText('Custom project-specific compliance disclaimer from CMS.')).toBeDefined()
  })
})
