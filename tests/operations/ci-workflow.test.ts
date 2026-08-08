import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const workflow = readFileSync(resolve(projectRoot, '.github/workflows/ci.yml'), 'utf8')
const codeowners = readFileSync(resolve(projectRoot, '.github/CODEOWNERS'), 'utf8')
const validationJob = workflow.slice(
  workflow.indexOf('  validation:'),
  workflow.indexOf('  ci_policy:'),
)
const mainPolicyJob = workflow.slice(
  workflow.indexOf('  ci_policy:'),
  workflow.indexOf('  ci_policy_target:'),
)
const trustedPolicyJob = workflow.slice(
  workflow.indexOf('  ci_policy_target:'),
  workflow.indexOf('  publish_production_images:'),
)
const prJobs = workflow.slice(0, workflow.indexOf('  publish_production_images:'))

describe('CI workflow policy', () => {
  it('uses native Draft and Ready events with PR-only cancellation', () => {
    expect(workflow).toContain('types: [opened, synchronize, reopened, ready_for_review]')
    expect(workflow).not.toContain('converted_to_draft')
    expect(workflow).toContain('pull_request_target:')
    expect(workflow).toContain(
      "cancel-in-progress: ${{ github.event_name == 'pull_request' || github.event_name == 'pull_request_target' }}",
    )
  })

  it('uses one read-only validation runner for classification, Fast CI, and heavy gates', () => {
    expect(validationJob).toContain('name: CI validation')
    expect(validationJob).toContain("if: ${{ github.event_name != 'pull_request_target' }}")
    expect(validationJob).toContain('timeout-minutes: 45')
    expect(validationJob).toContain('classify-changes.mjs')
    expect(validationJob).toContain('plan-validation.mjs')
    expect(validationJob).toContain('name: Fast CI')
    expect(validationJob).toContain('name: Database gate')
    expect(validationJob).toContain('name: Browser E2E')
    expect(validationJob).toContain('name: Operations gate')
    expect(workflow).not.toContain('  changes:')
    expect(workflow).not.toContain('  fast:')
    expect(workflow).not.toContain('  full_gate:')
    expect(validationJob.match(/pnpm install --frozen-lockfile/g)).toHaveLength(1)
  })

  it('uses trusted base classifier, planner, and policy for pull requests', () => {
    expect(validationJob).toContain('name: Prepare CI control plane')
    expect(validationJob).toContain('PR_BASE_SHA: ${{ github.event.pull_request.base.sha }}')
    expect(validationJob).toContain(".github/workflows/'*")
    expect(validationJob).toContain("scripts/ci/'*")
    expect(validationJob).toContain('.github/CODEOWNERS')
    expect(validationJob).toContain('classifier_ref="$PR_BASE_SHA"')
    expect(validationJob).toContain('policy_ref="$PR_BASE_SHA"')
    expect(validationJob).toContain('control_source=trusted-base')
    expect(validationJob).toContain('force_full=true')
    expect(mainPolicyJob).toContain('ref: ${{ needs.validation.outputs.policy_ref || github.sha }}')
    expect(mainPolicyJob).toContain('name: Enforce trusted v2 policy')
    expect(mainPolicyJob).toContain('name: Enforce trusted legacy bootstrap policy')
    expect(mainPolicyJob).toContain('name: Reject an unknown policy contract')
    expect(mainPolicyJob).toContain("if: ${{ always() && github.event_name == 'push' }}")
    expect(trustedPolicyJob).toContain("if: ${{ github.event_name == 'pull_request_target' }}")
    expect(trustedPolicyJob).toContain('node scripts/ci/verify-trusted-policy.mjs')
    expect(workflow).toContain("github.event_name == 'pull_request_target'")
  })

  it('forces every validation stage for candidate control-plane changes', () => {
    expect(validationJob).toContain(
      "steps.control.outputs.force_full == 'true' || steps.plan.outputs.fast_required == 'true'",
    )
    expect(validationJob).toContain(
      "steps.control.outputs.force_full == 'true' || steps.plan.outputs.database_required == 'true'",
    )
    expect(validationJob).toContain(
      "steps.control.outputs.force_full == 'true' || steps.plan.outputs.build_required == 'true'",
    )
    expect(validationJob).toContain(
      "steps.control.outputs.force_full == 'true' || steps.plan.outputs.e2e_required == 'true'",
    )
    expect(validationJob).toContain(
      "steps.control.outputs.force_full == 'true' || steps.plan.outputs.operations_required == 'true'",
    )
    expect(validationJob).toContain('FORCE_FULL: ${{ steps.control.outputs.force_full }}')
    expect(mainPolicyJob).toContain('FORCE_FULL: ${{ needs.validation.outputs.force_full }}')
  })

  it('makes CODEOWNERS a self-owned CI control-plane boundary', () => {
    expect(codeowners).toContain('/.github/CODEOWNERS @jueyunai @xuemusi')
  })

  it('starts PostgreSQL only when planned and always cleans it up', () => {
    expect(validationJob).not.toContain('services:')
    expect(validationJob).toContain('name: Start database when required')
    expect(validationJob).toContain("steps.plan.outputs.database_required == 'true'")
    expect(validationJob).toContain('pgvector/pgvector:0.8.5-pg18@sha256:')
    expect(validationJob).toContain('name: Clean up database')
    expect(validationJob).toContain(
      "always() && (steps.control.outputs.force_full == 'true' || steps.plan.outputs.database_required == 'true')",
    )
    expect(validationJob).toContain('docker rm --force "$CI_DB_CONTAINER"')
  })

  it('keeps a stable independent fail-closed policy check', () => {
    expect(trustedPolicyJob).toContain('name: CI policy')
    expect(trustedPolicyJob).not.toContain('needs: [validation]')
    expect(trustedPolicyJob).toContain("if: ${{ github.event_name == 'pull_request_target' }}")
    expect(trustedPolicyJob).toContain('ref: ${{ github.event.pull_request.base.sha }}')
    expect(trustedPolicyJob).toContain('actions: read')
    expect(trustedPolicyJob).toContain('pull-requests: read')
    expect(trustedPolicyJob).toContain('node scripts/ci/verify-trusted-policy.mjs')
    expect(trustedPolicyJob).not.toContain('needs.validation.outputs')
  })

  it('does not present candidate-owned pull_request results as the merge policy', () => {
    expect(mainPolicyJob).toContain("if: ${{ always() && github.event_name == 'push' }}")
    expect(workflow).toContain("if: ${{ github.event_name == 'pull_request_target' }}")
    expect(trustedPolicyJob).not.toContain('needs.validation.outputs')
  })

  it('keeps all PR execution read-only and pins every action by commit SHA', () => {
    expect(workflow).toMatch(/permissions:\n  contents: read\n/)
    expect(prJobs).not.toContain('packages: write')

    for (const action of workflow.matchAll(/uses:\s+[^@\s]+@([^\s#]+)/g)) {
      expect(action[1]).toMatch(/^[0-9a-f]{40}$/)
    }
  })

  it('installs Chromium only for selected E2E and invokes the exact suite set once', () => {
    expect(validationJob).toContain("steps.plan.outputs.e2e_required == 'true'")
    expect(validationJob).toContain('pnpm exec playwright install --with-deps chromium')
    expect(validationJob).toContain('specs+=(tests/e2e/website.spec.ts)')
    expect(validationJob).toContain('specs+=(tests/e2e/website-visual.spec.ts)')
    expect(validationJob).toContain('specs+=(tests/e2e/inquiry.spec.ts)')
    expect(validationJob).toContain('specs+=(tests/e2e/admin-visual.spec.ts)')
    expect(validationJob).toContain('specs+=(tests/e2e/admin-portal-*.spec.ts)')
    expect(validationJob).toContain('specs+=(tests/e2e/chat-handoff.spec.ts)')
    expect(validationJob).toContain('pnpm test:e2e -- "${specs[@]}"')
  })

  it('uploads only short-lived visual evidence after website visual E2E failures', () => {
    expect(validationJob).toContain('name: Upload failed website visual evidence')
    expect(validationJob).toContain(
      "always() && steps.e2e.outcome == 'failure' && steps.classification.outputs.website_visual_e2e == 'true'",
    )
    expect(validationJob).toContain(
      'uses: actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a',
    )
    expect(validationJob).toContain('test-results/website-visual-*/**/*-actual.png')
    expect(validationJob).toContain('test-results/website-visual-*/**/*-diff.png')
    expect(validationJob).toContain('retention-days: 3')
    expect(validationJob).toContain('include-hidden-files: false')
    expect(validationJob).not.toContain('playwright-report/')
    expect(validationJob).not.toContain('path: test-results/**')
  })

  it('preserves the production-disabled Portal test environment', () => {
    expect(validationJob).toContain('ADMIN_PORTAL_ENABLED: true')
    expect(validationJob).toContain('ADMIN_PORTAL_SETTINGS_ENABLED: true')
    expect(validationJob).toContain('ADMIN_PORTAL_PUBLISHING_ENABLED: false')
  })

  it('keeps visual baselines isolated by runner platform', () => {
    const playwrightConfig = readFileSync(resolve(projectRoot, 'playwright.config.ts'), 'utf8')
    expect(playwrightConfig).toContain(
      "snapshotPathTemplate: '{testDir}/{testFilePath}-snapshots/{platform}/{arg}-{projectName}{ext}'",
    )
  })
})
