import { beforeEach, describe, expect, it } from 'vitest'
import { NextRequest } from 'next/server'

import {
  authorizeUserSettingsRequest,
  isSameOriginRequest,
  isTeamManagementEnabled,
  userSettingsErrorResponse,
} from '@/admin-portal/modules/settings/userSettingsRoute'
import { UserSettingsCommandError } from '@/admin-portal/modules/settings/userSettingsContracts'

describe('Portal user settings route utilities and authorization', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    process.env = { ...originalEnv }
  })

  it('checks team management feature flag', () => {
    expect(isTeamManagementEnabled({ ADMIN_PORTAL_TEAM_MANAGEMENT_ENABLED: 'true' })).toBe(true)
    expect(isTeamManagementEnabled({ ADMIN_PORTAL_TEAM_MANAGEMENT_ENABLED: 'false' })).toBe(false)
    expect(isTeamManagementEnabled({})).toBe(false)
  })

  it('validates same-origin requests in dev/test vs production', () => {
    const devReq = new NextRequest('http://localhost:3000/api/portal/settings/users', {
      headers: { origin: 'http://localhost:3000' },
    })
    expect(isSameOriginRequest(devReq)).toBe(true)

    const foreignReq = new NextRequest('http://localhost:3000/api/portal/settings/users', {
      headers: { origin: 'https://attacker.invalid' },
    })
    expect(isSameOriginRequest(foreignReq)).toBe(false)
  })

  it('formats error responses with proper status and error code', () => {
    const customErr = new UserSettingsCommandError('self-lock-forbidden', 'Cannot lock self', 403)
    const resp = userSettingsErrorResponse(customErr)
    expect(resp.status).toBe(403)
    expect(resp.headers.get('cache-control')).toBe('no-store')

    const validationErr = { name: 'ValidationError', message: 'Invalid field value', status: 400 }
    const valResp = userSettingsErrorResponse(validationErr)
    expect(valResp.status).toBe(400)

    const unexpectedErr = new Error('Database crash')
    const unexpResp = userSettingsErrorResponse(unexpectedErr)
    expect(unexpResp.status).toBe(500)
  })

  it('rejects unauthenticated requests or disabled portal/module', async () => {
    process.env.ADMIN_PORTAL_ENABLED = 'false'
    await expect(
      authorizeUserSettingsRequest(new Request('http://localhost')),
    ).rejects.toEqual(
      expect.objectContaining<Partial<UserSettingsCommandError>>({
        code: 'portal-disabled',
        status: 503,
      }),
    )

    process.env.ADMIN_PORTAL_ENABLED = 'true'
    process.env.ADMIN_PORTAL_SETTINGS_ENABLED = 'false'
    await expect(
      authorizeUserSettingsRequest(new Request('http://localhost')),
    ).rejects.toEqual(
      expect.objectContaining<Partial<UserSettingsCommandError>>({
        code: 'settings-module-disabled',
        status: 503,
      }),
    )

    process.env.ADMIN_PORTAL_SETTINGS_ENABLED = 'true'
    process.env.ADMIN_PORTAL_TEAM_MANAGEMENT_ENABLED = 'false'
    await expect(
      authorizeUserSettingsRequest(new Request('http://localhost'), { requireAdmin: true }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<UserSettingsCommandError>>({
        code: 'team-management-disabled',
        status: 503,
      }),
    )
  })
})
