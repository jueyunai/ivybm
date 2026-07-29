import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const workflow = readFileSync(resolve(projectRoot, '.github/workflows/ci.yml'), 'utf8')

describe('CI workflow policy', () => {
  it('uses native Draft and Ready pull request events', () => {
    expect(workflow).toContain(
      'types: [opened, synchronize, reopened, ready_for_review, converted_to_draft]',
    )
    expect(workflow).not.toContain('pull_request_target')
    expect(workflow).toContain("cancel-in-progress: ${{ github.event_name == 'pull_request' }}")
  })

  it('classifies paths before selecting Fast or path-specific gates', () => {
    expect(workflow).toContain('name: Classify and validate changes')
    expect(workflow).toContain('node scripts/ci/classify-changes.mjs')
    expect(workflow).toContain('name: Fast CI')
    expect(workflow).toContain('name: Path-specific full gate')
    expect(workflow).toContain('github.event.pull_request.draft == false')
  })

  it('always evaluates a stable fail-closed policy for the current head', () => {
    expect(workflow).toContain('name: CI policy')
    expect(workflow).toContain('if: ${{ always() }}')
    expect(workflow).toContain('node scripts/ci/evaluate-policy.mjs')
    expect(workflow).toContain('HEAD_SHA: ${{ needs.changes.outputs.head_sha }}')
  })

  it('keeps default workflow permissions read-only', () => {
    expect(workflow).toMatch(/permissions:\n  contents: read\n/)
    expect(workflow).not.toMatch(/^  packages: write$/m)
  })
})
