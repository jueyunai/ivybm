import type { Payload, PayloadRequest } from 'payload'
import { describe, expect, it, vi } from 'vitest'

import {
  getContentSummary,
  parseContentQuery,
  type ContentTypeId,
} from '@/admin-portal/modules/website-content/getContentSummary'

const req = { user: { id: 1, role: 'admin' } } as unknown as PayloadRequest

describe('Portal content sort modes', () => {
  it('defaults invalid sort inputs to recently created and bounds website mode to public content', () => {
    expect(parseContentQuery({ sort: '-internalNotes', type: 'products' })).toEqual({
      page: 1,
      q: '',
      sort: 'created',
      status: 'all',
      type: 'products',
    })
    expect(parseContentQuery({ sort: 'website', status: 'draft', type: 'products' })).toEqual({
      page: 1,
      q: '',
      sort: 'website',
      status: 'published',
      type: 'products',
    })
    expect(parseContentQuery({ sort: 'website', type: 'product-categories' }).sort).toBe('created')
  })

  it.each(['created', 'updated'] as const)(
    'applies %s ordering in the paginated database query',
    async (sort) => {
      const find = vi.fn().mockResolvedValue({ docs: [], page: 2, totalDocs: 0, totalPages: 0 })
      const query = parseContentQuery({
        page: '2',
        q: 'panel',
        sort,
        status: 'draft',
        type: 'products',
      })
      const summary = await getContentSummary({
        payload: { find } as unknown as Payload,
        query,
        req,
      })
      expect(find).toHaveBeenCalledWith(
        expect.objectContaining({
          collection: 'products',
          draft: true,
          limit: 12,
          page: 2,
          select: expect.objectContaining({ createdAt: true, publishedAt: true, updatedAt: true }),
          sort: [sort === 'created' ? '-createdAt' : '-updatedAt', '-id'],
        }),
      )
      expect(find).toHaveBeenCalledWith(
        expect.objectContaining({
          limit: 1,
          select: { updatedAt: true },
          sort: ['-updatedAt', '-id'],
        }),
      )
      expect(summary.query).toEqual(query)
    },
  )

  it.each(['products', 'projects', 'posts', 'knowledge'] as ContentTypeId[])(
    'uses the actual published documents in %s website order',
    async (type) => {
      const find = vi.fn().mockResolvedValue({ docs: [], totalDocs: 0 })
      const query = parseContentQuery({ sort: 'website', status: 'unpublished', type })
      const summary = await getContentSummary({
        payload: { find } as unknown as Payload,
        query,
        req,
      })
      const listQuery = find.mock.calls.find(([options]) => options.limit === 12)?.[0]
      expect(listQuery).toMatchObject({
        collection: type === 'knowledge' ? 'posts' : type,
        draft: false,
        overrideAccess: false,
        req,
        sort: ['-publishedAt', '-id'],
      })
      expect(JSON.stringify(listQuery.where)).toContain('"_status":{"equals":"published"}')
      expect(summary.query.status).toBe('published')
    },
  )
})
