import { describe, expect, it, vi } from 'vitest'

import type { Payload, PayloadRequest } from 'payload'

import { getPortalSiteSettingsEditor } from '@/admin-portal/modules/settings/getPortalSettingsSummary'

describe('Portal site settings editor reader', () => {
  it('loads distinct English and Arabic values without shared request mutation', async () => {
    const originalReq = {
      locale: 'en',
      user: { collection: 'users', id: 1 },
    } as unknown as PayloadRequest

    const receivedRequests: PayloadRequest[] = []

    const findGlobal = vi.fn().mockImplementation(async ({ locale, req }) => {
      receivedRequests.push(req)
      // Simulate Payload internal createLocalReq mutating req.locale in-place
      req.locale = locale

      // Asynchronously yield so concurrent tasks interleave, faithfully reproducing the race condition
      await new Promise((resolve) => setTimeout(resolve, 10))

      // Crucial: return based on the actual mutated state of req.locale, matching Payload runtime behavior
      if (req.locale === 'en') {
        return {
          contact: {
            email: 'sales@ivybm.com',
            phone: '+86 757 8560 0000',
          },
          siteDescription: 'Architectural aluminum facade manufacturer',
          siteName: 'IVY Building Materials',
          updatedAt: '2026-08-19T00:00:01.000Z',
        }
      }

      return {
        contact: {
          email: 'sales@ivybm.com',
          phone: '+86 757 8560 0000',
        },
        siteDescription: 'مصنع واجهات ألمنيوم معمارية',
        siteName: 'IVY لمواد البناء',
        updatedAt: '2026-08-19T00:00:02.000Z',
      }
    })

    const payload = { findGlobal } as unknown as Payload

    const result = await getPortalSiteSettingsEditor({ payload, req: originalReq })

    expect(findGlobal).toHaveBeenCalledTimes(2)
    // Assert that each parallel call received a distinct request object, not the shared original
    expect(receivedRequests).toHaveLength(2)
    expect(receivedRequests[0]).not.toBe(receivedRequests[1])
    expect(receivedRequests[0]).not.toBe(originalReq)
    expect(receivedRequests[1]).not.toBe(originalReq)

    expect(result.locales.en).toEqual({
      siteDescription: 'Architectural aluminum facade manufacturer',
      siteName: 'IVY Building Materials',
    })
    expect(result.locales.ar).toEqual({
      siteDescription: 'مصنع واجهات ألمنيوم معمارية',
      siteName: 'IVY لمواد البناء',
    })
    expect(result.contact).toEqual({
      email: 'sales@ivybm.com',
      phone: '+86 757 8560 0000',
    })
    expect(result.updatedAt).toBe('2026-08-19T00:00:01.000Z')

    // Verify originalReq was not mutated
    expect(originalReq.locale).toBe('en')
  })

  it('falls back to IVYBM and null when optional site fields are blank', async () => {
    const req = { user: { collection: 'users', id: 1 } } as unknown as PayloadRequest
    const findGlobal = vi.fn().mockResolvedValue({
      contact: {},
      siteDescription: '   ',
      siteName: '',
      updatedAt: '',
    })

    const payload = { findGlobal } as unknown as Payload

    const result = await getPortalSiteSettingsEditor({ payload, req })

    expect(result.locales.en).toEqual({
      siteDescription: null,
      siteName: 'IVYBM',
    })
    expect(result.locales.ar).toEqual({
      siteDescription: null,
      siteName: 'IVYBM',
    })
    expect(result.contact).toEqual({
      email: null,
      phone: null,
    })
  })
})
