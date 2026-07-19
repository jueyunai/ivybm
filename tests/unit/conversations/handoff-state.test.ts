import { describe, expect, it } from 'vitest'

import {
  assertAiReplyAllowed,
  transitionHandoff,
} from '@/modules/conversations/handoffState'

describe('handoff state machine', () => {
  it.each([
    ['ai_active', 'request', 'handoff_requested'],
    ['handoff_requested', 'take_over', 'human_active'],
    ['human_active', 'resolve', 'resolved'],
  ] as const)('allows %s --%s--> %s', (current, command, expected) => {
    expect(transitionHandoff(current, command)).toBe(expected)
  })

  it.each([
    ['ai_active', 'take_over'],
    ['ai_active', 'resolve'],
    ['handoff_requested', 'resolve'],
    ['human_active', 'request'],
    ['resolved', 'take_over'],
    ['resolved', 'request'],
  ] as const)('rejects illegal transition %s --%s', (current, command) => {
    expect(() => transitionHandoff(current, command)).toThrow('Illegal handoff transition')
  })

  it('rejects AI replies as soon as a handoff is requested', () => {
    expect(() => assertAiReplyAllowed('handoff_requested')).toThrow('AI replies are disabled')
    expect(() => assertAiReplyAllowed('human_active')).toThrow('AI replies are disabled')
    expect(() => assertAiReplyAllowed('resolved')).toThrow('AI replies are disabled')
    expect(() => assertAiReplyAllowed('ai_active')).not.toThrow()
  })
})
