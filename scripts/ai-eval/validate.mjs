import { readEvaluationFixtures, validateEvaluationFixtures } from './lib.mjs'

const { cases, sources } = readEvaluationFixtures()
const errors = validateEvaluationFixtures(cases, sources)

if (errors.length > 0) {
  for (const error of errors) {
    console.error(`AI evaluation gate failed: ${error}`)
  }
  process.exit(1)
}

console.log(`AI evaluation gate passed: ${cases.length} cases and ${sources.length} sources checked.`)
