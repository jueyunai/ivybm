import { describe, expect, it } from 'vitest'

import { generateCanaryData, generateRunId } from '../../../scripts/smoke/marker'

describe('live-workflow marker and canary generator', () => {
  it('generates a valid runId matching the canary pattern', () => {
    const fixedDate = new Date(Date.UTC(2026, 7, 25, 14, 30, 45))
    const runId = generateRunId(fixedDate, '1a2b3c')
    expect(runId).toBe('canary-20260825-143045-1a2b3c')

    const dynamicRunId = generateRunId()
    expect(dynamicRunId).toMatch(/^canary-\d{8}-\d{6}-[0-9a-f]{6}$/u)
  })

  it('generates English canary data with reserved domain and marker tags', () => {
    const runId = 'canary-20260825-143045-1a2b3c'
    const data = generateCanaryData(runId, 'en')

    expect(data.email).toBe(`canary-${runId}@example.invalid`)
    expect(data.name).toBe(`Canary Buyer ${runId}`)
    expect(data.company).toBe(`Canary Facade ${runId}`)
    expect(data.country).toBe('United Arab Emirates')
    expect(data.message).toContain(`[CANARY ${runId}]`)
    expect(data.operatorReply).toContain(`[CANARY ${runId}]`)
    expect(data.chatMessages).toHaveLength(3)
    expect(data.chatMessages[0]).toContain(`[CANARY ${runId}]`)
    expect(data.chatMessages[1]).toContain(data.company)
    expect(data.chatMessages[2]).toContain(data.email)
  })

  it('generates Arabic canary data with localized strings and marker tags', () => {
    const runId = 'canary-20260825-143045-1a2b3c'
    const data = generateCanaryData(runId, 'ar')

    expect(data.email).toBe(`canary-${runId}-ar@example.invalid`)
    expect(data.name).toBe(`عميل اختبار ${runId}`)
    expect(data.company).toBe(`شركة اختبار الواجهات ${runId}`)
    expect(data.country).toBe('United Arab Emirates')
    expect(data.message).toContain(`[CANARY ${runId}]`)
    expect(data.operatorReply).toContain(`[CANARY ${runId}]`)
    expect(data.chatMessages).toHaveLength(3)
    expect(data.chatMessages[0]).toContain(`[CANARY ${runId}]`)
    expect(data.chatMessages[1]).toContain(data.company)
    expect(data.chatMessages[2]).toContain(data.email)
  })
})
