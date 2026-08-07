import { appendFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

import { classificationKeys } from './classify-changes.mjs'

const e2eKeys = ['website_e2e', 'website_visual_e2e', 'inquiry_e2e', 'admin_e2e', 'chat_e2e']

const heavyKeys = ['database', ...e2eKeys, 'operations', 'production_image', 'full_fallback']

export function validateClassification(classification) {
  const errors = []

  if (!classification || typeof classification !== 'object' || Array.isArray(classification)) {
    return ['classification is missing or invalid']
  }

  for (const key of classificationKeys) {
    if (typeof classification[key] !== 'boolean') {
      errors.push(`classification.${key} is missing or not boolean`)
    }
  }

  if (errors.length > 0) {
    return errors
  }

  const heavyFlags = heavyKeys.map((key) => classification[key])
  if (classification.docs_only && (classification.code || heavyFlags.some(Boolean))) {
    errors.push('docs_only classification cannot enable code or heavy flags')
  }
  if (!classification.docs_only && !classification.code) {
    errors.push('non-document classification must enable code')
  }
  if (classification.full_fallback && (!classification.code || heavyFlags.some((flag) => !flag))) {
    errors.push('full_fallback must enable every code and heavy flag')
  }

  return errors
}

export function createValidationPlan({ eventName, isDraft, classification, forceFull = false }) {
  const errors = validateClassification(classification)

  if (eventName !== 'pull_request' && eventName !== 'push') {
    errors.push(`unsupported event: ${eventName || 'missing'}`)
  }
  if (typeof isDraft !== 'boolean') {
    errors.push('isDraft is missing or not boolean')
  }
  if (eventName === 'push' && isDraft === true) {
    errors.push('push events cannot be Draft')
  }
  if (typeof forceFull !== 'boolean') {
    errors.push('forceFull is missing or not boolean')
  }
  if (forceFull && classification?.full_fallback !== true) {
    errors.push('forceFull requires full_fallback')
  }

  if (errors.length > 0) {
    throw new Error(errors.join('; '))
  }

  const readyOrMain = forceFull || eventName === 'push' || isDraft === false
  const e2eSelected = e2eKeys.some((key) => classification[key])
  const heavyRequired = heavyKeys.some((key) => classification[key])
  const fastRequired = classification.code

  return {
    buildRequired:
      readyOrMain && classification.code && (classification.production_image || e2eSelected),
    databaseRequired:
      readyOrMain && classification.code && (classification.database || e2eSelected),
    e2eRequired: readyOrMain && classification.code && e2eSelected,
    fastRequired,
    heavyRequired,
    mode: classification.docs_only ? 'docs-only' : readyOrMain ? 'full-policy' : 'fast-only',
    operationsRequired: readyOrMain && classification.code && classification.operations,
    readyOrMain,
  }
}

const parseBoolean = (name, value) => {
  if (value === 'true') return true
  if (value === 'false') return false
  throw new Error(`${name} must be true or false`)
}

const runCli = () => {
  try {
    const classification = Object.fromEntries(
      classificationKeys.map((key) => [key, parseBoolean(key, process.env[key.toUpperCase()])]),
    )
    const plan = createValidationPlan({
      classification,
      eventName: process.env.EVENT_NAME,
      forceFull: parseBoolean('FORCE_FULL', process.env.FORCE_FULL),
      isDraft: parseBoolean('IS_DRAFT', process.env.IS_DRAFT),
    })

    const outputs = {
      build_required: plan.buildRequired,
      database_required: plan.databaseRequired,
      e2e_required: plan.e2eRequired,
      fast_required: plan.fastRequired,
      heavy_required: plan.heavyRequired,
      mode: plan.mode,
      operations_required: plan.operationsRequired,
      ready_or_main: plan.readyOrMain,
    }
    const output = `${Object.entries(outputs)
      .map(([key, value]) => `${key}=${String(value)}`)
      .join('\n')}\n`

    if (process.env.GITHUB_OUTPUT) {
      appendFileSync(process.env.GITHUB_OUTPUT, output)
    } else {
      process.stdout.write(JSON.stringify({ classification, plan }) + '\n')
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : 'unknown planning error'}\n`)
    process.exitCode = 1
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli()
}
