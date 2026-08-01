import { describe, expect, it, vi } from 'vitest'

import type { PayloadRequest } from 'payload'

import {
  MediaCommandError,
  createPortalMedia,
  deletePortalMedia,
  parseMediaMetadata,
  updatePortalMedia,
  validatePortalMediaFile,
} from '@/admin-portal/modules/media/mediaCommands'

const req = {
  user: { collection: 'users', email: 'operator@example.invalid', id: 2, role: 'operator' },
} as unknown as PayloadRequest

describe('Portal media commands', () => {
  it('parses bounded metadata and validates upload files', () => {
    expect(
      parseMediaMetadata({
        alt: '  Aluminum facade sample ',
        isPublic: 'true',
        source: ' IVYBM owned photography ',
        updatedAt: '2026-07-30T10:00:00.000Z',
      }),
    ).toEqual({
      alt: 'Aluminum facade sample',
      isPublic: true,
      source: 'IVYBM owned photography',
      updatedAt: '2026-07-30T10:00:00.000Z',
    })

    expect(
      validatePortalMediaFile({
        data: Buffer.from('pdf'),
        mimetype: 'application/pdf',
        name: 'owned-reference.pdf',
        size: 3,
      }),
    ).toMatchObject({ name: 'owned-reference.pdf' })
    expect(() =>
      validatePortalMediaFile({
        data: Buffer.from('html'),
        mimetype: 'text/html',
        name: 'unsafe.html',
        size: 4,
      }),
    ).toThrow(MediaCommandError)
  })

  it('creates an asset through the current access-controlled Payload request', async () => {
    const create = vi.fn().mockResolvedValue({
      alt: 'Owned reference',
      filename: 'owned-reference.pdf',
      id: 42,
      isPublic: false,
      mimeType: 'application/pdf',
      source: 'IVYBM',
      updatedAt: '2026-07-30T10:00:00.000Z',
    })

    await expect(
      createPortalMedia({
        file: {
          data: Buffer.from('pdf'),
          mimetype: 'application/pdf',
          name: 'owned-reference.pdf',
          size: 3,
        },
        input: { alt: 'Owned reference', isPublic: false, source: 'IVYBM' },
        payload: { create },
        req,
      }),
    ).resolves.toMatchObject({ id: 42, isPublic: false })

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: 'media',
        overrideAccess: false,
        req,
      }),
    )
  })

  it('rejects stale metadata updates', async () => {
    const findByID = vi.fn().mockResolvedValue({
      id: 42,
      updatedAt: '2026-07-30T10:00:00.000Z',
    })
    const update = vi.fn()

    await expect(
      updatePortalMedia({
        id: 42,
        input: {
          alt: 'Updated alt',
          isPublic: true,
          source: 'IVYBM',
          updatedAt: '2026-07-30T09:00:00.000Z',
        },
        payload: { findByID, update },
        req,
      }),
    ).rejects.toMatchObject({ code: 'media-stale', status: 409 })
    expect(update).not.toHaveBeenCalled()
  })

  it('blocks deletion while an asset is referenced by content', async () => {
    const count = vi.fn().mockResolvedValueOnce({ totalDocs: 1 })
    const deleteDocument = vi.fn()
    const findByID = vi.fn().mockResolvedValue({
      id: 42,
      updatedAt: '2026-07-30T10:00:00.000Z',
    })

    await expect(
      deletePortalMedia({
        id: 42,
        payload: { count, delete: deleteDocument, findByID },
        req,
        updatedAt: '2026-07-30T10:00:00.000Z',
      }),
    ).rejects.toMatchObject({ code: 'media-in-use', status: 409 })
    expect(count).toHaveBeenCalledWith(
      expect.objectContaining({ collection: 'pages', overrideAccess: false, req }),
    )
    expect(deleteDocument).not.toHaveBeenCalled()
  })

  it('blocks deletion while a Content Studio draft uses the asset', async () => {
    const count = vi
      .fn()
      .mockResolvedValueOnce({ totalDocs: 0 })
      .mockResolvedValueOnce({ totalDocs: 0 })
      .mockResolvedValueOnce({ totalDocs: 0 })
      .mockResolvedValueOnce({ totalDocs: 0 })
      .mockResolvedValueOnce({ totalDocs: 0 })
      .mockResolvedValueOnce({ totalDocs: 0 })
      .mockResolvedValueOnce({ totalDocs: 0 })
      .mockResolvedValueOnce({ totalDocs: 1 })
    const findByID = vi.fn().mockResolvedValue({
      id: 42,
      updatedAt: '2026-07-30T10:00:00.000Z',
    })

    await expect(
      deletePortalMedia({
        id: 42,
        payload: { count, delete: vi.fn(), findByID, findGlobal: vi.fn() },
        req,
        updatedAt: '2026-07-30T10:00:00.000Z',
      }),
    ).rejects.toMatchObject({ code: 'media-in-use', status: 409 })
    expect(count).toHaveBeenLastCalledWith(
      expect.objectContaining({ collection: 'generated-contents', overrideAccess: false, req }),
    )
  })
})
