// @vitest-environment node

import { describe, expect, it, vi } from 'vitest'
import type { Payload } from 'payload'

import { createAttachmentUploadHandler } from '@/app/api/inquiries/attachments/upload/route'
import { createFixedWindowRateLimiter } from '@/lib/security/rateLimit'
import { issueUploadTicket } from '@/modules/lead-attachments/tokens'

const makeFormDataRequest = ({
  filename = 'test.pdf',
  fileContent = Buffer.from('%PDF-1.7\n'),
  mimeType = 'application/pdf',
  ticket,
  ip = '192.0.2.1',
}: {
  filename?: string
  fileContent?: Buffer
  mimeType?: string
  ticket?: string
  ip?: string
} = {}) => {
  const form = new FormData()
  if (ticket !== undefined) {
    form.append('ticket', ticket)
  }
  const file = new File([fileContent], filename, { type: mimeType })
  form.append('file', file)

  return new Request('http://localhost/api/inquiries/attachments/upload', {
    body: form,
    headers: {
      'x-real-ip': ip,
    },
    method: 'POST',
  })
}

const createMockPayload = (overrides: {
  existingDocs?: Array<{ byteSize: number; id: number; status: string; ticketHash: string }>
  createResult?: { byteSize: number; filename: string; id: number; mimeType: string }
} = {}) => {
  const existingDocs = overrides.existingDocs ?? []
  const createResult = overrides.createResult ?? {
    byteSize: 1024,
    filename: 'facade-test.pdf',
    id: 101,
    mimeType: 'application/pdf',
  }

  return {
    find: vi.fn().mockResolvedValue({ docs: existingDocs }),
    create: vi.fn().mockResolvedValue(createResult),
  } as unknown as Payload
}

describe('lead attachment upload endpoint', () => {
  it('enforces rate limiting when too many requests are sent', async () => {
    const limiter = createFixedWindowRateLimiter({ limit: 1, windowMs: 60_000 })
    const handler = createAttachmentUploadHandler({
      limiter,
      payloadProvider: async () => createMockPayload(),
    })

    const first = await handler(makeFormDataRequest({ ip: '192.0.2.1' }))
    expect(first.status).toBe(201)

    const second = await handler(makeFormDataRequest({ ip: '192.0.2.1' }))
    expect(second.status).toBe(429)
    const body = await second.json()
    expect(body.code).toBe('rate_limited')
  })

  it('rejects invalid or expired upload tickets', async () => {
    const handler = createAttachmentUploadHandler({
      limiter: createFixedWindowRateLimiter({ limit: 10, windowMs: 60_000 }),
      payloadProvider: async () => createMockPayload(),
    })

    const request = makeFormDataRequest({
      filename: 'drawing.pdf',
      ip: '192.0.2.2',
      ticket: 'invalid-expired-ticket-string',
    })

    const response = await handler(request)
    expect(response.status).toBe(401)
    const body = await response.json()
    expect(body.code).toBe('invalid_ticket')
  })

  it('rejects unsupported or dangerous file types', async () => {
    const handler = createAttachmentUploadHandler({
      limiter: createFixedWindowRateLimiter({ limit: 10, windowMs: 60_000 }),
      payloadProvider: async () => createMockPayload(),
    })

    const request = makeFormDataRequest({
      fileContent: Buffer.from('#!/bin/sh\necho hack'),
      filename: 'script.sh',
      ip: '192.0.2.3',
      mimeType: 'text/x-shellscript',
    })

    const response = await handler(request)
    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.code).toBe('invalid_filename')
  })

  it('rejects files exceeding 50 MB limit', async () => {
    const handler = createAttachmentUploadHandler({
      limiter: createFixedWindowRateLimiter({ limit: 10, windowMs: 60_000 }),
      payloadProvider: async () => createMockPayload(),
    })

    const request = new Request('http://localhost/api/inquiries/attachments/upload', {
      body: Buffer.from('small'),
      headers: {
        'content-length': String(55 * 1024 * 1024),
        'content-type': 'multipart/form-data; boundary=oversized',
        'x-real-ip': '192.0.2.4',
      },
      method: 'POST',
    })

    const response = await handler(request)
    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.code).toBe('file_too_large')
  })

  it('enforces maximum 5 files per inquiry ticket', async () => {
    const ticket = issueUploadTicket()
    const payload = createMockPayload({
      existingDocs: [
        { byteSize: 1000, id: 1, status: 'pending', ticketHash: 'hash' },
        { byteSize: 1000, id: 2, status: 'pending', ticketHash: 'hash' },
        { byteSize: 1000, id: 3, status: 'pending', ticketHash: 'hash' },
        { byteSize: 1000, id: 4, status: 'pending', ticketHash: 'hash' },
        { byteSize: 1000, id: 5, status: 'pending', ticketHash: 'hash' },
      ],
    })

    const handler = createAttachmentUploadHandler({
      limiter: createFixedWindowRateLimiter({ limit: 10, windowMs: 60_000 }),
      payloadProvider: async () => payload,
    })

    const request = makeFormDataRequest({
      filename: 'sixth.pdf',
      ip: '192.0.2.5',
      ticket,
    })

    const response = await handler(request)
    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.code).toBe('too_many_attachments')
  })

  it('enforces maximum 200 MB total size per inquiry ticket', async () => {
    const ticket = issueUploadTicket()
    const payload = createMockPayload({
      existingDocs: [
        { byteSize: 45 * 1024 * 1024, id: 1, status: 'pending', ticketHash: 'hash' },
        { byteSize: 45 * 1024 * 1024, id: 2, status: 'pending', ticketHash: 'hash' },
        { byteSize: 45 * 1024 * 1024, id: 3, status: 'pending', ticketHash: 'hash' },
        { byteSize: 45 * 1024 * 1024, id: 4, status: 'pending', ticketHash: 'hash' },
      ], // Total 180 MB
    })

    const handler = createAttachmentUploadHandler({
      limiter: createFixedWindowRateLimiter({ limit: 10, windowMs: 60_000 }),
      payloadProvider: async () => payload,
    })

    // Upload 30MB file (180MB + 30MB = 210MB > 200MB)
    const largeContent = Buffer.alloc(25 * 1024 * 1024, 0x20)
    largeContent.write('%PDF-1.7\n', 0, 'ascii')

    const request = makeFormDataRequest({
      fileContent: largeContent,
      filename: 'exceeding-total.pdf',
      ip: '192.0.2.6',
      ticket,
    })

    const response = await handler(request)
    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.code).toBe('total_size_exceeded')
  })

  it('successfully accepts a valid technical file and returns 201 with ticket', async () => {
    const payload = createMockPayload({
      createResult: {
        byteSize: 1024,
        filename: 'facade-detail.dwg',
        id: 201,
        mimeType: 'application/acad',
      },
    })

    const handler = createAttachmentUploadHandler({
      limiter: createFixedWindowRateLimiter({ limit: 10, windowMs: 60_000 }),
      payloadProvider: async () => payload,
    })

    const request = makeFormDataRequest({
      fileContent: Buffer.from('AC1032\x00\x00\x00test content'),
      filename: 'facade-detail.dwg',
      ip: '192.0.2.7',
      mimeType: 'application/acad',
    })

    const response = await handler(request)
    expect(response.status).toBe(201)
    const body = await response.json()
    expect(body.ok).toBe(true)
    expect(body.attachment.id).toBe(201)
    expect(body.attachment.filename).toBe('facade-detail.dwg')
    expect(typeof body.ticket).toBe('string')
  })
})

import { createAttachmentTicketHandler } from '@/app/api/inquiries/attachments/ticket/route'

describe('lead attachment ticket endpoint', () => {
  it('issues a valid upload ticket with 2h expiration timestamp', async () => {
    const handler = createAttachmentTicketHandler({
      limiter: createFixedWindowRateLimiter({ limit: 10, windowMs: 60_000 }),
    })

    const request = new Request('http://localhost/api/inquiries/attachments/ticket', {
      headers: { 'x-real-ip': '192.0.2.20' },
      method: 'POST',
    })

    const response = await handler(request)
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.ok).toBe(true)
    expect(typeof body.ticket).toBe('string')
    expect(body.ticket).toContain('.')
    expect(typeof body.expiresAt).toBe('string')
  })

  it('enforces rate limiting on ticket requests', async () => {
    const limiter = createFixedWindowRateLimiter({ limit: 1, windowMs: 60_000 })
    const handler = createAttachmentTicketHandler({ limiter })

    const request = () =>
      new Request('http://localhost/api/inquiries/attachments/ticket', {
        headers: { 'x-real-ip': '192.0.2.21' },
        method: 'POST',
      })

    const first = await handler(request())
    expect(first.status).toBe(200)

    const second = await handler(request())
    expect(second.status).toBe(429)
    const body = await second.json()
    expect(body.code).toBe('rate_limited')
  })
})
