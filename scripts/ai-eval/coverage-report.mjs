import {
  createCoverageReport,
  readEvaluationFixtures,
  validateEvaluationFixtures,
} from './lib.mjs'

const { cases, sources } = readEvaluationFixtures()
const errors = validateEvaluationFixtures(cases, sources)

if (errors.length > 0) {
  for (const error of errors) {
    console.error(`Cannot create coverage report: ${error}`)
  }
  process.exit(1)
}

console.log(createCoverageReport(cases, sources))
