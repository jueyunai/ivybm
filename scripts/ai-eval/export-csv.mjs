import {
  createEvaluationCsv,
  readEvaluationFixtures,
  validateEvaluationFixtures,
} from './lib.mjs'

const { cases, sources } = readEvaluationFixtures()
const errors = validateEvaluationFixtures(cases, sources)

if (errors.length > 0) {
  for (const error of errors) {
    console.error(`Cannot export evaluation CSV: ${error}`)
  }
  process.exit(1)
}

console.log(createEvaluationCsv(cases))
