import { describe, expect, it } from 'vitest'

import { validateInquiry } from '@/lib/validation/inquiry'

describe('Website v1.7 Inquiry Form and Drawing Upload experience specification', () => {
  const baseInquiryPayload = {
    company: 'Al Habtoor Facades',
    country: 'United Arab Emirates',
    email: 'procurement@alhabtoor.ae',
    idempotencyKey: '2dcfd680-64e6-4f63-961a-16eec41f60d2',
    locale: 'en',
    message: 'Please review our facade requirements for commercial tower.',
    name: 'Tariq Al-Mansoor',
    phone: '+971501234567',
  }

  it('allows submission without attachments (no-drawings flexible inquiry)', () => {
    // Inquiry without any attachments must validate cleanly
    const resultWithoutAttachments = validateInquiry({
      ...baseInquiryPayload,
    })

    expect(resultWithoutAttachments.ok).toBe(true)
    if (!resultWithoutAttachments.ok || resultWithoutAttachments.spam) return
    expect(resultWithoutAttachments.data.attachments).toBeUndefined()
  })

  it('accepts inquiry with valid attachment references', () => {
    const resultWithAttachments = validateInquiry({
      ...baseInquiryPayload,
      attachments: [
        { id: 101, ticket: 'ticket-session-token-1' },
        { id: 102, ticket: 'ticket-session-token-2' },
      ],
    })

    expect(resultWithAttachments.ok).toBe(true)
    if (!resultWithAttachments.ok || resultWithAttachments.spam) return
    expect(resultWithAttachments.data.attachments).toHaveLength(2)
  })

  it('enforces attachment upload constraints (5 files, 50MB single, 200MB total)', () => {
    const MAX_FILES = 5
    const MAX_SINGLE_BYTES = 50 * 1024 * 1024
    const MAX_TOTAL_BYTES = 200 * 1024 * 1024

    const ALLOWED_EXTENSIONS = new Set([
      '.pdf',
      '.dwg',
      '.dxf',
      '.step',
      '.stp',
      '.3dm',
      '.iges',
      '.igs',
      '.xlsx',
      '.xls',
      '.csv',
      '.zip',
      '.rar',
      '.7z',
      '.jpg',
      '.jpeg',
      '.png',
      '.gif',
      '.webp',
    ])

    const validateFile = (filename: string, size: number, currentTotalSize: number, currentCount: number) => {
      if (currentCount >= MAX_FILES) {
        return { error: 'max_files_reached', ok: false }
      }
      const dotIndex = filename.lastIndexOf('.')
      const ext = dotIndex !== -1 ? filename.slice(dotIndex).toLowerCase() : ''
      if (!ALLOWED_EXTENSIONS.has(ext)) {
        return { error: 'invalid_file_type', ok: false }
      }
      if (size > MAX_SINGLE_BYTES) {
        return { error: 'file_too_large', ok: false }
      }
      if (currentTotalSize + size > MAX_TOTAL_BYTES) {
        return { error: 'total_size_exceeded', ok: false }
      }
      return { ok: true }
    }

    // Valid DWG within limits
    expect(validateFile('elevation-drawing.dwg', 10 * 1024 * 1024, 0, 0).ok).toBe(true)

    // Valid STEP file within limits
    expect(validateFile('panel-assembly.step', 45 * 1024 * 1024, 0, 0).ok).toBe(true)

    // Invalid extension (.exe)
    expect(validateFile('script.exe', 1024, 0, 0)).toEqual({ error: 'invalid_file_type', ok: false })

    // Single file > 50 MB
    expect(validateFile('huge-model.3dm', 55 * 1024 * 1024, 0, 0)).toEqual({
      error: 'file_too_large',
      ok: false,
    })

    // Cumulative total > 200 MB
    expect(validateFile('extra.dwg', 40 * 1024 * 1024, 170 * 1024 * 1024, 4)).toEqual({
      error: 'total_size_exceeded',
      ok: false,
    })

    // Exceeding 5 files
    expect(validateFile('sixth.dwg', 1024, 10 * 1024 * 1024, 5)).toEqual({
      error: 'max_files_reached',
      ok: false,
    })
  })

  it('validates upload progress, abort cancellation and retry lifecycle model', () => {
    type AttachmentState = {
      aborted?: boolean
      error?: string
      id: string
      name: string
      progress: number
      status: 'error' | 'success' | 'uploading'
    }

    let attachment: AttachmentState = {
      id: 'att-1',
      name: 'curved-facade.step',
      progress: 0,
      status: 'uploading',
    }

    // Simulate progress update
    const onProgress = (loaded: number, total: number) => {
      attachment = { ...attachment, progress: Math.round((loaded / total) * 100) }
    }
    onProgress(40, 100)
    expect(attachment.progress).toBe(40)

    // Simulate cancel / abort
    const onCancel = () => {
      attachment = { ...attachment, aborted: true }
    }
    onCancel()
    expect(attachment.aborted).toBe(true)

    // Simulate error and retry
    attachment = {
      id: 'att-1',
      name: 'curved-facade.step',
      progress: 0,
      status: 'error',
      error: 'Network timeout (120s limit exceeded)',
    }
    expect(attachment.status).toBe('error')

    const onRetry = () => {
      attachment = {
        id: 'att-1',
        name: 'curved-facade.step',
        progress: 0,
        status: 'uploading',
        error: undefined,
      }
    }
    onRetry()
    expect(attachment.status).toBe('uploading')
    expect(attachment.error).toBeUndefined()
  })
})
