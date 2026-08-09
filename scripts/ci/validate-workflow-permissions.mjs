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

const createPublisherAuthorityEnvelope = (workflow) => {
  // Freeze every workflow-level field so newly supported inherited settings cannot
  // silently change the effective environment of the packages-write publisher.
  const workflowSettings = Object.fromEntries(
    Object.entries(workflow).filter(([key]) => key !== 'jobs'),
  )
  return stableSerialize({
    job: workflow.jobs?.[publishJobId],
    workflow: workflowSettings,
  })
}

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

const actionRepository = (value) => {
  if (typeof value !== 'string') return ''
  const separator = value.lastIndexOf('@')
  const [owner, repository] = value.slice(0, separator).split('/')
  return owner && repository ? `${owner}/${repository}`.toLowerCase() : ''
}

const validateActionsAndCredentials = ({ errors, path, trustedContract, workflow }) => {
  visitValues(workflow, 'workflow', ({ key, location, value }) => {
    if (typeof key === 'string' && key.toLowerCase() === 'secrets') {
      errors.push(`${path}:${location}: secrets mapping is forbidden in candidate workflows`)
    }
    if (key === 'uses') {
      if (typeof value !== 'string' || !remoteActionPattern.test(value)) {
        errors.push(`${path}:${location}: remote action must be pinned to a 40-character SHA`)
      }
      if (
        actionRepository(value) === 'actions/checkout' &&
        value !== trustedContract.checkoutAction
      ) {
        errors.push(`${path}:${location}: checkout action must match the trusted pinned action`)
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
      if (!isPlainObject(step) || actionRepository(step.uses) !== 'actions/checkout') return
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

const findStep = (job, predicate) =>
  Array.isArray(job?.steps)
    ? job.steps.find((step) => isPlainObject(step) && predicate(step))
    : null

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
    createPublisherAuthorityEnvelope(workflow) !== trustedContract.publisherAuthorityEnvelope
  ) {
    errors.push(
      `${entry.path}.jobs.${publishJobId}: publisher authority envelope is not allowlisted`,
    )
  }

  if (entry.path === trustedWorkflowPath) {
    if (stableSerialize(workflow) !== trustedContract.trustedWorkflow) {
      errors.push(`${entry.path}: trusted PR workflow contract is invalid`)
      errors.push(`${entry.path}: trusted PR workflow must exactly match the base-owned contract`)
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
    publisherAuthorityEnvelope: createPublisherAuthorityEnvelope(ciWorkflow),
    publisherSecrets,
    trustedWorkflow: stableSerialize(trustedWorkflow),
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
    typeof trustedContract.publisherAuthorityEnvelope !== 'string' ||
    typeof trustedContract.checkoutAction !== 'string' ||
    typeof trustedContract.trustedWorkflow !== 'string' ||
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
