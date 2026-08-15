// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ getPayload: vi.fn(), readPublicationAsset: vi.fn() }))

vi.mock('payload', () => ({ getPayload: mocks.getPayload }))
vi.mock('@/payload.config', () => ({ default: {} }))
vi.mock('@/modules/media/publicationAssets', () => ({
  readPublicationAsset: mocks.readPublicationAsset,
}))

import { GET } from '@/app/api/publication-assets/[id]/[sha256]/route'

describe('public publication asset route', () => {
  beforeEach(() => {
    mocks.getPayload.mockReset().mockResolvedValue({})
    mocks.readPublicationAsset.mockReset()
  })

  it('returns immutable nosniff bytes only after hash validation', async () => {
    mocks.readPublicationAsset.mockResolvedValue({
      bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
      mimeType: 'image/png',
    })
    const sha256 = 'a'.repeat(64)
    const response = await GET(new Request('https://ivybm.example.invalid'), {
      params: Promise.resolve({ id: '81', sha256 }),
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('public, max-age=0, must-revalidate')
    expect(response.headers.get('content-type')).toBe('image/png')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(mocks.readPublicationAsset).toHaveBeenCalledWith({ id: 81, payload: {}, sha256 })
  })

  it('returns 404 for an invalid or replaced asset identity', async () => {
    mocks.readPublicationAsset.mockResolvedValue(null)
    const response = await GET(new Request('https://ivybm.example.invalid'), {
      params: Promise.resolve({ id: 'invalid', sha256: 'x' }),
    })

    expect(response.status).toBe(404)
  })
})
