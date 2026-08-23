import React from 'react'

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { Payload, PayloadRequest } from 'payload'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { PortalPreferencesProvider } from '@/admin-portal/core/navigation/PortalPreferences'
import { KnowledgeSourcePanel } from '@/admin-portal/modules/knowledge/KnowledgeSourcePanel'
import {
  KNOWLEDGE_SOURCE_PAGE_SIZE,
  listKnowledgeSources,
  parseKnowledgeSourcePage,
} from '@/admin-portal/modules/knowledge/knowledgeSourceRoute'

const req = { user: { id: 7, role: 'operator' } } as unknown as PayloadRequest

const source = (id: number, title: string) => ({
  detectedLanguage: 'en',
  errorCode: null,
  errorSummary: null,
  filename: `source-${id}.pdf`,
  filesize: 1024,
  id,
  imageCount: 0,
  mimeType: 'application/pdf',
  processingStage: 'complete',
  processingStatus: 'needs_review',
  sourceTitle: title,
  sourceType: 'technical-specification',
  sourceVersion: '1',
  updatedAt: '2026-08-09T00:00:00.000Z',
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  window.localStorage.clear()
})

describe('knowledge source pagination', () => {
  it('normalizes page input and performs an access-controlled paginated read', async () => {
    expect(parseKnowledgeSourcePage(null)).toBe(1)
    expect(parseKnowledgeSourcePage('0')).toBe(1)
    expect(parseKnowledgeSourcePage('2.5')).toBe(1)
    expect(parseKnowledgeSourcePage('3')).toBe(3)

    const find = vi.fn().mockResolvedValue({
      docs: [{ ...source(51, 'Source 51'), currentJobOwnerToken: 'must-not-leak' }],
      hasNextPage: false,
      page: 3,
      totalDocs: 51,
      totalPages: 3,
    })
    const result = await listKnowledgeSources({
      page: 3,
      payload: { find } as unknown as Pick<Payload, 'find'>,
      req,
    })

    expect(find).toHaveBeenCalledWith(expect.objectContaining({
      collection: 'knowledge-source-documents',
      limit: KNOWLEDGE_SOURCE_PAGE_SIZE,
      overrideAccess: false,
      page: 3,
      pagination: true,
      req,
    }))
    expect(result).toMatchObject({
      pagination: { hasNextPage: false, page: 3, pageSize: 25, totalDocs: 51, totalPages: 3 },
      sources: [{ id: 51, sourceTitle: 'Source 51' }],
    })
    expect(JSON.stringify(result)).not.toContain('must-not-leak')
  })

  it('lets an operator reach the fifty-first source through accessible page controls', async () => {
    const pages = new Map([
      [1, { hasNextPage: true, page: 1, sources: [source(1, 'Source 1')] }],
      [2, { hasNextPage: true, page: 2, sources: [source(26, 'Source 26')] }],
      [3, { hasNextPage: false, page: 3, sources: [source(51, 'Source 51')] }],
    ])
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), 'http://localhost')
      const page = Number(url.searchParams.get('page') ?? '1')
      const body = pages.get(page) ?? pages.get(1)!
      return Response.json({
        pagination: {
          hasNextPage: body.hasNextPage,
          page: body.page,
          pageSize: 25,
          totalDocs: 51,
          totalPages: 3,
        },
        sources: body.sources,
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    render(
      React.createElement(
        PortalPreferencesProvider,
        null,
        React.createElement(KnowledgeSourcePanel, { role: 'operator' }),
      ),
    )

    expect(await screen.findByText('Source 1')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '下一页' }))
    expect(await screen.findByText('Source 26')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '下一页' }))
    expect(await screen.findByText('Source 51')).toBeTruthy()
    expect(screen.getByText(/页码 3\/3/)).toBeTruthy()
    expect(fetchMock).toHaveBeenCalledWith('/api/portal/knowledge/sources?page=3', { cache: 'no-store' })
  })

  it('localizes persisted ingestion errors instead of rendering the stored language', async () => {
    window.localStorage.setItem(
      'ivybm.portal.preferences',
      JSON.stringify({ locale: 'en', reducedMotion: false, theme: 'light' }),
    )
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        Response.json({
          pagination: { hasNextPage: false, page: 1, pageSize: 25, totalDocs: 1, totalPages: 1 },
          sources: [
            {
              ...source(9, 'Broken PDF'),
              errorCode: 'invalid-pdf',
              errorSummary: 'PDF 文件格式无效或损坏',
              processingStatus: 'failed',
            },
          ],
        }),
      ),
    )

    render(
      React.createElement(
        PortalPreferencesProvider,
        null,
        React.createElement(KnowledgeSourcePanel, { role: 'operator' }),
      ),
    )

    expect(await screen.findByText('The PDF file is invalid or damaged.')).toBeTruthy()
    expect(screen.queryByText('PDF 文件格式无效或损坏')).toBeNull()
  })
})
