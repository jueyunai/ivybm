import { appendFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const booleanKeys = [
  'docs_only',
  'code',
  'database',
  'ui_e2e',
  'operations',
  'production_image',
  'full_fallback',
]

const resultValues = new Set(['success', 'failure', 'cancelled', 'skipped'])

const validateClassification = (classification, errors) => {
  const initialErrorCount = errors.length
  for (const key of booleanKeys) {
    if (typeof classification[key] !== 'boolean') {
      errors.push(`classification.${key} is missing or not boolean`)
    }
  }

  if (errors.length > initialErrorCount) {
    return
  }

  const heavyFlags = [
    classification.database,
    classification.ui_e2e,
    classification.operations,
    classification.production_image,
    classification.full_fallback,
  ]

  if (classification.docs_only && (classification.code || heavyFlags.some(Boolean))) {
    errors.push('docs_only classification cannot enable code or heavy flags')
  }
  if (!classification.docs_only && !classification.code) {
    errors.push('non-document classification must enable code')
  }
  if (classification.full_fallback && (!classification.code || heavyFlags.some((flag) => !flag))) {
    errors.push('full_fallback must enable every code and heavy flag')
  }
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

export function evaluateCiPolicy({ eventName, isDraft, headSha, classification, results }) {
  const errors = []

  if (eventName !== 'pull_request' && eventName !== 'push') {
    errors.push(`unsupported event: ${eventName || 'missing'}`)
  }
  if (typeof isDraft !== 'boolean') {
    errors.push('isDraft is missing or not boolean')
  }
  if (typeof headSha !== 'string' || !/^[0-9a-f]{40}$/.test(headSha)) {
    errors.push('head SHA is missing or invalid')
  }

  validateClassification(classification, errors)
  expectResult('changes', 'success', results.changes, errors)

  const validClassification = booleanKeys.every((key) => typeof classification[key] === 'boolean')
  let heavyRequired = true
  let fullGateRequired = true
  let mode = 'invalid'

  if (validClassification) {
    heavyRequired =
      classification.database ||
      classification.ui_e2e ||
      classification.operations ||
      classification.production_image ||
      classification.full_fallback

    const readyOrMain = eventName === 'push' || isDraft === false
    fullGateRequired = classification.code && heavyRequired && readyOrMain

    expectResult('fast', classification.code ? 'success' : 'skipped', results.fast, errors)
    expectResult('full_gate', fullGateRequired ? 'success' : 'skipped', results.fullGate, errors)

    if (eventName === 'pull_request' && isDraft) {
      mode = 'fast-only'
    } else {
      mode = 'full-policy'
    }
  }

  return {
    errors,
    fullGateRequired,
    heavyRequired,
    mode,
    ok: errors.length === 0,
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
      booleanKeys.map((key) => [key, parseBoolean(key, process.env[key.toUpperCase()])]),
    )
    evaluation = evaluateCiPolicy({
      eventName: process.env.EVENT_NAME,
      isDraft: parseBoolean('IS_DRAFT', process.env.IS_DRAFT),
      headSha: process.env.HEAD_SHA,
      classification,
      results: {
        changes: process.env.CHANGES_RESULT,
        fast: process.env.FAST_RESULT,
        fullGate: process.env.FULL_GATE_RESULT,
      },
    })
  } catch (error) {
    evaluation = {
      errors: [error instanceof Error ? error.message : 'unknown policy input error'],
      mode: 'invalid',
      ok: false,
    }
  }

  const classificationSummary = booleanKeys
    .map((key) => `${key}=${process.env[key.toUpperCase()] ?? 'missing'}`)
    .join(', ')

  const summary = [
    '## CI policy',
    '',
    `- Event: \`${process.env.EVENT_NAME ?? 'missing'}\``,
    `- Revision: \`${process.env.HEAD_SHA ?? 'missing'}\``,
    `- Classification: ${classificationSummary}`,
    evaluation.mode === 'fast-only'
      ? '- Mode: Fast CI only; Draft PR is not merge-ready.'
      : '- Mode: Full policy for the current revision.',
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
