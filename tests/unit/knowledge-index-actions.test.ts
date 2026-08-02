import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  role: 'operator',
  setData: vi.fn(),
}))

vi.mock('@payloadcms/ui', () => ({
  useAuth: () => ({ user: { role: mocks.role } }),
  useDocumentInfo: () => ({
    data: { indexStatus: 'pending', reviewStatus: 'reviewed' },
    id: 7,
    setData: mocks.setData,
  }),
  useFormModified: () => false,
  useTranslation: () => ({ i18n: { language: 'en' } }),
}))

import KnowledgeIndexActions from '@/admin/components/KnowledgeIndexActions'

describe('KnowledgeIndexActions job visibility', () => {
  beforeEach(() => {
    mocks.fetch.mockReset()
    mocks.setData.mockReset()
    vi.stubGlobal('fetch', mocks.fetch)
    mocks.fetch.mockResolvedValue(
      new Response(JSON.stringify({ jobId: 42, state: 'created', status: 'pending' }), {
        headers: { 'content-type': 'application/json' },
        status: 202,
      }),
    )
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it.each([
    ['operator', false],
    ['sales', false],
    ['admin', true],
  ])('shows a queued Job link to %s only when authorized', async (role, canOpenJob) => {
    mocks.role = role
    const { container } = render(React.createElement(KnowledgeIndexActions))

    fireEvent.click(screen.getByRole('button'))
    await waitFor(() => expect(screen.getByRole('status')).toBeTruthy())

    const jobLink = container.querySelector('a[href="/admin/collections/jobs/42"]')
    expect(Boolean(jobLink)).toBe(canOpenJob)
  })
})
