import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Payload, PayloadRequest } from 'payload'

import { enqueueFeishuLeadSyncForLead } from '@/modules/feishu/jobs'
import { seedPortalDemo } from '@/seed/portalDemo'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('Portal demo seed safety', () => {
  it('fails before touching Payload in production', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    const payload = {
      create: vi.fn(),
      find: vi.fn(),
      logger: { info: vi.fn() },
    } as unknown as Payload

    await expect(seedPortalDemo(payload)).rejects.toThrow(
      'Portal DEMO seed is forbidden in production',
    )
    expect(payload.find).not.toHaveBeenCalled()
    expect(payload.create).not.toHaveBeenCalled()
    expect(payload.logger.info).not.toHaveBeenCalled()
  })

  it('skips Feishu synchronization before reading integration configuration', async () => {
    const doc = { id: 71, intentLevel: 'a', status: 'new' }
    const find = vi.fn()
    const req = {
      context: { skipFeishuSync: true },
      payload: { find },
    } as unknown as PayloadRequest

    await expect(enqueueFeishuLeadSyncForLead({ doc, operation: 'create', req })).resolves.toBe(doc)
    expect(find).not.toHaveBeenCalled()
  })
})
