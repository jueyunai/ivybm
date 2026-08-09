import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { validateWorkflowSet } from '../../scripts/ci/validate-workflow-permissions.mjs'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const pinnedCheckout = 'actions/checkout@df4cb1c069e1874edd31b4311f1884172cec0e10'
const mainPublishCondition = [
  "github.event_name == 'push'",
  "github.ref == 'refs/heads/main'",
  "needs.changes.result == 'success'",
  "needs.ci_policy.result == 'success'",
  "needs.changes.outputs.production_image == 'true'",
].join(' && ')

const workflow = (body: string) => `
name: Test
on: pull_request
permissions:
  contents: read
jobs:
${body}
`

describe('candidate workflow permission validator', () => {
  it('accepts the repository workflows after structural validation', () => {
    const workflows = ['ci.yml', 'trusted-pr-ci.yml'].map((name) => ({
      content: readFileSync(resolve(projectRoot, '.github/workflows', name), 'utf8'),
      path: `.github/workflows/${name}`,
    }))

    expect(validateWorkflowSet(workflows)).toEqual([])
  })

  it('allows the exact main-only image publisher and GHCR token use', () => {
    const content = `
name: CI
on:
  push:
    branches: [main]
permissions: { contents: read }
jobs:
  publish_production_images:
    if: ${mainPublishCondition}
    permissions: { contents: read, packages: write }
    runs-on: ubuntu-latest
    steps:
      - uses: ${pinnedCheckout}
      - uses: docker/login-action@c94ce9fb468520275223c153574b00df6fe4bcc9
        with:
          password: \${{ secrets.GITHUB_TOKEN }}
`

    expect(validateWorkflowSet([{ content, path: '.github/workflows/ci.yml' }])).toEqual([])
  })

  it.each([
    ['missing permissions', 'name: Test\non: pull_request\njobs: {}'],
    ['flow write', 'name: Test\non: pull_request\npermissions: { contents: write }\njobs: {}'],
    ['quoted write', 'name: Test\non: pull_request\npermissions:\n  "contents": write\njobs: {}'],
    ['write-all', 'name: Test\non: pull_request\npermissions: write-all\njobs: {}'],
    [
      'OIDC write',
      'name: Test\non: pull_request\npermissions: { contents: read, id-token: write }\njobs: {}',
    ],
    [
      'alias permissions',
      'name: Test\non: pull_request\npermissions: &p { contents: read }\njobs:\n  test:\n    permissions: *p\n    runs-on: ubuntu-latest\n    steps: []',
    ],
    [
      'merge permissions',
      'name: Test\non: pull_request\npermissions: { contents: read }\nbase: &p { contents: write }\njobs:\n  test:\n    permissions:\n      <<: *p\n    runs-on: ubuntu-latest\n    steps: []',
    ],
  ])('rejects %s', (_name, content) => {
    expect(validateWorkflowSet([{ content, path: '.github/workflows/test.yml' }])).not.toEqual([])
  })

  it('rejects packages write when a comment only pretends to provide the main gate', () => {
    const content = workflow(`  publish_production_images:
    # github.event_name == 'push' && github.ref == 'refs/heads/main'
    permissions: { contents: read, packages: write }
    runs-on: ubuntu-latest
    steps: []`)

    expect(validateWorkflowSet([{ content, path: '.github/workflows/ci.yml' }])).not.toEqual([])
  })

  it('rejects secrets outside the exact main publisher', () => {
    const content = workflow(`  test:
    runs-on: ubuntu-latest
    steps:
      - run: echo \"\${{ secrets.DEPLOY_TOKEN }}\"`)

    expect(validateWorkflowSet([{ content, path: '.github/workflows/test.yml' }])).not.toEqual([])
  })

  it.each([
    "\${{ secrets['DEPLOY_TOKEN'] }}",
    "\${{ secrets[format('{0}', 'DEPLOY_TOKEN')] }}",
    '${{ toJSON(secrets) }}',
  ])('rejects non-dot secrets context access %s', (expression) => {
    const content = workflow(`  test:
    runs-on: ubuntu-latest
    steps:
      - env:
          LEAK: "${expression.replaceAll('"', '\\"')}"
        run: echo blocked`)

    expect(validateWorkflowSet([{ content, path: '.github/workflows/test.yml' }])).not.toEqual([])
  })

  it('rejects unpinned remote actions', () => {
    const content = workflow(`  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6`)

    expect(validateWorkflowSet([{ content, path: '.github/workflows/test.yml' }])).not.toEqual([])
  })
})
