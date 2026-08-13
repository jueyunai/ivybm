// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  adoptContentStudioImage: vi.fn(),
  authorizeContentStudioRequest: vi.fn(),
  executePortalRouteCommand: vi.fn(),
  generateContentStudioImage: vi.fn(),
}))

vi.mock('@/admin-portal/core/commands/portalCommandReceipts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/admin-portal/core/commands/portalCommandReceipts')>()),
  executePortalRouteCommand: mocks.executePortalRouteCommand,
}))
vi.mock('@/admin-portal/modules/content-studio/contentStudioCommands', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/admin-portal/modules/content-studio/contentStudioCommands')>()),
  adoptContentStudioImage: mocks.adoptContentStudioImage,
  generateContentStudioImage: mocks.generateContentStudioImage,
}))
vi.mock('@/admin-portal/modules/content-studio/contentStudioRoute', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/admin-portal/modules/content-studio/contentStudioRoute')>()),
  authorizeContentStudioRequest: mocks.authorizeContentStudioRequest,
}))

import { PortalCommandReceiptError } from '@/admin-portal/core/commands/portalCommandReceipts'
import { POST as itemPOST } from '@/app/api/portal/content-studio/[id]/route'
import { POST as generateImagePOST } from '@/app/api/portal/content-studio/generate-image/route'

const request = (body: unknown) => new NextRequest('http://localhost/api/portal/content-studio/71', {
  body: JSON.stringify(body),
  headers: { 'content-type': 'application/json', 'Idempotency-Key': 'portal-content-studio:adopt-image:test' },
  method: 'POST',
})

describe('Portal Content Studio item route', () => {
  beforeEach(() => {
    const req = { user: { id: 1 } }
    mocks.adoptContentStudioImage.mockReset().mockResolvedValue({ id: 71 })
    mocks.authorizeContentStudioRequest.mockReset().mockResolvedValue({ payload: {}, req })
    mocks.executePortalRouteCommand.mockReset().mockImplementation(async ({ operation }) => operation(req))
    mocks.generateContentStudioImage.mockReset()
  })

  it('dispatches adopt-image through an atomic target receipt', async () => {
    const response = await itemPOST(request({ action: 'adopt-image', mediaId: 81, updatedAt: 'current' }), {
      params: Promise.resolve({ id: '71' }),
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ content: { id: 71 } })
    expect(mocks.executePortalRouteCommand).toHaveBeenCalledWith(expect.objectContaining({
      fingerprintInput: { id: 71, input: { action: 'adopt-image', mediaId: 81, updatedAt: 'current' } },
      scope: 'portal.content-studio:adopt-image:71',
      target: { collection: 'generated-contents', id: 71 },
    }))
    expect(mocks.adoptContentStudioImage).toHaveBeenCalledWith(expect.objectContaining({ id: 71 }))
  })

  it('returns a stable unknown 409 from the image route after external dispatch', async () => {
    mocks.executePortalRouteCommand.mockRejectedValueOnce(
      new PortalCommandReceiptError(
        'portal-command-result-unknown',
        'The command outcome is unknown. Check current data before starting a new command.',
        409,
      ),
    )
    const response = await generateImagePOST(
      new NextRequest('http://localhost/api/portal/content-studio/generate-image', {
        body: JSON.stringify({ prompt: 'Generate a facade image', size: '1024x1024' }),
        headers: {
          'content-type': 'application/json',
          'Idempotency-Key': 'portal-content-studio:image-generate:test',
        },
        method: 'POST',
      }),
    )

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({
      error: {
        code: 'portal-command-result-unknown',
        message:
          'The command outcome is unknown. Check current data before starting a new command.',
      },
    })
    expect(mocks.executePortalRouteCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        atomic: false,
        replayPolicy: 'unknown-on-expiry',
        scope: 'portal.content-studio:generate-image',
      }),
    )
  })
})
