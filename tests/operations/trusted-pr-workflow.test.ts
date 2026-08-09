import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const workflow = readFileSync(resolve(projectRoot, '.github/workflows/trusted-pr-ci.yml'), 'utf8')
const controlJob = workflow.slice(workflow.indexOf('  control:'), workflow.indexOf('  validation:'))
const validationJob = workflow.slice(
  workflow.indexOf('  validation:'),
  workflow.indexOf('  policy:'),
)
const policyJob = workflow.slice(workflow.indexOf('  policy:'))

describe('base-owned trusted PR workflow', () => {
  it('uses only pull_request_target with read-only permissions and PR-scoped cancellation', () => {
    expect(workflow).toContain('pull_request_target:')
    expect(workflow).not.toContain('workflow_run:')
    expect(workflow).not.toContain('workflow_dispatch:')
    expect(workflow).not.toMatch(/^  pull_request:/m)
    expect(workflow).toMatch(/permissions:\n  contents: read\n/)
    expect(workflow).not.toContain('packages: write')
    expect(workflow).not.toContain('${{ secrets.')
    expect(workflow).toContain('cancel-in-progress: true')
  })

  it('keeps trusted control and exact candidate code in separate checkouts', () => {
    expect(controlJob).toContain('path: control')
    expect(controlJob).toContain('ref: ${{ github.event.pull_request.base.sha }}')
    expect(controlJob).toContain('path: candidate')
    expect(controlJob).toContain('repository: ${{ github.event.pull_request.head.repo.full_name }}')
    expect(controlJob).toContain('ref: ${{ github.event.pull_request.head.sha }}')
    expect(controlJob.match(/persist-credentials: false/g)).toHaveLength(2)
    expect(controlJob).toContain(
      'git -C candidate fetch --no-tags "$GITHUB_WORKSPACE/control" "$BASE_SHA"',
    )
    expect(controlJob).toContain('node control/scripts/ci/validate-workflow-permissions.mjs')
  })

  it('runs the complete candidate gate without secrets, reusable cache, or write tokens', () => {
    expect(validationJob).toContain('needs: control')
    expect(validationJob).toContain('path: candidate')
    expect(validationJob).toContain('ref: ${{ needs.control.outputs.head_sha }}')
    expect(validationJob).toContain("GITHUB_TOKEN: ''")
    expect(validationJob).toContain("GH_TOKEN: ''")
    expect(validationJob).not.toContain('cache: pnpm')
    expect(validationJob).toContain('pnpm install --frozen-lockfile --ignore-scripts')
    expect(validationJob).toContain('pnpm lint')
    expect(validationJob).toContain('pnpm typecheck')
    expect(validationJob).toContain('pnpm test:unit')
    expect(validationJob).toContain('pnpm test:contract')
    expect(validationJob).toContain('pnpm test:integration')
    expect(validationJob).toContain('pnpm build')
    expect(validationJob).toContain('pnpm test:e2e')
    expect(validationJob).toContain('pnpm test:operations')
    expect(validationJob).toContain('docker build --target runtime')
    expect(validationJob).toContain('docker build --target worker')
  })

  it('derives the only authoritative policy from same-run trusted needs', () => {
    expect(policyJob).toContain('name: CI policy')
    expect(policyJob).toContain('needs: [control, validation]')
    expect(policyJob).toContain('if: ${{ always() }}')
    expect(policyJob).toContain('ref: ${{ github.event.pull_request.base.sha }}')
    expect(policyJob).toContain('node control/scripts/ci/evaluate-trusted-pr-policy.mjs')
    expect(policyJob).not.toContain('/actions/runs')
    expect(policyJob).not.toContain('GH_TOKEN')
    expect(workflow).not.toContain('candidate ledger')
  })

  it('pins every remote action by an immutable commit SHA', () => {
    for (const action of workflow.matchAll(/uses:\s+([^@\s]+)@([^\s#]+)/g)) {
      expect(action[1].startsWith('./')).toBe(false)
      expect(action[2]).toMatch(/^[0-9a-f]{40}$/)
    }
  })
})
