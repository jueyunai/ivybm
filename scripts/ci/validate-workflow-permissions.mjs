import { lstatSync, readFileSync, readdirSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { isAlias, isMap, isScalar, isSeq, parseDocument } from 'yaml'

const ciWorkflowPath = '.github/workflows/ci.yml'
const trustedWorkflowPath = '.github/workflows/trusted-pr-ci.yml'
const canonicalWorkflowPaths = [ciWorkflowPath, trustedWorkflowPath]
const publishJobId = 'publish_production_images'
const remoteActionPattern = /^[^./\s][^\s]*@[0-9a-f]{40}$/
const permissionScopes = new Set([
  'actions',
  'attestations',
  'checks',
  'contents',
  'deployments',
  'discussions',
  'id-token',
  'issues',
  'models',
  'packages',
  'pages',
  'pull-requests',
  'security-events',
  'statuses',
])
const allowedPublishConditions = new Set(
  [
    [
      "github.event_name == 'push'",
      "github.ref == 'refs/heads/main'",
      "needs.changes.result == 'success'",
      "needs.ci_policy.result == 'success'",
      "needs.changes.outputs.production_image == 'true'",
    ],
    [
      "github.event_name == 'push'",
      "github.ref == 'refs/heads/main'",
      "needs.validation.result == 'success'",
      "needs.ci_policy.result == 'success'",
      "needs.validation.outputs.production_image == 'true'",
    ],
  ].map((parts) => parts.join(' && ')),
)

const isPlainObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const normalizeExpression = (value) =>
  typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : ''

const unwrapExpression = (value) =>
  normalizeExpression(value)
    .replace(/^\$\{\{\s*/, '')
    .replace(/\s*\}\}$/, '')

const canonicalize = (value) => {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (!isPlainObject(value)) return value
  return Object.fromEntries(
    Object.keys(value)
      .sort((left, right) => left.localeCompare(right))
      .map((key) => [key, canonicalize(value[key])]),
  )
}

const stableSerialize = (value) => JSON.stringify(canonicalize(value))

const inspectYamlNode = (node, location, errors) => {
  if (!node) return
  if (isAlias(node)) {
    errors.push(`${location}: YAML aliases are forbidden`)
    return
  }
  if ('anchor' in node && node.anchor) {
    errors.push(`${location}: YAML anchors are forbidden`)
  }
  if ('tag' in node && node.tag) {
    errors.push(`${location}: explicit YAML tags are forbidden`)
  }

  if (isMap(node)) {
    for (const pair of node.items) {
      if (!isScalar(pair.key) || typeof pair.key.value !== 'string') {
        errors.push(`${location}: workflow mapping keys must be strings`)
      } else if (pair.key.value === '<<') {
        errors.push(`${location}: YAML merge keys are forbidden`)
      }
      inspectYamlNode(pair.key, location, errors)
      inspectYamlNode(pair.value, location, errors)
    }
  } else if (isSeq(node)) {
    for (const item of node.items) inspectYamlNode(item, location, errors)
  }
}

const parseWorkflow = ({ content, path }, errors) => {
  if (typeof content !== 'string' || typeof path !== 'string') {
    errors.push('candidate workflow content is missing or invalid')
    return null
  }
  if (Buffer.byteLength(content, 'utf8') > 1_000_000) {
    errors.push(`${path}: workflow exceeds the 1 MB validation limit`)
    return null
  }

  const document = parseDocument(content, {
    merge: false,
    prettyErrors: false,
    strict: true,
    uniqueKeys: true,
  })
  for (const error of document.errors) errors.push(`${path}: ${error.message}`)
  for (const warning of document.warnings) errors.push(`${path}: ${warning.message}`)
  inspectYamlNode(document.contents, path, errors)
  if (document.errors.length > 0) return null

  try {
    const value = document.toJS({ maxAliasCount: 0 })
    if (!isPlainObject(value)) {
      errors.push(`${path}: workflow root must be a mapping`)
      return null
    }
    return value
  } catch (error) {
    errors.push(`${path}: ${error instanceof Error ? error.message : 'workflow conversion failed'}`)
    return null
  }
}

const indexWorkflowEntries = (workflows, errors) => {
  const entries = new Map()
  for (const entry of workflows) {
    if (!isPlainObject(entry) || typeof entry.path !== 'string') {
      errors.push('candidate workflow entry is missing or invalid')
      continue
    }
    if (!/^\.github\/workflows\/[^/]+\.ya?ml$/i.test(entry.path)) {
      errors.push(`${entry.path}: workflow path is invalid`)
      continue
    }
    if (entries.has(entry.path)) {
      errors.push(`${entry.path}: duplicate workflow path`)
      continue
    }
    entries.set(entry.path, entry)
  }
  return entries
}

const validatePermissionMap = ({ allowPublishWrite, errors, location, permissions }) => {
  if (!isPlainObject(permissions)) {
    errors.push(`${location}: permissions must be an explicit mapping`)
    return
  }

  for (const [scope, access] of Object.entries(permissions)) {
    if (!permissionScopes.has(scope)) {
      errors.push(`${location}: unsupported permission scope ${scope}`)
      continue
    }
    if (access !== 'read' && access !== 'none' && access !== 'write') {
      errors.push(`${location}.${scope}: permission must be read, none, or write`)
      continue
    }
    const allowedWrite = allowPublishWrite && scope === 'packages' && access === 'write'
    if (access === 'write' && !allowedWrite) {
      errors.push(`${location}.${scope}: write permission is forbidden`)
    }
    if (scope === 'id-token' && access !== 'none') {
      errors.push(`${location}.id-token: OIDC permission is forbidden`)
    }
  }
}

const visitValues = (value, location, callback, key = null) => {
  callback({ key, location, value })
  if (Array.isArray(value)) {
    value.forEach((item, index) => visitValues(item, `${location}.${index}`, callback, index))
    return
  }
  if (!isPlainObject(value)) return
  for (const [childKey, child] of Object.entries(value)) {
    visitValues(child, `${location}.${childKey}`, callback, childKey)
  }
}

const hasGithubTokenAccess = (value) =>
  /\bgithub\s*\.\s*token\b/i.test(value) ||
  /\bgithub\s*\.\s*\*/i.test(value) ||
  /\bgithub\s*\[/i.test(value) ||
  /\btojson\s*\(\s*github\s*\)/i.test(value)

const validateActionsAndCredentials = ({ errors, path, trustedContract, workflow }) => {
  visitValues(workflow, 'workflow', ({ key, location, value }) => {
    if (key === 'uses') {
      if (typeof value !== 'string' || !remoteActionPattern.test(value)) {
        errors.push(`${path}:${location}: remote action must be pinned to a 40-character SHA`)
      }
    }
    if (typeof value !== 'string') return

    if (hasGithubTokenAccess(value)) {
      errors.push(`${path}:${location}: GitHub token context is forbidden`)
    }

    if (!/\bsecrets\b/i.test(value)) return
    const allowedSecret =
      path === ciWorkflowPath && trustedContract.publisherSecrets.get(location) === value
    if (!allowedSecret) {
      errors.push(`${path}:${location}: secrets context is forbidden in candidate workflows`)
    }
  })

  for (const [jobId, job] of Object.entries(workflow.jobs ?? {})) {
    if (!Array.isArray(job?.steps)) continue
    job.steps.forEach((step, index) => {
      if (!isPlainObject(step) || !String(step.uses).startsWith('actions/checkout@')) return
      if (
        !isPlainObject(step.with) ||
        step.with['persist-credentials'] !== false ||
        Object.hasOwn(step.with, 'token')
      ) {
        errors.push(
          `${path}:workflow.jobs.${jobId}.steps.${index}: checkout must disable credential persistence`,
        )
      }
    })
  }
}

const exactKeys = (value, expected) =>
  isPlainObject(value) && Object.keys(value).sort().join('\0') === [...expected].sort().join('\0')

const needsExactly = (value, expected) => {
  const actual = Array.isArray(value) ? value : typeof value === 'string' ? [value] : []
  return [...actual].sort().join('\0') === [...expected].sort().join('\0')
}

const findStep = (job, predicate) =>
  Array.isArray(job?.steps)
    ? job.steps.find((step) => isPlainObject(step) && predicate(step))
    : null

const collectRunCommands = (job) =>
  Array.isArray(job?.steps)
    ? job.steps
        .filter((step) => isPlainObject(step) && typeof step.run === 'string')
        .map((step) => step.run)
        .join('\n')
    : ''

const containsKey = (value, target) => {
  if (Array.isArray(value)) return value.some((item) => containsKey(item, target))
  if (!isPlainObject(value)) return false
  return Object.entries(value).some(([key, child]) => key === target || containsKey(child, target))
}

const checkoutMatches = ({ checkoutAction, job, path, ref, repository }) =>
  Boolean(
    findStep(
      job,
      (step) =>
        step.uses === checkoutAction &&
        isPlainObject(step.with) &&
        step.with.path === path &&
        step.with.ref === ref &&
        step.with['persist-credentials'] === false &&
        (repository === undefined || step.with.repository === repository),
    ),
  )

const validateTrustedWorkflowContract = (workflow, trustedContract) => {
  const violations = []
  const trigger = workflow.on
  const triggerTypes = trigger?.pull_request_target?.types
  if (
    workflow.name !== 'Trusted PR CI' ||
    !exactKeys(trigger, ['pull_request_target']) ||
    !Array.isArray(triggerTypes) ||
    triggerTypes.join('\0') !== 'opened\0synchronize\0reopened\0ready_for_review'
  ) {
    violations.push('event contract must be the canonical pull_request_target trigger')
  }
  if (!exactKeys(workflow.permissions, ['contents']) || workflow.permissions.contents !== 'read') {
    violations.push('top-level permissions must be exactly contents: read')
  }
  if (!exactKeys(workflow.jobs, ['control', 'validation', 'policy'])) {
    violations.push('jobs must be exactly control, validation, and policy')
    return violations
  }

  const { control, validation, policy } = workflow.jobs
  if (!isPlainObject(control) || !isPlainObject(validation) || !isPlainObject(policy)) {
    violations.push('trusted jobs must be mappings')
    return violations
  }

  if (
    control.outputs?.base_sha !== '${{ steps.revision.outputs.base_sha }}' ||
    control.outputs?.head_sha !== '${{ steps.revision.outputs.head_sha }}'
  ) {
    violations.push('control outputs must bind the verified base and head revisions')
  }
  if (
    !checkoutMatches({
      checkoutAction: trustedContract.checkoutAction,
      job: control,
      path: 'control',
      ref: '${{ github.event.pull_request.base.sha }}',
    }) ||
    !checkoutMatches({
      checkoutAction: trustedContract.checkoutAction,
      job: control,
      path: 'candidate',
      ref: '${{ github.event.pull_request.head.sha }}',
      repository: '${{ github.event.pull_request.head.repo.full_name }}',
    })
  ) {
    violations.push('control must isolate trusted base and exact candidate checkouts')
  }

  const revisionStep = findStep(control, (step) => step.id === 'revision')
  const revisionCommand = typeof revisionStep?.run === 'string' ? revisionStep.run : ''
  const requiredRevisionFragments = [
    'git -C candidate fetch --no-tags "$GITHUB_WORKSPACE/control" "$BASE_SHA"',
    'git -C candidate cat-file -e "${BASE_SHA}^{commit}"',
    'git -C candidate cat-file -e "${HEAD_SHA}^{commit}"',
    'git -C candidate rev-parse HEAD',
    'git -C candidate diff --check "$diff_range"',
    'git -C candidate diff --name-only -z "$diff_range"',
    'git -C candidate diff --name-only --diff-filter=ACMR -z "$diff_range"',
  ]
  if (
    revisionStep?.env?.BASE_SHA !== '${{ github.event.pull_request.base.sha }}' ||
    revisionStep?.env?.HEAD_SHA !== '${{ github.event.pull_request.head.sha }}' ||
    requiredRevisionFragments.some((fragment) => !revisionCommand.includes(fragment))
  ) {
    violations.push(
      'control revision step must verify immutable SHAs and the complete diff boundary',
    )
  }

  const controlCommands = collectRunCommands(control)
  if (
    !controlCommands.includes('pnpm --dir control install --frozen-lockfile --ignore-scripts') ||
    !controlCommands.includes(
      'node control/scripts/ci/validate-workflow-permissions.mjs candidate/.github/workflows',
    )
  ) {
    violations.push('control must install and execute only the trusted workflow validator')
  }

  if (
    !needsExactly(validation.needs, ['control']) ||
    unwrapExpression(validation.if) !== "needs.control.result == 'success'" ||
    validation.defaults?.run?.['working-directory'] !== 'candidate' ||
    validation.env?.GH_TOKEN !== '' ||
    validation.env?.GITHUB_TOKEN !== '' ||
    validation.env?.ACTIONS_RUNTIME_TOKEN !== '' ||
    validation.env?.ACTIONS_ID_TOKEN_REQUEST_TOKEN !== '' ||
    containsKey(validation, 'cache')
  ) {
    violations.push(
      'validation must depend on control and run candidate code without tokens or cache',
    )
  }
  if (
    !checkoutMatches({
      checkoutAction: trustedContract.checkoutAction,
      job: validation,
      path: 'candidate',
      ref: '${{ needs.control.outputs.head_sha }}',
      repository: '${{ github.event.pull_request.head.repo.full_name }}',
    })
  ) {
    violations.push('validation must checkout the exact verified candidate revision')
  }
  const validationCommands = collectRunCommands(validation)
  const requiredValidationCommands = [
    'pnpm install --frozen-lockfile --ignore-scripts',
    'pnpm lint',
    'pnpm typecheck',
    'pnpm test:unit',
    'pnpm test:contract',
    'pnpm db:migrate',
    'pnpm db:reset:test',
    'pnpm db:seed',
    'pnpm test:integration',
    'pnpm db:test:persistence',
    'pnpm build',
    'pnpm test:e2e',
    'docker build --target runtime',
    'docker build --target worker',
    'docker compose -f compose.yaml -f compose.staging.yaml config',
    'pnpm test:operations',
  ]
  if (requiredValidationCommands.some((command) => !validationCommands.includes(command))) {
    violations.push('validation must retain the complete candidate gate')
  }

  if (
    !needsExactly(policy.needs, ['control', 'validation']) ||
    unwrapExpression(policy.if) !== 'always()' ||
    !checkoutMatches({
      checkoutAction: trustedContract.checkoutAction,
      job: policy,
      path: 'control',
      ref: '${{ github.event.pull_request.base.sha }}',
    })
  ) {
    violations.push('policy must always consume control and validation from the same run')
  }
  const policyStep = findStep(
    policy,
    (step) =>
      typeof step.run === 'string' &&
      step.run.includes('node control/scripts/ci/evaluate-trusted-pr-policy.mjs'),
  )
  if (
    !policyStep ||
    policyStep.env?.CHECKED_HEAD_SHA !== '${{ needs.control.outputs.head_sha }}' ||
    policyStep.env?.CONTROL_RESULT !== '${{ needs.control.result }}' ||
    policyStep.env?.VALIDATION_RESULT !== '${{ needs.validation.result }}'
  ) {
    violations.push('policy must execute the trusted evaluator with same-run results')
  }

  const serialized = stableSerialize(workflow)
  if (
    serialized.includes('/actions/runs') ||
    serialized.includes('workflow_run') ||
    serialized.includes('workflow_dispatch') ||
    serialized.includes('verify-trusted-policy')
  ) {
    violations.push('trusted workflow must not poll or delegate policy authority')
  }
  return violations
}

const validateWorkflow = (entry, errors, trustedContract) => {
  const workflow = parseWorkflow(entry, errors)
  if (!workflow) return

  if (!Object.hasOwn(workflow, 'permissions')) {
    errors.push(`${entry.path}: top-level permissions are required`)
  } else {
    validatePermissionMap({
      allowPublishWrite: false,
      errors,
      location: `${entry.path}.permissions`,
      permissions: workflow.permissions,
    })
  }

  if (!isPlainObject(workflow.jobs)) {
    errors.push(`${entry.path}: jobs must be a mapping`)
    return
  }

  for (const [jobId, job] of Object.entries(workflow.jobs)) {
    if (!isPlainObject(job)) {
      errors.push(`${entry.path}.jobs.${jobId}: job must be a mapping`)
      continue
    }
    const isPublisher = entry.path === ciWorkflowPath && jobId === publishJobId
    if (Object.hasOwn(job, 'permissions')) {
      validatePermissionMap({
        allowPublishWrite: isPublisher,
        errors,
        location: `${entry.path}.jobs.${jobId}.permissions`,
        permissions: job.permissions,
      })
    }

    const permissionEntries = isPlainObject(job.permissions) ? Object.entries(job.permissions) : []
    const hasWrite = permissionEntries.some(([, access]) => access === 'write')
    if (isPublisher) {
      const exactPermissions =
        permissionEntries.length === 2 &&
        job.permissions.contents === 'read' &&
        job.permissions.packages === 'write'
      if (!exactPermissions) {
        errors.push(`${entry.path}.jobs.${jobId}: publisher permissions must be exact`)
      }
      if (!allowedPublishConditions.has(normalizeExpression(job.if))) {
        errors.push(`${entry.path}.jobs.${jobId}: publisher condition is not allowlisted`)
      }
    } else if (hasWrite) {
      errors.push(
        `${entry.path}.jobs.${jobId}: write permissions are limited to the main publisher`,
      )
    }
  }

  const publisher = workflow.jobs[publishJobId]
  if (entry.path === ciWorkflowPath && !isPlainObject(publisher)) {
    errors.push(`${entry.path}.jobs.${publishJobId}: publisher job is missing`)
  } else if (
    entry.path === ciWorkflowPath &&
    stableSerialize(publisher) !== trustedContract.publisherJob
  ) {
    errors.push(`${entry.path}.jobs.${publishJobId}: publisher job is not allowlisted`)
  }

  if (entry.path === trustedWorkflowPath) {
    const violations = validateTrustedWorkflowContract(workflow, trustedContract)
    if (violations.length > 0) {
      errors.push(`${entry.path}: trusted PR workflow contract is invalid`)
      for (const violation of violations) errors.push(`${entry.path}: ${violation}`)
    }
  }

  validateActionsAndCredentials({ errors, path: entry.path, trustedContract, workflow })
}

export function createTrustedWorkflowContract(workflows) {
  const errors = []
  if (!Array.isArray(workflows) || workflows.length === 0) {
    throw new Error('trusted workflow set is empty or invalid')
  }
  const entries = indexWorkflowEntries(workflows, errors)
  const ciEntry = entries.get(ciWorkflowPath)
  const trustedEntry = entries.get(trustedWorkflowPath)
  if (!ciEntry || !trustedEntry || errors.length > 0) {
    throw new Error(`trusted workflow set is invalid: ${errors.join('; ')}`)
  }

  const ciWorkflow = parseWorkflow(ciEntry, errors)
  const trustedWorkflow = parseWorkflow(trustedEntry, errors)
  const publisher = ciWorkflow?.jobs?.[publishJobId]
  const control = trustedWorkflow?.jobs?.control
  const checkout = findStep(
    control,
    (step) =>
      typeof step.uses === 'string' &&
      step.uses.startsWith('actions/checkout@') &&
      step.with?.path === 'control',
  )
  if (!isPlainObject(publisher) || typeof checkout?.uses !== 'string' || errors.length > 0) {
    throw new Error(`trusted workflow contract cannot be created: ${errors.join('; ')}`)
  }

  const publisherSecrets = new Map()
  visitValues(publisher, `workflow.jobs.${publishJobId}`, ({ location, value }) => {
    if (typeof value === 'string' && /\bsecrets\b/i.test(value)) {
      publisherSecrets.set(location, value)
    }
  })
  const expectedSecretLocation = `workflow.jobs.${publishJobId}.steps.3.with.password`
  if (
    publisherSecrets.size !== 1 ||
    publisherSecrets.get(expectedSecretLocation) !== '${{ secrets.GITHUB_TOKEN }}'
  ) {
    throw new Error('trusted publisher secret contract is invalid')
  }

  return Object.freeze({
    checkoutAction: checkout.uses,
    publisherJob: stableSerialize(publisher),
    publisherSecrets,
  })
}

export function validateWorkflowSet(workflows, trustedContract) {
  const errors = []
  if (!Array.isArray(workflows) || workflows.length === 0) {
    return ['candidate workflow set is empty or invalid']
  }
  if (workflows.length > 50) return ['candidate workflow set exceeds the 50-file limit']
  if (
    !isPlainObject(trustedContract) ||
    typeof trustedContract.publisherJob !== 'string' ||
    typeof trustedContract.checkoutAction !== 'string' ||
    !(trustedContract.publisherSecrets instanceof Map)
  ) {
    return ['trusted workflow contract is missing or invalid']
  }

  const entries = indexWorkflowEntries(workflows, errors)
  for (const path of canonicalWorkflowPaths) {
    if (!entries.has(path)) errors.push(`canonical workflow ${path} is missing`)
  }
  for (const entry of entries.values()) validateWorkflow(entry, errors, trustedContract)
  return errors
}

export function loadWorkflowDirectory(directory) {
  const directoryMetadata = lstatSync(directory)
  const parentMetadata = lstatSync(dirname(directory))
  if (
    !directoryMetadata.isDirectory() ||
    directoryMetadata.isSymbolicLink() ||
    !parentMetadata.isDirectory() ||
    parentMetadata.isSymbolicLink()
  ) {
    throw new Error('workflow directory and its parent must be regular directories')
  }

  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => /\.ya?ml$/i.test(entry.name))
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((entry) => {
      const file = join(directory, entry.name)
      if (!entry.isFile() || !lstatSync(file).isFile()) {
        throw new Error(`${entry.name} must be a regular file`)
      }
      return {
        content: readFileSync(file, 'utf8'),
        path: `.github/workflows/${basename(file)}`,
      }
    })
}

const runCli = () => {
  const directory = process.argv[2]
  if (!directory) throw new Error('workflow directory argument is required')

  const controlRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
  const trustedEntries = loadWorkflowDirectory(join(controlRoot, '.github/workflows'))
  const candidateEntries = loadWorkflowDirectory(directory)
  const trustedContract = createTrustedWorkflowContract(trustedEntries)
  const errors = validateWorkflowSet(candidateEntries, trustedContract)
  if (errors.length > 0) {
    process.stderr.write(`${errors.join('\n')}\n`)
    process.exitCode = 1
  } else {
    process.stdout.write(`Validated ${candidateEntries.length} candidate workflow file(s).\n`)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli()
}
