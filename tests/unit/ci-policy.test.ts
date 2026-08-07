import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

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
  inquiry_e2e: false,
  operations: false,
  production_image: false,
  website_e2e: false,
  website_visual_e2e: false,
}
const runtime = { ...docs, code: true, docs_only: false, production_image: true }
const fullFallback = {
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

const skippedHeavy = {
  build: 'skipped',
  cleanup: 'skipped',
  database: 'skipped',
  e2e: 'skipped',
  fast: 'success',
  operations: 'skipped',
  validation: 'success',
}

const evaluate = ({
  classification = runtime,
  eventName = 'pull_request',
  isDraft = false,
  results = { ...skippedHeavy, build: 'success' },
  resolvedHeadSha = sha,
  checkedOutSha = sha,
  controlSource = 'trusted-base',
  forceFull = false,
}: {
  classification?: typeof docs
  controlSource?: string
  eventName?: string
  forceFull?: boolean
  isDraft?: boolean
  results?: Record<string, string>
  resolvedHeadSha?: string
  checkedOutSha?: string
} = {}) =>
  evaluateCiPolicy({
    checkedOutSha,
    classification,
    controlSource,
    eventName,
    expectedHeadSha: sha,
    forceFull,
    isDraft,
    resolvedHeadSha,
    results,
  })

describe('CI policy evaluator', () => {
  it('accepts documentation-only changes with every execution stage skipped', () => {
    expect(
      evaluate({
        classification: docs,
        results: { ...skippedHeavy, fast: 'skipped' },
      }),
    ).toMatchObject({ mode: 'docs-only', ok: true })
  })

  it('accepts Draft code only when Fast succeeds and every heavy stage is skipped', () => {
    expect(evaluate({ isDraft: true, results: skippedHeavy })).toMatchObject({
      mode: 'fast-only',
      ok: true,
    })
  })

  it('requires database, build, E2E, and cleanup for a Ready browser change', () => {
    const classification = { ...runtime, inquiry_e2e: true }
    const results = {
      ...skippedHeavy,
      build: 'success',
      cleanup: 'success',
      database: 'success',
      e2e: 'success',
    }

    expect(evaluate({ classification, results })).toMatchObject({ mode: 'full-policy', ok: true })
  })

  it('rejects stale or mismatched revisions', () => {
    expect(evaluate({ resolvedHeadSha: 'a'.repeat(40) }).errors).toContain(
      'resolved head SHA does not match expected head SHA',
    )
    expect(evaluate({ checkedOutSha: 'b'.repeat(40) }).errors).toContain(
      'checked out SHA does not match expected head SHA',
    )
  })

  it.each(['failure', 'cancelled', 'skipped', 'abandoned', ''])(
    'rejects a required stage result of %j',
    (build) => {
      expect(evaluate({ results: { ...skippedHeavy, build } })).toMatchObject({ ok: false })
    },
  )

  it('rejects push events represented as Draft', () => {
    expect(evaluate({ eventName: 'push', isDraft: true })).toMatchObject({ ok: false })
  })

  it('returns a policy failure instead of throwing for malformed input', () => {
    expect(() =>
      evaluateCiPolicy({
        checkedOutSha: sha,
        classification: null,
        eventName: 'pull_request',
        expectedHeadSha: sha,
        isDraft: false,
        resolvedHeadSha: sha,
        results: null,
      }),
    ).not.toThrow()

    expect(
      evaluateCiPolicy({
        checkedOutSha: sha,
        classification: null,
        eventName: 'pull_request',
        expectedHeadSha: sha,
        isDraft: false,
        resolvedHeadSha: sha,
        results: null,
      }),
    ).toMatchObject({ mode: 'invalid', ok: false })
  })

  it('requires full fallback to enable every E2E and heavy flag', () => {
    expect(evaluate({ classification: { ...runtime, full_fallback: true } }).errors).toContain(
      'full_fallback must enable every code and heavy flag',
    )
  })

  it('forces full policy for a Draft candidate control-plane change', () => {
    expect(
      evaluate({
        classification: fullFallback,
        controlSource: 'candidate-control-change',
        forceFull: true,
        isDraft: true,
        results: {
          build: 'success',
          cleanup: 'success',
          database: 'success',
          e2e: 'success',
          fast: 'success',
          operations: 'success',
          validation: 'success',
        },
      }),
    ).toMatchObject({ mode: 'full-policy', ok: true })
  })

  it('rejects a candidate control-plane change that is not forced full', () => {
    expect(
      evaluate({
        classification: fullFallback,
        controlSource: 'candidate-control-change',
        forceFull: false,
        isDraft: true,
        results: skippedHeavy,
      }).errors,
    ).toContain('candidate control changes must force full validation')
  })

  it('prints the Draft state and explicit non-merge-ready warning', () => {
    const classificationEnv = Object.fromEntries(
      Object.entries(runtime).map(([key, value]) => [key.toUpperCase(), String(value)]),
    )
    const result = spawnSync(process.execPath, [resolve('scripts/ci/evaluate-policy.mjs')], {
      encoding: 'utf8',
      env: {
        ...process.env,
        ...classificationEnv,
        BUILD_RESULT: 'skipped',
        CHECKED_OUT_SHA: sha,
        CLEANUP_RESULT: 'skipped',
        CONTROL_SOURCE: 'trusted-base',
        DATABASE_RESULT: 'skipped',
        E2E_RESULT: 'skipped',
        EVENT_NAME: 'pull_request',
        EXPECTED_HEAD_SHA: sha,
        FAST_RESULT: 'success',
        FORCE_FULL: 'false',
        GITHUB_STEP_SUMMARY: '',
        IS_DRAFT: 'true',
        OPERATIONS_RESULT: 'skipped',
        RESOLVED_HEAD_SHA: sha,
        VALIDATION_RESULT: 'success',
      },
    })

    expect(result.status).toBe(0)
    expect(result.stdout).toContain('- PR state: Draft')
    expect(result.stdout).toContain('- Mode: Fast CI only; Draft PR is not merge-ready.')
  })

  it('writes the policy summary to the GitHub step summary file when configured', () => {
    const tempDirectory = mkdtempSync(join(tmpdir(), 'ivybm-ci-policy-'))
    const summaryPath = join(tempDirectory, 'summary.md')
    const classificationEnv = Object.fromEntries(
      Object.entries(runtime).map(([key, value]) => [key.toUpperCase(), String(value)]),
    )

    try {
      const result = spawnSync(process.execPath, [resolve('scripts/ci/evaluate-policy.mjs')], {
        encoding: 'utf8',
        env: {
          ...process.env,
          ...classificationEnv,
          BUILD_RESULT: 'skipped',
          CHECKED_OUT_SHA: sha,
          CLEANUP_RESULT: 'skipped',
          CONTROL_SOURCE: 'trusted-base',
          DATABASE_RESULT: 'skipped',
          E2E_RESULT: 'skipped',
          EVENT_NAME: 'pull_request',
          EXPECTED_HEAD_SHA: sha,
          FAST_RESULT: 'success',
          FORCE_FULL: 'false',
          GITHUB_STEP_SUMMARY: summaryPath,
          IS_DRAFT: 'true',
          OPERATIONS_RESULT: 'skipped',
          RESOLVED_HEAD_SHA: sha,
          VALIDATION_RESULT: 'success',
        },
      })

      expect(result.status).toBe(0)
      expect(result.stdout).toBe('')
      expect(readFileSync(summaryPath, 'utf8')).toContain('- PR state: Draft')
    } finally {
      rmSync(tempDirectory, { force: true, recursive: true })
    }
  })
})
