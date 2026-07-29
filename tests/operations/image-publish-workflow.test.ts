import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const workflow = readFileSync(resolve(projectRoot, '.github/workflows/ci.yml'), 'utf8')
const publishJob = workflow.slice(workflow.indexOf('  publish_production_images:'))

describe('production image publishing policy', () => {
  it('removes the duplicate workflow_run publishing path', () => {
    expect(existsSync(resolve(projectRoot, '.github/workflows/build-image.yml'))).toBe(false)
    expect(workflow).not.toContain('workflow_run:')
  })

  it('publishes only the verified production-impacting main revision', () => {
    expect(publishJob).toContain("github.event_name == 'push'")
    expect(publishJob).toContain("github.ref == 'refs/heads/main'")
    expect(publishJob).toContain("needs.ci_policy.result == 'success'")
    expect(publishJob).toContain("needs.changes.outputs.production_image == 'true'")
    expect(publishJob).toContain('ref: ${{ needs.changes.outputs.head_sha }}')
  })

  it('scopes package write access and pins privileged third-party actions', () => {
    expect(publishJob).toContain('packages: write')
    expect(publishJob).toContain('GITHUB_REPOSITORY_OWNER,,')
    expect(publishJob).toContain('NEXT_PUBLIC_SERVER_URL=https://ivybm.com')
    expect(publishJob).toContain('persist-credentials: false')
    expect(publishJob).toContain('actions/checkout@df4cb1c069e1874edd31b4311f1884172cec0e10')
    expect(publishJob).toContain(
      'docker/setup-buildx-action@f7ce87c1d6bead3e36075b2ce75da1f6cc28aaca',
    )
    expect(publishJob).toContain('docker/login-action@c94ce9fb468520275223c153574b00df6fe4bcc9')
    expect(publishJob).toContain(
      'docker/build-push-action@4f58ea79222b3b9dc2c8bbdd6debcef730109a75',
    )
  })

  it('shares a stable Buildx cache without granting deployment access', () => {
    expect(publishJob.match(/cache-from: type=gha,scope=ivybm-production/g)).toHaveLength(2)
    expect(publishJob.match(/cache-to: type=gha,mode=max,scope=ivybm-production/g)).toHaveLength(2)
    expect(publishJob).not.toMatch(/\bssh\b/i)
    expect(publishJob).not.toMatch(/\bscp\b/i)
    expect(publishJob).not.toMatch(/docker compose/i)
  })

  it('records digest-pinned references for manual deployment', () => {
    expect(publishJob).toContain('${{ steps.runtime.outputs.digest }}')
    expect(publishJob).toContain('${{ steps.worker.outputs.digest }}')
    expect(publishJob).toContain('Revision tag')
  })
})
