import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import ProjectDetailPage from '@/app/(frontend)/[locale]/projects/[slug]/page'
import type { Project, SiteSetting } from '@/payload-types'

const mockProject: Project & Record<string, unknown> = {
  application: 'Airport Terminal Envelope',
  coverImage: 1,
  createdAt: '2026-08-30T00:00:00.000Z',
  id: 10,
  location: 'Dubai, UAE',
  slug: 'dubai-airport-terminal',
  summary: 'International airport expansion featuring hyperbolic aluminum panels.',
  title: 'Dubai International Airport Expansion',
  updatedAt: '2026-08-30T00:00:00.000Z',
}

const mockSettings: SiteSetting = {
  defaultSeo: {},
  siteName: 'IVYBM',
} as SiteSetting

vi.mock('@/lib/website-data', () => ({
  getProjectBySlug: vi.fn(),
  getSiteSettings: vi.fn(),
}))

import { getProjectBySlug, getSiteSettings } from '@/lib/website-data'

afterEach(cleanup)

describe('ProjectDetailPage v1.7 4D Case Study', () => {
  it('renders standard layout without 4D section when 4D fields are empty', async () => {
    vi.mocked(getProjectBySlug).mockResolvedValueOnce(mockProject)
    vi.mocked(getSiteSettings).mockResolvedValueOnce(mockSettings)

    const pageElement = await ProjectDetailPage({
      params: Promise.resolve({ locale: 'en', slug: 'dubai-airport-terminal' }),
    })
    render(pageElement)

    expect(screen.getByRole('heading', { level: 1, name: 'Dubai International Airport Expansion' })).toBeDefined()
    expect(screen.getByText(/Airport Terminal Envelope/)).toBeDefined()
    expect(screen.queryByText('4-Dimensional Project Case Study')).toBeNull()
  })

  it('renders 4D Case Study dimensions when CMS 4D fields are populated', async () => {
    const projectWith4D = {
      ...mockProject,
      observedFocus: 'High wind load zone requiring variable radius curvature.',
      projectSnapshot: 'Total facade area: 25,000 m² with custom fluorocarbon coating.',
      qualityVerification: '100% 3D laser coordinate scan passed with ±1.0mm tolerance.',
      solutionFramework: 'Grasshopper parametric panel subdivision and robotic welding.',
    }
    vi.mocked(getProjectBySlug).mockResolvedValueOnce(projectWith4D as Project)
    vi.mocked(getSiteSettings).mockResolvedValueOnce(mockSettings)

    const pageElement = await ProjectDetailPage({
      params: Promise.resolve({ locale: 'en', slug: 'dubai-airport-terminal' }),
    })
    render(pageElement)

    expect(screen.getByText('4-Dimensional Project Case Study')).toBeDefined()
    expect(screen.getByText('Project Snapshot & Specifications')).toBeDefined()
    expect(screen.getByText('Total facade area: 25,000 m² with custom fluorocarbon coating.')).toBeDefined()
    expect(screen.getByText('Design Challenges & Observed Focus')).toBeDefined()
    expect(screen.getByText('High wind load zone requiring variable radius curvature.')).toBeDefined()
    expect(screen.getByText('Fabrication Solutions & Deepening')).toBeDefined()
    expect(screen.getByText('Grasshopper parametric panel subdivision and robotic welding.')).toBeDefined()
    expect(screen.getByText('Quality Verification & Inspection')).toBeDefined()
    expect(screen.getByText('100% 3D laser coordinate scan passed with ±1.0mm tolerance.')).toBeDefined()
  })
})
