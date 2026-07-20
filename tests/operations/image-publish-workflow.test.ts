import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const workflow = readFileSync(resolve(projectRoot, '.github/workflows/build-image.yml'), 'utf8')

describe('production image publishing workflow', () => {
  it('publishes only verified main commits with package-scoped permissions', () => {
    expect(workflow).toContain('workflow_run:')
    expect(workflow).toContain('branches: [main]')
    expect(workflow).toContain("github.event.workflow_run.event == 'push'")
    expect(workflow).toContain(
      'github.event.workflow_run.head_repository.full_name == github.repository',
    )
    expect(workflow).toContain('packages: write')
    expect(workflow).toContain('GITHUB_REPOSITORY_OWNER,,')
    expect(workflow).toContain('NEXT_PUBLIC_SERVER_URL=https://ivybm.com')
    expect(workflow).toContain('persist-credentials: false')
    expect(workflow).toContain('actions/checkout@df4cb1c069e1874edd31b4311f1884172cec0e10')
    expect(workflow).toContain(
      'docker/setup-buildx-action@f7ce87c1d6bead3e36075b2ce75da1f6cc28aaca',
    )
    expect(workflow).toContain('docker/login-action@c94ce9fb468520275223c153574b00df6fe4bcc9')
    expect(workflow).toContain('docker/build-push-action@4f58ea79222b3b9dc2c8bbdd6debcef730109a75')
  })

  it('does not grant server access or execute a deployment', () => {
    expect(workflow).not.toMatch(/\bssh\b/i)
    expect(workflow).not.toMatch(/\bscp\b/i)
    expect(workflow).not.toMatch(/docker compose/i)
  })

  it('records digest-pinned image references for manual deployment', () => {
    expect(workflow).toContain('${{ steps.runtime.outputs.digest }}')
    expect(workflow).toContain('${{ steps.worker.outputs.digest }}')
    expect(workflow).toContain('Revision tag')
  })
})
