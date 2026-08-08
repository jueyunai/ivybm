import { describe, expect, it } from 'vitest'

import {
  evaluateTrustedPolicy,
  validateWorkflowPermissions,
} from '../../scripts/ci/verify-trusted-policy.mjs'

const sha = '0123456789abcdef0123456789abcdef01234567'
const docs = {
  admin_e2e: false,
  chat_e2e: false,
  code: false,
  database: false,
  docs_only: true,
  full_fallback: false,
  inquiry_e2e: false,
  operations: false,
  production_image: false,
  website_e2e: false,
  website_visual_e2e: false,
}
const website = {
  ...docs,
  code: true,
  docs_only: false,
  website_e2e: true,
  website_visual_e2e: true,
}
const full = {
  admin_e2e: true,
  chat_e2e: true,
  code: true,
  database: true,
  docs_only: false,
  full_fallback: true,
  inquiry_e2e: true,
  operations: true,
  production_image: true,
  website_e2e: true,
  website_visual_e2e: true,
}

const controlSteps = [
  'Verify immutable event revision',
  'Resolve comparison and changed paths',
  'Prepare CI control plane',
  'Classify changed paths',
  'Normalize classification contract',
  'Validate repository diff and sensitive path boundary',
  'Plan validation stages',
  'Record validation stage outcomes',
]

const makeJobs = ({
  build = 'skipped',
  cleanup = 'skipped',
  database = 'skipped',
  e2e = 'skipped',
  fast = 'skipped',
  operations = 'skipped',
  omit = [],
}: Partial<Record<'build' | 'cleanup' | 'database' | 'e2e' | 'fast' | 'operations', string>> & {
  omit?: string[]
} = {}) => {
  const stageSteps = new Map([
    ['Set up pnpm', fast === 'success' ? 'success' : 'skipped'],
    ['Set up Node.js', fast === 'success' ? 'success' : 'skipped'],
    ['Install dependencies once', fast === 'success' ? 'success' : 'skipped'],
    ['Fast CI', fast],
    ['Start database when required', database === 'success' ? 'success' : 'skipped'],
    ['Database gate', database],
    ['Production build', build],
    ['Browser E2E', e2e],
    ['Operations gate', operations],
    ['Clean up database', cleanup],
  ])
  const steps = [
    ...controlSteps.map((name) => ({ name, conclusion: 'success' })),
    ...Array.from(stageSteps.entries())
      .filter(([name]) => !omit.includes(name))
      .map(([name, conclusion]) => ({ name, conclusion })),
  ]

  return [
    {
      conclusion: 'success',
      name: 'CI validation',
      status: 'completed',
      steps,
    },
  ]
}

const run = {
  conclusion: 'success',
  event: 'pull_request',
  head_sha: sha,
  id: 123,
  status: 'completed',
}

type EvaluateOptions = {
  checkedHeadSha?: string
  classification?: typeof docs
  forceFull?: boolean
  jobs?: ReturnType<typeof makeJobs>
}

const evaluate = (options: EvaluateOptions = {}) =>
  evaluateTrustedPolicy({
    baseSha: sha,
    checkedHeadSha: sha,
    classification: docs,
    forceFull: false,
    headSha: sha,
    isDraft: false,
    jobs: makeJobs(),
    run,
    ...options,
  })

describe('trusted CI policy verifier', () => {
  it('allows packages write only for the main publish job', () => {
    expect(
      validateWorkflowPermissions([
        {
          path: '.github/workflows/ci.yml',
          content: `
  publish_production_images:
    if: >-
      github.event_name == 'push' &&
      github.ref == 'refs/heads/main'
    permissions:
      packages: write
  other:
    run: true
`,
        },
      ]),
    ).toEqual([])
  })

  it('rejects a candidate-added write job', () => {
    expect(
      validateWorkflowPermissions([
        {
          path: '.github/workflows/ci.yml',
          content: `
  validation:
    permissions:
      packages: write
`,
        },
      ]),
    ).toContain(
      '.github/workflows/ci.yml: packages: write is not restricted to the main publish job',
    )
  })

  it('accepts docs-only when the trusted control steps succeed and heavy stages are skipped', () => {
    expect(evaluate()).toMatchObject({ ok: true, plan: { mode: 'docs-only' } })
  })

  it('requires the actual Website stages from the candidate validation job', () => {
    expect(
      evaluate({
        classification: website,
        jobs: makeJobs({
          build: 'success',
          cleanup: 'success',
          database: 'success',
          e2e: 'success',
          fast: 'success',
        }),
      }),
    ).toMatchObject({ ok: true, plan: { mode: 'full-policy' } })
  })

  it('rejects a green candidate ledger when Browser E2E was omitted', () => {
    expect(
      evaluate({
        classification: website,
        jobs: makeJobs({
          build: 'success',
          cleanup: 'success',
          database: 'success',
          e2e: 'success',
          fast: 'success',
          omit: ['Browser E2E'],
        }),
      }),
    ).toMatchObject({
      errors: expect.arrayContaining(['Browser E2E: expected success, got missing']),
      ok: false,
    })
  })

  it('forces every stage for a control-plane change', () => {
    expect(
      evaluate({
        classification: full,
        forceFull: true,
        jobs: makeJobs({
          build: 'success',
          cleanup: 'success',
          database: 'success',
          e2e: 'success',
          fast: 'success',
          operations: 'success',
        }),
      }),
    ).toMatchObject({ ok: true, plan: { mode: 'full-policy' } })
  })

  it('rejects stale candidate runs', () => {
    expect(evaluate({ checkedHeadSha: 'a'.repeat(40) })).toMatchObject({
      errors: expect.arrayContaining(['candidate run head SHA does not match the PR head']),
      ok: false,
    })
  })
})
