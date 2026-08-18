import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const workflow = readFileSync(resolve(projectRoot, '.github/workflows/ci.yml'), 'utf8')
const prJobs = workflow.slice(0, workflow.indexOf('  publish_production_images:'))

describe('CI workflow policy', () => {
  it('uses native Draft and Ready pull request events', () => {
    expect(workflow).toContain('types: [opened, synchronize, reopened, ready_for_review]')
    expect(workflow).not.toContain('converted_to_draft')
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

  it('budgets enough time for the complete path-specific gate', () => {
    const fullGate = workflow.slice(
      workflow.indexOf('  full_gate:'),
      workflow.indexOf('  ci_policy:'),
    )
    const fullGateEnvironment = fullGate.slice(
      fullGate.indexOf('\n    env:\n'),
      fullGate.indexOf('\n    steps:\n'),
    )

    expect(fullGate).toContain('timeout-minutes: 30')
    expect(fullGate).toContain('ADMIN_PORTAL_ENABLED: true')
    expect(fullGate).toContain('ADMIN_PORTAL_SETTINGS_ENABLED: true')
    expect(fullGate).toContain('ADMIN_PORTAL_OVERVIEW_ENABLED: true')
    expect(fullGate).toContain('ADMIN_PORTAL_WEBSITE_CONTENT_ENABLED: true')
    expect(fullGate).toContain('ADMIN_PORTAL_MEDIA_ENABLED: true')
    expect(fullGate).toContain('ADMIN_PORTAL_KNOWLEDGE_ENABLED: true')
    expect(fullGate).toContain('ADMIN_PORTAL_CONVERSATIONS_ENABLED: true')
    expect(fullGate).toContain('ADMIN_PORTAL_LEADS_ENABLED: true')
    expect(fullGate).toContain('ADMIN_PORTAL_CONTENT_STUDIO_ENABLED: true')
    expect(fullGate).toContain('ADMIN_PORTAL_PUBLISHING_ENABLED: false')
    expect(fullGate).toContain('ADMIN_PORTAL_PLATFORMS_ENABLED: true')
    expect(fullGate).toContain('ADMIN_PORTAL_OPERATIONS_ENABLED: true')
    expect(fullGateEnvironment).not.toContain('PLATFORM_CREDENTIAL_ENCRYPTION_KEY')
  })

  it('always evaluates a stable fail-closed policy for the current head', () => {
    expect(workflow).toContain('name: CI policy')
    expect(workflow).toContain('if: ${{ always() }}')
    expect(workflow).toContain('node scripts/ci/evaluate-policy.mjs')
    expect(workflow).toContain('HEAD_SHA: ${{ needs.changes.outputs.head_sha }}')
  })

  it('keeps default workflow permissions read-only', () => {
    expect(workflow).toMatch(/permissions:\n  contents: read\n/)
    expect(prJobs).not.toContain('packages: write')
  })

  it('blocks root runtime data without rejecting source modules named media', () => {
    const sensitivePathStep = workflow.slice(
      workflow.indexOf('      - name: Validate repository diff and sensitive path boundary'),
      workflow.indexOf('  fast:'),
    )

    expect(sensitivePathStep).toContain(
      '.env|.env.*|data/*|media/*|uploads/*|backups/*|*.sqlite|*.sqlite3|*.dump)',
    )
    expect(sensitivePathStep).not.toContain('*/data/*')
    expect(sensitivePathStep).not.toContain('*/media/*')
    expect(sensitivePathStep).not.toContain('*/uploads/*')
    expect(sensitivePathStep).not.toContain('*/backups/*')
  })

  it('exports three E2E classifications and preserves full fallback', () => {
    expect(workflow).toContain('website_e2e: ${{ steps.classify.outcome')
    expect(workflow).toContain('admin_e2e: ${{ steps.classify.outcome')
    expect(workflow).toContain('chat_e2e: ${{ steps.classify.outcome')
    expect(workflow).not.toContain('ui_e2e')
    expect(workflow).toContain("echo 'website_e2e=true'")
    expect(workflow).toContain("echo 'admin_e2e=true'")
    expect(workflow).toContain("echo 'chat_e2e=true'")
  })

  it('installs Chromium only when at least one E2E suite is selected', () => {
    const installStep = workflow.slice(
      workflow.indexOf('      - name: Install Chromium for browser E2E'),
      workflow.indexOf('      - name: Browser E2E'),
    )

    expect(installStep).toContain("needs.changes.outputs.website_e2e == 'true'")
    expect(installStep).toContain("needs.changes.outputs.admin_e2e == 'true'")
    expect(installStep).toContain("needs.changes.outputs.chat_e2e == 'true'")
    expect(installStep).toContain('pnpm exec playwright install --with-deps chromium')
  })

  it('runs selected Website, Admin, and Chat specs in one Playwright invocation', () => {
    const e2eStep = workflow.slice(
      workflow.indexOf('      - name: Browser E2E'),
      workflow.indexOf('      - name: Build runtime image for PR validation'),
    )

    expect(e2eStep).toContain('WEBSITE_E2E: ${{ needs.changes.outputs.website_e2e }}')
    expect(e2eStep).toContain('ADMIN_E2E: ${{ needs.changes.outputs.admin_e2e }}')
    expect(e2eStep).toContain('CHAT_E2E: ${{ needs.changes.outputs.chat_e2e }}')
    expect(e2eStep).toMatch(/PLATFORM_CREDENTIAL_ENCRYPTION_KEY: [a-f0-9]{64}/)
    expect(e2eStep).toContain('suites+=(website)')
    expect(e2eStep).toContain('suites+=(admin)')
    expect(e2eStep).toContain('suites+=(chat)')
    expect(e2eStep).not.toContain('admin-portal-*.spec.ts')
    expect(e2eStep.match(/pnpm test:e2e/g)).toHaveLength(2)
    expect(e2eStep).toContain('pnpm test:e2e -- "${suites[@]}"')
    expect(e2eStep).toContain('if [[ "$FULL_FALLBACK" == \'true\' ]]')
  })

  it('retains browser E2E evidence when the browser suite fails', () => {
    const evidenceStep = workflow.slice(
      workflow.indexOf('      - name: Upload browser E2E evidence'),
      workflow.indexOf('      - name: Build runtime image for PR validation'),
    )

    expect(evidenceStep).toContain('${{ always() &&')
    expect(evidenceStep).toContain(
      'actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02',
    )
    expect(evidenceStep).toContain('browser-e2e-${{ needs.changes.outputs.head_sha }}')
    expect(evidenceStep).toContain('playwright-report/')
    expect(evidenceStep).toContain('test-results/')
    expect(evidenceStep).toContain('retention-days: 7')
  })

  it('keeps visual baselines isolated by runner platform', () => {
    const playwrightConfig = readFileSync(resolve(projectRoot, 'playwright.config.ts'), 'utf8')
    const packageJSON = readFileSync(resolve(projectRoot, 'package.json'), 'utf8')

    expect(playwrightConfig).toContain(
      "snapshotPathTemplate: '{testDir}/{testFilePath}-snapshots/{platform}/{arg}-{projectName}{ext}'",
    )
    expect(playwrightConfig).toContain('NEXT_PUBLIC_SERVER_URL: context.baseURL')
    expect(playwrightConfig).toContain('reuseExistingServer: false')
    expect(playwrightConfig).toContain('readE2ELaunchContext()')
    expect(packageJSON).toContain('node scripts/e2e/run-suite.mjs')
  })
})
