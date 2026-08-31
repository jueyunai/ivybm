import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import HomePage from '@/app/(frontend)/[locale]/page'
import type { Page, Product, Project, SiteSetting } from '@/payload-types'

const mockPage: Page = {
  createdAt: '2026-08-30T00:00:00.000Z',
  id: 1,
  slug: 'home',
  summary: 'Professional facade engineering and custom aluminum panel manufacturing.',
  title: 'Professional Curved Aluminum Panel Manufacturer',
  updatedAt: '2026-08-30T00:00:00.000Z',
}

const mockProducts: Product[] = [
  {
    category: 1,
    coverImage: 1,
    createdAt: '2026-08-30T00:00:00.000Z',
    id: 101,
    shortDescription: 'Custom double curved panel.',
    slug: 'double-curved-panel',
    title: 'Double-Curved Aluminum Panel',
    updatedAt: '2026-08-30T00:00:00.000Z',
  } as Product,
]

const mockProjects: Project[] = [
  {
    coverImage: 1,
    createdAt: '2026-08-30T00:00:00.000Z',
    id: 201,
    slug: 'dubai-tower',
    summary: 'Landmark facade in Dubai.',
    title: 'Dubai Landmark Tower',
    updatedAt: '2026-08-30T00:00:00.000Z',
  } as Project,
]

const mockSettings: SiteSetting = {
  defaultSeo: {},
  siteName: 'IVYBM',
} as SiteSetting

vi.mock('@/lib/website-data', () => ({
  getPageBySlug: vi.fn(),
  getProducts: vi.fn(),
  getProjects: vi.fn(),
  getSiteSettings: vi.fn(),
}))

import { getPageBySlug, getProducts, getProjects, getSiteSettings } from '@/lib/website-data'

afterEach(cleanup)

describe('HomePage v1.7 Narrative & Structure', () => {
  it('renders home page with Hero Upload Drawing CTA, 4-step workflow, core craftsmanship, professionals pillars, and final CTA in English', async () => {
    vi.mocked(getPageBySlug).mockResolvedValueOnce(mockPage)
    vi.mocked(getProducts).mockResolvedValueOnce(mockProducts)
    vi.mocked(getProjects).mockResolvedValueOnce(mockProjects)
    vi.mocked(getSiteSettings).mockResolvedValueOnce(mockSettings)

    const pageElement = await HomePage({
      params: Promise.resolve({ locale: 'en' }),
    })
    render(pageElement)

    // 1. Hero with Upload Drawing primary CTA and View All Projects secondary CTA
    expect(screen.getByRole('heading', { level: 1, name: 'Professional Curved Aluminum Panel Manufacturer' })).toBeDefined()
    expect(screen.getAllByRole('link', { name: /View All Projects/i }).length).toBeGreaterThanOrEqual(1)

    // 2. "How IVY supports your project" 4 steps
    expect(screen.getByText('How IVY Supports Your Facade Project')).toBeDefined()
    expect(screen.getByText('Design Deepening & 3D Engineering')).toBeDefined()
    expect(screen.getByText('Complex Hyperbolic Fabrication')).toBeDefined()
    expect(screen.getByText('1:1 Mock-up & Precision Inspection')).toBeDefined()
    expect(screen.getByText('Global Export Delivery & Packaging')).toBeDefined()

    // 3. Core Capabilities / Craftsmanship (Neutral Labels, No unconfirmed assertions)
    expect(screen.getByText('High-Precision Complex Geometry Fabrication')).toBeDefined()
    expect(screen.getByText('Design Deepening')).toBeDefined()
    expect(screen.getByText('Complex Forming')).toBeDefined()

    // 4. For Professionals 3 Pillars
    expect(screen.getByText('Engineered for Project Decision Makers')).toBeDefined()
    expect(screen.getByText('Architects & Facade Consultants')).toBeDefined()
    expect(screen.getByText('Curtain Wall & Facade Contractors')).toBeDefined()
    expect(screen.getByText('Main Contractors & Procurement Heads')).toBeDefined()

    // 5. Products & Projects
    expect(screen.getByText('Product Categories')).toBeDefined()
    expect(screen.getByText('Featured Projects')).toBeDefined()

    // 6. Final Upload Drawing CTA
    expect(screen.getByText('Ready for a Buildability Review of Your Facade?')).toBeDefined()
    const allCtaButtons = screen.getAllByRole('link', { name: /Upload Drawing/i })
    expect(allCtaButtons.length).toBeGreaterThanOrEqual(1)
  })

  it('renders Arabic localized home narrative and CTA properly', async () => {
    vi.mocked(getPageBySlug).mockResolvedValueOnce(mockPage)
    vi.mocked(getProducts).mockResolvedValueOnce(mockProducts)
    vi.mocked(getProjects).mockResolvedValueOnce(mockProjects)
    vi.mocked(getSiteSettings).mockResolvedValueOnce(mockSettings)

    const pageElement = await HomePage({
      params: Promise.resolve({ locale: 'ar' }),
    })
    render(pageElement)

    expect(screen.getByText('كيف تدعم IVYBM مشروع واجهتك')).toBeDefined()
    expect(screen.getByText('تصنيع عالي الدقة للأشكال الهندسية المعقدة')).toBeDefined()
    expect(screen.getByText('مصمم خصيصًا لصناع القرار في المشاريع')).toBeDefined()
    expect(screen.getByText('هل أنت جاهز لمراجعة قابلية تصنيع واجهتك؟')).toBeDefined()
  })
})
