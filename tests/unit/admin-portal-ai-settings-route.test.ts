// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { AiCredentialError } from '@/modules/ai/credentials'

const mocks = vi.hoisted(() => ({
  createLocalReq: vi.fn(),
  executePortalRouteCommand: vi.fn(),
  getPayload: vi.fn(),
}))

vi.mock('payload', () => ({ createLocalReq: mocks.createLocalReq, getPayload: mocks.getPayload }))
vi.mock('@/payload.config', () => ({ default: {} }))
vi.mock('@/admin-portal/core/commands/portalCommandReceipts', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/admin-portal/core/commands/portalCommandReceipts')>()
  return { ...original, executePortalRouteCommand: mocks.executePortalRouteCommand }
})

import { DELETE, PATCH } from '@/app/api/portal/settings/ai/[resource]/[id]/route'
import { POST } from '@/app/api/portal/settings/ai/[resource]/route'
import { GET } from '@/app/api/portal/settings/ai/route'
import { aiSettingsErrorResponse } from '@/admin-portal/modules/settings/aiSettingsRoute'

const request = (body: unknown, method: 'DELETE' | 'PATCH' | 'POST' = 'POST'): NextRequest =>
  new NextRequest('http://localhost/api/portal/settings/ai/providers', {
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', 'Idempotency-Key': 'portal-ai:test-command' },
    method,
  })

describe('Portal AI settings route', () => {
  beforeEach(() => {
    vi.stubEnv('ADMIN_PORTAL_ENABLED', 'true')
    vi.stubEnv('ADMIN_PORTAL_SETTINGS_ENABLED', 'true')
    mocks.createLocalReq.mockReset().mockResolvedValue({ user: { id: 1 } })
    mocks.executePortalRouteCommand.mockReset().mockResolvedValue({ item: { id: 1 }, resource: 'providers' })
    mocks.getPayload.mockReset()
  })

  afterEach(() => vi.unstubAllEnvs())

  it('rejects unauthenticated and non-admin users before any command runs', async () => {
    mocks.getPayload.mockResolvedValue({ auth: vi.fn().mockResolvedValue({ user: null }) })
    const unauthenticated = await POST(request({}), { params: Promise.resolve({ resource: 'providers' }) })
    expect(unauthenticated.status).toBe(401)
    expect(unauthenticated.headers.get('cache-control')).toBe('no-store')

    for (const role of ['operator', 'sales'] as const) {
      mocks.getPayload.mockResolvedValue({
        auth: vi.fn().mockResolvedValue({ user: { collection: 'users', id: 2, role } }),
      })
      const responses = await Promise.all([
        GET(new NextRequest('http://localhost/api/portal/settings/ai')),
        POST(request({}), { params: Promise.resolve({ resource: 'providers' }) }),
        PATCH(request({}, 'PATCH'), {
          params: Promise.resolve({ id: '1', resource: 'providers' }),
        }),
        DELETE(request({}, 'DELETE'), {
          params: Promise.resolve({ id: '1', resource: 'providers' }),
        }),
      ])
      expect(responses.map((response) => response.status)).toEqual([403, 403, 403, 403])
    }
    expect(mocks.executePortalRouteCommand).not.toHaveBeenCalled()
  })

  it('rejects oversized bodies before starting a receipt command', async () => {
    mocks.getPayload.mockResolvedValue({
      auth: vi.fn().mockResolvedValue({ user: { collection: 'users', id: 1, role: 'admin' } }),
    })
    const response = await POST(
      request({ padding: 'x'.repeat(16_100) }),
      { params: Promise.resolve({ resource: 'providers' }) },
    )
    expect(response.status).toBe(413)
    expect(mocks.executePortalRouteCommand).not.toHaveBeenCalled()
  })

  it('runs an admin command with no-store response semantics', async () => {
    mocks.getPayload.mockResolvedValue({
      auth: vi.fn().mockResolvedValue({ user: { collection: 'users', id: 1, role: 'admin' } }),
    })
    const response = await POST(
      request({ apiKey: 'secret', baseURL: 'https://api.example.invalid/v1', enabled: true, name: 'Primary' }),
      { params: Promise.resolve({ resource: 'providers' }) },
    )
    expect(response.status).toBe(201)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(mocks.executePortalRouteCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        fingerprintInput: expect.objectContaining({ resource: 'providers' }),
        scope: 'portal.ai-settings:providers:create',
      }),
    )
  })

  it.each([
    {
      error: new AiCredentialError('secret-key-was-invalid'),
      expectedCode: 'ai-settings-encryption-unavailable',
      expectedStatus: 503,
    },
    {
      error: Object.assign(new Error('validation included secret-key'), { name: 'ValidationError' }),
      expectedCode: 'ai-settings-validation-failed',
      expectedStatus: 400,
    },
    {
      error: new Error('unexpected failure included secret-key'),
      expectedCode: 'ai-settings-command-failed',
      expectedStatus: 500,
    },
  ])('returns a stable, credential-free $expectedCode response', async ({
    error,
    expectedCode,
    expectedStatus,
  }) => {
    const response = aiSettingsErrorResponse(error)
    const body = await response.text()

    expect(response.status).toBe(expectedStatus)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(body).toContain(expectedCode)
    expect(body).not.toContain('secret-key')
  })
})
