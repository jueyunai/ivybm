// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  authorizeSiteSettingsRequest: vi.fn(),
  executePortalRouteCommand: vi.fn(),
  readSiteSettingsJSON: vi.fn(),
  updatePortalSiteSettings: vi.fn(),
}))

vi.mock('@/admin-portal/core/commands/portalCommandReceipts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/admin-portal/core/commands/portalCommandReceipts')>()),
  executePortalRouteCommand: mocks.executePortalRouteCommand,
}))
vi.mock('@/admin-portal/modules/settings/siteSettingsRoute', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/admin-portal/modules/settings/siteSettingsRoute')>()),
  authorizeSiteSettingsRequest: mocks.authorizeSiteSettingsRequest,
  readSiteSettingsJSON: mocks.readSiteSettingsJSON,
}))
vi.mock('@/admin-portal/modules/settings/siteSettingsCommands', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('@/admin-portal/modules/settings/siteSettingsCommands')
  >()),
  updatePortalSiteSettings: mocks.updatePortalSiteSettings,
}))

import { PATCH } from '@/app/api/portal/settings/site/route'

describe('Portal site settings route', () => {
  beforeEach(() => {
    mocks.authorizeSiteSettingsRequest.mockReset().mockResolvedValue({
      payload: { id: 'payload' },
      req: { id: 'request' },
    })
    mocks.readSiteSettingsJSON.mockReset().mockResolvedValue({
      ar: { siteName: 'موقع' },
      en: { siteName: 'Site' },
      updatedAt: 'current',
    })
    mocks.updatePortalSiteSettings.mockReset().mockResolvedValue({
      contact: { email: 'site@example.invalid' },
      locales: { ar: { siteName: 'موقع' }, en: { siteName: 'Site' } },
      updatedAt: 'next',
    })
    mocks.executePortalRouteCommand
      .mockReset()
      .mockImplementation(async ({ operation }) => operation({ id: 'transaction-request' }))
  })

  it('wraps the command result so clients can advance the revision', async () => {
    const response = await PATCH(
      new NextRequest('http://localhost/api/portal/settings/site', {
        body: '{}',
        headers: { 'content-type': 'application/json', 'Idempotency-Key': 'site-settings:test' },
        method: 'PATCH',
      }),
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toEqual({
      result: {
        contact: { email: 'site@example.invalid' },
        locales: { ar: { siteName: 'موقع' }, en: { siteName: 'Site' } },
        updatedAt: 'next',
      },
    })
    expect(mocks.updatePortalSiteSettings).toHaveBeenCalledWith({
      input: expect.objectContaining({ updatedAt: 'current' }),
      payload: { id: 'payload' },
      req: { id: 'transaction-request' },
    })
  })
})
