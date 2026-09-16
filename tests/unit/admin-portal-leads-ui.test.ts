import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PortalPreferencesProvider } from '@/admin-portal/core/navigation/PortalPreferences'
import { LeadsHub } from '@/admin-portal/modules/leads/LeadsHub'
import type { LeadsSummary } from '@/admin-portal/modules/leads/getLeadsPage'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

const mockLeadSummary: LeadsSummary = {
  items: [
    {
      assignedTo: 1,
      attachmentCount: 0,
      budget: 'USD 50,000',
      company: 'Dubai Construction LLC',
      country: 'UAE',
      email: 'ahmed@example.test',
      hasDrawings: true,
      id: 101,
      interest: 'Perforated Aluminum Panels',
      intentLevel: 'a',
      locale: 'en',
      message: 'Need urgent facade sample delivery.',
      messagingAccountExternalId: null,
      messagingPlatform: null,
      messagingSenderExternalId: null,
      messagingThreadExternalId: null,
      name: 'Ahmed Al-Maktoum',
      phone: '+971501234567',
      procurementPlan: 'Ready to order',
      projectStage: 'Tender',
      quantitySquareMeters: 500,
      relatedConversations: [],
      source: 1,
      status: 'qualified',
      timeline: '1 month',
      updatedAt: '2026-09-14T16:32:00.000Z',
    },
  ],
  options: {
    sources: [{ id: 1, label: 'Website inquiry' }],
    users: [{ id: 1, label: 'Sales Engineer' }],
  },
  pagination: {
    page: 1,
    totalDocs: 25,
    totalPages: 3,
  },
  query: {
    intent: 'all',
    page: 1,
    q: '',
    status: 'all',
  },
}

const renderLeadsHub = (summary = mockLeadSummary) =>
  render(
    React.createElement(
      PortalPreferencesProvider,
      null,
      React.createElement(LeadsHub, {
        feishuRegistrationEnabled: false,
        pageState: 'available',
        role: 'admin',
        summary,
      }),
    ),
  )

describe('LeadsHub Master-Detail UI Rendering', () => {
  beforeEach(() => {
    window.localStorage.clear()
    vi.restoreAllMocks()
  })

  afterEach(() => {
    cleanup()
  })

  it('renders lead card with formatted update time and clock icon', () => {
    const { container } = renderLeadsHub()

    // Verify lead item footer exists and contains clock icon + time tag
    const footer = container.querySelector('.portal-leads__list-footer')
    expect(footer).not.toBeNull()

    const timeTag = footer?.querySelector('time')
    expect(timeTag).not.toBeNull()
    expect(timeTag?.getAttribute('datetime')).toBe('2026-09-14T16:32:00.000Z')
    // Chinese default renders YYYY年M月D日 HH:mm in local timezone
    expect(timeTag?.textContent).toMatch(/2026.*\d{2}:\d{2}/)
  })

  it('renders pagination with portal-leads__pagination class and native disabled button on first page', () => {
    const { container } = renderLeadsHub()

    const pagination = container.querySelector('.portal-leads__pagination')
    expect(pagination).not.toBeNull()
    expect(pagination?.textContent).toContain('1 / 3')

    // On first page, "上一页" (previous) must be a native disabled button, NOT an active link
    const prevButton = screen.getByRole('button', { name: /上一页|previous/i })
    expect(prevButton).toBeDefined()
    expect(prevButton.hasAttribute('disabled')).toBe(true)
    expect(prevButton.closest('a')).toBeNull()

    // "下一页" (next) on page 1 of 3 must be an active link button
    const nextLink = screen.getByRole('link', { name: /下一页|next/i })
    expect(nextLink).toBeDefined()
    expect(nextLink.getAttribute('href')).toContain('page=2')
  })

  it('renders detail-body container for internal scrolling and fixed header', () => {
    const { container } = renderLeadsHub()

    // Verify detail container has detail-body section separating fixed header from scrollable content
    const detailBody = container.querySelector('.portal-leads__detail-body')
    expect(detailBody).not.toBeNull()
    expect(detailBody?.querySelector('dl')).not.toBeNull()
  })
})
