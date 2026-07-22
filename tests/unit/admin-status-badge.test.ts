import { describe, expect, it } from 'vitest'

import { getStatusBadgeModel } from '@/admin/components/StatusBadge'

describe('Admin status badge', () => {
  it('pairs every semantic status with visible text and an icon instead of color alone', () => {
    const models = [
      getStatusBadgeModel('info', 'Information'),
      getStatusBadgeModel('warning', 'Attention'),
      getStatusBadgeModel('danger', 'Failure'),
      getStatusBadgeModel('success', 'Complete'),
    ]

    expect(models).toEqual([
      { icon: 'info', label: 'Information', tone: 'info' },
      { icon: 'alert', label: 'Attention', tone: 'warning' },
      { icon: 'alert', label: 'Failure', tone: 'danger' },
      { icon: 'check', label: 'Complete', tone: 'success' },
    ])
  })
})
