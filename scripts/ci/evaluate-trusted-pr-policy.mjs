import { appendFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const shaPattern = /^[0-9a-f]{40}$/
const acceptedResults = new Set(['success', 'failure', 'cancelled', 'skipped'])

const expectSuccess = (name, value, errors) => {
  if (!acceptedResults.has(value)) {
    errors.push(`${name} result is missing or invalid`)
  } else if (value !== 'success') {
    errors.push(`${name}: expected success, got ${value}`)
  }
}

export function evaluateTrustedPrPolicy({
  baseSha,
  checkedHeadSha,
  eventName,
  expectedHeadSha,
  results,
}) {
  const errors = []

  if (eventName !== 'pull_request_target') {
    errors.push('trusted PR policy requires pull_request_target')
  }
  if (!shaPattern.test(baseSha ?? '')) errors.push('base SHA is missing or invalid')
  if (!shaPattern.test(expectedHeadSha ?? '')) {
    errors.push('expected head SHA is missing or invalid')
  }
  if (!shaPattern.test(checkedHeadSha ?? '')) {
    errors.push('checked candidate SHA is missing or invalid')
  } else if (checkedHeadSha !== expectedHeadSha) {
    errors.push('checked candidate SHA does not match the expected PR head')
  }

  expectSuccess('control', results?.control, errors)
  expectSuccess('validation', results?.validation, errors)

  return {
    errors,
    mode: 'trusted-full',
    ok: errors.length === 0,
  }
}

const runCli = () => {
  const evaluation = evaluateTrustedPrPolicy({
    baseSha: process.env.BASE_SHA,
    checkedHeadSha: process.env.CHECKED_HEAD_SHA,
    eventName: process.env.EVENT_NAME,
    expectedHeadSha: process.env.EXPECTED_HEAD_SHA,
    results: {
      control: process.env.CONTROL_RESULT,
      validation: process.env.VALIDATION_RESULT,
    },
  })

  const summary = [
    '## CI policy',
    '',
    '- Source: base-owned `pull_request_target`',
    `- Base revision: \`${process.env.BASE_SHA ?? 'missing'}\``,
    `- Expected head: \`${process.env.EXPECTED_HEAD_SHA ?? 'missing'}\``,
    `- Checked head: \`${process.env.CHECKED_HEAD_SHA ?? 'missing'}\``,
    `- Control result: \`${process.env.CONTROL_RESULT ?? 'missing'}\``,
    `- Validation result: \`${process.env.VALIDATION_RESULT ?? 'missing'}\``,
    '- Mode: trusted full validation.',
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
