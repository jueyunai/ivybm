import { describe, expect, it } from 'vitest'

import { isWebsiteSilentRecoveryHandoff } from '@/modules/conversations/recoveryPolicy'

describe('website recovery handoff policy', () => {
  it.each([
    'ai_service_unavailable',
    'high_risk_topic',
    'reviewed_knowledge_unavailable',
  ])('silences website %s recovery side effects', (reason) => {
    expect(isWebsiteSilentRecoveryHandoff('website', reason)).toBe(true)
  })

  it.each([
    ['website', 'high_intent'],
    ['website', 'qualification_complete'],
    ['facebook', 'high_risk_topic'],
    ['instagram', 'ai_service_unavailable'],
  ])('preserves the %s / %s non-recovery boundary', (channel, reason) => {
    expect(isWebsiteSilentRecoveryHandoff(channel, reason)).toBe(false)
  })
})
