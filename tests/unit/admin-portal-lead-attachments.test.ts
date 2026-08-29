import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { PortalPreferencesProvider, usePortalPreferences } from '@/admin-portal/core/navigation/PortalPreferences'
import {
  formatByteSize,
  loadLeadsPageData,
  parseLeadQuery,
  type LeadSummaryItem,
  type LeadsSummary,
} from '@/admin-portal/modules/leads/getLeadsPage'
import { LeadsHub } from '@/admin-portal/modules/leads/LeadsHub'

const router = { refresh: vi.fn(), replace: vi.fn() }
vi.mock('next/navigation', () => ({
  useRouter: () => router,
  useSearchParams: () => new URLSearchParams(),
}))

const req = { user: { id: 1, role: 'admin' } } as never

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('formatByteSize utility', () => {
  it('formats bytes across zero, B, KB, MB, and GB boundaries', () => {
    expect(formatByteSize(0)).toBe('0 B')
    expect(formatByteSize(-10)).toBe('0 B')
    expect(formatByteSize(512)).toBe('512 B')
    expect(formatByteSize(1024)).toBe('1.0 KB')
    expect(formatByteSize(153600)).toBe('150 KB')
    expect(formatByteSize(1048576)).toBe('1.0 MB')
    expect(formatByteSize(5242880)).toBe('5.0 MB')
    expect(formatByteSize(52428800)).toBe('50 MB')
    expect(formatByteSize(1073741824)).toBe('1.0 GB')
  })
})

describe('Portal leads page read model with attachments', () => {
  it('loads lead attachments in a single batch query without N+1', async () => {
    const find = vi.fn().mockImplementation(({ collection }: { collection: string }) => {
      if (collection === 'leads') {
        return Promise.resolve({
          docs: [
            {
              assignedTo: null,
              budget: null,
              company: 'Company A',
              country: 'UAE',
              email: 'a@example.com',
              hasDrawings: true,
              id: 101,
              intentLevel: 'a',
              interest: 'Curtain walls',
              locale: 'en',
              message: 'Need facade drawings.',
              name: 'Client A',
              phone: null,
              procurementPlan: null,
              projectStage: 'tender',
              quantitySquareMeters: 2000,
              source: 4,
              status: 'new',
              timeline: null,
              updatedAt: '2026-08-29T10:00:00.000Z',
            },
            {
              assignedTo: null,
              budget: null,
              company: 'Company B',
              country: 'KSA',
              email: 'b@example.com',
              hasDrawings: false,
              id: 102,
              intentLevel: 'b',
              interest: 'Windows',
              locale: 'en',
              message: 'Inquiry without drawings.',
              name: 'Client B',
              phone: null,
              procurementPlan: null,
              projectStage: null,
              quantitySquareMeters: null,
              source: 4,
              status: 'new',
              timeline: null,
              updatedAt: '2026-08-29T11:00:00.000Z',
            },
          ],
          page: 1,
          totalDocs: 2,
          totalPages: 1,
        })
      }
      if (collection === 'lead-sources') {
        return Promise.resolve({ docs: [{ id: 4, isActive: true, name: 'Website' }] })
      }
      if (collection === 'users') {
        return Promise.resolve({ docs: [{ email: 'admin@example.com', id: 1 }] })
      }
      if (collection === 'conversations') {
        return Promise.resolve({ docs: [] })
      }
      if (collection === 'lead-attachments') {
        return Promise.resolve({
          docs: [
            {
              byteSize: 2048576,
              createdAt: '2026-08-29T10:05:00.000Z',
              filename: 'facade-plan.pdf',
              id: 501,
              lead: 101,
              mimeType: 'application/pdf',
              status: 'associated',
            },
            {
              byteSize: 524288,
              createdAt: '2026-08-29T10:06:00.000Z',
              filename: 'facade-boq.xlsx',
              id: 502,
              lead: { id: 101 },
              mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
              status: 'associated',
            },
          ],
        })
      }
      return Promise.resolve({ docs: [] })
    })

    const result = await loadLeadsPageData({
      env: { ADMIN_PORTAL_ENABLED: 'true', ADMIN_PORTAL_LEADS_ENABLED: 'true' } as never,
      payload: { find } as never,
      query: parseLeadQuery({}),
      req,
      role: 'admin',
    })

    expect(result.state).toBe('available')
    const items = result.summary?.items ?? []
    expect(items).toHaveLength(2)

    // Check batch query on lead-attachments
    const attachmentCalls = find.mock.calls.filter((call) => call[0]?.collection === 'lead-attachments')
    expect(attachmentCalls).toHaveLength(1)
    expect(attachmentCalls[0][0]).toMatchObject({
      collection: 'lead-attachments',
      where: { lead: { in: [101, 102] } },
    })

    // Lead 101 has 2 attachments
    expect(items[0]?.attachmentCount).toBe(2)
    expect(items[0]?.attachmentsAccess).toBe('authorized')
    expect(items[0]?.attachments).toHaveLength(2)
    expect(items[0]?.attachments?.[0]).toEqual({
      byteSize: 2048576,
      createdAt: '2026-08-29T10:05:00.000Z',
      downloadUrl: '/api/portal/leads/101/attachments/501',
      filename: 'facade-plan.pdf',
      id: 501,
      mimeType: 'application/pdf',
      status: 'associated',
    })
    expect(items[0]?.attachments?.[1]).toEqual({
      byteSize: 524288,
      createdAt: '2026-08-29T10:06:00.000Z',
      downloadUrl: '/api/portal/leads/101/attachments/502',
      filename: 'facade-boq.xlsx',
      id: 502,
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      status: 'associated',
    })

    // Lead 102 has 0 attachments
    expect(items[1]?.attachmentCount).toBe(0)
    expect(items[1]?.attachmentsAccess).toBe('authorized')
    expect(items[1]?.attachments).toEqual([])
  })

  it('restricts sales role from querying attachments and sets unauthorized access', async () => {
    const find = vi.fn().mockImplementation(({ collection }: { collection: string }) => {
      if (collection === 'leads') {
        return Promise.resolve({
          docs: [
            {
              assignedTo: 9,
              budget: null,
              company: 'Company S',
              country: 'UAE',
              email: 's@example.com',
              hasDrawings: true,
              id: 201,
              intentLevel: 'a',
              interest: 'Facade',
              locale: 'en',
              message: 'Assigned sales lead',
              name: 'Sales Client',
              phone: null,
              procurementPlan: null,
              projectStage: null,
              quantitySquareMeters: null,
              source: 4,
              status: 'new',
              timeline: null,
              updatedAt: '2026-08-29T12:00:00.000Z',
            },
          ],
          page: 1,
          totalDocs: 1,
          totalPages: 1,
        })
      }
      if (collection === 'lead-sources') {
        return Promise.resolve({ docs: [{ id: 4, isActive: true, name: 'Website' }] })
      }
      return Promise.resolve({ docs: [] })
    })

    const result = await loadLeadsPageData({
      env: { ADMIN_PORTAL_ENABLED: 'true', ADMIN_PORTAL_LEADS_ENABLED: 'true' } as never,
      payload: { find } as never,
      query: parseLeadQuery({}),
      req: { user: { id: 9, role: 'sales' } } as never,
      role: 'sales',
    })

    const items = result.summary?.items ?? []
    expect(items).toHaveLength(1)
    expect(items[0]?.attachmentsAccess).toBe('unauthorized')
    expect(items[0]?.attachmentCount).toBe(0)
    expect(items[0]?.attachments).toEqual([])

    // Verify lead-attachments was never queried
    const attachmentCalls = find.mock.calls.filter((call) => call[0]?.collection === 'lead-attachments')
    expect(attachmentCalls).toHaveLength(0)
  })
})

describe('LeadsHub attachment UI presentation', () => {
  const createLeadItem = (overrides: Partial<LeadSummaryItem> = {}): LeadSummaryItem => ({
    assignedTo: null,
    attachmentCount: 0,
    attachments: [],
    attachmentsAccess: 'authorized',
    budget: null,
    company: 'Al Futtaim Engineering',
    country: 'United Arab Emirates',
    email: 'tender@example.com',
    hasDrawings: false,
    id: 10,
    interest: 'Aluminium Louvers',
    intentLevel: 'a',
    locale: 'en',
    message: 'Please review our drawings and BOQ.',
    messagingAccountExternalId: null,
    messagingPlatform: null,
    messagingSenderExternalId: null,
    messagingThreadExternalId: null,
    name: 'Ahmed Al-Mansoor',
    phone: '+971 50 123 4567',
    procurementPlan: 'Immediate',
    projectStage: 'Tender submission',
    quantitySquareMeters: 5000,
    relatedConversations: [],
    source: 1,
    status: 'new',
    timeline: '1 month',
    updatedAt: '2026-08-29T10:00:00.000Z',
    ...overrides,
  })

  it('renders attachment badge in list item and authorized download buttons in detail', () => {
    const leadWithFiles = createLeadItem({
      attachmentCount: 2,
      attachments: [
        {
          byteSize: 3145728,
          createdAt: '2026-08-29T10:00:00.000Z',
          downloadUrl: '/api/portal/leads/10/attachments/51',
          filename: 'elevation-drawing.pdf',
          id: 51,
          mimeType: 'application/pdf',
          status: 'associated',
        },
        {
          byteSize: 102400,
          createdAt: '2026-08-29T10:01:00.000Z',
          downloadUrl: '/api/portal/leads/10/attachments/52',
          filename: 'boq-schedule.xlsx',
          id: 52,
          mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          status: 'associated',
        },
      ],
      hasDrawings: true,
    })

    const summary: LeadsSummary = {
      items: [leadWithFiles],
      options: { sources: [{ id: 1, label: 'Website Inquiry' }], users: [] },
      pagination: { page: 1, totalDocs: 1, totalPages: 1 },
      query: { intent: 'all', page: 1, q: '', status: 'all' },
    }

    render(
      React.createElement(
        PortalPreferencesProvider,
        null,
        React.createElement(LeadsHub, { pageState: 'available', role: 'admin', summary }),
      ),
    )

    // List item should have attachment count badge
    expect(screen.getByTitle('2 个附件')).toBeTruthy()

    // Detail section header
    expect(screen.getByRole('heading', { name: '图纸与附件' })).toBeTruthy()

    // File items
    expect(screen.getByText('elevation-drawing.pdf')).toBeTruthy()
    expect(screen.getByText(/3.0 MB/)).toBeTruthy()
    expect(screen.getByText('boq-schedule.xlsx')).toBeTruthy()
    expect(screen.getByText(/100 KB/)).toBeTruthy()

    // Download links
    const downloadLinks = screen.getAllByRole('link', { name: /下载/ })
    expect(downloadLinks).toHaveLength(2)
    expect(downloadLinks[0]?.getAttribute('href')).toBe('/api/portal/leads/10/attachments/51')
    expect(downloadLinks[0]?.getAttribute('download')).toBe('elevation-drawing.pdf')
    expect(downloadLinks[1]?.getAttribute('href')).toBe('/api/portal/leads/10/attachments/52')
  })

  it('renders missing, expired, and pending statuses with informative badges and disabled actions', () => {
    const leadWithSpecialStatuses = createLeadItem({
      attachmentCount: 3,
      attachments: [
        {
          byteSize: 1048576,
          createdAt: '2026-08-29T10:00:00.000Z',
          downloadUrl: '/api/portal/leads/10/attachments/61',
          filename: 'missing-drawing.dwg',
          id: 61,
          mimeType: 'application/acad',
          status: 'missing',
        },
        {
          byteSize: 2097152,
          createdAt: '2026-08-20T10:00:00.000Z',
          downloadUrl: '/api/portal/leads/10/attachments/62',
          filename: 'expired-spec.pdf',
          id: 62,
          mimeType: 'application/pdf',
          status: 'expired',
        },
        {
          byteSize: 512000,
          createdAt: '2026-08-29T10:00:00.000Z',
          downloadUrl: '/api/portal/leads/10/attachments/63',
          filename: 'pending-upload.zip',
          id: 63,
          mimeType: 'application/zip',
          status: 'pending',
        },
      ],
      hasDrawings: true,
    })

    const summary: LeadsSummary = {
      items: [leadWithSpecialStatuses],
      options: { sources: [{ id: 1, label: 'Website Inquiry' }], users: [] },
      pagination: { page: 1, totalDocs: 1, totalPages: 1 },
      query: { intent: 'all', page: 1, q: '', status: 'all' },
    }

    render(
      React.createElement(
        PortalPreferencesProvider,
        null,
        React.createElement(LeadsHub, { pageState: 'available', role: 'operator', summary }),
      ),
    )

    // Status badges
    expect(screen.getByText('文件缺失')).toBeTruthy()
    expect(screen.getByText('已过期')).toBeTruthy()
    expect(screen.getByText('待关联')).toBeTruthy()

    // Descriptions
    expect(screen.getByText('文件在存储中缺失')).toBeTruthy()
    expect(screen.getByText('附件已超过保留期限')).toBeTruthy()
    expect(screen.getByText('附件正在等待关联')).toBeTruthy()

    // No download links for unassociated files
    expect(screen.queryByRole('link', { name: /下载/ })).toBeNull()
  })

  it('renders empty attachment states with and without customer-marked drawings', () => {
    const leadNoFiles = createLeadItem({
      attachmentCount: 0,
      attachments: [],
      hasDrawings: false,
      id: 11,
      name: 'Client Without Drawings',
    })
    const leadWithDrawingsCheckbox = createLeadItem({
      attachmentCount: 0,
      attachments: [],
      hasDrawings: true,
      id: 12,
      name: 'Client With Drawings Checkbox',
    })

    const summary: LeadsSummary = {
      items: [leadNoFiles, leadWithDrawingsCheckbox],
      options: { sources: [{ id: 1, label: 'Website Inquiry' }], users: [] },
      pagination: { page: 1, totalDocs: 2, totalPages: 1 },
      query: { intent: 'all', page: 1, q: '', status: 'all' },
    }

    render(
      React.createElement(
        PortalPreferencesProvider,
        null,
        React.createElement(LeadsHub, { pageState: 'available', role: 'admin', summary }),
      ),
    )

    // Lead 11 (hasDrawings: false) is initially selected
    expect(screen.getByText('暂无附件')).toBeTruthy()

    // Select Lead 12 (hasDrawings: true, but attachments: [])
    fireEvent.click(screen.getByRole('button', { name: /Client With Drawings Checkbox/ }))
    expect(screen.getByText('客户标记了已有图纸，但未上传附件。')).toBeTruthy()
  })

  it('renders unauthorized lock message for sales role', () => {
    const leadForSales = createLeadItem({
      attachmentCount: 0,
      attachments: [],
      attachmentsAccess: 'unauthorized',
      hasDrawings: true,
    })

    const summary: LeadsSummary = {
      items: [leadForSales],
      options: { sources: [{ id: 1, label: 'Website Inquiry' }], users: [] },
      pagination: { page: 1, totalDocs: 1, totalPages: 1 },
      query: { intent: 'all', page: 1, q: '', status: 'all' },
    }

    render(
      React.createElement(
        PortalPreferencesProvider,
        null,
        React.createElement(LeadsHub, { pageState: 'available', role: 'sales', summary }),
      ),
    )

    expect(screen.getByText('当前角色无权查看或下载附件。')).toBeTruthy()
  })

  it('supports English locale for attachment labels and actions', async () => {
    const leadWithFiles = createLeadItem({
      attachmentCount: 1,
      attachments: [
        {
          byteSize: 1048576,
          createdAt: '2026-08-29T10:00:00.000Z',
          downloadUrl: '/api/portal/leads/10/attachments/71',
          filename: 'facade-system-drawing.dwg',
          id: 71,
          mimeType: 'application/acad',
          status: 'associated',
        },
      ],
      hasDrawings: true,
    })

    const summary: LeadsSummary = {
      items: [leadWithFiles],
      options: { sources: [{ id: 1, label: 'Website Inquiry' }], users: [] },
      pagination: { page: 1, totalDocs: 1, totalPages: 1 },
      query: { intent: 'all', page: 1, q: '', status: 'all' },
    }

    function LocaleSwitcher() {
      const { setLocale } = usePortalPreferences()
      return React.createElement('button', { onClick: () => setLocale('en') }, 'Switch to English')
    }

    render(
      React.createElement(
        PortalPreferencesProvider,
        null,
        React.createElement(LocaleSwitcher),
        React.createElement(LeadsHub, { pageState: 'available', role: 'admin', summary }),
      ),
    )

    fireEvent.click(screen.getByRole('button', { name: 'Switch to English' }))

    expect(await screen.findByRole('heading', { name: 'Drawings & Attachments' })).toBeTruthy()
    expect(screen.getByText('Associated')).toBeTruthy()
    expect(screen.getByRole('link', { name: /Download/ })).toBeTruthy()
  })
})
