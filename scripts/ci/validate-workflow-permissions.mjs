import { readFileSync, readdirSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { isAlias, isMap, isScalar, isSeq, parseDocument } from 'yaml'

const workflowPath = '.github/workflows/ci.yml'
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

const visitValues = (value, location, callback) => {
  if (Array.isArray(value)) {
    value.forEach((item, index) => visitValues(item, `${location}.${index}`, callback))
    return
  }
  if (!isPlainObject(value)) return
  for (const [key, child] of Object.entries(value)) {
    const childLocation = `${location}.${key}`
    callback(key, child, childLocation)
    visitValues(child, childLocation, callback)
  }
}

const validateActionsAndSecrets = ({ errors, path, workflow }) => {
  visitValues(workflow, 'workflow', (key, value, location) => {
    if (key === 'uses') {
      if (typeof value !== 'string' || !remoteActionPattern.test(value)) {
        errors.push(`${path}:${location}: remote action must be pinned to a 40-character SHA`)
      }
    }
    if (typeof value !== 'string' || !/\bsecrets\b/.test(value)) return

    const allowedGhcrSecret =
      path === workflowPath &&
      /^\$\{\{\s*secrets\.GITHUB_TOKEN\s*\}\}$/.test(value) &&
      location.startsWith(`workflow.jobs.${publishJobId}.steps.`) &&
      location.endsWith('.with.password')
    if (!allowedGhcrSecret) {
      errors.push(`${path}:${location}: secrets context is forbidden in candidate workflows`)
    }
  })
}

const validateWorkflow = (entry, errors) => {
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
    const isPublisher = entry.path === workflowPath && jobId === publishJobId
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

  validateActionsAndSecrets({ errors, path: entry.path, workflow })
}

export function validateWorkflowSet(workflows) {
  const errors = []
  if (!Array.isArray(workflows) || workflows.length === 0) {
    return ['candidate workflow set is empty or invalid']
  }
  if (workflows.length > 50) return ['candidate workflow set exceeds the 50-file limit']

  for (const entry of workflows) validateWorkflow(entry, errors)
  return errors
}

const runCli = () => {
  const directory = process.argv[2]
  if (!directory) throw new Error('workflow directory argument is required')
  const entries = readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.ya?ml$/i.test(entry.name))
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((entry) => {
      const file = join(directory, entry.name)
      if (statSync(file).size > 1_000_000) {
        return { content: '', path: `.github/workflows/${basename(file)}` }
      }
      return {
        content: readFileSync(file, 'utf8'),
        path: `.github/workflows/${basename(file)}`,
      }
    })

  const errors = validateWorkflowSet(entries)
  if (errors.length > 0) {
    process.stderr.write(`${errors.join('\n')}\n`)
    process.exitCode = 1
  } else {
    process.stdout.write(`Validated ${entries.length} candidate workflow file(s).\n`)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli()
}
