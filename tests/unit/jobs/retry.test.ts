import { describe, expect, it } from 'vitest'

import {
  canRetryManually,
  manualRetryState,
  retryDelayMs,
  transitionAfterFailure,
  validateMaxAttempts,
} from '@/modules/jobs/retry'

describe('job retry policy', () => {
  it('uses capped exponential backoff based on the claimed attempt number', () => {
    expect(retryDelayMs(1)).toBe(1_000)
    expect(retryDelayMs(2)).toBe(2_000)
    expect(retryDelayMs(5)).toBe(16_000)
    expect(retryDelayMs(10)).toBe(60_000)
  })

  it('rejects invalid attempt and maximum-attempt values', () => {
    expect(() => retryDelayMs(0)).toThrow('attempts must be a positive integer')
    expect(() => validateMaxAttempts(0)).toThrow('maxAttempts must be an integer between 1 and 5')
    expect(() => validateMaxAttempts(6)).toThrow('maxAttempts must be an integer between 1 and 5')
  })

  it('schedules a retry until the fifth failed claim, then moves the job to dead', () => {
    const now = new Date('2026-07-20T00:00:00.000Z')

    expect(transitionAfterFailure({ attempts: 4, maxAttempts: 5, now })).toEqual({
      deadAt: null,
      nextRunAt: new Date('2026-07-20T00:00:08.000Z'),
      status: 'failed',
    })
    expect(transitionAfterFailure({ attempts: 5, maxAttempts: 5, now })).toEqual({
      deadAt: now,
      nextRunAt: null,
      status: 'dead',
    })
  })

  it('only permits explicit human compensation for retryable terminal states', () => {
    const now = new Date('2026-07-20T00:00:00.000Z')

    expect(canRetryManually('failed')).toBe(true)
    expect(canRetryManually('dead')).toBe(true)
    expect(canRetryManually('processing')).toBe(false)
    expect(manualRetryState({ manualRetryCount: 2, status: 'dead' }, now)).toEqual({
      attempts: 0,
      completedAt: null,
      deadAt: null,
      lastError: null,
      leaseExpiresAt: null,
      manualRetryCount: 3,
      nextRunAt: now,
      ownerToken: null,
      status: 'pending',
    })
    expect(() => manualRetryState({ manualRetryCount: 0, status: 'succeeded' }, now)).toThrow(
      'Cannot manually retry a succeeded job',
    )
  })

  it('keeps a retry after the lease-aware recovery boundary', () => {
    const now = new Date('2026-07-20T00:00:00.000Z')
    const leaseExpiry = new Date('2026-07-20T00:05:00.000Z')

    expect(
      transitionAfterFailure({
        attempts: 1,
        maxAttempts: 2,
        now,
        retryNotBefore: leaseExpiry,
      }),
    ).toMatchObject({ status: 'failed', nextRunAt: leaseExpiry })
  })

  it('allows manual retry to preserve a lease-aware next run time', () => {
    const now = new Date('2026-07-20T00:00:00.000Z')
    const leaseExpiry = new Date('2026-07-20T00:05:00.000Z')

    expect(
      manualRetryState({ manualRetryCount: 2, status: 'dead' }, now, leaseExpiry),
    ).toMatchObject({
      manualRetryCount: 3,
      nextRunAt: leaseExpiry,
      status: 'pending',
    })
  })
})
