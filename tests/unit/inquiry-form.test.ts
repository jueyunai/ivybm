import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { InquiryForm } from '@/components/inquiry/InquiryForm'

class MockXMLHttpRequest {
  static instances: MockXMLHttpRequest[] = []

  headers: Record<string, string> = {}
  method = ''
  url = ''
  status = 201
  responseText = ''
  upload = {
    onprogress: null as ((event: { lengthComputable: boolean; loaded: number; total: number }) => void) | null,
  }
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  ontimeout: (() => void) | null = null
  onabort: (() => void) | null = null
  sendPayload: unknown = null
  aborted = false
  timeout = 0

  constructor() {
    MockXMLHttpRequest.instances.push(this)
  }

  open(method: string, url: string) {
    this.method = method
    this.url = url
  }

  setRequestHeader(key: string, value: string) {
    this.headers[key] = value
  }

  send(payload: unknown) {
    this.sendPayload = payload
  }

  abort() {
    this.aborted = true
    if (this.onabort) this.onabort()
  }

  simulateProgress(loaded: number, total: number) {
    if (this.upload.onprogress) {
      this.upload.onprogress({ lengthComputable: true, loaded, total })
    }
  }

  simulateSuccess(response: unknown, status = 201) {
    this.status = status
    this.responseText = typeof response === 'string' ? response : JSON.stringify(response)
    if (this.onload) this.onload()
  }

  simulateError(response: unknown, status = 400) {
    this.status = status
    this.responseText = typeof response === 'string' ? response : JSON.stringify(response)
    if (this.onload) this.onload()
  }

  simulateTimeout() {
    if (this.ontimeout) this.ontimeout()
  }

  simulateNetworkError() {
    if (this.onerror) this.onerror()
  }
}

const originalXHR = globalThis.XMLHttpRequest
const originalFetch = globalThis.fetch

beforeEach(() => {
  MockXMLHttpRequest.instances = []
  // @ts-expect-error Mocking XHR
  globalThis.XMLHttpRequest = MockXMLHttpRequest
  globalThis.fetch = vi.fn()
})

afterEach(() => {
  cleanup()
  globalThis.XMLHttpRequest = originalXHR
  globalThis.fetch = originalFetch
})

describe('InquiryForm component', () => {
  it('renders drawing and document attachment fields, optional note and limits', () => {
    render(
      React.createElement(InquiryForm, {
        initialIdempotencyKey: '2dcfd680-64e6-4f63-961a-16eec41f60d2',
        locale: 'en',
      }),
    )

    expect(screen.getByText('Drawings & Documents')).toBeDefined()
    expect(screen.getByText(/Optional \(recommended for faster RFQ\)/i)).toBeDefined()
    expect(screen.getByText('Max 5 files, up to 50 MB each (200 MB total)')).toBeDefined()
    expect(screen.getByText(/Upload shop drawings, BOQ, or specifications/i)).toBeDefined()
  })

  it('renders submit button inside independent form-actions container with Submit copy', () => {
    const { container } = render(
      React.createElement(InquiryForm, {
        initialIdempotencyKey: '2dcfd680-64e6-4f63-961a-16eec41f60d2',
        locale: 'en',
      }),
    )

    const actions = container.querySelector('.form-actions')
    expect(actions).not.toBeNull()
    const submitBtn = screen.getByRole('button', { name: 'Submit' })
    expect(actions?.contains(submitBtn)).toBe(true)
  })

  it('rejects unsupported file extensions with localized error without disabling dropzone', async () => {
    render(
      React.createElement(InquiryForm, {
        initialIdempotencyKey: '2dcfd680-64e6-4f63-961a-16eec41f60d2',
        locale: 'en',
      }),
    )

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
    const invalidFile = new File(['binary content'], 'script.exe', { type: 'application/x-msdownload' })

    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [invalidFile] } })
    })

    expect(screen.getByText('File type or format is not supported.')).toBeDefined()
    expect(screen.getByText('script.exe')).toBeDefined()

    // Error files should not increment valid count or disable dropzone
    expect(screen.getByText('0/5 files')).toBeDefined()
    const dropzone = document.querySelector('.attachment-dropzone')
    expect(dropzone?.classList.contains('is-disabled')).toBe(false)
  })

  it('allows adding valid files even when error files exist in the list', async () => {
    render(
      React.createElement(InquiryForm, {
        initialIdempotencyKey: '2dcfd680-64e6-4f63-961a-16eec41f60d2',
        locale: 'en',
      }),
    )

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
    const invalidFile = new File(['content'], 'malicious.bat')

    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [invalidFile] } })
    })

    expect(screen.getByText('malicious.bat')).toBeDefined()

    // Add a valid file next
    const validFile = new File(['dwg data'], 'panel-drawing.dwg', { type: 'application/acad' })
    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [validFile] } })
    })

    expect(MockXMLHttpRequest.instances).toHaveLength(1)
    expect(screen.getByText('panel-drawing.dwg')).toBeDefined()
    expect(screen.getByText('1/5 files')).toBeDefined()
  })

  it('rejects files larger than 50 MB with localized error', async () => {
    render(
      React.createElement(InquiryForm, {
        initialIdempotencyKey: '2dcfd680-64e6-4f63-961a-16eec41f60d2',
        locale: 'en',
      }),
    )

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
    const oversizedFile = new File(['dummy'], 'huge-model.step', { type: 'model/step' })
    Object.defineProperty(oversizedFile, 'size', { value: 55 * 1024 * 1024 })

    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [oversizedFile] } })
    })

    expect(screen.getByText('Each attachment must be 50 MB or smaller.')).toBeDefined()
  })

  it('rejects files when cumulative total exceeds 200 MB', async () => {
    render(
      React.createElement(InquiryForm, {
        initialIdempotencyKey: '2dcfd680-64e6-4f63-961a-16eec41f60d2',
        locale: 'en',
      }),
    )

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
    const file1 = new File(['a'], 'file1.dwg')
    Object.defineProperty(file1, 'size', { value: 45 * 1024 * 1024 })
    const file2 = new File(['b'], 'file2.dwg')
    Object.defineProperty(file2, 'size', { value: 45 * 1024 * 1024 })
    const file3 = new File(['c'], 'file3.dwg')
    Object.defineProperty(file3, 'size', { value: 45 * 1024 * 1024 })
    const file4 = new File(['d'], 'file4.dwg')
    Object.defineProperty(file4, 'size', { value: 45 * 1024 * 1024 })
    const file5 = new File(['e'], 'file5.dwg')
    Object.defineProperty(file5, 'size', { value: 30 * 1024 * 1024 })

    // Total would be 210 MB > 200 MB
    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [file1, file2, file3, file4, file5] } })
    })

    expect(screen.getByText('Total attachment size must not exceed 200 MB.')).toBeDefined()
  })

  it('disables dropzone only when 5 valid/uploading files are reached', async () => {
    render(
      React.createElement(InquiryForm, {
        initialIdempotencyKey: '2dcfd680-64e6-4f63-961a-16eec41f60d2',
        locale: 'en',
      }),
    )

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
    const files = [
      new File(['1'], 'f1.dwg'),
      new File(['2'], 'f2.dwg'),
      new File(['3'], 'f3.dwg'),
      new File(['4'], 'f4.dwg'),
      new File(['5'], 'f5.dwg'),
    ]

    await act(async () => {
      fireEvent.change(fileInput, { target: { files } })
    })

    expect(MockXMLHttpRequest.instances).toHaveLength(5)
    expect(screen.getByText('5/5 files')).toBeDefined()
    const dropzone = document.querySelector('.attachment-dropzone')
    expect(dropzone?.classList.contains('is-disabled')).toBe(true)
  })

  it('handles asynchronous upload with progress, ticket sharing, 120s timeout setting, and success state', async () => {
    ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      json: () => Promise.resolve({ ok: true, ticket: 'ticket-session-123' }),
      ok: true,
    })

    render(
      React.createElement(InquiryForm, {
        initialIdempotencyKey: '2dcfd680-64e6-4f63-961a-16eec41f60d2',
        locale: 'en',
      }),
    )

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
    const validFile = new File(['AC10 valid dwg bytes'], 'facade-panel.dwg', { type: 'application/acad' })

    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [validFile] } })
    })

    // Exactly one XHR request created
    expect(MockXMLHttpRequest.instances).toHaveLength(1)
    const xhr = MockXMLHttpRequest.instances[0]
    expect(xhr.url).toBe('/api/inquiries/attachments/upload')
    expect(xhr.timeout).toBe(120000)

    // Simulate upload progress
    await act(async () => {
      xhr.simulateProgress(50, 100)
    })
    expect(screen.getByText('50%')).toBeDefined()

    // Simulate upload completion
    await act(async () => {
      xhr.simulateSuccess({
        attachment: {
          byteSize: 1024,
          filename: 'facade-panel.dwg',
          id: 701,
          mimeType: 'application/acad',
        },
        ok: true,
        ticket: 'ticket-session-123',
      })
    })

    expect(screen.getByText('Uploaded')).toBeDefined()
    expect(screen.getByText('1/5 files')).toBeDefined()
  })

  it('supports cancelling an in-flight upload', async () => {
    render(
      React.createElement(InquiryForm, {
        initialIdempotencyKey: '2dcfd680-64e6-4f63-961a-16eec41f60d2',
        locale: 'en',
      }),
    )

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
    const validFile = new File(['step file content'], 'curtain-wall.step')

    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [validFile] } })
    })

    const xhr = MockXMLHttpRequest.instances[0]
    expect(xhr).toBeDefined()

    const cancelButton = screen.getByRole('button', { name: /Cancel curtain-wall.step/i })
    await act(async () => {
      fireEvent.click(cancelButton)
    })

    expect(xhr.aborted).toBe(true)
    expect(screen.queryByText('curtain-wall.step')).toBeNull()
  })

  it('supports retrying a failed upload', async () => {
    render(
      React.createElement(InquiryForm, {
        initialIdempotencyKey: '2dcfd680-64e6-4f63-961a-16eec41f60d2',
        locale: 'en',
      }),
    )

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
    const validFile = new File(['pdf content'], 'specification.pdf', { type: 'application/pdf' })

    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [validFile] } })
    })

    const firstXhr = MockXMLHttpRequest.instances[0]
    await act(async () => {
      firstXhr.simulateNetworkError()
    })

    expect(screen.getByText(/Upload failed/i)).toBeDefined()

    const retryButton = screen.getByRole('button', { name: /Retry specification.pdf/i })
    await act(async () => {
      fireEvent.click(retryButton)
    })

    expect(MockXMLHttpRequest.instances).toHaveLength(2)
    const secondXhr = MockXMLHttpRequest.instances[1]

    await act(async () => {
      secondXhr.simulateSuccess({
        attachment: {
          byteSize: 2048,
          filename: 'specification.pdf',
          id: 802,
          mimeType: 'application/pdf',
        },
        ok: true,
        ticket: 'ticket-retry-success',
      })
    })

    expect(screen.getByText('Uploaded')).toBeDefined()
  })

  it('submits inquiry with Submit button and carries attachment references { id, ticket }', async () => {
    let capturedBody: string | null = null
    ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementation((url, init) => {
      if (url === '/api/inquiries/attachments/ticket') {
        return Promise.resolve({
          json: () => Promise.resolve({ ok: true, ticket: 'ticket-submit-123' }),
          ok: true,
        })
      }
      if (url === '/api/inquiries') {
        capturedBody = init.body as string
        return Promise.resolve({
          json: () => Promise.resolve({ duplicate: false, ok: true, requestId: 'req-success-1' }),
          ok: true,
        })
      }
      return Promise.reject(new Error('unhandled fetch'))
    })

    render(
      React.createElement(InquiryForm, {
        initialIdempotencyKey: '2dcfd680-64e6-4f63-961a-16eec41f60d2',
        locale: 'en',
      }),
    )

    // Upload attachment
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File(['dwg data'], 'project-drawing.dwg', { type: 'application/acad' })

    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [file] } })
    })

    const xhr = MockXMLHttpRequest.instances[0]
    await act(async () => {
      xhr.simulateSuccess({
        attachment: {
          byteSize: 4096,
          filename: 'project-drawing.dwg',
          id: 999,
          mimeType: 'application/acad',
        },
        ok: true,
        ticket: 'ticket-submit-123',
      })
    })

    // Fill form
    fireEvent.change(screen.getByLabelText('Name *'), { target: { value: 'Jane Doe' } })
    fireEvent.change(screen.getByLabelText('Email *'), { target: { value: 'jane@facade.com' } })
    fireEvent.change(screen.getByLabelText('Country *'), { target: { value: 'United Arab Emirates' } })
    fireEvent.change(screen.getByLabelText('Message *'), { target: { value: 'Please review attached drawing for quote.' } })

    // Submit form using Submit button
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
    })

    await waitFor(() => {
      expect(screen.getByTestId('inquiry-request-id').textContent).toBe('req-success-1')
    })

    expect(capturedBody).not.toBeNull()
    const parsed = JSON.parse(capturedBody!)
    expect(parsed.attachments).toEqual([{ id: 999, ticket: 'ticket-submit-123' }])
    expect(parsed.name).toBe('Jane Doe')
    expect(parsed.email).toBe('jane@facade.com')
  })

  it('submits inquiry smoothly without any attachments attached', async () => {
    let capturedBody: string | null = null
    ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementation((url, init) => {
      if (url === '/api/inquiries') {
        capturedBody = init.body as string
        return Promise.resolve({
          json: () => Promise.resolve({ duplicate: false, ok: true, requestId: 'req-no-drawing-1' }),
          ok: true,
        })
      }
      return Promise.reject(new Error('unhandled fetch'))
    })

    render(
      React.createElement(InquiryForm, {
        initialIdempotencyKey: '2dcfd680-64e6-4f63-961a-16eec41f60d2',
        locale: 'en',
      }),
    )

    // Fill form without adding any attachments
    fireEvent.change(screen.getByLabelText('Name *'), { target: { value: 'Concept Buyer' } })
    fireEvent.change(screen.getByLabelText('Email *'), { target: { value: 'buyer@concept.com' } })
    fireEvent.change(screen.getByLabelText('Country *'), { target: { value: 'Saudi Arabia' } })
    fireEvent.change(screen.getByLabelText('Message *'), { target: { value: 'Concept inquiry without drawings.' } })

    // Submit form
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
    })

    await waitFor(() => {
      expect(screen.getByTestId('inquiry-request-id').textContent).toBe('req-no-drawing-1')
    })

    expect(capturedBody).not.toBeNull()
    const parsed = JSON.parse(capturedBody!)
    expect(parsed.attachments).toBeUndefined()
    expect(parsed.name).toBe('Concept Buyer')
  })

  it('renders Arabic localized labels and Submit button properly', () => {
    render(
      React.createElement(InquiryForm, {
        initialIdempotencyKey: '2dcfd680-64e6-4f63-961a-16eec41f60d2',
        locale: 'ar',
      }),
    )

    expect(screen.getByText('الرسومات والمستندات')).toBeDefined()
    expect(screen.getByText(/بحد أقصى 5 ملفات/i)).toBeDefined()
    expect(screen.getByText('استعراض الملفات')).toBeDefined()
    expect(screen.getByRole('button', { name: 'إرسال' })).toBeDefined()
  })
})
