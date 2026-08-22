import { describe, expect, it, vi } from 'vitest'

import type { Payload, PayloadRequest } from 'payload'

import {
  SiteSettingsCommandError,
  updatePortalSiteSettings,
} from '@/admin-portal/modules/settings/siteSettingsCommands'

const request = {
  transactionID: Promise.resolve('site-settings-test'),
  user: { collection: 'users', id: 1 },
} as unknown as PayloadRequest

describe('Portal site settings command', () => {
  it('updates both locales while preserving existing non-editable site fields', async () => {
    const updateGlobal = vi
      .fn()
      .mockResolvedValueOnce({ updatedAt: '2026-08-19T00:00:01.000Z' })
      .mockResolvedValueOnce({ updatedAt: '2026-08-19T00:00:02.000Z' })
    const payload = {
      db: { sessions: { 'site-settings-test': { db: { execute: vi.fn() } } } },
      findGlobal: vi.fn().mockResolvedValue({
        contact: {
          address: 'Existing address',
          email: 'old@example.invalid',
          phone: '+86123',
          whatsapp: '+86456',
        },
        siteDescription: 'Existing English description',
        siteName: 'Existing English name',
        updatedAt: '2026-08-19T00:00:00.000Z',
      }),
      updateGlobal,
    } as unknown as Payload

    const result = await updatePortalSiteSettings({
      input: {
        ar: { siteDescription: 'وصف جديد', siteName: 'اسم جديد' },
        contact: { email: 'new@example.invalid', phone: '+9715000' },
        en: { siteDescription: 'New description', siteName: 'New name' },
        updatedAt: '2026-08-19T00:00:00.000Z',
      },
      payload,
      req: request,
    })

    expect(updateGlobal).toHaveBeenNthCalledWith(1, {
      data: {
        contact: {
          address: 'Existing address',
          email: 'new@example.invalid',
          phone: '+9715000',
          whatsapp: '+86456',
        },
        siteDescription: 'New description',
        siteName: 'New name',
      },
      locale: 'en',
      overrideAccess: false,
      req: request,
      slug: 'site-settings',
    })
    expect(updateGlobal).toHaveBeenNthCalledWith(2, {
      data: { siteDescription: 'وصف جديد', siteName: 'اسم جديد' },
      locale: 'ar',
      overrideAccess: false,
      req: request,
      slug: 'site-settings',
    })
    expect(result.updatedAt).toBe('2026-08-19T00:00:02.000Z')
  })

  it('rejects stale site settings before writing either locale', async () => {
    const updateGlobal = vi.fn()
    const payload = {
      db: { sessions: { 'site-settings-test': { db: { execute: vi.fn() } } } },
      findGlobal: vi.fn().mockResolvedValue({ updatedAt: 'current-version' }),
      updateGlobal,
    } as unknown as Payload

    await expect(
      updatePortalSiteSettings({
        input: {
          ar: { siteDescription: null, siteName: 'اسم' },
          contact: { email: null, phone: null },
          en: { siteDescription: null, siteName: 'Name' },
          updatedAt: 'stale-version',
        },
        payload,
        req: request,
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<SiteSettingsCommandError>>({
        code: 'site-settings-stale',
        status: 409,
      }),
    )
    expect(updateGlobal).not.toHaveBeenCalled()
  })
})
