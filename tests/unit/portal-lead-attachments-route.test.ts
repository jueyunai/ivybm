import { describe, expect, it, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

import { createLeadAttachmentDownloadHandler } from '@/app/api/portal/leads/[id]/attachments/[attachmentId]/route'
import * as leadRoute from '@/admin-portal/modules/leads/leadRoute'
import { LeadCommandError } from '@/admin-portal/modules/leads/leadCommands'

describe('portal lead attachment download endpoint', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('rejects unauthenticated requests with 401', async () => {
    vi.spyOn(leadRoute, 'authorizeLeadRequest').mockRejectedValue(
      new LeadCommandError('leads-unauthenticated', 'Authentication required', 401),
    )

    const handler = createLeadAttachmentDownloadHandler()
    const request = new NextRequest('http://localhost/api/portal/leads/10/attachments/50')
    const response = await handler(request, {
      params: Promise.resolve({ attachmentId: '50', id: '10' }),
    })

    expect(response.status).toBe(401)
    const body = await response.json()
    expect(body.error.code).toBe('leads-unauthenticated')
  })

  it('redirects browser navigation to login and preserves the attachment URL', async () => {
    vi.spyOn(leadRoute, 'authorizeLeadRequest').mockRejectedValue(
      new LeadCommandError('leads-unauthenticated', 'Authentication required', 401),
    )

    const handler = createLeadAttachmentDownloadHandler()
    const request = new NextRequest(
      'https://ivybm.com/api/portal/leads/10/attachments/50?download=1',
      { headers: { accept: 'text/html,application/xhtml+xml' } },
    )
    const response = await handler(request, {
      params: Promise.resolve({ attachmentId: '50', id: '10' }),
    })

    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe(
      'https://ivybm.com/dashboard/login?returnTo=%2Fapi%2Fportal%2Fleads%2F10%2Fattachments%2F50%3Fdownload%3D1',
    )
  })

  it('allows authorized operator to download associated lead attachment with safe headers', async () => {
    const fakeFileContent = Buffer.from('%PDF-1.7\nFacade Drawing Content')
    const fileReader = vi.fn().mockResolvedValue(fakeFileContent)

    const mockPayload = {
      findByID: vi.fn().mockImplementation(({ collection, id }: { collection: string; id: number }) => {
        if (collection === 'leads' && id === 10) {
          return Promise.resolve({ id: 10, name: 'Lead 10' })
        }
        if (collection === 'lead-attachments' && id === 50) {
          return Promise.resolve({
            filename: 'curtain-wall-detail.pdf',
            id: 50,
            lead: 10,
            mimeType: 'application/pdf',
            status: 'associated',
          })
        }
        return Promise.resolve(null)
      }),
    }

    vi.spyOn(leadRoute, 'authorizeLeadRequest').mockResolvedValue({
      payload: mockPayload as unknown as never,
      req: {} as unknown as never,
      role: 'operator',
    })

    const handler = createLeadAttachmentDownloadHandler({ fileReader })
    const request = new NextRequest('http://localhost/api/portal/leads/10/attachments/50')
    const response = await handler(request, {
      params: Promise.resolve({ attachmentId: '50', id: '10' }),
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('content-type')).toBe('application/pdf')
    expect(response.headers.get('content-disposition')).toContain('attachment; filename*=UTF-8\'\'curtain-wall-detail.pdf')

    const data = await response.arrayBuffer()
    expect(Buffer.from(data)).toEqual(fakeFileContent)
    expect(fileReader).toHaveBeenCalled()
  })

  it('returns 404 if attachment belongs to a different lead', async () => {
    const mockPayload = {
      findByID: vi.fn().mockImplementation(({ collection, id }: { collection: string; id: number }) => {
        if (collection === 'leads' && id === 10) {
          return Promise.resolve({ id: 10, name: 'Lead 10' })
        }
        if (collection === 'lead-attachments' && id === 50) {
          // Attachment belongs to lead 999, not lead 10
          return Promise.resolve({
            filename: 'other-lead.dwg',
            id: 50,
            lead: 999,
            mimeType: 'application/acad',
            status: 'associated',
          })
        }
        return Promise.resolve(null)
      }),
    }

    vi.spyOn(leadRoute, 'authorizeLeadRequest').mockResolvedValue({
      payload: mockPayload as unknown as never,
      req: {} as unknown as never,
      role: 'admin',
    })

    const handler = createLeadAttachmentDownloadHandler()
    const request = new NextRequest('http://localhost/api/portal/leads/10/attachments/50')
    const response = await handler(request, {
      params: Promise.resolve({ attachmentId: '50', id: '10' }),
    })

    expect(response.status).toBe(404)
  })

  it('returns 404 if attachment status is not associated', async () => {
    const mockPayload = {
      findByID: vi.fn().mockImplementation(({ collection, id }: { collection: string; id: number }) => {
        if (collection === 'leads' && id === 10) {
          return Promise.resolve({ id: 10, name: 'Lead 10' })
        }
        if (collection === 'lead-attachments' && id === 50) {
          return Promise.resolve({
            filename: 'unassociated.dwg',
            id: 50,
            lead: 10,
            mimeType: 'application/acad',
            status: 'pending',
          })
        }
        return Promise.resolve(null)
      }),
    }

    vi.spyOn(leadRoute, 'authorizeLeadRequest').mockResolvedValue({
      payload: mockPayload as unknown as never,
      req: {} as unknown as never,
      role: 'admin',
    })

    const handler = createLeadAttachmentDownloadHandler()
    const request = new NextRequest('http://localhost/api/portal/leads/10/attachments/50')
    const response = await handler(request, {
      params: Promise.resolve({ attachmentId: '50', id: '10' }),
    })

    expect(response.status).toBe(404)
  })
})
