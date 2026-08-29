import { describe, expect, it, vi } from 'vitest'
import type { Payload } from 'payload'

import { createInquiryHandler } from '@/lib/inquiries/handler'
import { createFixedWindowRateLimiter } from '@/lib/security/rateLimit'
import { hashUploadTicket, issueUploadTicket } from '@/modules/lead-attachments/tokens'

describe('inquiry handler with lead attachments', () => {
  it('associates valid pending attachments and sets hasDrawings on the created lead', async () => {
    const ticket = issueUploadTicket()
    const ticketHash = hashUploadTicket(ticket)

    const updatedAttachments: Record<string, unknown>[] = []
    let updatedLead: Record<string, unknown> | null = null

    const mockPayload = {
      find: vi.fn().mockImplementation(({ collection, _where }: { collection: string; _where?: unknown }) => {
        if (collection === 'lead-sources') {
          return Promise.resolve({
            docs: [{ id: 1, key: 'website-contact', name: 'Website Contact Form' }],
          })
        }
        if (collection === 'leads') {
          return Promise.resolve({ docs: [] })
        }
        if (collection === 'lead-attachments') {
          return Promise.resolve({
            docs: [
              {
                byteSize: 1024,
                filename: 'shop-drawing.dwg',
                id: 501,
                status: 'pending',
                ticketHash,
              },
            ],
          })
        }
        return Promise.resolve({ docs: [] })
      }),
      create: vi.fn().mockImplementation(({ collection, data }: { collection: string; data: unknown }) => {
        if (collection === 'leads') {
          return Promise.resolve({
            id: 99,
            name: (data as Record<string, unknown>).name as string,
            requestId: 'req-12345',
            ...(data as Record<string, unknown>),
          })
        }
        return Promise.resolve({ id: 1, ...(data as Record<string, unknown>) })
      }),
      update: vi.fn().mockImplementation(({ collection, data, id }: { collection: string; data: unknown; id: unknown }) => {
        if (collection === 'lead-attachments') {
          updatedAttachments.push({ id, ...(data as Record<string, unknown>) })
          return Promise.resolve({ id, ...(data as Record<string, unknown>) })
        }
        if (collection === 'leads') {
          updatedLead = { id, ...(data as Record<string, unknown>) }
          return Promise.resolve({ id, ...(data as Record<string, unknown>) })
        }
        return Promise.resolve({ id, ...(data as Record<string, unknown>) })
      }),
    } as unknown as Payload

    const handler = createInquiryHandler({
      limiter: createFixedWindowRateLimiter({ limit: 10, windowMs: 60_000 }),
      payloadProvider: async () => mockPayload,
      uuid: () => 'req-12345',
    })

    const request = new Request('http://localhost/api/inquiries', {
      body: JSON.stringify({
        attachments: [{ id: 501, ticket }],
        company: 'Facade Partners LLC',
        country: 'United Arab Emirates',
        email: 'engineer@facadepartners.ae',
        idempotencyKey: '2dcfd680-64e6-4f63-961a-16eec41f60d2',
        locale: 'en',
        message: 'Please review attached shop drawing for quote.',
        name: 'Ahmed Al Mansoor',
      }),
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'x-real-ip': '192.0.2.10',
      },
      method: 'POST',
    })

    const response = await handler(request)
    expect(response.status).toBe(201)
    const body = await response.json()
    expect(body.ok).toBe(true)
    expect(body.requestId).toBe('req-12345')

    // Verify attachment was associated
    expect(updatedAttachments).toHaveLength(1)
    expect(updatedAttachments[0].id).toBe(501)
    expect(updatedAttachments[0].lead).toBe(99)
    expect(updatedAttachments[0].status).toBe('associated')

    // Verify lead hasDrawings was updated to true
    expect((updatedLead as Record<string, unknown> | null)?.hasDrawings).toBe(true)
  })

  it('tolerates missing or expired attachment tickets without blocking lead creation', async () => {
    const mockPayload = {
      find: vi.fn().mockImplementation(({ collection }: { collection: string }) => {
        if (collection === 'lead-sources') {
          return Promise.resolve({
            docs: [{ id: 1, key: 'website-contact', name: 'Website Contact Form' }],
          })
        }
        if (collection === 'leads') {
          return Promise.resolve({ docs: [] })
        }
        if (collection === 'lead-attachments') {
          // Staged attachment not found (e.g. expired or cleaned up)
          return Promise.resolve({ docs: [] })
        }
        return Promise.resolve({ docs: [] })
      }),
      create: vi.fn().mockImplementation(({ collection, data }: { collection: string; data: unknown }) => {
        if (collection === 'leads') {
          return Promise.resolve({
            id: 100,
            name: (data as Record<string, unknown>).name as string,
            requestId: 'req-tolerance',
            ...(data as Record<string, unknown>),
          })
        }
        return Promise.resolve({ id: 1, ...(data as Record<string, unknown>) })
      }),
      update: vi.fn(),
    } as unknown as Payload

    const handler = createInquiryHandler({
      limiter: createFixedWindowRateLimiter({ limit: 10, windowMs: 60_000 }),
      payloadProvider: async () => mockPayload,
      uuid: () => 'req-tolerance',
    })

    const request = new Request('http://localhost/api/inquiries', {
      body: JSON.stringify({
        attachments: [{ id: 9999, ticket: 'invalid-or-expired-token' }],
        country: 'Saudi Arabia',
        email: 'procurement@saudi-tower.sa',
        idempotencyKey: '7c9f8a32-1111-4f63-961a-16eec41f60d2',
        locale: 'en',
        message: 'Inquiry with expired attachment reference.',
        name: 'Khalid',
      }),
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'x-real-ip': '192.0.2.11',
      },
      method: 'POST',
    })

    // Lead creation must succeed (degradation / tolerance semantics)
    const response = await handler(request)
    expect(response.status).toBe(201)
    const body = await response.json()
    expect(body.ok).toBe(true)
    expect(body.requestId).toBe('req-tolerance')
  })
})
