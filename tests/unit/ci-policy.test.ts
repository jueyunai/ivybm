import { describe, expect, it } from 'vitest'

import { evaluateCiPolicy } from '../../scripts/ci/evaluate-policy.mjs'

const sha = '0123456789abcdef0123456789abcdef01234567'
const docs = {
  admin_e2e: false,
  chat_e2e: false,
  code: false,
  database: false,
  docs_only: true,
  full_fallback: false,
  operations: false,
  production_image: false,
  website_e2e: false,
}
const runtime = {
  ...docs,
  code: true,
  docs_only: false,
  production_image: true,
}
const website = {
  ...runtime,
  website_e2e: true,
}

const evaluate = ({
  classification = runtime,
  eventName = 'pull_request',
  fast = 'success',
  fullGate = 'success',
  isDraft = false,
}: {
  classification?: typeof docs
  eventName?: string
  fast?: string
  fullGate?: string
  isDraft?: boolean
} = {}) =>
  evaluateCiPolicy({
    classification,
    eventName,
    headSha: sha,
    isDraft,
    results: { changes: 'success', fast, fullGate },
  })

describe('CI policy evaluator', () => {
  it('accepts documentation-only pull requests without Fast or heavy jobs', () => {
    expect(evaluate({ classification: docs, fast: 'skipped', fullGate: 'skipped' })).toMatchObject({
      fullGateRequired: false,
      mode: 'full-policy',
      ok: true,
    })
  })

  it('accepts Draft code only when Fast CI succeeds and the heavy job is skipped', () => {
    expect(evaluate({ classification: website, fullGate: 'skipped', isDraft: true })).toMatchObject({
      fullGateRequired: false,
      mode: 'fast-only',
      ok: true,
    })
  })

  it('requires the heavy job for a Ready Website change', () => {
    expect(evaluate({ classification: website })).toMatchObject({
      fullGateRequired: true,
      heavyRequired: true,
      mode: 'full-policy',
      ok: true,
    })
  })

  it('requires the heavy job for runtime changes pushed to main', () => {
    expect(evaluate({ eventName: 'push' })).toMatchObject({
      fullGateRequired: true,
      ok: true,
    })
  })

  it.each(['failure', 'cancelled', 'skipped'])(
    'rejects a Ready Website change when the heavy job is %s',
    (fullGate) => {
      expect(evaluate({ classification: website, fullGate })).toMatchObject({ ok: false })
    },
  )

  it('rejects a Draft PR when Fast CI fails', () => {
    expect(
      evaluate({ classification: website, fast: 'failure', fullGate: 'skipped', isDraft: true }),
    ).toMatchObject({ ok: false })
  })

  it('accepts Ready test-only changes without starting an inapplicable heavy job', () => {
    expect(
      evaluate({
        classification: { ...docs, code: true, docs_only: false },
        fullGate: 'skipped',
      }),
    ).toMatchObject({
      fullGateRequired: false,
      heavyRequired: false,
      ok: true,
    })
  })

  it('rejects missing outputs and inconsistent classifications', () => {
    const result = evaluateCiPolicy({
      classification: { ...docs, code: true },
      eventName: 'pull_request',
      headSha: '',
      isDraft: false,
      results: { changes: 'success', fast: '', fullGate: 'skipped' },
    })

    expect(result.ok).toBe(false)
    expect(result.errors).toEqual(
      expect.arrayContaining([
        'head SHA is missing or invalid',
        'docs_only classification cannot enable code or heavy flags',
        'fast result is missing or invalid',
      ]),
    )
  })

  it('requires full fallback to enable every E2E and heavy flag', () => {
    expect(
      evaluate({
        classification: {
          ...runtime,
          full_fallback: true,
        },
      }).errors,
    ).toContain('full_fallback must enable every code and heavy flag')
  })
})
