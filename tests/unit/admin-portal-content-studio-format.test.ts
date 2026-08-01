import { describe, expect, it } from 'vitest'

import { formatScheduledAt } from '@/admin-portal/modules/content-studio/formatScheduledAt'

describe('formatScheduledAt', () => {
  it('renders an ISO timestamp deterministically in UTC', () => {
    expect(formatScheduledAt('2026-08-01T10:30:00.000Z')).toBe('2026-08-01 10:30 UTC')
  })

  it('keeps an invalid value visible for diagnosis', () => {
    expect(formatScheduledAt('not-a-date')).toBe('not-a-date')
  })
})
