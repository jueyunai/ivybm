// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  adoptContentStudioImage: vi.fn(),
  authorizeContentStudioRequest: vi.fn(),
  executePortalRouteCommand: vi.fn(),
}))

vi.mock('@/admin-portal/core/commands/portalCommandReceipts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/admin-portal/core/commands/portalCommandReceipts')>()),
  executePortalRouteCommand: mocks.executePortalRouteCommand,
}))
vi.mock('@/admin-portal/modules/content-studio/contentStudioCommands', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/admin-portal/modules/content-studio/contentStudioCommands')>()),
  adoptContentStudioImage: mocks.adoptContentStudioImage,
}))
vi.mock('@/admin-portal/modules/content-studio/contentStudioRoute', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/admin-portal/modules/content-studio/contentStudioRoute')>()),
  authorizeContentStudioRequest: mocks.authorizeContentStudioRequest,
}))

import { POST } from '@/app/api/portal/content-studio/[id]/route'

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
  })

  it('dispatches adopt-image through an atomic target receipt', async () => {
    const response = await POST(request({ action: 'adopt-image', mediaId: 81, updatedAt: 'current' }), {
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
})
