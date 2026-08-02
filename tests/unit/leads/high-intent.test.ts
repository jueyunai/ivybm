import { describe, expect, it } from 'vitest'

import { isHighIntentLead } from '@/modules/leads/highIntent'

describe('shared high-intent lead predicate', () => {
  it.each([
    ['new', true],
    ['qualified', true],
    ['contacted', false],
    ['disqualified', false],
  ] as const)('treats an A-intent %s lead as high intent: %s', (status, expected) => {
    expect(isHighIntentLead({ intentLevel: 'a', status })).toBe(expected)
  })

  it('rejects lower intent regardless of an active sales status', () => {
    expect(isHighIntentLead({ intentLevel: 'b', status: 'new' })).toBe(false)
    expect(isHighIntentLead({ intentLevel: 'unscored', status: 'qualified' })).toBe(false)
  })
})
