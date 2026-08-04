import { describe, expect, it, vi } from 'vitest'

import { createPortalCommandKeySession } from '@/admin-portal/core/commands/usePortalCommandKey'

describe('Portal command key session', () => {
  it('reuses a key only while the same payload has no HTTP response', () => {
    const createID = vi.fn().mockReturnValueOnce('first').mockReturnValueOnce('second')
    const session = createPortalCommandKeySession('portal-test', createID)

    const first = session.key('{"prompt":"same"}')
    expect(session.key('{"prompt":"same"}')).toBe(first)

    session.receivedResponse(first)
    expect(session.key('{"prompt":"same"}')).toBe('portal-test:second')
  })

  it('rotates immediately when the intended payload changes', () => {
    const createID = vi.fn().mockReturnValueOnce('first').mockReturnValueOnce('changed')
    const session = createPortalCommandKeySession('portal-test', createID)

    expect(session.key('{"title":"before"}')).toBe('portal-test:first')
    expect(session.key('{"title":"after"}')).toBe('portal-test:changed')
  })
})
