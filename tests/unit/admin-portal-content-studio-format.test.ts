import { describe, expect, it } from 'vitest'

import { formatScheduledAt } from '@/admin-portal/modules/content-studio/formatScheduledAt'

describe('formatScheduledAt', () => {
  it('renders an ISO timestamp deterministically in Shanghai time', () => {
    expect(formatScheduledAt('2026-08-01T10:30:00.000Z')).toBe('2026-08-01 18:30')
  })

  it('crosses the date boundary when Shanghai time rolls into the next day', () => {
    expect(formatScheduledAt('2026-08-01T17:45:00.000Z')).toBe('2026-08-02 01:45')
  })

  it('keeps an invalid value visible for diagnosis', () => {
    expect(formatScheduledAt('not-a-date')).toBe('not-a-date')
  })
})
