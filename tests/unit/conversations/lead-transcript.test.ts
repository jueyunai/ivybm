import { describe, expect, it } from 'vitest'

import { truncateLeadTranscript } from '@/modules/conversations/payloadRepository'

describe('chat lead transcript', () => {
  it('keeps the most recent business context inside the Leads.message limit', () => {
    const prefix = 'earlier-context-'
    const recent = 'contact buyer@example.invalid in UAE'
    const transcript = `${prefix.repeat(400)}${recent}`

    const persisted = truncateLeadTranscript(transcript)
    expect(persisted).toHaveLength(5_000)
    expect(persisted.endsWith(recent)).toBe(true)
  })
})
