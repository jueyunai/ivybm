import { appendFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

import { classificationKeys } from './classify-changes.mjs'
import { createValidationPlan, validateClassification } from './plan-validation.mjs'

const resultValues = new Set(['success', 'failure', 'cancelled', 'skipped'])
const controlSources = new Set([
  'bootstrap-candidate-control-change',
  'candidate-control-change',
  'trusted-base',
  'trusted-main',
])
const candidateControlSources = new Set([
  'bootstrap-candidate-control-change',
  'candidate-control-change',
])

const validateSha = (name, value, errors) => {
  if (typeof value !== 'string' || !/^[0-9a-f]{40}$/.test(value)) {
    errors.push(`${name} SHA is missing or invalid`)
    return false
  }
  return true
}

const expectResult = (name, expected, actual, errors) => {
  if (!resultValues.has(actual)) {
    errors.push(`${name} result is missing or invalid`)
    return
  }
  if (actual !== expected) {
    errors.push(`${name}: expected ${expected}, got ${actual}`)
  }
}

export function evaluateCiPolicy({
  eventName,
  isDraft,
  expectedHeadSha,
  resolvedHeadSha,
  checkedOutSha,
  classification,
  controlSource = 'trusted-base',
  forceFull = false,
  results,
}) {
  const errors = validateClassification(classification)
  let plan = null

  if (eventName === 'pull_request') {
    errors.push('candidate-owned pull_request cannot authorize CI policy')
  } else if (eventName !== 'pull_request_target' && eventName !== 'push') {
    errors.push(`unsupported event: ${eventName || 'missing'}`)
  }
  if (typeof isDraft !== 'boolean') {
    errors.push('isDraft is missing or not boolean')
  }
  if (eventName === 'push' && isDraft === true) {
    errors.push('push events cannot be Draft')
  }
  if (!controlSources.has(controlSource)) {
    errors.push('control source is missing or invalid')
  }
  if (candidateControlSources.has(controlSource) && forceFull !== true) {
    errors.push('candidate control changes must force full validation')
  }
  if (eventName === 'push' && controlSource !== 'trusted-main') {
    errors.push('push events must use the trusted main control plane')
  }

  const expectedValid = validateSha('expected head', expectedHeadSha, errors)
  const resolvedValid = validateSha('resolved head', resolvedHeadSha, errors)
  const checkedOutValid = validateSha('checked out', checkedOutSha, errors)
  if (expectedValid && resolvedValid && expectedHeadSha !== resolvedHeadSha) {
    errors.push('resolved head SHA does not match expected head SHA')
  }
  if (expectedValid && checkedOutValid && expectedHeadSha !== checkedOutSha) {
    errors.push('checked out SHA does not match expected head SHA')
  }

  try {
    plan = createValidationPlan({ classification, eventName, forceFull, isDraft })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'invalid validation plan'
    for (const part of message.split('; ')) {
      if (!errors.includes(part)) errors.push(part)
    }
  }

  const safeResults = results && typeof results === 'object' ? results : {}
  expectResult('validation', 'success', safeResults.validation, errors)

  if (plan) {
    expectResult('fast', plan.fastRequired ? 'success' : 'skipped', safeResults.fast, errors)
    expectResult(
      'database',
      plan.databaseRequired ? 'success' : 'skipped',
      safeResults.database,
      errors,
    )
    expectResult('build', plan.buildRequired ? 'success' : 'skipped', safeResults.build, errors)
    expectResult('e2e', plan.e2eRequired ? 'success' : 'skipped', safeResults.e2e, errors)
    expectResult(
      'operations',
      plan.operationsRequired ? 'success' : 'skipped',
      safeResults.operations,
      errors,
    )
    expectResult(
      'cleanup',
      plan.databaseRequired ? 'success' : 'skipped',
      safeResults.cleanup,
      errors,
    )
  }

  return {
    errors,
    heavyRequired: plan?.heavyRequired ?? true,
    mode: plan?.mode ?? 'invalid',
    ok: errors.length === 0,
    plan,
  }
}

const parseBoolean = (name, value) => {
  if (value === 'true') return true
  if (value === 'false') return false
  throw new Error(`${name} must be true or false`)
}

const runCli = () => {
  let evaluation

  try {
    const classification = Object.fromEntries(
      classificationKeys.map((key) => [key, parseBoolean(key, process.env[key.toUpperCase()])]),
    )
    evaluation = evaluateCiPolicy({
      checkedOutSha: process.env.CHECKED_OUT_SHA,
      classification,
      controlSource: process.env.CONTROL_SOURCE,
      eventName: process.env.EVENT_NAME,
      expectedHeadSha: process.env.EXPECTED_HEAD_SHA,
      forceFull: parseBoolean('FORCE_FULL', process.env.FORCE_FULL),
      isDraft: parseBoolean('IS_DRAFT', process.env.IS_DRAFT),
      resolvedHeadSha: process.env.RESOLVED_HEAD_SHA,
      results: {
        build: process.env.BUILD_RESULT,
        cleanup: process.env.CLEANUP_RESULT,
        database: process.env.DATABASE_RESULT,
        e2e: process.env.E2E_RESULT,
        fast: process.env.FAST_RESULT,
        operations: process.env.OPERATIONS_RESULT,
        validation: process.env.VALIDATION_RESULT,
      },
    })
  } catch (error) {
    evaluation = {
      errors: [error instanceof Error ? error.message : 'unknown policy input error'],
      mode: 'invalid',
      ok: false,
    }
  }

  const classificationSummary = classificationKeys
    .map((key) => `${key}=${process.env[key.toUpperCase()] ?? 'missing'}`)
    .join(', ')
  const resultSummary = ['validation', 'fast', 'database', 'build', 'e2e', 'operations', 'cleanup']
    .map((key) => `${key}=${process.env[`${key.toUpperCase()}_RESULT`] ?? 'missing'}`)
    .join(', ')
  const prState =
    process.env.EVENT_NAME === 'pull_request' || process.env.EVENT_NAME === 'pull_request_target'
      ? process.env.IS_DRAFT === 'true'
        ? 'Draft'
        : process.env.IS_DRAFT === 'false'
          ? 'Ready'
          : 'Invalid'
      : 'Not applicable'
  const modeSummary =
    evaluation.mode === 'fast-only'
      ? 'Fast CI only; Draft PR is not merge-ready.'
      : evaluation.mode === 'docs-only'
        ? 'Documentation-only validation.'
        : evaluation.mode === 'full-policy'
          ? 'Full policy for the current revision.'
          : 'Invalid policy state.'

  const summary = [
    '## CI policy',
    '',
    `- Event: \`${process.env.EVENT_NAME ?? 'missing'}\``,
    `- Expected revision: \`${process.env.EXPECTED_HEAD_SHA ?? 'missing'}\``,
    `- Resolved revision: \`${process.env.RESOLVED_HEAD_SHA ?? 'missing'}\``,
    `- Checked out revision: \`${process.env.CHECKED_OUT_SHA ?? 'missing'}\``,
    `- CI control source: \`${process.env.CONTROL_SOURCE ?? 'missing'}\``,
    `- Forced full validation: \`${process.env.FORCE_FULL ?? 'missing'}\``,
    `- PR state: ${prState}`,
    `- Classification: ${classificationSummary}`,
    `- Stage results: ${resultSummary}`,
    `- Mode: ${modeSummary}`,
  ]

  if (!evaluation.ok) {
    summary.push('', '### Policy errors', ...evaluation.errors.map((error) => `- ${error}`))
    process.stderr.write(`${evaluation.errors.join('\n')}\n`)
    process.exitCode = 1
  }

  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary.join('\n')}\n`)
  } else {
    process.stdout.write(`${summary.join('\n')}\n`)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli()
}
