import { describe, expect, it } from 'vitest'

import { createIntervalGate } from '@/modules/jobs/maintenance'

describe('job maintenance cadence', () => {
  it('runs immediately and gates repeated scans until the interval elapses', () => {
    let now = 1_000
    const shouldRun = createIntervalGate(30_000, () => now)

    expect(shouldRun()).toBe(true)
    expect(shouldRun()).toBe(false)

    now += 29_999
    expect(shouldRun()).toBe(false)

    now += 1
    expect(shouldRun()).toBe(true)
  })

  it('rejects invalid intervals instead of disabling the gate silently', () => {
    expect(() => createIntervalGate(0)).toThrow('positive integer')
    expect(() => createIntervalGate(1.5)).toThrow('positive integer')
  })
})
