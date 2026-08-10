import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { parse, stringify } from 'yaml'
import { afterEach, describe, expect, it } from 'vitest'

import {
  createTrustedWorkflowContract,
  loadWorkflowDirectory,
  validateWorkflowSet,
} from '../../scripts/ci/validate-workflow-permissions.mjs'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const workflowDirectory = resolve(projectRoot, '.github/workflows')
const repositoryWorkflows = ['ci.yml', 'trusted-pr-ci.yml'].map((name) => ({
  content: readFileSync(resolve(workflowDirectory, name), 'utf8'),
  path: `.github/workflows/${name}`,
}))
const trustedContract = createTrustedWorkflowContract(repositoryWorkflows)
const temporaryDirectories: string[] = []
type ParsedWorkflow = {
  [key: string]: unknown
  jobs: Record<
    string,
    {
      [key: string]: unknown
      steps?: Array<{
        [key: string]: unknown
        name?: string
        run?: string
        with?: Record<string, unknown>
      }>
    }
  >
}

const validate = (workflows = repositoryWorkflows) =>
  validateWorkflowSet(workflows, trustedContract)

const extraWorkflow = (content: string, path = '.github/workflows/test.yml') => [
  ...repositoryWorkflows,
  { content, path },
]

const replaceWorkflow = (path: string, update: (workflow: ParsedWorkflow) => void) =>
  repositoryWorkflows.map((entry) => {
    if (entry.path !== path) return entry
    const workflow = parse(entry.content) as ParsedWorkflow
    update(workflow)
    return { ...entry, content: stringify(workflow) }
  })

const workflow = (body: string) => `
name: Test
on: pull_request
permissions:
  contents: read
jobs:
${body}
`

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true })
  }
})

describe('candidate workflow permission validator', () => {
  it('accepts the canonical repository workflows after structural validation', () => {
    expect(validate()).toEqual([])
  })

  it('accepts semantically identical trusted YAML after formatting and mapping-key reordering', () => {
    const reformatted = repositoryWorkflows.map((entry) => {
      if (entry.path !== '.github/workflows/trusted-pr-ci.yml') return entry
      const parsed = parse(entry.content) as Record<string, unknown>
      const reordered = Object.fromEntries(Object.entries(parsed).reverse())
      return { ...entry, content: stringify(reordered) }
    })

    expect(validate(reformatted)).toEqual([])
  })

  it('accepts semantically identical CI YAML after formatting and mapping-key reordering', () => {
    const reformatted = repositoryWorkflows.map((entry) => {
      if (entry.path !== '.github/workflows/ci.yml') return entry
      const parsed = parse(entry.content) as Record<string, unknown>
      const reordered = Object.fromEntries(Object.entries(parsed).reverse())
      return { ...entry, content: stringify(reordered) }
    })

    expect(validate(reformatted)).toEqual([])
  })

  it('allows read-only non-publisher jobs outside the publisher authority envelope', () => {
    const workflows = replaceWorkflow('.github/workflows/ci.yml', (candidate) => {
      candidate.jobs.extra_diagnostics = {
        permissions: { contents: 'read' },
        'runs-on': 'ubuntu-latest',
        steps: [],
      }
    })

    expect(validate(workflows)).toEqual([])
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
    expect(validate(extraWorkflow(content))).not.toEqual([])
  })

  it('rejects a publisher that sends the packages-write token outside GHCR', () => {
    const workflows = replaceWorkflow('.github/workflows/ci.yml', (candidate) => {
      const login = candidate.jobs.publish_production_images.steps?.find(
        (step: { name?: string }) => step.name === 'Log in to GitHub Container Registry',
      )
      if (!login?.with) throw new Error('publisher login step is missing')
      login.with.registry = 'attacker.example'
    })

    expect(validate(workflows)).toContain(
      '.github/workflows/ci.yml.jobs.publish_production_images: publisher authority envelope is not allowlisted',
    )
  })

  it.each([
    [
      'Docker credential directory',
      (candidate: ParsedWorkflow) => {
        candidate.env = { DOCKER_CONFIG: '${{ github.workspace }}' }
      },
    ],
    [
      'non-interactive Bash startup file',
      (candidate: ParsedWorkflow) => {
        candidate.env = { BASH_ENV: './scripts/ci/attacker.sh' }
      },
    ],
    [
      'default command shell',
      (candidate: ParsedWorkflow) => {
        candidate.defaults = { run: { shell: './scripts/ci/attacker.sh {0}' } }
      },
    ],
    [
      'default command working directory',
      (candidate: ParsedWorkflow) => {
        candidate.defaults = { run: { 'working-directory': './scripts/ci' } }
      },
    ],
    [
      'workflow concurrency',
      (candidate: ParsedWorkflow) => {
        candidate.concurrency = { group: 'attacker-controlled', 'cancel-in-progress': true }
      },
    ],
    [
      'workflow run name',
      (candidate: ParsedWorkflow) => {
        candidate['run-name'] = '${{ github.actor }} controls publisher'
      },
    ],
    [
      'workflow display name',
      (candidate: ParsedWorkflow) => {
        candidate.name = 'Attacker-controlled publisher'
      },
    ],
    [
      'workflow trigger',
      (candidate: ParsedWorkflow) => {
        candidate.on = { workflow_dispatch: null }
      },
    ],
    [
      'workflow default permissions',
      (candidate: ParsedWorkflow) => {
        candidate.permissions = { contents: 'none' }
      },
    ],
    [
      'removed workflow concurrency',
      (candidate: ParsedWorkflow) => {
        delete candidate.concurrency
      },
    ],
  ])('rejects publisher workflow-level authority drift: %s', (_name, mutate) => {
    const workflows = replaceWorkflow('.github/workflows/ci.yml', mutate)

    expect(validate(workflows)).toContain(
      '.github/workflows/ci.yml.jobs.publish_production_images: publisher authority envelope is not allowlisted',
    )
  })

  it.each([
    '${{ github.token }}',
    "${{ github['token'] }}",
    "${{ github[format('{0}', 'token')] }}",
    "${{ join(github.*, ',') }}",
    '${{ toJSON(github) }}',
  ])('rejects GitHub token context access %s', (expression) => {
    const content = workflow(`  test:
    runs-on: ubuntu-latest
    steps:
      - env:
          LEAK: "${expression.replaceAll('"', '\\"')}"
        run: echo blocked`)

    expect(validate(extraWorkflow(content))).toContain(
      '.github/workflows/test.yml:workflow.jobs.test.steps.0.env.LEAK: GitHub token context is forbidden',
    )
  })

  it('allows non-token GitHub context properties', () => {
    const content = workflow(`  test:
    runs-on: ubuntu-latest
    steps:
      - env:
          ACTOR: "\${{ github.actor }}"
          REF: "\${{ github.ref }}"
        run: echo allowed`)

    expect(validate(extraWorkflow(content))).toEqual([])
  })

  it('rejects secrets outside the exact main publisher', () => {
    const content = workflow(`  test:
    runs-on: ubuntu-latest
    steps:
      - run: echo \"\${{ secrets.DEPLOY_TOKEN }}\"`)

    expect(validate(extraWorkflow(content))).not.toEqual([])
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

    expect(validate(extraWorkflow(content))).not.toEqual([])
  })

  it('rejects unpinned remote actions', () => {
    const content = workflow(`  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6`)

    expect(validate(extraWorkflow(content))).not.toEqual([])
  })

  it('rejects checkout steps that retain the automatic workflow token', () => {
    const content = workflow(`  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@df4cb1c069e1874edd31b4311f1884172cec0e10`)

    expect(validate(extraWorkflow(content))).toContain(
      '.github/workflows/test.yml:workflow.jobs.test.steps.0: checkout must disable credential persistence',
    )
  })

  it('rejects reusable workflows that inherit job secrets', () => {
    const content = workflow(`  reusable:
    uses: jueyunai/ivybm/.github/workflows/trusted-pr-ci.yml@0123456789abcdef0123456789abcdef01234567
    secrets: inherit`)

    expect(validate(extraWorkflow(content))).toContain(
      '.github/workflows/test.yml:workflow.jobs.reusable.secrets: secrets mapping is forbidden in candidate workflows',
    )
  })

  it.each([
    'Actions/Checkout@df4cb1c069e1874edd31b4311f1884172cec0e10',
    'actions/checkout@0123456789abcdef0123456789abcdef01234567',
  ])('rejects a non-canonical checkout action reference %s', (action) => {
    const content = workflow(`  test:
    runs-on: ubuntu-latest
    steps:
      - uses: ${action}
        with:
          persist-credentials: false`)

    expect(validate(extraWorkflow(content))).toContain(
      '.github/workflows/test.yml:workflow.jobs.test.steps.0.uses: checkout action must match the trusted pinned action',
    )
  })

  it('requires both canonical workflow paths', () => {
    const safe = {
      content: workflow('  test:\n    runs-on: ubuntu-latest\n    steps: []'),
      path: '.github/workflows/safe.yml',
    }

    expect(validate([safe])).toEqual(
      expect.arrayContaining([
        'canonical workflow .github/workflows/ci.yml is missing',
        'canonical workflow .github/workflows/trusted-pr-ci.yml is missing',
      ]),
    )
  })

  it('rejects deletion of either canonical workflow', () => {
    for (const deletedPath of ['.github/workflows/ci.yml', '.github/workflows/trusted-pr-ci.yml']) {
      expect(validate(repositoryWorkflows.filter((entry) => entry.path !== deletedPath))).toContain(
        `canonical workflow ${deletedPath} is missing`,
      )
    }
  })

  it('rejects duplicate canonical workflow paths', () => {
    expect(validate([...repositoryWorkflows, repositoryWorkflows[0]])).toContain(
      '.github/workflows/ci.yml: duplicate workflow path',
    )
  })

  it('rejects read-only noop replacements for both canonical workflows', () => {
    const noop = workflow('  noop:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo noop')
    const errors = validate([
      { content: noop, path: '.github/workflows/ci.yml' },
      { content: noop, path: '.github/workflows/trusted-pr-ci.yml' },
    ])

    expect(errors).toEqual(
      expect.arrayContaining([
        '.github/workflows/ci.yml.jobs.publish_production_images: publisher job is missing',
        '.github/workflows/trusted-pr-ci.yml: trusted PR workflow contract is invalid',
      ]),
    )
  })

  it.each([
    ['trigger', '  pull_request_target:', '  workflow_dispatch:'],
    [
      'candidate revision',
      'ref: ${{ github.event.pull_request.head.sha }}',
      'ref: ${{ github.sha }}',
    ],
    [
      'trusted dependency install',
      'pnpm --dir control install --frozen-lockfile --ignore-scripts',
      'pnpm --dir control install --frozen-lockfile',
    ],
    ['same-run policy needs', 'needs: [control, validation]', 'needs: validation'],
    ['always policy', 'if: ${{ always() }}', 'if: ${{ success() }}'],
    [
      'trusted policy evaluator',
      'node control/scripts/ci/evaluate-trusted-pr-policy.mjs',
      'echo policy bypassed',
    ],
  ])('rejects a trusted workflow with a weakened %s contract', (_name, source, replacement) => {
    const workflows = repositoryWorkflows.map((entry) =>
      entry.path === '.github/workflows/trusted-pr-ci.yml'
        ? { ...entry, content: entry.content.replace(source, replacement) }
        : entry,
    )

    expect(validate(workflows)).toContain(
      '.github/workflows/trusted-pr-ci.yml: trusted PR workflow contract is invalid',
    )
  })

  it.each([
    [
      'false conditions on trusted jobs and every command step',
      (candidate: ParsedWorkflow) => {
        for (const job of Object.values(candidate.jobs)) {
          job.if = '${{ false }}'
          for (const step of job.steps ?? []) {
            if (step.run) step.if = '${{ false }}'
          }
        }
      },
    ],
    [
      'job and step continue-on-error',
      (candidate: ParsedWorkflow) => {
        candidate.jobs.validation['continue-on-error'] = true
        const evaluator = candidate.jobs.policy.steps?.find((step) =>
          step.run?.includes('evaluate-trusted-pr-policy.mjs'),
        )
        if (!evaluator) throw new Error('trusted evaluator step is missing')
        evaluator['continue-on-error'] = true
      },
    ],
    [
      'self-hosted runners',
      (candidate: ParsedWorkflow) => {
        for (const job of Object.values(candidate.jobs)) job['runs-on'] = 'self-hosted'
      },
    ],
    [
      'echo-only evaluator',
      (candidate: ParsedWorkflow) => {
        const evaluator = candidate.jobs.policy.steps?.find((step) =>
          step.run?.includes('evaluate-trusted-pr-policy.mjs'),
        )
        if (!evaluator?.run) throw new Error('trusted evaluator step is missing')
        evaluator.run = `echo ${evaluator.run}`
      },
    ],
    [
      'additional control step',
      (candidate: ParsedWorkflow) => {
        candidate.jobs.control.steps?.push({ run: 'echo extra control step' })
      },
    ],
    [
      'reordered validation steps',
      (candidate: ParsedWorkflow) => {
        candidate.jobs.validation.steps?.reverse()
      },
    ],
    [
      'alternate command shell',
      (candidate: ParsedWorkflow) => {
        const evaluator = candidate.jobs.policy.steps?.find((step) =>
          step.run?.includes('evaluate-trusted-pr-policy.mjs'),
        )
        if (!evaluator) throw new Error('trusted evaluator step is missing')
        evaluator.shell = 'python'
      },
    ],
  ])('rejects trusted workflow structural bypass: %s', (_name, mutate) => {
    const workflows = replaceWorkflow('.github/workflows/trusted-pr-ci.yml', mutate)

    expect(validate(workflows)).toContain(
      '.github/workflows/trusted-pr-ci.yml: trusted PR workflow must exactly match the base-owned contract',
    )
  })

  it('rejects a symlinked canonical workflow file', () => {
    const directory = mkdtempSync(join(tmpdir(), 'ivybm-workflow-contract-'))
    temporaryDirectories.push(directory)
    writeFileSync(
      join(directory, 'safe.yml'),
      workflow('  test:\n    runs-on: ubuntu-latest\n    steps: []'),
    )
    symlinkSync(join(directory, 'safe.yml'), join(directory, 'ci.yml'))

    expect(() => loadWorkflowDirectory(directory)).toThrow('ci.yml must be a regular file')
  })

  it('rejects a workflow directory reached through a symlinked parent', () => {
    const repository = mkdtempSync(join(tmpdir(), 'ivybm-workflow-parent-contract-'))
    temporaryDirectories.push(repository)
    const actualDirectory = join(repository, 'actual', 'workflows')
    mkdirSync(actualDirectory, { recursive: true })
    symlinkSync(join(repository, 'actual'), join(repository, '.github'))

    expect(() => loadWorkflowDirectory(join(repository, '.github', 'workflows'))).toThrow(
      'workflow directory and its parent must be regular directories',
    )
  })
})
