import { describe, expect, it } from 'vitest'

import { evaluateTrustedPrPolicy } from '../../scripts/ci/evaluate-trusted-pr-policy.mjs'

const baseSha = '0123456789abcdef0123456789abcdef01234567'
const headSha = '89abcdef0123456789abcdef0123456789abcdef'

const evaluate = ({
  checkedHeadSha = headSha,
  control = 'success',
  eventName = 'pull_request_target',
  validation = 'success',
}: {
  checkedHeadSha?: string
  control?: string
  eventName?: string
  validation?: string
} = {}) =>
  evaluateTrustedPrPolicy({
    baseSha,
    checkedHeadSha,
    eventName,
    expectedHeadSha: headSha,
    results: { control, validation },
  })

describe('trusted PR policy evaluator', () => {
  it('accepts only a successful same-run validation bound to the expected head', () => {
    expect(evaluate()).toMatchObject({ mode: 'trusted-full', ok: true })
  })

  it.each(['failure', 'cancelled', 'skipped', ''])('rejects validation result %s', (validation) => {
    expect(evaluate({ validation })).toMatchObject({ ok: false })
  })

  it('rejects a stale checked-out head', () => {
    expect(evaluate({ checkedHeadSha: baseSha }).errors).toContain(
      'checked candidate SHA does not match the expected PR head',
    )
  })

  it('rejects candidate-owned pull_request policy execution', () => {
    expect(evaluate({ eventName: 'pull_request' }).errors).toContain(
      'trusted PR policy requires pull_request_target',
    )
  })

  it('rejects invalid SHA inputs and a failed control job', () => {
    const result = evaluateTrustedPrPolicy({
      baseSha: '',
      checkedHeadSha: '',
      eventName: 'pull_request_target',
      expectedHeadSha: '',
      results: { control: 'failure', validation: 'success' },
    })

    expect(result.ok).toBe(false)
    expect(result.errors).toEqual(
      expect.arrayContaining([
        'base SHA is missing or invalid',
        'expected head SHA is missing or invalid',
        'checked candidate SHA is missing or invalid',
        'control: expected success, got failure',
      ]),
    )
  })
})
