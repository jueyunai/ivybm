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
  it('renders concise home page with distinct layout, independent summaries, and no detail-page long copy in English', async () => {
    vi.mocked(getPageBySlug).mockResolvedValueOnce(mockPage)
    vi.mocked(getProducts).mockResolvedValueOnce(mockProducts)
    vi.mocked(getProjects).mockResolvedValueOnce(mockProjects)
    vi.mocked(getSiteSettings).mockResolvedValueOnce(mockSettings)

    const pageElement = await HomePage({
      params: Promise.resolve({ locale: 'en' }),
    })
    const { container } = render(pageElement)

    // 1. Hero with Upload Drawing primary CTA and View All Projects secondary CTA
    expect(screen.getByRole('heading', { level: 1, name: 'Professional Curved Aluminum Panel Manufacturer' })).toBeDefined()
    expect(screen.getAllByRole('link', { name: /View All Projects/i }).length).toBeGreaterThanOrEqual(1)

    // 2. "How IVY supports your project" 4 steps in distinct home-support-grid (independent short descriptions)
    expect(container.querySelector('.home-support-band')).not.toBeNull()
    expect(container.querySelector('.home-support-grid')).not.toBeNull()
    expect(screen.getByText('How IVY Supports Your Facade Project')).toBeDefined()
    expect(screen.getByText('Design & Engineering')).toBeDefined()
    expect(screen.getByText('Geometry review, panelization, shop drawings and buildability input.')).toBeDefined()
    expect(screen.getByText('Complex Fabrication')).toBeDefined()
    expect(screen.getByText('Flat, curved, perforated and free-form architectural aluminum.')).toBeDefined()
    expect(screen.getByText('Mock-up & QC')).toBeDefined()
    expect(screen.getByText('Representative samples, dimensional checks, finish review and pre-shipment inspection.')).toBeDefined()
    expect(screen.getByText('Global Delivery')).toBeDefined()
    expect(screen.getByText('Panel numbering, export packing, container planning and shipment coordination.')).toBeDefined()

    // Assert that detail-page long descriptions and feature lists do NOT appear on Home page
    expect(screen.queryByText(/BIM coordination, Rhino\/Grasshopper parametric modeling/i)).toBeNull()
    expect(screen.queryByText(/Multi-axis CNC roll-bending, hyperbolic panel forming/i)).toBeNull()
    expect(container.querySelector('.capability-features')).toBeNull()

    // 3. Core Capabilities / Craftsmanship in distinct home-focus-grid (3 focus cards with Explore Capabilities action link)
    expect(container.querySelector('.home-focus-grid')).not.toBeNull()
    expect(screen.getByText('High-Precision Complex Geometry Fabrication')).toBeDefined()
    expect(screen.getByText('Double-Curved & Complex Geometry')).toBeDefined()
    expect(screen.getByText('Curved Louvers & Architectural Fins')).toBeDefined()
    expect(screen.getByText('Mashrabiya & Perforated Metal Panels')).toBeDefined()
    expect(screen.getByRole('link', { name: /Explore Capabilities/i })).toBeDefined()

    // 4. For Professionals in editorial split layout (home-prof-split) with concise summaries
    expect(container.querySelector('.home-prof-split')).not.toBeNull()
    expect(screen.getByText('Engineered for Project Decision Makers')).toBeDefined()
    expect(screen.getByText('Architects & Consultants')).toBeDefined()
    expect(screen.getByText('Geometry optimization, parametric surface rationalization, and physical VMU sample support.')).toBeDefined()
    expect(screen.getByText('Facade Contractors')).toBeDefined()
    expect(screen.getByText('General Contractors & Procurement')).toBeDefined()
    expect(screen.getByRole('link', { name: /Explore Professional Solutions/i })).toBeDefined()

    // Assert that detail-page long role descriptions and highlight lists do NOT appear on Home page
    expect(screen.queryByText(/Transform complex parametric sketches and freeform curves/i)).toBeNull()
    expect(container.querySelector('.role-highlights')).toBeNull()

    // 5. Products & Projects
    expect(screen.getByText('Product Categories')).toBeDefined()
    expect(screen.getByText('Featured Projects')).toBeDefined()

    // 6. Final Upload Drawing CTA
    expect(screen.getByText('Ready for a Buildability Review of Your Facade?')).toBeDefined()
    const allCtaButtons = screen.getAllByRole('link', { name: /Upload Drawing/i })
    expect(allCtaButtons.length).toBeGreaterThanOrEqual(1)
  })

  it('renders Arabic localized concise home narrative, distinct support grid, 3 craftsmanship cards, and Explore Capabilities CTA properly', async () => {
    vi.mocked(getPageBySlug).mockResolvedValueOnce(mockPage)
    vi.mocked(getProducts).mockResolvedValueOnce(mockProducts)
    vi.mocked(getProjects).mockResolvedValueOnce(mockProjects)
    vi.mocked(getSiteSettings).mockResolvedValueOnce(mockSettings)

    const pageElement = await HomePage({
      params: Promise.resolve({ locale: 'ar' }),
    })
    render(pageElement)

    expect(screen.getByText('كيف تدعم IVYBM مشروع واجهتك')).toBeDefined()
    expect(screen.getByText('التصميم والهندسة')).toBeDefined()
    expect(screen.getByText('التصنيع المعقد')).toBeDefined()
    expect(screen.getByText('تصنيع عالي الدقة للأشكال الهندسية المعقدة')).toBeDefined()
    expect(screen.getByText('الألواح مزدوجة الانحناء والأشكال المعقدة')).toBeDefined()
    expect(screen.getByRole('link', { name: /استكشف القدرات الهندسية/i })).toBeDefined()
    expect(screen.getByText('مصمم خصيصًا لصناع القرار في المشاريع')).toBeDefined()
    expect(screen.getByText('المعماريون والاستشاريون')).toBeDefined()
    expect(screen.getByRole('link', { name: /استكشف حلول المهنيين/i })).toBeDefined()
    expect(screen.getByText('هل أنت جاهز لمراجعة قابلية تصنيع واجهتك؟')).toBeDefined()
  })
})
