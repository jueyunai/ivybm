import { describe, expect, it } from 'vitest'

import {
  hashUploadTicket,
  issueUploadTicket,
  uploadTicketTTL,
  verifyUploadTicket,
} from '@/modules/lead-attachments/tokens'

describe('lead attachment upload tokens', () => {
  it('issues a signed upload ticket with 2 hour default TTL', () => {
    const now = 1_700_000_000_000
    const ticket = issueUploadTicket(now)

    expect(typeof ticket).toBe('string')
    expect(ticket).toContain('.')
    expect(uploadTicketTTL).toBe(2 * 60 * 60 * 1_000)

    const verified = verifyUploadTicket(ticket, now)
    expect(verified).not.toBeNull()
    expect(verified?.exp).toBe(now + 2 * 60 * 60 * 1_000)
    expect(verified?.v).toBe('v1')
  })

  it('rejects expired tokens', () => {
    const now = 1_700_000_000_000
    const ticket = issueUploadTicket(now)

    // Verify 1 hour later -> valid
    expect(verifyUploadTicket(ticket, now + 3_600_000)).not.toBeNull()

    // Verify 2 hours and 1 second later -> expired
    expect(verifyUploadTicket(ticket, now + 7_200_001)).toBeNull()
  })

  it('rejects tampered tokens', () => {
    const now = 1_700_000_000_000
    const ticket = issueUploadTicket(now)
    const [encoded, sig] = ticket.split('.')

    // Tampered payload
    const tamperedPayload = Buffer.from(JSON.stringify({ exp: now + 100_000_000, nonce: 'hacked', v: 'v1' })).toString('base64url')
    expect(verifyUploadTicket(`${tamperedPayload}.${sig}`, now)).toBeNull()

    // Tampered signature
    expect(verifyUploadTicket(`${encoded}.invalidsignature123`, now)).toBeNull()

    // Malformed strings
    expect(verifyUploadTicket('not-a-token', now)).toBeNull()
    expect(verifyUploadTicket('', now)).toBeNull()
    expect(verifyUploadTicket(null, now)).toBeNull()
  })

  it('creates stable ticket hash for database lookup', () => {
    const ticket = issueUploadTicket()
    const hash1 = hashUploadTicket(ticket)
    const hash2 = hashUploadTicket(ticket)

    expect(hash1).toBe(hash2)
    expect(hash1).toHaveLength(64)
  })
})
