import { describe, expect, it } from 'vitest'

import {
  portalCommandFingerprint,
  PortalCommandReceiptError,
  requirePortalIdempotencyKey,
} from '@/admin-portal/core/commands/portalCommandReceipts'

describe('Portal command receipt inputs', () => {
  it('creates a stable fingerprint for canonically equivalent objects', () => {
    expect(portalCommandFingerprint({ b: 2, a: { z: true, y: ['x', 1] } })).toBe(
      portalCommandFingerprint({ a: { y: ['x', 1], z: true }, b: 2 }),
    )
  })

  it('preserves array order in command fingerprints', () => {
    expect(portalCommandFingerprint({ ids: [1, 2] })).not.toBe(
      portalCommandFingerprint({ ids: [2, 1] }),
    )
  })

  it('requires a bounded canonical Idempotency-Key header', () => {
    expect(
      requirePortalIdempotencyKey(
        new Request('http://localhost', {
          headers: { 'Idempotency-Key': 'portal-media:create-123' },
        }),
      ),
    ).toBe('portal-media:create-123')
    expect(() => requirePortalIdempotencyKey(new Request('http://localhost'))).toThrowError(
      expect.objectContaining({
        code: 'portal-idempotency-key-required',
        status: 400,
      }) as PortalCommandReceiptError,
    )
  })
})
