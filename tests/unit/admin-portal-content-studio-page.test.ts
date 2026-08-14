import { describe, expect, it, vi } from 'vitest'

import type { Payload, PayloadRequest } from 'payload'

import {
  loadContentStudioPageData,
  parseContentStudioQuery,
} from '@/admin-portal/modules/content-studio/getContentStudioPage'

const req = { user: { collection: 'users', id: 2, role: 'operator' } } as unknown as PayloadRequest

describe('Portal Content Studio read model', () => {
  it('projects publishing accounts for operators without requesting credentials', async () => {
    const find = vi.fn(async ({ collection }: { collection: string }) => {
      if (collection === 'generated-contents')
        return { docs: [], page: 1, totalDocs: 0, totalPages: 1 }
      if (collection === 'platform-accounts')
        return {
          docs: [
            {
              accountKind: 'facebook-page',
              authorization: { accessToken: 'must-not-be-projected', state: 'connected' },
              capabilities: { publishing: 'approved' },
              id: 31,
              name: 'Operator-safe Facebook page',
            },
          ],
        }
      return { docs: [] }
    })

    const result = await loadContentStudioPageData({
      env: {
        ADMIN_PORTAL_CONTENT_STUDIO_ENABLED: 'true',
        ADMIN_PORTAL_ENABLED: 'true',
        ADMIN_PORTAL_PUBLISHING_ENABLED: 'true',
      },
      payload: { find } as unknown as Payload,
      query: parseContentStudioQuery({}),
      req,
      role: 'operator',
    })

    expect(find).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: 'platform-accounts',
        overrideAccess: true,
        req,
        select: {
          accountKind: true,
          authorization: { state: true },
          capabilities: { publishing: true },
          name: true,
        },
      }),
    )
    expect(result.summary?.options.platformAccounts).toEqual([
      { id: 31, label: 'Operator-safe Facebook page', platform: 'facebook' },
    ])
    expect(result.summary?.options.platformAccounts[0]).not.toHaveProperty('authorization')
  })

  it('returns all asset options while exposing only safe image preview URLs', async () => {
    const find = vi.fn(async ({ collection }: { collection: string }) => {
      if (collection === 'generated-contents')
        return { docs: [], page: 1, totalDocs: 0, totalPages: 1 }
      if (collection === 'media')
        return {
          docs: [
            {
              alt: 'Facade',
              id: 21,
              mimeType: 'image/webp',
              sizes: { card: { url: '/media/card.webp' } },
              url: '/media/facade.webp',
            },
            { alt: 'Unsafe', id: 22, mimeType: 'image/png', url: 'javascript:alert(1)' },
            { alt: 'Catalogue', id: 23, mimeType: 'application/pdf', url: '/media/catalogue.pdf' },
          ],
        }
      return { docs: [] }
    })

    const result = await loadContentStudioPageData({
      env: { ADMIN_PORTAL_CONTENT_STUDIO_ENABLED: 'true', ADMIN_PORTAL_ENABLED: 'true' },
      payload: { find } as unknown as Payload,
      query: parseContentStudioQuery({}),
      req,
      role: 'operator',
    })

    expect(find).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: 'media',
        overrideAccess: false,
        req,
        select: expect.objectContaining({
          sizes: { card: { url: true }, thumbnail: { url: true } },
          url: true,
        }),
      }),
    )
    expect(result.summary?.options.assets).toEqual([
      expect.objectContaining({ id: 21, previewUrl: '/media/card.webp' }),
      expect.not.objectContaining({ previewUrl: expect.anything() }),
      expect.not.objectContaining({ previewUrl: expect.anything() }),
    ])
  })
})
