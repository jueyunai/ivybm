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
  it('renders concise home page with Hero, 4-step workflow summary, 3 craftsmanship focus cards with Explore Capabilities, 3 role summary cards, and final CTA in English', async () => {
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

    // 2. "How IVY supports your project" 4 steps (summary cards, no long features lists)
    expect(screen.getByText('How IVY Supports Your Facade Project')).toBeDefined()
    expect(screen.getByText('Design Deepening & 3D Engineering')).toBeDefined()
    expect(screen.getByText('Complex Hyperbolic Fabrication')).toBeDefined()
    expect(screen.getByText('1:1 Mock-up & Precision Inspection')).toBeDefined()
    expect(screen.getByText('Global Export Delivery & Packaging')).toBeDefined()
    // Verify no capability-features list on home page
    expect(container.querySelector('.capability-features')).toBeNull()

    // 3. Core Capabilities / Craftsmanship (3 concise cards with Explore Capabilities action link)
    expect(screen.getByText('High-Precision Complex Geometry Fabrication')).toBeDefined()
    expect(screen.getByText('Double-Curved & Complex Geometry')).toBeDefined()
    expect(screen.getByText('Curved Louvers & Architectural Fins')).toBeDefined()
    expect(screen.getByText('Mashrabiya & Perforated Metal Panels')).toBeDefined()
    expect(screen.getByRole('link', { name: /Explore Capabilities/i })).toBeDefined()

    // 4. For Professionals 3 Pillars (concise role cards, no long highlights lists)
    expect(screen.getByText('Engineered for Project Decision Makers')).toBeDefined()
    expect(screen.getByText('Architects & Facade Consultants')).toBeDefined()
    expect(screen.getByText('Curtain Wall & Facade Contractors')).toBeDefined()
    expect(screen.getByText('Main Contractors & Procurement Heads')).toBeDefined()
    // Verify no role-highlights list on home page
    expect(container.querySelector('.role-highlights')).toBeNull()

    // 5. Products & Projects
    expect(screen.getByText('Product Categories')).toBeDefined()
    expect(screen.getByText('Featured Projects')).toBeDefined()

    // 6. Final Upload Drawing CTA
    expect(screen.getByText('Ready for a Buildability Review of Your Facade?')).toBeDefined()
    const allCtaButtons = screen.getAllByRole('link', { name: /Upload Drawing/i })
    expect(allCtaButtons.length).toBeGreaterThanOrEqual(1)
  })

  it('renders Arabic localized concise home narrative, 3 craftsmanship cards, and Explore Capabilities CTA properly', async () => {
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
    expect(screen.getByText('الألواح مزدوجة الانحناء والأشكال المعقدة')).toBeDefined()
    expect(screen.getByRole('link', { name: /استكشف القدرات الهندسية/i })).toBeDefined()
    expect(screen.getByText('مصمم خصيصًا لصناع القرار في المشاريع')).toBeDefined()
    expect(screen.getByText('هل أنت جاهز لمراجعة قابلية تصنيع واجهتك؟')).toBeDefined()
  })
})
